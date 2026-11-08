import unittest
from unittest.mock import patch

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.pipeline import Pipeline

from risk_explanations import explain_risk
from train_models import build_preprocessor, RISK_FEATURE_COLUMNS


def record(**changes):
    return {
        "educationalSpecialNeeds": False, "tuitionFeeStatus": True,
        "scholarshipStatus": False, "studySchedule": "day",
        "previousSemesterUnitsEnrolled": 18, "previousSemesterUnitsApproved": 18,
        "previousSemesterGrade": 9.0, "gradeMaximum": 20.0, **changes,
    }


class RiskExplanationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Keep Dropout at a nonzero class index to catch accidental class-0 use.
        rows, labels = [], []
        for grade in (0, 5, 10, 15, 20):
            for approved in (0, 3, 6):
                for schedule in (0, 1):
                    for fees in (0, 1):
                        rows.append({
                            "Educational special needs": 0,
                            "Tuition fees up to date": fees,
                            "Scholarship holder": grade % 2,
                            "Daytime/evening attendance": schedule,
                            "Curricular units 1st sem (enrolled)": 6,
                            "Curricular units 1st sem (approved)": approved,
                            "Semester 1 completion rate": approved / 6,
                            "Curricular units 1st sem (grade)": grade,
                        })
                        labels.append("Dropout" if grade < 8 or not fees or not approved else
                                      "ZGraduate" if grade >= 15 and approved == 6 else "AContinuing")
        cls.features = pd.DataFrame(rows)
        cls.model = Pipeline([
            ("preprocessor", build_preprocessor(RISK_FEATURE_COLUMNS)),
            ("classifier", RandomForestClassifier(n_estimators=9, random_state=42, n_jobs=1)),
        ]).fit(cls.features, labels)

    def test_contributions_reconstruct_each_students_probability(self):
        self.assertEqual(list(self.model.classes_).index("Dropout"), 1)
        for index in range(len(self.features)):
            sample = self.features.iloc[[index]]
            expected = float(self.model.predict_proba(sample)[0, 1])
            explanation = explain_risk(self.model, sample, record(), expected)
            reconstructed = explanation["baselineProbability"] + sum(
                item["contributionPercentagePoints"] / 100 for item in explanation["factors"]
            )
            self.assertAlmostEqual(reconstructed, expected, places=7)
            self.assertTrue(explanation["available"])

    def test_groups_related_completion_inputs_and_one_hot_schedule(self):
        sample = self.features.iloc[[20]]
        probability = float(self.model.predict_proba(sample)[0, 1])
        explanation = explain_risk(self.model, sample, record(), probability)
        factors = {item["key"]: item for item in explanation["factors"]}
        self.assertEqual(len(factors), 6)
        self.assertEqual(factors["courseCompletion"]["value"], "18 of 18 units passed (100% completion)")
        self.assertEqual(factors["previousGrade"]["value"], "9 / 20")
        self.assertEqual(factors["studySchedule"]["value"], "Daytime classes")
        for factor in factors.values():
            points = factor["contributionPercentagePoints"]
            expected = "increases_risk" if points > 0 else "decreases_risk" if points < 0 else "neutral"
            self.assertEqual(factor["direction"], expected)

    def test_does_not_silently_explain_a_different_probability(self):
        sample = self.features.iloc[[20]]
        probability = float(self.model.predict_proba(sample)[0, 1])
        with self.assertRaisesRegex(ValueError, "reconstruct"):
            explain_risk(self.model, sample, record(), probability + 0.1)

    def test_leaf_only_trees_produce_neutral_factors(self):
        model = Pipeline([
            ("preprocessor", build_preprocessor(RISK_FEATURE_COLUMNS)),
            ("classifier", RandomForestClassifier(n_estimators=3, random_state=42)),
        ]).fit(self.features, ["Dropout"] * len(self.features))
        explanation = explain_risk(model, self.features.iloc[[0]], record(), 1.0)
        self.assertEqual(explanation["baselineProbability"], 1)
        self.assertTrue(all(item["direction"] == "neutral" for item in explanation["factors"]))


class DeployedModelExplanationTests(unittest.TestCase):
    def test_api_explains_real_artifact_without_changing_predictions(self):
        from app import PredictionInput, predict, risk_model, to_model_features

        for changes in [
            {},
            {"tuitionFeeStatus": False},
            {"previousSemesterUnitsApproved": 3, "previousSemesterGrade": 2},
            {"previousSemesterGrade": 4.12, "gradeMaximum": 5, "studySchedule": "night"},
        ]:
            payload = PredictionInput(**record(**changes))
            features = to_model_features(payload)
            expected = float(risk_model.predict_proba(features)[0, list(risk_model.classes_).index("Dropout")])
            result = predict(payload)
            self.assertEqual(result["dropoutProbability"], round(expected, 4))
            explanation = result["riskExplanation"]
            self.assertTrue(explanation["available"])
            reconstructed = explanation["baselineProbability"] + sum(
                factor["contributionPercentagePoints"] / 100 for factor in explanation["factors"]
            )
            self.assertAlmostEqual(reconstructed, expected, places=7)
            if changes.get("gradeMaximum") == 5:
                grade_factor = next(f for f in explanation["factors"] if f["key"] == "previousGrade")
                self.assertEqual(grade_factor["value"], "4.12 / 5")

    def test_explanation_failure_keeps_forecast_available_without_fabricating_reasons(self):
        from app import PredictionInput, predict

        with patch("app.explain_risk", side_effect=ValueError("Incompatible artifact")):
            with self.assertLogs("app", level="ERROR"):
                result = predict(PredictionInput(**record()))
        self.assertIsInstance(result["dropoutProbability"], float)
        self.assertEqual(result["riskExplanation"], {"available": False})


if __name__ == "__main__":
    unittest.main()

import csv
from io import StringIO
from types import SimpleNamespace
import unittest

import numpy as np
import pandas as pd

from dataset_report import DatasetReport, DatasetViewUnavailable
from train_models import (
    GRADE_FEATURE_COLUMNS, GRADE_TARGET, RISK_FEATURE_COLUMNS,
    add_completion_rate, build_preprocessor, clean_data,
)


def row(**changes):
    return {
        "Educational special needs": 0, "Tuition fees up to date": 1,
        "Scholarship holder": 0, "Daytime/evening attendance": 1,
        "Curricular units 1st sem (enrolled)": 6,
        "Curricular units 1st sem (approved)": 4,
        "Curricular units 1st sem (grade)": 12,
        GRADE_TARGET: 13, "Target": "Graduate", **changes,
    }


class DatasetReportTests(unittest.TestCase):
    def setUp(self):
        self.raw = pd.DataFrame([
            row(), row(),  # Exact duplicate must be found before source IDs exist.
            row(**{"Curricular units 1st sem (enrolled)": 0,
                   "Curricular units 1st sem (approved)": 0, "Target": "Dropout"}),
            row(**{"Curricular units 1st sem (approved)": 0,
                   "Curricular units 1st sem (grade)": 0, "Target": " dropout "}),
            row(**{"Curricular units 1st sem (grade)": "bad", "Target": "Other"}),
        ])

    def test_cleaning_audit_matches_training_and_preserves_source_rows(self):
        report = DatasetReport(self.raw)
        counts = report.summary["counts"]
        self.assertEqual((counts["original"], counts["cleaned"], counts["excluded"], counts["duplicates"]), (5, 2, 3, 1))
        self.assertEqual(report.frames["cleaned"]["Source row"].tolist(), ["SRC-000001", "SRC-000004"])
        self.assertEqual(report.frames["cleaned"]["Target"].tolist(), ["Graduate", "Dropout"])
        self.assertEqual(report.frames["cleaned"]["Semester 1 completion rate"].tolist(), [4 / 6, 0])
        self.assertEqual(report.frames["excluded"]["Source row"].tolist(), ["SRC-000002", "SRC-000003", "SRC-000005"])
        self.assertIn("Exact duplicate", report.frames["excluded"].iloc[0]["Exclusion reason"])
        self.assertIn("Fewer than one enrolled", report.frames["excluded"].iloc[1]["Exclusion reason"])
        rules = {item["id"]: item["count"] for item in report.summary["rules"]}
        self.assertEqual(rules["target"], 1)
        self.assertEqual(rules["missing_academic"], 1)

    def test_pagination_filter_and_csv_select_the_same_records(self):
        report = DatasetReport(self.raw)
        result = report.rows("raw", page=2, page_size=2)
        self.assertEqual(result["total"], 5)
        self.assertEqual([item["Source row"] for item in result["rows"]], ["SRC-000003", "SRC-000004"])
        filtered = report.rows("raw", outcome="Dropout", search="SRC-000004")
        self.assertEqual(filtered["total"], 1)
        downloaded = list(csv.DictReader(StringIO(report.csv("raw", outcome="Dropout", search="SRC-000004"))))
        self.assertEqual(downloaded[0]["Source row"], filtered["rows"][0]["Source row"])
        self.assertEqual(report.rows("excluded", outcome="Unknown")["total"], 1)
        self.assertEqual(report.rows("cleaned", search=".*")["total"], 0, "Search is literal, not regex")

    def test_model_views_reuse_fitted_transforms_and_keep_targets_separate(self):
        cleaned = add_completion_rate(clean_data(self.raw))
        models = {}
        for name, features in (("risk", RISK_FEATURE_COLUMNS), ("grade", GRADE_FEATURE_COLUMNS)):
            fitted = build_preprocessor(features).fit(cleaned[features])
            # Report creation must never refit the saved preprocessing pipeline.
            fitted.fit = lambda *_args, **_kwargs: self.fail("Unexpected preprocessing fit")
            models[name] = SimpleNamespace(named_steps={"preprocessor": fitted})
        report = DatasetReport(self.raw, risk_model=models["risk"], grade_model=models["grade"])
        for name, features in (("risk", RISK_FEATURE_COLUMNS), ("grade", GRADE_FEATURE_COLUMNS)):
            fitted = models[name].named_steps["preprocessor"]
            names = list(fitted.get_feature_names_out())
            np.testing.assert_allclose(report.frames[name][names].to_numpy(), fitted.transform(cleaned[features]))
            self.assertNotIn("Target", report.summary["models"][name]["inputColumns"])
            self.assertNotIn(GRADE_TARGET, report.summary["models"][name]["inputColumns"])
            self.assertEqual(report.frames[name]["Source row"].tolist(), ["SRC-000001", "SRC-000004"])

    def test_missing_models_do_not_hide_the_cleaned_dataset(self):
        report = DatasetReport(self.raw)
        self.assertFalse(report.summary["models"]["risk"]["available"])
        self.assertEqual(report.rows("cleaned")["total"], 2)
        with self.assertRaises(DatasetViewUnavailable):
            report.rows("risk")
        with self.assertRaises(ValueError):
            report.rows("../../student-records")
        with self.assertRaises(ValueError):
            report.rows("raw", page_size=1000)

    def test_no_exclusions_and_missing_values_are_reported_truthfully(self):
        data = pd.DataFrame([row(**{"Educational special needs": np.nan})])
        report = DatasetReport(data)
        self.assertEqual(report.summary["counts"]["missingCells"], 1)
        self.assertEqual(report.rows("excluded")["total"], 0)
        self.assertEqual(report.summary["counts"]["cleaned"], 1)


if __name__ == "__main__":
    unittest.main()

"""Local, additive probability explanations for the deployed Random Forest.

Each split contributes the change in Dropout probability from parent to child.
Average these changes over trees, then group related inputs. The root average
plus all contributions reconstructs predict_proba for this student. This is a
tree-path decomposition, not SHAP, a causal analysis, or global importance.
"""

import numpy as np

from risk_thresholds import HIGH_RISK_THRESHOLD, MEDIUM_RISK_THRESHOLD, risk_level


FEATURE_GROUPS = {
    "Educational special needs": "learningSupport",
    "Tuition fees up to date": "tuitionStatus",
    "Scholarship holder": "scholarshipStatus",
    "Daytime/evening attendance": "studySchedule",
    "Curricular units 1st sem (enrolled)": "courseCompletion",
    "Curricular units 1st sem (approved)": "courseCompletion",
    "Semester 1 completion rate": "courseCompletion",
    "Curricular units 1st sem (grade)": "previousGrade",
}

LIMITATIONS = (
    "These factors explain how this model calculated your estimate; they do not "
    "prove why a student will leave or how much a particular action will change "
    "their risk. Contributions depend on the model's tree split order and related "
    "inputs. Units enrolled, units passed, and completion rate are grouped together. "
    "The starting estimate is the model's weighted training reference, not your "
    "personal history or your institution's actual dropout rate."
)


def _group_for(transformed_name):
    name = transformed_name.split("__", 1)[-1]
    for original, group in FEATURE_GROUPS.items():
        if name == original or name.startswith(original + "_"):
            return group
    raise ValueError(f"Cannot explain unmapped model input: {name}")


def _factor_context(record):
    enrolled = record["previousSemesterUnitsEnrolled"]
    approved = record["previousSemesterUnitsApproved"]
    completion = approved / enrolled * 100
    return {
        "previousGrade": (
            "Previous-semester grade",
            f'{record["previousSemesterGrade"]:g} / {record["gradeMaximum"]:g}',
            "Review the subjects you found difficult with your professor and plan regular practice or tutoring.",
        ),
        "courseCompletion": (
            "Course completion and study load",
            f"{approved} of {enrolled} units passed ({completion:.0f}% completion)",
            "Review any unfinished units and discuss a manageable course load and study plan with your adviser.",
        ),
        "tuitionStatus": (
            "Tuition-fee status",
            "Fees up to date" if record["tuitionFeeStatus"] else "Fees not up to date",
            "Ask the student-support or finance office about payment arrangements and available financial assistance.",
        ),
        "scholarshipStatus": (
            "Scholarship status",
            "Scholarship recorded" if record["scholarshipStatus"] else "No scholarship recorded",
            "Check scholarship or other financial-support options with the student-support office.",
        ),
        "studySchedule": (
            "Study schedule",
            "Daytime classes" if record["studySchedule"] == "day" else "Evening classes",
            "Plan study time around your class schedule and discuss practical scheduling barriers with your adviser.",
        ),
        "learningSupport": (
            "Recorded learning-support status",
            "Support needs declared" if record["educationalSpecialNeeds"] else "No support needs declared",
            "Discuss whether your learning arrangements and any requested accommodations meet your needs; check that your record is accurate.",
        ),
    }


def explain_risk(model, features, record, dropout_probability):
    preprocessor = model.named_steps["preprocessor"]
    forest = model.named_steps["classifier"]
    class_index = list(forest.classes_).index("Dropout")
    transformed = preprocessor.transform(features)
    if hasattr(transformed, "toarray"):
        transformed = transformed.toarray()
    # sklearn's trees make their predictions using float32 inputs.
    values = np.asarray(transformed, dtype=np.float32)[0]
    groups = [_group_for(name) for name in preprocessor.get_feature_names_out()]
    contributions = {group: 0.0 for group in set(FEATURE_GROUPS.values())}
    baseline = 0.0

    for estimator in forest.estimators_:
        tree = estimator.tree_

        def probability(node):
            distribution = tree.value[node, 0]
            return float(distribution[class_index] / distribution.sum())

        node = 0
        parent_probability = probability(node)
        baseline += parent_probability
        while tree.children_left[node] != tree.children_right[node]:
            feature_index = tree.feature[node]
            child = (
                tree.children_left[node]
                if float(values[feature_index]) <= tree.threshold[node]
                else tree.children_right[node]
            )
            child_probability = probability(child)
            contributions[groups[feature_index]] += child_probability - parent_probability
            node = child
            parent_probability = child_probability

    count = len(forest.estimators_)
    baseline /= count
    contributions = {key: value / count for key, value in contributions.items()}
    if not np.isclose(baseline + sum(contributions.values()), dropout_probability, atol=1e-8, rtol=0):
        raise ValueError("Risk explanation does not reconstruct the model prediction.")

    factors = []
    for key, (label, value, action) in _factor_context(record).items():
        points = round(contributions[key] * 100, 6)
        direction = "increases_risk" if points > 0 else "decreases_risk" if points < 0 else "neutral"
        if points:
            movement = "raised" if points > 0 else "lowered"
            amount = f"{abs(points):.2f}" if abs(points) >= 0.005 else "less than 0.01"
            explanation = f"{value}. In this model's calculation, this factor {movement} the estimate by {amount} percentage points from its starting estimate."
        else:
            explanation = f"{value}. This factor had no net contribution to this model's estimate."
        factors.append({
            "key": key, "label": label, "value": value, "direction": direction,
            "contributionPercentagePoints": points,
            "explanation": explanation, "suggestedAction": action,
        })

    factors.sort(key=lambda factor: (-abs(factor["contributionPercentagePoints"]), factor["key"]))
    level = risk_level(dropout_probability)
    return {
        "available": True,
        "method": "tree-path-contributions-v1",
        "baselineProbability": round(baseline, 8),
        "predictedProbability": round(dropout_probability, 8),
        "tierExplanation": (
            f"Your estimated dropout probability is {dropout_probability * 100:.2f}% ({level} risk). "
            f"Low risk is below {MEDIUM_RISK_THRESHOLD * 100:g}%; medium risk is "
            f"{MEDIUM_RISK_THRESHOLD * 100:g}% to below {HIGH_RISK_THRESHOLD * 100:g}%; "
            f"high risk is {HIGH_RISK_THRESHOLD * 100:g}% or above."
        ),
        "factors": factors,
        "limitations": LIMITATIONS,
    }

# ML training service

This training setup intentionally uses only fields compatible with the planned
student form. It excludes `Course`, because the Kaggle course codes do not
have a validated mapping to this university's courses.

## Model inputs

### Grade forecaster: academic factors only

- Semester-1 units enrolled
- Semester-1 units approved
- Semester-1 completion rate (`units approved / units enrolled`)
- Semester-1 average grade

### Attrition-risk model

- Educational special needs
- Tuition-fee status
- Scholarship holder
- Semester-1 units enrolled
- Semester-1 units approved
- Semester-1 completion rate (`units approved / units enrolled`)
- Semester-1 average grade
- Daytime/evening study schedule

The dataset's `Daytime/evening attendance` column represents study schedule,
not an attendance percentage. Keep this label distinct from a future real
attendance-rate field.

## Targets

- **Grade model:** Semester-1 information predicts `Curricular units 2nd sem (grade)`.
- **Risk model:** Semester-1 information predicts `Dropout`, `Enrolled`, or `Graduate`.

## Train locally

1. Place `dataset.csv` in `data/dataset.csv`.
2. Install Python 3.10 or later.
3. In this directory, run:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   py train_models.py
   ```

The command creates `artifacts/grade_model.joblib` and
`artifacts/risk_model.joblib`, which are the artifacts loaded by the prediction
API. They use **Linear Regression** for grade forecasting and a **Random Forest
Classifier** for attrition-risk classification, respectively.

Before splitting the data, training removes exact duplicate rows, normalizes
outcome labels (`Dropout`, `Enrolled`, and `Graduate`), and filters only
impossible academic records: fewer than one enrolled unit, negative approved
units, approved units exceeding enrolled units, or grades outside the dataset's
0–20 scale. Valid low grades and zero approved units are retained because they
are meaningful attrition signals.

## Improve the attrition-risk model

After preparing the dataset, run the tuned training workflow:

```powershell
python optimize_risk_model.py
```

It uses stratified five-fold cross-validation to tune the Random Forest for
**balanced accuracy** across dropout, enrolled, and graduate outcomes. The
candidate replaces the baseline only if it does not reduce either held-out
accuracy or held-out balanced accuracy. It writes the comparison to
`artifacts/risk_model_metrics.json`. Restart the ML service after training.

The metrics file includes three-class accuracy, balanced accuracy, macro and
weighted F1, plus dropout-specific precision, recall, F1, ROC-AUC, PR-AUC,
and Brier score. It also reports each operational risk tier's observed dropout
rate on the held-out students.

The prediction API exposes the dropout probability and only its operational
risk tier: `low` (below 0.20), `medium` (0.20–0.39), or `high` (0.40 and
above). The model's internal outcome classes are not returned to educators.

## Individual risk explanations

New forecasts include `riskExplanation`, calculated from this student's actual
paths through the fitted Random Forest. At each split, the change in Dropout
probability is assigned to the input used by that split. Averaging over trees
gives additive contributions: `baselineProbability + sum(contributions / 100)`
reconstructs the predicted dropout probability (allowing for output rounding).
The baseline is the average weighted root-node probability, not a population
dropout rate or the student's previous prediction. Contributions are measured
in **percentage points** and can increase or decrease the estimate.

One-hot schedule columns are combined. Units enrolled, units passed, and
completion rate are grouped to avoid presenting closely related values as
independent explanations. Values shown to the student retain their chosen
grading scale. This is a tree-path decomposition, not SHAP or causal evidence;
split order and correlated inputs can affect how contributions are allocated.
It does not promise that changing a field will change risk by that amount.

The backend passes these factors to Gemini and validates that reasons and
actions refer to supported factors with the correct direction. Older saved
forecasts are not retrospectively assigned reasons from a different model;
students must run a new forecast. Restart the ML service and backend after
updating, then run a new forecast before requesting support suggestions.

Implementation references: [Random Forest probabilities](https://scikit-learn.org/1.8/modules/generated/sklearn.ensemble.RandomForestClassifier.html#sklearn.ensemble.RandomForestClassifier.predict_proba)
and [decision-tree structure](https://scikit-learn.org/1.8/auto_examples/tree/plot_unveil_tree_structure.html).

## Flexible grading scales

The trained grade model uses the Kaggle dataset's `0–20` scale internally. The
prediction API should accept both `previousSemesterGrade` and
`gradeMaximum`, then convert only the grade value:

```text
Previous grade: 75 / 100 → model input: 15 / 20
Model result: 14 / 20     → displayed prediction: 70 / 100
```

The same conversion supports 4.0, 5.0, 20, 100, or another numeric scale.
`grading_scale.py` contains the conversion helpers and bounds the displayed
prediction to `0–gradeMaximum`.

## Run the prediction API

After installing the requirements and generating the model artifacts, start
FastAPI from this folder:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
```

The Express backend forwards authenticated `POST /api/ml/predict` requests to
this service. Its default `ML_SERVICE_URL` is `http://localhost:8000`; set
`ML_SERVICE_URL` in the backend environment only when the service runs on a
different host or port.

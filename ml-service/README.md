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
2. Install Python 3.11 or later (required by the pinned scikit-learn version).
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

## Reproduce the evaluation in Orange on another device

Use the same repository revision, `data/dataset.csv`, and both saved model
artifacts. Having the models alone is not enough: evaluation also needs the
historical records and their actual outcomes. Install the pinned dependencies
in this service's virtual environment; keep Orange in its own environment.

From `ml-service`, run:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe export_orange_evaluation.py
```

If the environment does not exist yet, create it first with
`py -m venv .venv` using Python 3.11 or later. Existing saved models are evaluated
without retraining or replacing them.

Generated files are placed in the git-ignored `artifacts/orange/` directory:

| File | Purpose |
| --- | --- |
| `grade_train.csv`, `grade_test.csv` | The exact unstratified 80/20 grade-model split, seed 42. |
| `grade_predictions.csv`, `grade_metrics.json` | Saved grade-model predictions, row-level errors, MAE, RMSE, R2 and the calculation totals. |
| `risk_train.csv`, `risk_test.csv` | The exact 80/20 risk-model split, stratified by the original outcome, seed 42. |
| `risk_predictions.csv`, `risk_metrics.json` | Saved risk-model predictions, dropout probabilities, actual outcomes and classification metrics. |
| `verify_saved_random_forest.py` | A self-contained Python Script widget program with this device's evaluated prediction snapshot. |
| `provenance.json` | Dataset/model SHA256 fingerprints, row counts, split information and dependency version. |

For the grade evaluation in Orange, load the two grade CSVs, set the second
semester grade as the numeric target in **Select Columns** on both paths, and
connect training data to **Test & Score / Data** and test data to
**Test & Score / Test Data**. Connect a **Linear Regression** learner with no
regularization and fit intercept enabled, then choose **Test on test data**.
This retrains an equivalent linear model in Orange. Compare its results with
`grade_metrics.json`, which evaluates the local saved grade model directly.

For the saved Random Forest verification:

1. Open a **Python Script** widget. Choose **More > Import Script from File**
   and select the generated `verify_saved_random_forest.py`, then click **Run**.
2. Add **Confusion Matrix**, **ROC Analysis**, and **Data Table** widgets.
3. Make these actual signal connections (drawn annotation arrows do not connect data):

   | Source signal | Destination signal |
   | --- | --- |
   | Python Script / Object | Confusion Matrix / Evaluation Results |
   | Python Script / Object | ROC Analysis / Evaluation Results |
   | Python Script / Data | Data Table / Data (the metrics table) |

4. In **Confusion Matrix**, choose **Number of instances**. In **ROC Analysis**,
   choose **Dropout** as the target.
5. Optionally connect **Confusion Matrix / Selected Data** to another
   **Data Table / Data** to inspect the students represented by selected cells.
6. Save the workflow as an `.ows` file. Run its Python Script again if outputs
   are blank after reopening.

The forest's original predicted outcome is mapped to Dropout/Not Dropout after
prediction. This preserves the existing binary evaluation; it does not train
a different binary forest and does not use the dashboard's 40% high-risk
threshold. Orange independently computes scores from the saved predictions.

The script embeds the evaluated records and predictions, so its saved workflow
can be shared without changing absolute paths. Opening someone else's workflow
replays their snapshot; it does **not** evaluate your device's model. To verify
your own model, rerun the exporter and import your newly generated script.

Compare `provenance.json` across developers before expecting identical metrics.
Different model or dataset files can produce different results. Fingerprints
identify the files evaluated, but held-out validity still depends on the models
having been trained with this dataset and the documented training split.

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

## Historical dataset transparency

Open the frontend directly at `http://localhost:3000/dataset`. The page is
public and read-only, with no entry in the home or dashboard navigation. It
shows the bundled historical CSV, not student accounts or application records.

The frontend requests `/api/dataset/summary`, `/api/dataset/rows`, and
`/api/dataset/download` through Express. Express forwards these fixed routes to
the matching `/dataset/*` endpoints on the FastAPI service. Start all three
services as usual. No database queries are needed by these dataset endpoints.

Raw, cleaned, excluded, and model-input views use stable CSV source-row IDs.
Cleaning and completion-rate engineering reuse `train_models.py`. Model-input
views call `transform` on the loaded fitted preprocessors, without refitting or
retraining. Targets are displayed separately. CSV downloads include all columns
and all matching rows under the current search and outcome filters. Page sizes
are limited to 100 records. The prepared report is cached in memory and refreshed
when the source file changes or the ML service restarts.

The source fingerprint identifies the local file being inspected. It does not
by itself certify equivalence to the original UCI release or establish which
dataset version trained an externally replaced model. Original and cleaned
views remain available if a fitted model is unavailable.

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

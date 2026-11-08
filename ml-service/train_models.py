"""Train the semester-grade and student-outcome models.

Expected data path: data/dataset.csv.  The data must contain the original
Kaggle column names used below.
"""

from pathlib import Path

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import (
    mean_absolute_error,
    r2_score,
    root_mean_squared_error,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from risk_metrics import evaluate_risk_model


BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "data" / "dataset.csv"
ARTIFACTS_DIR = BASE_DIR / "artifacts"

# These fields intentionally exclude Course. Kaggle's course codes do not map
# reliably to this university's programs, so using them in a deployed model
# would create an invalid input mapping.
# The attrition model keeps the broader set of form-compatible inputs.
RISK_FEATURE_COLUMNS = [
    "Educational special needs",
    "Tuition fees up to date",
    "Scholarship holder",
    "Daytime/evening attendance",
    "Curricular units 1st sem (enrolled)",
    "Curricular units 1st sem (approved)",
    "Semester 1 completion rate",
    "Curricular units 1st sem (grade)",
]

# The grade forecaster deliberately uses academic-performance information only.
# It excludes financial-support/status indicators, special-needs status, and
# study schedule because they are not academic factors.
GRADE_FEATURE_COLUMNS = [
    "Curricular units 1st sem (enrolled)",
    "Curricular units 1st sem (approved)",
    "Semester 1 completion rate",
    "Curricular units 1st sem (grade)",
]

# Backward-compatible alias for the risk-model optimisation script.
FEATURE_COLUMNS = RISK_FEATURE_COLUMNS
SCHEDULE_COLUMN = "Daytime/evening attendance"
GRADE_TARGET = "Curricular units 2nd sem (grade)"
RISK_TARGET = "Target"
RANDOM_SEED = 42
VALID_TARGET_LABELS = {
    "dropout": "Dropout",
    "enrolled": "Enrolled",
    "graduate": "Graduate",
}


def build_preprocessor(feature_columns: list[str] = FEATURE_COLUMNS) -> ColumnTransformer:
    """Create preprocessing that can also handle unseen schedule values."""
    numeric_columns = [column for column in feature_columns if column != SCHEDULE_COLUMN]
    transformers = [
        (
            "numeric",
            Pipeline(
                steps=[
                    ("imputer", SimpleImputer(strategy="median")),
                    ("scaler", StandardScaler()),
                ]
            ),
            numeric_columns,
        )
    ]
    if SCHEDULE_COLUMN in feature_columns:
        transformers.append(
            ("study_schedule", OneHotEncoder(handle_unknown="ignore"), [SCHEDULE_COLUMN])
        )
    return ColumnTransformer(transformers=transformers)


def build_risk_pipeline(*, n_jobs: int = -1) -> Pipeline:
    """Build the single risk-model contract used by training and tuning.

    Keeping the preprocessing and baseline classifier in one factory prevents
    a tuned artifact from accepting a different feature shape than the API.
    """
    return Pipeline(
        steps=[
            ("preprocessor", build_preprocessor(RISK_FEATURE_COLUMNS)),
            (
                "classifier",
                RandomForestClassifier(
                    n_estimators=600,
                    class_weight="balanced_subsample",
                    random_state=RANDOM_SEED,
                    n_jobs=n_jobs,
                ),
            ),
        ]
    )


def clean_data(data: pd.DataFrame) -> pd.DataFrame:
    """Remove invalid rows and normalize outcome labels before model splitting.

    Academic edge cases such as a grade of zero are retained. Only impossible
    values and rows without a known training target are removed.
    """
    cleaned = data.drop_duplicates().copy()

    # Treat capitalization and surrounding whitespace as formatting errors,
    # not distinct model classes.
    cleaned[RISK_TARGET] = (
        cleaned[RISK_TARGET]
        .astype("string")
        .str.strip()
        .str.casefold()
        .map(VALID_TARGET_LABELS)
    )

    enrolled_column = "Curricular units 1st sem (enrolled)"
    approved_column = "Curricular units 1st sem (approved)"
    first_grade_column = "Curricular units 1st sem (grade)"
    second_grade_column = GRADE_TARGET
    numeric_columns = [
        enrolled_column,
        approved_column,
        first_grade_column,
        second_grade_column,
    ]
    for column in numeric_columns:
        cleaned[column] = pd.to_numeric(cleaned[column], errors="coerce")

    valid_academic_values = (
        cleaned[enrolled_column].ge(1)
        & cleaned[approved_column].ge(0)
        & cleaned[approved_column].le(cleaned[enrolled_column])
        & cleaned[first_grade_column].between(0, 20)
        & cleaned[second_grade_column].between(0, 20)
    )
    return cleaned.loc[cleaned[RISK_TARGET].notna() & valid_academic_values].copy()


def add_completion_rate(data: pd.DataFrame) -> pd.DataFrame:
    """Derive the same academic feature for training and dataset transparency."""
    data = data.copy()
    enrolled = data["Curricular units 1st sem (enrolled)"].replace(0, float("nan"))
    data["Semester 1 completion rate"] = (
        data["Curricular units 1st sem (approved)"].div(enrolled).fillna(0).clip(0, 1)
    )
    return data


def load_data() -> pd.DataFrame:
    if not DATA_PATH.exists():
        raise FileNotFoundError(
            f"Dataset not found at {DATA_PATH}. Extract dataset.csv to the data folder first."
        )

    data = pd.read_csv(DATA_PATH)
    required_columns = set(
        [column for column in FEATURE_COLUMNS if column != "Semester 1 completion rate"]
        + [GRADE_TARGET, RISK_TARGET]
    )
    missing_columns = sorted(required_columns - set(data.columns))
    if missing_columns:
        raise ValueError(f"Dataset is missing required columns: {', '.join(missing_columns)}")
    original_row_count = len(data)
    data = clean_data(data)
    if data.empty:
        raise ValueError("No valid rows remain after data cleaning.")
    print(f"Data cleaning retained {len(data):,} of {original_row_count:,} rows.")
    return add_completion_rate(data)


def train_grade_model(features: pd.DataFrame, target: pd.Series) -> Pipeline:
    x_train, x_test, y_train, y_test = train_test_split(
        features, target, test_size=0.20, random_state=42
    )
    model = Pipeline(
        steps=[
            ("preprocessor", build_preprocessor(GRADE_FEATURE_COLUMNS)),
            ("regressor", LinearRegression()),
        ]
    )
    model.fit(x_train, y_train)
    predictions = model.predict(x_test)

    print("Grade forecast evaluation")
    print(f"  MAE:  {mean_absolute_error(y_test, predictions):.3f}")
    print(f"  RMSE: {root_mean_squared_error(y_test, predictions):.3f}")
    print(f"  R^2:  {r2_score(y_test, predictions):.3f}")
    return model


def train_risk_model(features: pd.DataFrame, target: pd.Series) -> Pipeline:
    x_train, x_test, y_train, y_test = train_test_split(
        features, target, test_size=0.20, random_state=RANDOM_SEED, stratify=target
    )
    model = build_risk_pipeline()
    model.fit(x_train, y_train)
    metrics = evaluate_risk_model(model, x_test, y_test)

    print("\nAttrition-risk evaluation (Dropout vs. not Dropout)")
    confusion = metrics["dropout_confusion_matrix"]
    print("  Confusion matrix: rows = actual, columns = predicted")
    print("                    Not Dropout  Dropout")
    print(f"    Not Dropout       {confusion[0][0]:>5}    {confusion[0][1]:>5}")
    print(f"    Dropout           {confusion[1][0]:>5}    {confusion[1][1]:>5}")
    print(f"  Binary accuracy: {metrics['dropout_binary_accuracy']:.3f}")
    print(f"  Dropout precision: {metrics['dropout_precision']:.3f}")
    print(f"  Dropout recall (sensitivity): {metrics['dropout_recall']:.3f}")
    print(f"  Not-dropout recall (specificity): {metrics['dropout_specificity']:.3f}")
    print(f"  Dropout F1: {metrics['dropout_f1']:.3f}")
    print(f"  Dropout ROC-AUC: {metrics['dropout_roc_auc']:.3f}")
    print(f"  Dropout PR-AUC: {metrics['dropout_average_precision']:.3f}")
    print(f"  Dropout Brier score: {metrics['dropout_brier_score']:.3f}")
    return model


def main() -> None:
    data = load_data()
    grade_features = data[GRADE_FEATURE_COLUMNS].copy()
    risk_features = data[RISK_FEATURE_COLUMNS].copy()
    ARTIFACTS_DIR.mkdir(exist_ok=True)

    grade_model = train_grade_model(grade_features, data[GRADE_TARGET])
    risk_model = train_risk_model(risk_features, data[RISK_TARGET])

    joblib.dump(grade_model, ARTIFACTS_DIR / "grade_model.joblib")
    joblib.dump(risk_model, ARTIFACTS_DIR / "risk_model.joblib")
    print(f"\nSaved model artifacts to {ARTIFACTS_DIR}")


if __name__ == "__main__":
    main()

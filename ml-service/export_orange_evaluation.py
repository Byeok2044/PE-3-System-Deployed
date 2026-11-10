"""Export repeatable Orange evidence from this checkout's saved model artifacts.

Run with the ML service's Python environment, not Orange's Python environment.
No model is trained or replaced. The Orange script embeds the evaluated snapshot
so the resulting workflow can be opened on another device without path changes.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

from risk_metrics import evaluate_risk_model
from train_models import (
    ARTIFACTS_DIR,
    BASE_DIR,
    DATA_PATH,
    GRADE_FEATURE_COLUMNS,
    GRADE_TARGET,
    RANDOM_SEED,
    RISK_FEATURE_COLUMNS,
    RISK_TARGET,
    load_data,
)


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")


def export_evaluation(output_dir: Path) -> dict:
    grade_path = ARTIFACTS_DIR / "grade_model.joblib"
    risk_path = ARTIFACTS_DIR / "risk_model.joblib"
    for path in (DATA_PATH, grade_path, risk_path):
        if not path.is_file():
            raise FileNotFoundError(f"Required local file not found: {path}")

    # Reuse the production cleaning/feature engineering and the training splits.
    data = load_data()
    grade_train, grade_test = train_test_split(
        data[GRADE_FEATURE_COLUMNS + [GRADE_TARGET]],
        test_size=0.20,
        random_state=RANDOM_SEED,
    )
    risk_train, risk_test = train_test_split(
        data[RISK_FEATURE_COLUMNS + [RISK_TARGET]],
        test_size=0.20,
        random_state=RANDOM_SEED,
        stratify=data[RISK_TARGET],
    )

    grade_model = joblib.load(grade_path)
    risk_model = joblib.load(risk_path)
    grade_actual = grade_test[GRADE_TARGET]
    grade_predicted = grade_model.predict(grade_test[GRADE_FEATURE_COLUMNS])
    residual = grade_actual.to_numpy() - grade_predicted
    grade_metrics = {
        "test_rows": len(grade_test),
        "mae": float(mean_absolute_error(grade_actual, grade_predicted)),
        "rmse": float(np.sqrt(mean_squared_error(grade_actual, grade_predicted))),
        "r2": float(r2_score(grade_actual, grade_predicted)),
        "absolute_error_sum": float(np.abs(residual).sum()),
        "squared_error_sum": float(np.square(residual).sum()),
        "total_sum_of_squares": float(np.square(grade_actual - grade_actual.mean()).sum()),
    }

    risk_features = risk_test[RISK_FEATURE_COLUMNS]
    risk_actual = risk_test[RISK_TARGET]
    risk_predicted = risk_model.predict(risk_features)
    risk_probabilities = risk_model.predict_proba(risk_features)
    dropout_index = list(risk_model.classes_).index("Dropout")
    dropout_probability = risk_probabilities[:, dropout_index]
    risk_metrics = evaluate_risk_model(risk_model, risk_features, risk_actual)

    provenance = {
        "model_path": str(risk_path),
        "model_sha256": sha256(risk_path),
        "grade_model_sha256": sha256(grade_path),
        "dataset_sha256": sha256(DATA_PATH),
        "sklearn_version": sklearn.__version__,
        "cleaned_rows": len(data),
        "train_rows": len(risk_train),
        "test_rows": len(risk_test),
        "seed": RANDOM_SEED,
        "split": "80/20; risk stratified by original Target, grade unstratified",
        "evaluation": "Saved predictions; binary mapping performed AFTER original class prediction",
        "limitation": "Held-out validity requires these artifacts to have been trained with this dataset and split; hashes identify files but cannot establish training history.",
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    for name, table in (
        ("grade_train", grade_train), ("grade_test", grade_test),
        ("risk_train", risk_train), ("risk_test", risk_test),
    ):
        table.to_csv(output_dir / f"{name}.csv", index=False)

    pd.DataFrame({
        "source_csv_row": grade_test.index.to_numpy() + 2,
        "actual_grade": grade_actual.to_numpy(),
        "predicted_grade": grade_predicted,
        "residual": residual,
        "absolute_error": np.abs(residual),
        "squared_error": np.square(residual),
        "squared_deviation_from_test_mean": np.square(grade_actual.to_numpy() - grade_actual.mean()),
    }).to_csv(output_dir / "grade_predictions.csv", index=False)

    prediction_table = risk_test.copy()
    prediction_table.insert(0, "source_csv_row", risk_test.index.to_numpy() + 2)
    prediction_table["original_predicted_outcome"] = risk_predicted
    prediction_table["actual_binary_outcome"] = np.where(risk_actual.eq("Dropout"), "Dropout", "Not Dropout")
    prediction_table["predicted_binary_outcome"] = np.where(risk_predicted == "Dropout", "Dropout", "Not Dropout")
    prediction_table["dropout_probability"] = dropout_probability
    prediction_table.to_csv(output_dir / "risk_predictions.csv", index=False)

    snapshot = io.BytesIO()
    np.savez_compressed(
        snapshot,
        features=risk_features.to_numpy(float),
        feature_names=np.array(RISK_FEATURE_COLUMNS),
        original_actual=risk_actual.to_numpy(str),
        original_predicted=np.asarray(risk_predicted, dtype=str),
        dropout_probability=dropout_probability,
        source_csv_row=risk_test.index.to_numpy() + 2,
    )
    template = (BASE_DIR / "orange_templates" / "rf_verification.py.template").read_text(encoding="utf-8")
    script = template.replace("__PROVENANCE__", repr(provenance)).replace(
        "__PAYLOAD__", base64.b64encode(snapshot.getvalue()).decode("ascii")
    )
    (output_dir / "verify_saved_random_forest.py").write_text(script, encoding="utf-8")
    write_json(output_dir / "grade_metrics.json", grade_metrics)
    write_json(output_dir / "risk_metrics.json", risk_metrics)
    write_json(output_dir / "provenance.json", provenance)
    return {"grade": grade_metrics, "risk": risk_metrics, "provenance": provenance}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir", type=Path, default=ARTIFACTS_DIR / "orange",
        help="Destination for generated CSVs, metrics and the Orange script",
    )
    args = parser.parse_args()
    try:
        result = export_evaluation(args.output_dir.resolve())
    except (FileNotFoundError, ValueError) as error:
        parser.exit(1, f"Export failed: {error}\n")
    print(f"\nExported to: {args.output_dir.resolve()}")
    grade = result["grade"]
    print(f"Grade: MAE={grade['mae']:.6f}, RMSE={grade['rmse']:.6f}, R2={grade['r2']:.6f}")
    risk = result["risk"]
    print("Risk confusion matrix (actual rows / predicted columns; Not Dropout, Dropout):")
    print(np.array(risk["dropout_confusion_matrix"]))
    print(f"Risk: accuracy={risk['dropout_binary_accuracy']:.6f}, dropout AUC={risk['dropout_roc_auc']:.6f}")
    print("Models were evaluated, not retrained or replaced.")


if __name__ == "__main__":
    main()

"""Read-only transparency views of the bundled historical training dataset.

No application/student database is accessed here. Model views call transform on
the existing fitted preprocessors; visiting the report never fits a model.
"""

from datetime import datetime, timezone
from functools import lru_cache
import hashlib
from pathlib import Path

import numpy as np
import pandas as pd

from train_models import (
    DATA_PATH, GRADE_FEATURE_COLUMNS, GRADE_TARGET, RISK_FEATURE_COLUMNS,
    RISK_TARGET, VALID_TARGET_LABELS, add_completion_rate, clean_data,
)

VIEWS = ("raw", "cleaned", "excluded", "risk", "grade")
ROW_ID = "Source row"
ENROLLED = "Curricular units 1st sem (enrolled)"
APPROVED = "Curricular units 1st sem (approved)"
PRIOR_GRADE = "Curricular units 1st sem (grade)"


class DatasetViewUnavailable(ValueError):
    pass


def _counts(series):
    values = series.astype("string").str.strip().str.casefold().map(VALID_TARGET_LABELS)
    return {
        **{label: int(values.eq(label).sum()) for label in ("Dropout", "Enrolled", "Graduate")},
        "Unknown": int(values.isna().sum()),
    }


class DatasetReport:
    def __init__(self, raw, *, risk_model=None, grade_model=None, metadata=None):
        # Source identifiers are assigned after cleaning so they never influence
        # full-row duplicate detection. The original CSV row order is preserved.
        raw = raw.reset_index(drop=True).copy()
        needed = set(RISK_FEATURE_COLUMNS) - {"Semester 1 completion rate"}
        needed.update((GRADE_TARGET, RISK_TARGET))
        if not needed.issubset(raw.columns):
            raise DatasetViewUnavailable("The historical dataset is missing required columns.")
        cleaned = add_completion_rate(clean_data(raw))
        ids = pd.Series([f"SRC-{i + 1:06d}" for i in raw.index], index=raw.index)
        labels = raw[RISK_TARGET].astype("string").str.strip().str.casefold().map(VALID_TARGET_LABELS)
        numeric = raw[[ENROLLED, APPROVED, PRIOR_GRADE, GRADE_TARGET]].apply(pd.to_numeric, errors="coerce")
        rules = [
            ("duplicate", "Exact duplicate row", raw.duplicated()),
            ("target", "Unknown or missing outcome label", labels.isna()),
            ("missing_academic", "Missing or nonnumeric required academic value", numeric.isna().any(axis=1)),
            ("enrollment", "Fewer than one enrolled first-semester unit", numeric[ENROLLED].lt(1)),
            ("negative_approved", "Negative approved units", numeric[APPROVED].lt(0)),
            ("over_approved", "Approved units exceed enrolled units", numeric[APPROVED].gt(numeric[ENROLLED])),
            ("prior_grade", "First-semester grade outside 0–20", numeric[PRIOR_GRADE].notna() & ~numeric[PRIOR_GRADE].between(0, 20)),
            ("target_grade", "Second-semester grade outside 0–20", numeric[GRADE_TARGET].notna() & ~numeric[GRADE_TARGET].between(0, 20)),
        ]
        excluded_mask = ~raw.index.isin(cleaned.index)
        reasons = pd.Series("", index=raw.index, dtype="string")
        for _, label, mask in rules:
            reasons.loc[mask] = reasons.loc[mask].map(lambda previous: f"{previous}; {label}" if previous else label)
        if not np.array_equal(excluded_mask, reasons.ne("").to_numpy()):
            raise DatasetViewUnavailable("The cleaning rules changed. Update the transparency audit before displaying it.")

        raw_view = raw.copy()
        raw_view.insert(0, ROW_ID, ids)
        raw_view.insert(1, "Preparation status", np.where(excluded_mask, "Excluded", "Retained"))
        cleaned_view = cleaned.copy()
        cleaned_view.insert(0, ROW_ID, ids.loc[cleaned.index])
        excluded_view = raw.loc[excluded_mask].copy()
        excluded_view.insert(0, ROW_ID, ids.loc[excluded_view.index])
        excluded_view.insert(1, "Exclusion reason", reasons.loc[excluded_view.index])
        self.frames = {"raw": raw_view, "cleaned": cleaned_view, "excluded": excluded_view}
        self.outcomes = {
            "raw": labels,
            "cleaned": cleaned[RISK_TARGET],
            "excluded": labels.loc[excluded_view.index],
        }
        self.view_errors = {}
        self.model_views = {}
        for name, model, columns, target in (
            ("risk", risk_model, RISK_FEATURE_COLUMNS, RISK_TARGET),
            ("grade", grade_model, GRADE_FEATURE_COLUMNS, GRADE_TARGET),
        ):
            try:
                if model is None:
                    raise DatasetViewUnavailable("The fitted model is unavailable. Original and cleaned data remain available.")
                preprocessor = model.named_steps["preprocessor"]
                if list(preprocessor.feature_names_in_) != columns:
                    raise DatasetViewUnavailable("This model uses a different input schema from the current dataset preparation.")
                values = preprocessor.transform(cleaned[columns])
                if hasattr(values, "toarray"):
                    values = values.toarray()
                names = list(preprocessor.get_feature_names_out())
                frame = pd.DataFrame(values, columns=names, index=cleaned.index)
                frame.insert(0, ROW_ID, ids.loc[cleaned.index])
                # Targets are shown separately and are never passed to transform.
                frame.insert(1, "Outcome label (not an input)", cleaned[RISK_TARGET])
                if name == "grade":
                    frame.insert(2, "Next-semester grade target (not an input)", cleaned[target])
                self.frames[name] = frame
                self.outcomes[name] = cleaned[RISK_TARGET]
                self.model_views[name] = {"available": True, "inputColumns": columns, "transformedColumns": names}
            except Exception as error:
                self.view_errors[name] = str(error) if isinstance(error, DatasetViewUnavailable) else "The fitted preprocessing pipeline could not transform this dataset."
                self.model_views[name] = {"available": False, "message": self.view_errors[name]}

        fields = []
        for column in (ENROLLED, APPROVED, "Semester 1 completion rate", PRIOR_GRADE, GRADE_TARGET):
            series = cleaned[column]
            fields.append({"column": column, "mean": float(series.mean()) if len(series) else None,
                           "minimum": float(series.min()) if len(series) else None,
                           "maximum": float(series.max()) if len(series) else None})
        self.summary = {
            "title": "Historical dataset preparation",
            "metadata": metadata or {},
            "counts": {"original": len(raw), "cleaned": len(cleaned), "excluded": int(excluded_mask.sum()),
                       "retentionRate": len(cleaned) / len(raw) if len(raw) else 0,
                       "duplicates": int(raw.duplicated().sum()), "missingCells": int(raw.isna().sum().sum()),
                       "originalColumns": len(raw.columns), "cleanedColumns": len(cleaned.columns)},
            "rules": [{"id": code, "label": label, "count": int(mask.sum())} for code, label, mask in rules],
            "outcomes": {"raw": _counts(raw[RISK_TARGET]), "cleaned": _counts(cleaned[RISK_TARGET])},
            "missingByColumn": [{"column": col, "count": int(raw[col].isna().sum())} for col in raw.columns],
            "statistics": fields,
            "views": {name: {"columns": list(frame.columns), "count": len(frame)} for name, frame in self.frames.items()},
            "models": self.model_views,
            "notes": [
                "This page reads the bundled historical research dataset, not student accounts or submitted application records.",
                "Exclusion-rule counts can overlap when a row fails multiple checks; the excluded total counts each row once.",
                "Zero enrolled units make a record ineligible for the current completion-rate calculation; this does not prove a recording error.",
                "Median imputation is part of the numeric pipeline. It is only applied to missing selected numeric inputs; an imputer does not mean this dataset needed imputation.",
                "Model input views use the saved fitted preprocessors. Opening this page does not train or refit either model.",
                "Outcome labels and second-semester target grades are displayed separately from model inputs.",
            ],
        }

    def select(self, view, *, outcome="all", search=""):
        if view not in VIEWS:
            raise ValueError("Unknown dataset view.")
        if view not in self.frames:
            raise DatasetViewUnavailable(self.view_errors.get(view, "This view is unavailable."))
        frame = self.frames[view]
        if outcome != "all":
            labels = self.outcomes[view]
            mask = labels.isna() if outcome == "Unknown" else labels.eq(outcome).fillna(False)
            frame = frame.loc[mask]
        if search.strip():
            term = search.strip().casefold()
            mask = pd.Series(False, index=frame.index)
            for col in frame.columns:
                mask |= frame[col].astype("string").str.casefold().str.contains(term, regex=False, na=False)
            frame = frame.loc[mask]
        return frame

    def rows(self, view, *, page=1, page_size=25, outcome="all", search=""):
        if page < 1 or not 1 <= page_size <= 100:
            raise ValueError("Page must be positive and page size must be from 1 to 100.")
        frame = self.select(view, outcome=outcome, search=search)
        start = (page - 1) * page_size
        # pandas' JSON serializer handles numpy scalars and missing values.
        import json
        return {"view": view, "columns": list(frame.columns), "total": len(frame), "page": page,
                "pageSize": page_size, "rows": json.loads(frame.iloc[start:start + page_size].to_json(orient="records", double_precision=15))}

    def csv(self, view, *, outcome="all", search=""):
        return self.select(view, outcome=outcome, search=search).to_csv(index=False)


@lru_cache(maxsize=1)
def _cached_report(path, modified_ns, size, risk_model, grade_model):
    source = Path(path)
    payload = source.read_bytes()
    from io import BytesIO
    raw = pd.read_csv(BytesIO(payload))
    return DatasetReport(raw, risk_model=risk_model, grade_model=grade_model, metadata={
        "fileName": source.name, "sha256": hashlib.sha256(payload).hexdigest(),
        "sourceUpdatedAt": datetime.fromtimestamp(modified_ns / 1e9, timezone.utc).isoformat(),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceDescription": "Bundled historical dataset obtained through Kaggle; original research dataset from a Portuguese higher education institution.",
        "referenceUrl": "https://doi.org/10.24432/C5MC89",
        "sourceNote": "The bundled CSV is a local dataset variant. The original dataset reference does not certify that the local file is an unchanged copy.",
    })


def get_dataset_report(*, risk_model=None, grade_model=None):
    stat = DATA_PATH.stat()
    return _cached_report(str(DATA_PATH), stat.st_mtime_ns, stat.st_size, risk_model, grade_model)

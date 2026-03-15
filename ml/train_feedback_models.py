"""
Train v1 feedback-driven models:
- classifier: valid vs invalid from YES/NO labels
- regressor: top/bottom correction deltas from manual corrections
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, mean_absolute_error, r2_score
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from build_feedback_dataset import FEATURE_COLUMNS


def _load_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    try:
        return pd.read_csv(path)
    except Exception:
        return pd.DataFrame()


def _safe_cv_classifier(model: Pipeline, X: np.ndarray, y: np.ndarray) -> Dict[str, Optional[float]]:
    classes, counts = np.unique(y, return_counts=True)
    if len(classes) < 2:
        return {"cv_mean": None, "cv_std": None}
    min_class = int(np.min(counts))
    folds = min(5, min_class)
    if folds < 2:
        return {"cv_mean": None, "cv_std": None}
    cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=42)
    scores = cross_val_score(model, X, y, cv=cv, scoring="accuracy")
    return {"cv_mean": float(np.mean(scores)), "cv_std": float(np.std(scores))}


def train_classifier(df: pd.DataFrame, out_dir: Path) -> Dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    metrics: Dict[str, Any] = {
        "trained": False,
        "rows": int(len(df)),
        "class_counts": {},
    }

    if df.empty:
        metrics["reason"] = "empty_classifier_dataset"
        return metrics
    if "label" not in df.columns:
        metrics["reason"] = "missing_label_column"
        return metrics

    # Keep only binary labels.
    df = df[df["label"].isin([0, 1])].copy()
    if df.empty:
        metrics["reason"] = "no_binary_labels"
        return metrics

    available_features = [c for c in FEATURE_COLUMNS if c in df.columns]
    if not available_features:
        metrics["reason"] = "no_feature_columns_present"
        return metrics

    X = df[available_features].to_numpy(dtype=float)
    y = df["label"].to_numpy(dtype=int)
    cls, cnt = np.unique(y, return_counts=True)
    metrics["class_counts"] = {str(int(c)): int(n) for c, n in zip(cls, cnt)}

    if len(cls) < 2:
        metrics["reason"] = "only_one_class_present"
        return metrics

    if int(np.min(cnt)) < 2 or len(y) < 8:
        # Not enough for a reliable holdout split, still fit full model.
        model = Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
                ("clf", RandomForestClassifier(n_estimators=200, random_state=42, class_weight="balanced")),
            ]
        )
        model.fit(X, y)
        cv_stats = _safe_cv_classifier(model, X, y)
        metrics.update(
            {
                "trained": True,
                "mode": "full_fit_no_holdout",
                "feature_columns": available_features,
                **cv_stats,
            }
        )
    else:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        model = Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
                ("clf", RandomForestClassifier(n_estimators=300, random_state=42, class_weight="balanced")),
            ]
        )
        model.fit(X_train, y_train)
        y_pred = model.predict(X_test)
        cv_stats = _safe_cv_classifier(model, X_train, y_train)
        metrics.update(
            {
                "trained": True,
                "mode": "train_test_split",
                "feature_columns": available_features,
                "test_accuracy": float(accuracy_score(y_test, y_pred)),
                "confusion_matrix": confusion_matrix(y_test, y_pred).tolist(),
                "classification_report": classification_report(y_test, y_pred, output_dict=True),
                **cv_stats,
            }
        )

    joblib.dump(model, out_dir / "feedback_classifier.joblib")
    (out_dir / "feedback_classifier_features.json").write_text(
        json.dumps({"feature_columns": available_features}, indent=2),
        encoding="utf-8",
    )
    return metrics


def train_regressor(df: pd.DataFrame, out_dir: Path) -> Dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    metrics: Dict[str, Any] = {"trained": False, "rows": int(len(df))}
    if df.empty:
        metrics["reason"] = "empty_regressor_dataset"
        return metrics

    needed = {"target_delta_top", "target_delta_bottom"}
    if not needed.issubset(set(df.columns)):
        metrics["reason"] = "missing_target_columns"
        return metrics

    df = df.dropna(subset=["target_delta_top", "target_delta_bottom"]).copy()
    if len(df) < 8:
        metrics["reason"] = "too_few_rows_for_regression"
        return metrics

    available_features = [c for c in FEATURE_COLUMNS if c in df.columns]
    if not available_features:
        metrics["reason"] = "no_feature_columns_present"
        return metrics

    X = df[available_features].to_numpy(dtype=float)
    y = df[["target_delta_top", "target_delta_bottom"]].to_numpy(dtype=float)

    model = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("reg", RandomForestRegressor(n_estimators=300, random_state=42)),
        ]
    )

    if len(df) >= 15:
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        model.fit(X_train, y_train)
        pred = model.predict(X_test)
        mae_top = mean_absolute_error(y_test[:, 0], pred[:, 0])
        mae_bottom = mean_absolute_error(y_test[:, 1], pred[:, 1])
        r2_top = r2_score(y_test[:, 0], pred[:, 0])
        r2_bottom = r2_score(y_test[:, 1], pred[:, 1])
        metrics.update(
            {
                "trained": True,
                "mode": "train_test_split",
                "feature_columns": available_features,
                "mae_top_delta": float(mae_top),
                "mae_bottom_delta": float(mae_bottom),
                "r2_top_delta": float(r2_top),
                "r2_bottom_delta": float(r2_bottom),
            }
        )
    else:
        model.fit(X, y)
        metrics.update(
            {
                "trained": True,
                "mode": "full_fit_no_holdout",
                "feature_columns": available_features,
            }
        )

    joblib.dump(model, out_dir / "feedback_base_regressor.joblib")
    (out_dir / "feedback_regressor_features.json").write_text(
        json.dumps({"feature_columns": available_features}, indent=2),
        encoding="utf-8",
    )
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Train classifier/regressor from feedback datasets.")
    parser.add_argument(
        "--dataset-dir",
        default=str(Path(__file__).resolve().parent / "artifacts" / "feedback_dataset"),
        help="Folder containing classifier_rows.csv and regressor_rows.csv",
    )
    parser.add_argument(
        "--out-dir",
        default=str(Path(__file__).resolve().parent / "models" / "feedback_v1"),
        help="Output folder for trained artifacts.",
    )
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    clf_df = _load_csv(dataset_dir / "classifier_rows.csv")
    reg_df = _load_csv(dataset_dir / "regressor_rows.csv")

    clf_metrics = train_classifier(clf_df, out_dir)
    reg_metrics = train_regressor(reg_df, out_dir)

    report = {
        "classifier": clf_metrics,
        "regressor": reg_metrics,
        "dataset_dir": str(dataset_dir),
        "out_dir": str(out_dir),
    }
    report_path = out_dir / "training_report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("Training complete")
    print(json.dumps(report, indent=2))
    print(f"Report: {report_path}")


if __name__ == "__main__":
    main()


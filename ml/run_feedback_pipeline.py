"""
One-command feedback ML pipeline:
1) Build datasets from backend labels/corrections/candidates
2) Train classifier + regressor
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from build_feedback_dataset import build_datasets
from train_feedback_models import train_classifier, train_regressor, _load_csv


def main() -> None:
    parser = argparse.ArgumentParser(description="Run full feedback dataset + training pipeline.")
    parser.add_argument(
        "--data-root",
        default=str((Path(__file__).resolve().parents[1] / "backend" / "data")),
        help="Path to backend/data folder.",
    )
    parser.add_argument(
        "--dataset-dir",
        default=str(Path(__file__).resolve().parent / "artifacts" / "feedback_dataset"),
        help="Where to write classifier_rows.csv and regressor_rows.csv",
    )
    parser.add_argument(
        "--models-dir",
        default=str(Path(__file__).resolve().parent / "models" / "feedback_v1"),
        help="Where to write trained models/reports.",
    )
    parser.add_argument(
        "--include-close",
        action="store_true",
        help="Treat CLOSE labels as positive in classifier training data.",
    )
    args = parser.parse_args()

    data_root = Path(args.data_root)
    dataset_dir = Path(args.dataset_dir)
    models_dir = Path(args.models_dir)

    build_result = build_datasets(
        data_root=data_root,
        out_dir=dataset_dir,
        include_close=bool(args.include_close),
    )
    clf_df = _load_csv(dataset_dir / "classifier_rows.csv")
    reg_df = _load_csv(dataset_dir / "regressor_rows.csv")

    clf_metrics = train_classifier(clf_df, models_dir)
    reg_metrics = train_regressor(reg_df, models_dir)

    report = {
        "dataset_build": build_result["report"],
        "training": {
            "classifier": clf_metrics,
            "regressor": reg_metrics,
        },
        "paths": {
            "dataset_dir": str(dataset_dir),
            "models_dir": str(models_dir),
        },
    }
    models_dir.mkdir(parents=True, exist_ok=True)
    report_path = models_dir / "pipeline_report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("Feedback pipeline complete")
    print(json.dumps(report, indent=2))
    print(f"Report: {report_path}")


if __name__ == "__main__":
    main()


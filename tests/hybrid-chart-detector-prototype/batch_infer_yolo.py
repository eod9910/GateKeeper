import argparse
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import pandas as pd
import yfinance as yf
from ultralytics import YOLO

from utils import clamp_bar_range, map_pixels_to_bars, normalize_detection, resolve_model_ref
from validators import validate_head_shoulders

HS_CLASSES = {
    "head and shoulders top",
    "head_shoulders",
    "head_and_shoulders_top",
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Run YOLO detection on a directory of chart images and export detections."
    )
    parser.add_argument(
        "--model",
        default="foduucom/stockmarket-pattern-detection-yolov8",
        help="YOLO model path or model ID.",
    )
    parser.add_argument(
        "--images-dir",
        default="artifacts/charts",
        help="Root folder containing chart images.",
    )
    parser.add_argument(
        "--output-csv",
        default="artifacts/predictions/detections.csv",
        help="Output CSV path for detections.",
    )
    parser.add_argument(
        "--output-json",
        default="artifacts/predictions/summary.json",
        help="Output JSON path for summary.",
    )
    parser.add_argument(
        "--conf",
        type=float,
        default=0.50,
        help="Detection confidence threshold.",
    )
    parser.add_argument(
        "--class-contains",
        default="",
        help="Optional case-insensitive class-name substring filter.",
    )
    parser.add_argument(
        "--limit-images",
        type=int,
        default=0,
        help="If >0, process only first N images.",
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        default=False,
        help="Run structural validation on detections using OHLC data.",
    )
    parser.add_argument(
        "--pivot-left",
        type=int,
        default=3,
        help="Bars to the left for swing pivot detection.",
    )
    parser.add_argument(
        "--pivot-right",
        type=int,
        default=3,
        help="Bars to the right for swing pivot detection.",
    )
    parser.add_argument(
        "--shoulder-tolerance",
        type=float,
        default=0.03,
        help="Allowed right-shoulder overshoot vs left shoulder (0.03 = 3%%).",
    )
    return parser.parse_args()


def list_images(root: Path) -> List[Path]:
    exts = {".png", ".jpg", ".jpeg", ".webp"}
    images = [p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in exts]
    return sorted(images)


def parse_image_filename(image_path: Path) -> Optional[Dict[str, Any]]:
    """Extract symbol, timeframe, and bar range from filenames like BTC-USD__1wk__200_399.png"""
    match = re.match(r"^(.+?)__(\w+)__(\d+)_(\d+)\.\w+$", image_path.name)
    if not match:
        return None
    return {
        "symbol": match.group(1),
        "timeframe": match.group(2),
        "window_start": int(match.group(3)),
        "window_end": int(match.group(4)),
        "bars_visible": int(match.group(4)) - int(match.group(3)) + 1,
    }


_ohlc_cache: Dict[str, pd.DataFrame] = {}

INTERVAL_TO_PERIOD = {
    "1wk": "max",
    "1d": "max",
    "1h": "2y",
    "4h": "2y",
}


def fetch_ohlc_cached(symbol: str, interval: str) -> pd.DataFrame:
    key = f"{symbol}__{interval}"
    if key in _ohlc_cache:
        return _ohlc_cache[key]

    period = INTERVAL_TO_PERIOD.get(interval, "max")
    df = yf.download(
        tickers=symbol,
        interval=interval,
        period=period,
        auto_adjust=False,
        progress=False,
        threads=False,
    )
    if df is None or df.empty:
        _ohlc_cache[key] = pd.DataFrame()
        return _ohlc_cache[key]

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    required = ["Open", "High", "Low", "Close"]
    if not all(col in df.columns for col in required):
        _ohlc_cache[key] = pd.DataFrame()
        return _ohlc_cache[key]

    if "Volume" not in df.columns:
        df["Volume"] = 0

    df = df.rename(columns={
        "Open": "open", "High": "high", "Low": "low", "Close": "close", "Volume": "volume",
    })
    df = df[["open", "high", "low", "close", "volume"]].dropna().reset_index()
    rename_dt = "Datetime" if "Datetime" in df.columns else "Date"
    if rename_dt in df.columns:
        df = df.rename(columns={rename_dt: "datetime"})
    df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce")

    _ohlc_cache[key] = df
    return df


def run_validation(
    det: Dict,
    image_path: Path,
    image_width: int,
    file_info: Dict[str, Any],
    pivot_left: int,
    pivot_right: int,
    shoulder_tolerance: float,
) -> Dict[str, Any]:
    class_name_norm = str(det["class_name"]).strip().lower()

    if class_name_norm not in HS_CLASSES:
        return {"validated": False, "valid": False, "reason": f"No validator for '{det['class_name']}'"}

    symbol = file_info["symbol"]
    interval = file_info["timeframe"]
    window_start = file_info["window_start"]
    bars_visible = file_info["bars_visible"]

    df = fetch_ohlc_cached(symbol, interval)
    if df.empty:
        return {"validated": False, "valid": False, "reason": f"No OHLC data for {symbol} {interval}"}

    left_bar, right_bar = map_pixels_to_bars(
        x1=det["x1"], x2=det["x2"],
        image_width=image_width, bars_visible=bars_visible,
    )
    global_left = window_start + left_bar
    global_right = window_start + right_bar
    global_left, global_right = clamp_bar_range(global_left, global_right, len(df))

    ohlc_slice = df.iloc[global_left:global_right + 1].copy()
    if len(ohlc_slice) < 10:
        return {"validated": False, "valid": False, "reason": "OHLC slice too small"}

    result = validate_head_shoulders(
        ohlc_slice=ohlc_slice,
        global_offset=global_left,
        pivot_left=pivot_left,
        pivot_right=pivot_right,
        shoulder_tolerance=shoulder_tolerance,
    )

    start_dt = str(ohlc_slice.iloc[0]["datetime"]) if "datetime" in ohlc_slice.columns else ""
    end_dt = str(ohlc_slice.iloc[-1]["datetime"]) if "datetime" in ohlc_slice.columns else ""

    return {
        "validated": True,
        "valid": result.get("valid", False),
        "reason": result.get("reason", ""),
        "pattern": result.get("pattern"),
        "trade_idea": result.get("trade_idea"),
        "neckline_break": result.get("neckline_break"),
        "bar_range_global": f"{global_left}-{global_right}",
        "date_range": f"{start_dt} to {end_dt}",
    }


def main():
    args = parse_args()

    images_dir = Path(args.images_dir).resolve()
    if not images_dir.exists():
        raise FileNotFoundError(f"Images directory not found: {images_dir}")

    image_paths = list_images(images_dir)
    if args.limit_images > 0:
        image_paths = image_paths[: args.limit_images]

    if not image_paths:
        raise ValueError(f"No images found in: {images_dir}")

    output_csv = Path(args.output_csv).resolve()
    output_json = Path(args.output_json).resolve()
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    output_json.parent.mkdir(parents=True, exist_ok=True)

    class_filter = args.class_contains.strip().lower()
    resolved_model = resolve_model_ref(args.model)
    model = YOLO(resolved_model)

    rows: List[Dict] = []
    class_counts: Dict[str, int] = {}
    validated_counts = {"total": 0, "confirmed": 0, "rejected": 0, "skipped": 0}
    images_with_detections = 0

    for i, image_path in enumerate(image_paths, start=1):
        if i % 100 == 0 or i == 1 or i == len(image_paths):
            print(f"[{i}/{len(image_paths)}] {image_path.name}")

        try:
            results = model.predict(
                source=str(image_path),
                conf=args.conf,
                save=False,
                verbose=False,
            )
        except Exception as exc:  # noqa: BLE001
            rows.append(
                {
                    "image_path": str(image_path),
                    "error": str(exc),
                }
            )
            continue

        result = results[0]
        names = result.names if hasattr(result, "names") else {}

        file_info = parse_image_filename(image_path) if args.validate else None
        image_width = None
        if args.validate and file_info:
            img = cv2.imread(str(image_path))
            if img is not None:
                image_width = img.shape[1]

        kept_for_image = 0
        for box in result.boxes:
            det = normalize_detection(box, names)
            class_name = str(det["class_name"])
            if class_filter and class_filter not in class_name.lower():
                continue

            row: Dict[str, Any] = {
                "image_path": str(image_path),
                "class_id": det["class_id"],
                "class_name": class_name,
                "confidence": det["confidence"],
                "x1": det["x1"],
                "y1": det["y1"],
                "x2": det["x2"],
                "y2": det["y2"],
            }

            if args.validate and file_info and image_width:
                val = run_validation(
                    det=det,
                    image_path=image_path,
                    image_width=image_width,
                    file_info=file_info,
                    pivot_left=args.pivot_left,
                    pivot_right=args.pivot_right,
                    shoulder_tolerance=args.shoulder_tolerance,
                )
                row["validated"] = val["validated"]
                row["valid"] = val["valid"]
                row["validation_reason"] = val["reason"]
                row["bar_range"] = val.get("bar_range_global", "")
                row["date_range"] = val.get("date_range", "")

                if val.get("trade_idea"):
                    ti = val["trade_idea"]
                    row["entry"] = ti.get("entry")
                    row["stop"] = ti.get("stop")
                    row["target"] = ti.get("target")

                validated_counts["total"] += 1
                if val["valid"]:
                    validated_counts["confirmed"] += 1
                elif val["validated"]:
                    validated_counts["rejected"] += 1
                else:
                    validated_counts["skipped"] += 1

            rows.append(row)
            class_counts[class_name] = class_counts.get(class_name, 0) + 1
            kept_for_image += 1

        if kept_for_image > 0:
            images_with_detections += 1

    df = pd.DataFrame(rows)
    df.to_csv(output_csv, index=False)

    summary: Dict[str, Any] = {
        "model": args.model,
        "resolved_model": resolved_model,
        "images_dir": str(images_dir),
        "images_scanned": len(image_paths),
        "images_with_detections": images_with_detections,
        "detections_exported": int(len(df)),
        "conf_threshold": args.conf,
        "class_filter": args.class_contains,
        "output_csv": str(output_csv),
        "class_counts": class_counts,
    }
    if args.validate:
        summary["validation"] = validated_counts

    output_json.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"\nDone. Scanned {len(image_paths)} images.")
    print(f"Detections exported: {len(df)}")
    if args.validate:
        print(f"Validation: {validated_counts['confirmed']} confirmed, {validated_counts['rejected']} rejected, {validated_counts['skipped']} skipped")
    print(f"CSV: {output_csv}")
    print(f"JSON: {output_json}")


if __name__ == "__main__":
    main()

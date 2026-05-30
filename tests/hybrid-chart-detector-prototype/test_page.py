import tempfile
from pathlib import Path
from typing import Any, Dict, List

import cv2
import numpy as np
import pandas as pd
import streamlit as st
import yfinance as yf
from ultralytics import YOLO

from utils import (
    clamp_bar_range,
    load_ohlc_csv,
    map_pixels_to_bars,
    normalize_detection,
    resolve_model_ref,
)
from validators import validate_head_shoulders


def build_confidence_summary(output: Dict[str, Any]) -> Dict[str, Any]:
    results = output.get("results", [])
    detections_found = int(output.get("detections_found", 0))

    detected_classes = []
    confirmed = []
    rejected = []

    for item in results:
        det = item.get("detection", {})
        val = item.get("validation", {})
        class_name = str(det.get("class_name", "unknown"))
        confidence = float(det.get("confidence", 0.0))
        valid = bool(val.get("valid", False))
        reason = str(val.get("reason", "No reason provided"))

        detected_classes.append(class_name)
        if valid:
            confirmed.append(item)
        else:
            rejected.append(
                {
                    "class_name": class_name,
                    "confidence": confidence,
                    "reason": reason,
                }
            )

    saw_pattern = detections_found > 0
    confirmed_pattern = len(confirmed) > 0
    unique_classes = sorted(set(detected_classes))

    top_rejection_reason = None
    if rejected:
        rejected.sort(key=lambda x: x["confidence"], reverse=True)
        top = rejected[0]
        top_rejection_reason = (
            f"{top['class_name']} ({top['confidence']:.2f}): {top['reason']}"
        )

    if not saw_pattern:
        verdict = "No candidate pattern was detected in this image."
    elif confirmed_pattern:
        verdict = "At least one detected candidate passed structural validation."
    else:
        verdict = "Pattern candidates were detected, but none passed structural validation."

    return {
        "saw_pattern": saw_pattern,
        "confirmed_pattern": confirmed_pattern,
        "detected_classes": unique_classes,
        "top_rejection_reason": top_rejection_reason,
        "verdict": verdict,
    }


def fetch_ohlc_from_yahoo(symbol: str, interval: str, period: str) -> pd.DataFrame:
    ticker = symbol.strip().upper()
    if ticker == "BTC":
        ticker = "BTC-USD"

    data = yf.download(
        tickers=ticker,
        interval=interval,
        period=period,
        auto_adjust=False,
        progress=False,
    )
    if data is None or data.empty:
        raise ValueError(
            f"No OHLC data returned for symbol '{ticker}' with interval='{interval}' and period='{period}'."
        )

    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)

    data = data.reset_index()
    datetime_col = "Datetime" if "Datetime" in data.columns else "Date"
    data = data.rename(
        columns={
            datetime_col: "datetime",
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
        }
    )

    missing = [col for col in ["datetime", "open", "high", "low", "close", "volume"] if col not in data.columns]
    if missing:
        raise ValueError(f"Downloaded data missing required columns: {missing}")

    return data[["datetime", "open", "high", "low", "close", "volume"]].copy()


def draw_detection(
    image: np.ndarray,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    label: str,
    valid: bool,
) -> None:
    color = (0, 180, 0) if valid else (0, 0, 220)
    p1 = (int(x1), int(y1))
    p2 = (int(x2), int(y2))
    cv2.rectangle(image, p1, p2, color, 2)
    cv2.putText(
        image,
        label,
        (int(x1), max(18, int(y1) - 8)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        color,
        2,
        cv2.LINE_AA,
    )


def run_detection(
    model_ref: str,
    image_path: Path,
    csv_path: Path,
    bars_visible: int,
    conf: float,
    pivot_left: int,
    pivot_right: int,
    shoulder_tolerance: float,
) -> Dict[str, Any]:
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Could not load image: {image_path}")
    image_height, image_width = image.shape[:2]
    _ = image_height

    df = load_ohlc_csv(csv_path)
    resolved_model = resolve_model_ref(model_ref)
    model = YOLO(resolved_model)
    results = model.predict(source=str(image_path), conf=conf, save=False, verbose=False)

    result = results[0]
    names = result.names if hasattr(result, "names") else {}

    all_outputs: List[Dict[str, Any]] = []
    annotated = image.copy()

    for box in result.boxes:
        det = normalize_detection(box, names)
        left_bar, right_bar = map_pixels_to_bars(
            x1=det["x1"],
            x2=det["x2"],
            image_width=image_width,
            bars_visible=bars_visible,
        )
        left_bar, right_bar = clamp_bar_range(left_bar, right_bar, len(df))

        ohlc_slice = df.iloc[left_bar : right_bar + 1].copy()
        class_name_norm = str(det["class_name"]).strip().lower()
        if class_name_norm in {"head_shoulders", "head and shoulders top", "head_and_shoulders_top"}:
            validation = validate_head_shoulders(
                ohlc_slice=ohlc_slice,
                global_offset=left_bar,
                pivot_left=pivot_left,
                pivot_right=pivot_right,
                shoulder_tolerance=shoulder_tolerance,
            )
        elif class_name_norm in {"head and shoulders bottom", "head_and_shoulders_bottom"}:
            validation = {
                "valid": False,
                "reason": "Inverse head-and-shoulders validator not implemented yet.",
            }
        else:
            validation = {
                "valid": False,
                "reason": f"No validator implemented yet for class '{det['class_name']}'",
            }

        draw_detection(
            image=annotated,
            x1=det["x1"],
            y1=det["y1"],
            x2=det["x2"],
            y2=det["y2"],
            label=f"{det['class_name']} {det['confidence']:.2f} | valid={validation.get('valid', False)}",
            valid=bool(validation.get("valid", False)),
        )

        all_outputs.append(
            {
                "detection": det,
                "candidate_bar_range": {"left_bar": left_bar, "right_bar": right_bar},
                "validation": validation,
            }
        )

    return {
        "annotated_image_bgr": annotated,
        "output": {
            "image": str(image_path),
            "csv": str(csv_path),
            "bars_visible": bars_visible,
            "detections_found": len(all_outputs),
            "results": all_outputs,
        },
    }


st.set_page_config(page_title="Hybrid Pattern Detector Test Page", layout="wide")
st.title("Hybrid Chart Pattern Detector")

tab_scan, tab_upload = st.tabs(["Batch Scan Results", "Manual Upload"])


def render_batch_results_tab():
    st.subheader("Batch Scan Results")
    artifacts_root = Path(__file__).parent / "artifacts"

    prediction_dirs = sorted(
        [d for d in artifacts_root.iterdir() if d.is_dir() and d.name.startswith("predictions")],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    ) if artifacts_root.exists() else []

    if not prediction_dirs:
        st.info("No batch scan results found. Run `batch_generate_charts.py` then `batch_infer_yolo.py` first.")
        return

    selected_dir = st.selectbox(
        "Select scan run",
        prediction_dirs,
        format_func=lambda p: p.name,
    )

    summary_path = selected_dir / "summary.json"
    csv_path = selected_dir / "detections.csv"

    if summary_path.exists():
        import json
        summary = json.loads(summary_path.read_text(encoding="utf-8"))

        validation_info = summary.get("validation")
        if validation_info:
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Images Scanned", summary.get("images_scanned", "?"))
            c2.metric("Total Detections", summary.get("detections_exported", "?"))
            c3.metric("Confirmed", validation_info.get("confirmed", 0))
            c4.metric("Rejected", validation_info.get("rejected", 0))
        else:
            c1, c2, c3 = st.columns(3)
            c1.metric("Images Scanned", summary.get("images_scanned", "?"))
            c2.metric("Images with Detections", summary.get("images_with_detections", "?"))
            c3.metric("Total Detections", summary.get("detections_exported", "?"))

        class_counts = summary.get("class_counts", {})
        if class_counts:
            st.subheader("Pattern Counts")
            counts_df = pd.DataFrame(
                [{"Pattern": k, "Count": v} for k, v in sorted(class_counts.items(), key=lambda x: -x[1])]
            )
            st.dataframe(counts_df, use_container_width=True, hide_index=True)

    if not csv_path.exists():
        st.warning("No detections CSV found in this run.")
        return

    detections_df = pd.read_csv(csv_path)
    if detections_df.empty:
        st.info("No detections in this scan.")
        return

    st.subheader("Detections")

    has_validation = "valid" in detections_df.columns

    class_filter = st.multiselect(
        "Filter by pattern class",
        options=sorted(detections_df["class_name"].dropna().unique().tolist()),
        default=sorted(detections_df["class_name"].dropna().unique().tolist()),
    )

    filter_cols = st.columns(2 if has_validation else 1)
    with filter_cols[0]:
        min_conf = st.slider("Minimum confidence", 0.0, 1.0, 0.50, 0.05, key="batch_conf")
    if has_validation:
        with filter_cols[1]:
            validation_filter = st.radio(
                "Validation status",
                ["All", "Confirmed only", "Rejected only"],
                horizontal=True,
                key="val_filter",
            )

    filtered = detections_df[
        (detections_df["class_name"].isin(class_filter)) & (detections_df["confidence"] >= min_conf)
    ].copy()

    if has_validation:
        if validation_filter == "Confirmed only":
            filtered = filtered[filtered["valid"] == True]  # noqa: E712
        elif validation_filter == "Rejected only":
            filtered = filtered[filtered["valid"] == False]  # noqa: E712

    filtered = filtered.sort_values("confidence", ascending=False).reset_index(drop=True)

    st.caption(f"Showing {len(filtered)} of {len(detections_df)} detections")

    for _, row in filtered.iterrows():
        img_path = Path(str(row["image_path"]))
        conf = float(row["confidence"])
        class_name = str(row["class_name"])

        is_valid = bool(row.get("valid", False)) if has_validation else None
        status_icon = ""
        if has_validation:
            status_icon = "CONFIRMED " if is_valid else "REJECTED "

        with st.expander(f"{status_icon}{class_name}  —  {conf:.1%}  —  {img_path.stem}", expanded=is_valid is True):
            if has_validation:
                if is_valid:
                    st.success(f"Structurally confirmed: {row.get('validation_reason', '')}")
                else:
                    st.error(f"Rejected: {row.get('validation_reason', 'No reason')}")

                if row.get("date_range"):
                    st.caption(f"Date range: {row['date_range']}")

                if is_valid and any(row.get(k) for k in ["entry", "stop", "target"]):
                    tc1, tc2, tc3 = st.columns(3)
                    tc1.metric("Entry", f"${row.get('entry', 0):,.2f}" if row.get("entry") else "—")
                    tc2.metric("Stop", f"${row.get('stop', 0):,.2f}" if row.get("stop") else "—")
                    tc3.metric("Target", f"${row.get('target', 0):,.2f}" if row.get("target") else "—")

            if img_path.exists():
                img = cv2.imread(str(img_path))
                if img is not None:
                    x1, y1 = int(row["x1"]), int(row["y1"])
                    x2, y2 = int(row["x2"]), int(row["y2"])
                    if has_validation:
                        color = (0, 180, 0) if is_valid else (0, 0, 220)
                    else:
                        color = (0, 180, 0) if conf >= 0.65 else (0, 165, 255) if conf >= 0.50 else (0, 0, 220)
                    cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
                    label = f"{class_name} {conf:.2f}"
                    cv2.putText(img, label, (x1, max(18, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2, cv2.LINE_AA)
                    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                    st.image(img_rgb, use_container_width=True)
                else:
                    st.error(f"Could not load image: {img_path}")
            else:
                st.warning(f"Image file not found: {img_path}")

            detail = {
                "class_name": class_name,
                "confidence": conf,
                "bounding_box": {"x1": float(row["x1"]), "y1": float(row["y1"]), "x2": float(row["x2"]), "y2": float(row["y2"])},
                "image": str(img_path),
            }
            if has_validation:
                detail["valid"] = is_valid
                detail["validation_reason"] = row.get("validation_reason", "")
                detail["date_range"] = row.get("date_range", "")
            st.json(detail)


with tab_scan:
    render_batch_results_tab()

with tab_upload:
    st.caption("Upload a known-pattern chart and matching OHLC CSV to see if detection + validation confirms it.")

    model_path_str = st.text_input(
        "YOLO model path or model ID",
        value="foduucom/stockmarket-pattern-detection-yolov8",
    )
    st.caption("Examples: local file path `C:\\models\\best.pt` or Hugging Face ID `foduucom/stockmarket-pattern-detection-yolov8`.")
    bars_visible = st.number_input("Bars visible in chart image", min_value=10, value=200, step=1)
    conf = st.slider("Detection confidence threshold", min_value=0.05, max_value=0.95, value=0.50, step=0.05)

    with st.expander("Advanced validation settings", expanded=False):
        pivot_left = st.number_input("Pivot left bars", min_value=1, max_value=20, value=3, step=1)
        pivot_right = st.number_input("Pivot right bars", min_value=1, max_value=20, value=3, step=1)
        shoulder_tolerance = st.number_input(
            "Shoulder tolerance (fraction, 0.03 = 3%)",
            min_value=0.0,
            max_value=0.25,
            value=0.03,
            step=0.005,
            format="%.3f",
        )

    image_upload = st.file_uploader("Chart image (PNG/JPG)", type=["png", "jpg", "jpeg"])
    data_source = st.radio("OHLC source", ["Upload CSV", "Fetch by symbol (Yahoo)"], horizontal=True)
    csv_upload = None
    yf_symbol = None
    yf_interval = None
    yf_period = None

    if data_source == "Upload CSV":
        csv_upload = st.file_uploader("OHLC CSV", type=["csv"])
    else:
        yf_symbol = st.text_input("Symbol (examples: BTC-USD, BTC, SPY, AAPL)", value="BTC-USD")
        c_i, c_p = st.columns(2)
        yf_interval = c_i.selectbox("Interval", options=["1d", "1wk", "1h", "4h"], index=0)
        yf_period = c_p.selectbox("Period", options=["5y", "10y", "2y", "1y", "6mo"], index=0)

    run_btn = st.button("Run Detection", type="primary")

    if run_btn:
        model_ref = model_path_str.strip()
        if not model_ref:
            st.error("Please provide a YOLO model path or model ID.")
            st.stop()
        if image_upload is None:
            st.error("Please upload a chart image.")
            st.stop()
        if data_source == "Upload CSV" and csv_upload is None:
            st.error("Please upload an OHLC CSV, or switch OHLC source to Yahoo fetch.")
            st.stop()
        if data_source == "Fetch by symbol (Yahoo)" and not yf_symbol:
            st.error("Please enter a symbol for Yahoo fetch.")
            st.stop()

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            image_path = tmp_path / image_upload.name
            csv_path = tmp_path / "ohlc_data.csv"

            image_path.write_bytes(image_upload.getvalue())
            if data_source == "Upload CSV":
                csv_path.write_bytes(csv_upload.getvalue())
            else:
                yf_df = fetch_ohlc_from_yahoo(
                    symbol=yf_symbol or "BTC-USD",
                    interval=yf_interval or "1d",
                    period=yf_period or "5y",
                )
                yf_df.to_csv(csv_path, index=False)
                st.caption(f"Loaded {len(yf_df)} bars from Yahoo for {yf_symbol.upper()}.")

            with st.spinner("Running YOLO + structural validation..."):
                try:
                    result = run_detection(
                        model_ref=model_ref,
                        image_path=image_path,
                        csv_path=csv_path,
                        bars_visible=int(bars_visible),
                        conf=float(conf),
                        pivot_left=int(pivot_left),
                        pivot_right=int(pivot_right),
                        shoulder_tolerance=float(shoulder_tolerance),
                    )
                except Exception as exc:  # noqa: BLE001
                    st.exception(exc)
                    st.stop()

        annotated_rgb = cv2.cvtColor(result["annotated_image_bgr"], cv2.COLOR_BGR2RGB)
        summary = build_confidence_summary(result["output"])

        st.subheader("Confidence Check")
        c1, c2 = st.columns(2)
        c1.metric("Model saw pattern candidate", "Yes" if summary["saw_pattern"] else "No")
        c2.metric(
            "Validator confirmed structure",
            "Yes" if summary["confirmed_pattern"] else "No",
        )

        classes_text = ", ".join(summary["detected_classes"]) if summary["detected_classes"] else "None"
        st.write(f"Detected classes: {classes_text}")

        if summary["confirmed_pattern"]:
            st.success(summary["verdict"])
        elif summary["saw_pattern"]:
            st.warning(summary["verdict"])
        else:
            st.error(summary["verdict"])

        if summary["top_rejection_reason"]:
            st.write(f"Top rejection reason: {summary['top_rejection_reason']}")

        st.subheader("Annotated Detection")
        st.image(annotated_rgb, use_container_width=True)

        st.subheader("Structured Result")
        st.json(result["output"])

        st.info(
            "Tip: If a known pattern is not confirmed, try adjusting bars-visible, confidence, and pivot settings."
        )

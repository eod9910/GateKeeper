import argparse
import json
from pathlib import Path

import cv2
from ultralytics import YOLO

from utils import clamp_bar_range, load_ohlc_csv, map_pixels_to_bars, normalize_detection
from validators import validate_head_shoulders


def parse_args():
    parser = argparse.ArgumentParser(
        description="Hybrid chart-pattern detector: YOLO candidate finder + OHLC validator"
    )
    parser.add_argument("--model", required=True, help="Path to trained YOLO .pt model")
    parser.add_argument("--image", required=True, help="Path to chart image PNG/JPG")
    parser.add_argument("--csv", required=True, help="Path to OHLC CSV")
    parser.add_argument(
        "--bars-visible",
        required=True,
        type=int,
        help="Number of visible bars on the chart image from left to right",
    )
    parser.add_argument(
        "--conf",
        type=float,
        default=0.50,
        help="Minimum detection confidence threshold",
    )
    parser.add_argument(
        "--pivot-left",
        type=int,
        default=3,
        help="Bars to the left for swing pivot detection",
    )
    parser.add_argument(
        "--pivot-right",
        type=int,
        default=3,
        help="Bars to the right for swing pivot detection",
    )
    parser.add_argument(
        "--shoulder-tolerance",
        type=float,
        default=0.03,
        help="Allowed right-shoulder overshoot vs left shoulder, e.g. 0.03 = 3%%",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    model_path = Path(args.model)
    image_path = Path(args.image)
    csv_path = Path(args.csv)

    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")
    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    # Load image so we know its width for pixel-to-bar mapping.
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Could not load image: {image_path}")
    _, image_width = image.shape[:2]

    # Load OHLC data.
    df = load_ohlc_csv(csv_path)

    # Load YOLO model and run detection.
    model = YOLO(str(model_path))
    results = model.predict(source=str(image_path), conf=args.conf, save=False, verbose=False)

    result = results[0]
    names = result.names if hasattr(result, "names") else {}

    all_outputs = []

    for box in result.boxes:
        det = normalize_detection(box, names)

        left_bar, right_bar = map_pixels_to_bars(
            x1=det["x1"],
            x2=det["x2"],
            image_width=image_width,
            bars_visible=args.bars_visible,
        )
        left_bar, right_bar = clamp_bar_range(left_bar, right_bar, len(df))

        ohlc_slice = df.iloc[left_bar : right_bar + 1].copy()

        if det["class_name"] == "head_shoulders":
            validation = validate_head_shoulders(
                ohlc_slice=ohlc_slice,
                global_offset=left_bar,
                pivot_left=args.pivot_left,
                pivot_right=args.pivot_right,
                shoulder_tolerance=args.shoulder_tolerance,
            )
        else:
            validation = {
                "valid": False,
                "reason": f"No validator implemented yet for class '{det['class_name']}'",
            }

        all_outputs.append(
            {
                "detection": det,
                "candidate_bar_range": {
                    "left_bar": left_bar,
                    "right_bar": right_bar,
                },
                "validation": validation,
            }
        )

    output = {
        "image": str(image_path),
        "csv": str(csv_path),
        "bars_visible": args.bars_visible,
        "detections_found": len(all_outputs),
        "results": all_outputs,
    }

    print(json.dumps(output, indent=2, default=str))


if __name__ == "__main__":
    main()

from pathlib import Path
from typing import Dict, Tuple

import pandas as pd
from huggingface_hub import hf_hub_download


REQUIRED_COLUMNS = ["datetime", "open", "high", "low", "close", "volume"]


def load_ohlc_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)

    missing = [col for col in REQUIRED_COLUMNS if col not in df.columns]
    if missing:
        raise ValueError(f"CSV is missing required columns: {missing}")

    df = df.copy()
    df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce")

    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
    return df


def normalize_detection(box, names) -> Dict:
    cls_id = int(box.cls[0].item())
    conf = float(box.conf[0].item())
    x1, y1, x2, y2 = box.xyxy[0].tolist()

    return {
        "class_id": cls_id,
        "class_name": names.get(cls_id, str(cls_id)) if isinstance(names, dict) else str(cls_id),
        "confidence": round(conf, 4),
        "x1": float(x1),
        "y1": float(y1),
        "x2": float(x2),
        "y2": float(y2),
    }


def map_pixels_to_bars(x1: float, x2: float, image_width: int, bars_visible: int) -> Tuple[int, int]:
    left_bar = int((x1 / image_width) * bars_visible)
    right_bar = int((x2 / image_width) * bars_visible)
    return left_bar, right_bar


def clamp_bar_range(left_bar: int, right_bar: int, df_len: int) -> Tuple[int, int]:
    left_bar = max(0, min(left_bar, df_len - 1))
    right_bar = max(0, min(right_bar, df_len - 1))
    if right_bar < left_bar:
        left_bar, right_bar = right_bar, left_bar
    return left_bar, right_bar


def resolve_model_ref(model_ref: str) -> str:
    """
    Resolve a YOLO model reference to a local path when possible.

    Supports:
    - local file paths
    - Hugging Face repo IDs like "owner/repo" (tries model.pt, then best.pt)
    """
    ref = model_ref.strip()
    if not ref:
        raise ValueError("Model reference is empty.")

    local_path = Path(ref)
    if local_path.exists():
        return str(local_path)

    if "://" in ref:
        return ref

    if ref.count("/") == 1 and "\\" not in ref:
        last_error = None
        for filename in ("model.pt", "best.pt"):
            try:
                cached = hf_hub_download(repo_id=ref, filename=filename)
                return str(Path(cached))
            except Exception as exc:  # noqa: BLE001
                last_error = exc

        raise FileNotFoundError(
            f"Could not resolve Hugging Face model '{ref}'. Tried filenames: model.pt, best.pt. "
            f"Last error: {last_error}"
        )

    return ref

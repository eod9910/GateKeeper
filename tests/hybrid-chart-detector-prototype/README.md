# Hybrid Chart Pattern Detector

This is a minimal Windows-first prototype for:

1. detecting chart patterns from chart screenshots with YOLO
2. mapping the detected region back to a visible bar range
3. validating the candidate against OHLC structure logic

Current rule-based validator implemented:
- head_shoulders

## Files

- `run_detector.py` -> main entry point
- `test_page.py` -> local upload UI test page (Streamlit)
- `batch_generate_charts.py` -> rolling chart-image generation from universe symbols
- `batch_infer_yolo.py` -> batch YOLO inference and detection export
- `validators.py` -> structure validation logic
- `utils.py` -> CSV loading and coordinate helpers
- `requirements.txt` -> dependencies

## Expected inputs

### 1) Chart image

A screenshot of the chart, for example:

- `data\chart_001.png`

### 2) OHLC CSV

A CSV with these columns:

- `datetime`
- `open`
- `high`
- `low`
- `close`
- `volume`

Example:

```csv
datetime,open,high,low,close,volume
2026-04-01 09:30:00,100,101,99.5,100.8,12345
2026-04-01 09:35:00,100.8,101.2,100.2,100.5,15300
```

### 3) Trained YOLO model

Your custom chart-pattern model, for example:

- `models\best.pt`

## Windows setup

Open Command Prompt in the project folder.

### Create a virtual environment

```bat
py -m venv .venv
.venv\Scripts\activate
```

### Install dependencies

```bat
py -m pip install -U pip
py -m pip install -r requirements.txt
```

## Run test page (upload chart + CSV)

```bat
py -m streamlit run test_page.py
```

Then in the browser UI:

1. Set your YOLO model path (for example `models\best.pt`).
2. Upload a chart image you know has a pattern.
3. Upload the matching OHLC CSV.
4. Enter the `bars-visible` count from the screenshot.
5. Click **Run Detection**.

You will see:
- an annotated image with boxes and pass/fail coloring
- structured JSON output with detection + validation diagnostics

## Batch pipeline (clean universe scan)

### 1) Generate rolling chart images

This step reads `backend/data/universe_clean.json`, fetches OHLC data from Yahoo, and renders rolling chart windows into PNGs.

```bat
py batch_generate_charts.py ^
  --universe-json ..\..\backend\data\universe_clean.json ^
  --output-dir artifacts\charts ^
  --timeframes 1d,1wk ^
  --period max ^
  --window-bars 200 ^
  --stride-bars 20 ^
  --max-symbols 200
```

Notes:
- Remove `--max-symbols 200` when you are ready for full-universe runs.
- Start with `--max-symbols 50` for a smoke test.

### 1b) Scan one symbol through full history

If you want exactly "scan this symbol through history", use `--symbol`:

```bat
py batch_generate_charts.py ^
  --symbol BTC-USD ^
  --output-dir artifacts\charts_btc ^
  --timeframes 1d,1wk ^
  --period max ^
  --window-bars 200 ^
  --stride-bars 20 ^
  --min-bars 260
```

### 2) Run YOLO on generated images

This step runs the model over all generated images and exports detections to CSV/JSON.

```bat
py batch_infer_yolo.py ^
  --model foduucom/stockmarket-pattern-detection-yolov8 ^
  --images-dir artifacts\charts ^
  --output-csv artifacts\predictions\detections.csv ^
  --output-json artifacts\predictions\summary.json ^
  --conf 0.70 ^
  --class-contains "head and shoulders"
```

Outputs:
- `artifacts\predictions\detections.csv`
- `artifacts\predictions\summary.json`

## Run

Example:

```bat
py run_detector.py ^
  --model models\best.pt ^
  --image data\chart_001.png ^
  --csv data\chart_001.csv ^
  --bars-visible 200 ^
  --conf 0.50
```

## Important assumption

`--bars-visible` means how many candles are visible from the far left to the far right of the chart screenshot.

If the screenshot shows 200 candles, pass:

```bat
--bars-visible 200
```

## Output

The script prints JSON to the console with:

- detection class
- confidence
- candidate bar range
- validation result
- trade idea fields if valid

## Notes

- YOLO finds candidate regions.
- The validator checks whether the OHLC structure actually matches a head-and-shoulders.
- More validators can be added later for:
  - double_top
  - double_bottom
  - inverse_head_shoulders
  - quasimodo

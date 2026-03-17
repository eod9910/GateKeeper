# Pattern Classifier ML Module

Train a machine learning model to recognize valid Wyckoff patterns based on YOUR judgments.

## How It Works

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Chart Data    │────▶│  Extract 13  │────▶│   Classifier    │
│ (Scanner + AI)  │     │   Features   │     │   Predicts:     │
└─────────────────┘     └──────────────┘     │ VALID/INVALID   │
                                             │ + Confidence %  │
        ┌───────────────────────────────────▶└─────────────────┘
        │
        │  Training Phase:
        │  Your labels teach the model
        │  what YOU consider valid
        │
┌───────┴───────┐
│  Your Labels  │
│ ✓ Correct     │
│ ✗ Incorrect   │
└───────────────┘
```

## Feature Vector (13 dimensions)

### Scanner Features (8)
| Feature | Description | Range |
|---------|-------------|-------|
| drawdown_pct | How much price dropped from peak | 0-1 |
| position_in_range | Current price position (low=0, high=1) | 0-1 |
| retracement | Pullback depth as % of markup | 0-1 |
| base_tightness | How tight the consolidation is | 0-1 |
| pattern_duration | Length of pattern (normalized) | 0-1 |
| volume_trend | Volume pattern (placeholder) | 0-1 |
| momentum | Recent price momentum | 0-1 |
| volatility | Price volatility (normalized) | 0-1 |

### AI Scores (5)
| Feature | Description | Range |
|---------|-------------|-------|
| pattern_likeness | How closely matches ideal Wyckoff | 0-1 |
| structural_clarity | Cleanliness of the structure | 0-1 |
| phase_completeness | How many phases are visible | 0-1 |
| failure_risk | Probability of pattern failure | 0-1 |
| entry_quality | Quality of current entry point | 0-1 |

## Setup

```bash
cd pattern-detector/ml
pip install -r requirements.txt
```

## Workflow

### 1. Collect Training Data (in Pattern Detector)

1. Scan symbols for patterns
2. Click "Ask AI" to get AI analysis + ML scores
3. Click "✓ Correct" or "✗ Incorrect" to label
4. Repeat for 50+ patterns

### 2. Export Training Data

1. Go to Labels page in Pattern Detector
2. Click "🧠 Export ML CSV"
3. Move the CSV to this folder

### 3. Train the Model

```bash
python train_classifier.py --data ml_training_data_2024-01-15.csv
```

Output:
```
Loaded 75 samples
Features shape: (75, 15)

MODEL COMPARISON
================
Logistic Regression:
  Test Accuracy: 82.67%
  CV Score (5-fold): 80.00% (+/- 8.94%)

Random Forest:
  Test Accuracy: 86.67%
  CV Score (5-fold): 84.00% (+/- 6.32%)

✅ Best model: Random Forest

FEATURE IMPORTANCE
==================
  1. ai_pattern_likeness: 0.2341
  2. ai_structural_clarity: 0.1892
  3. base_tightness: 0.1245
  ...
```

### 4. Use the Model

```bash
# Command line
python predict.py --vector "0.6,0.3,0.75,0.8,0.5,0.5,0.6,0.3,0.85,0.80,0.90,0.20,0.75,1,0.85"

# Output
PATTERN PREDICTION
==================
  Result: VALID
  Confidence: 87.3%
  Explanation: Valid pattern: strong pattern likeness (85%), clear structure (80%)
```

## Files

```
ml/
├── train_classifier.py   # Training script
├── predict.py            # Prediction script & class
├── build_feedback_dataset.py # Build ML rows from backend labels/corrections/candidates
├── train_feedback_models.py  # Train classifier + correction regressor from feedback rows
├── run_feedback_pipeline.py  # One-command dataset+training pipeline
├── requirements.txt      # Python dependencies
├── README.md             # This file
└── models/               # Saved models (created after training)
    ├── pattern_classifier.joblib
    ├── feature_scaler.joblib
    └── model_metadata.json
```

## New Feedback Pipeline (Recommended)

This pipeline uses your real scanner feedback directly:
- `YES/NO` labels → validity classifier
- manual base corrections → top/bottom correction regressor

### Run full pipeline

```bash
cd ml
pip install -r requirements.txt
python run_feedback_pipeline.py
```

Outputs:
- `ml/artifacts/feedback_dataset/classifier_rows.csv`
- `ml/artifacts/feedback_dataset/regressor_rows.csv`
- `ml/artifacts/feedback_dataset/dataset_report.json`
- `ml/models/feedback_v1/feedback_classifier.joblib`
- `ml/models/feedback_v1/feedback_base_regressor.joblib` (if enough correction rows)
- `ml/models/feedback_v1/pipeline_report.json`

### Run steps separately

```bash
python build_feedback_dataset.py
python train_feedback_models.py
```

Notes:
- By default, `close` labels are excluded from classifier training.
- Use `--include-close` if you want to treat `close` as positive.
- If data is sparse, scripts still export reports and skip unsupported model steps gracefully.

## Tips for Better Accuracy

1. **Label consistently** - Be consistent in what you consider "correct"
2. **Balance your data** - Try to have similar counts of correct/incorrect
3. **Quality over quantity** - 50 good labels beat 200 sloppy ones
4. **Re-train periodically** - As you add more labels, re-train
5. **Check feature importance** - See which features matter most to YOUR judgment

## Minimum Data Requirements

| Samples | What to Expect |
|---------|----------------|
| < 20 | Won't train (need more data) |
| 20-50 | Basic model, ~60-70% accuracy |
| 50-100 | Good model, ~75-85% accuracy |
| 100-200 | Strong model, ~85-90% accuracy |
| 200+ | Best results, personalized to you |

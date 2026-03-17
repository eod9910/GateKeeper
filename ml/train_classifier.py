"""
Pattern Classifier Training Script

This script trains a machine learning model on your labeled pattern data.
It learns to predict whether a chart shows a valid Wyckoff pattern based on:
- Scanner features (8 dimensions from chart data)
- AI scores (5 dimensions from vision AI)

Usage:
  1. Export your training data from the Pattern Detector (🧠 Export ML CSV)
  2. Place the CSV file in this folder
  3. Run: python train_classifier.py --data ml_training_data_YYYY-MM-DD.csv
  4. The trained model will be saved as 'pattern_classifier.joblib'

Requirements:
  pip install pandas scikit-learn joblib numpy
"""

import argparse
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
from sklearn.preprocessing import StandardScaler
import joblib


# Feature names for reference
SCANNER_FEATURES = [
    'drawdown_pct',
    'position_in_range', 
    'retracement',
    'base_tightness',
    'pattern_duration',
    'volume_trend',
    'momentum',
    'volatility'
]

AI_FEATURES = [
    'ai_pattern_likeness',
    'ai_structural_clarity',
    'ai_phase_completeness',
    'ai_failure_risk',
    'ai_entry_quality'
]

ALL_FEATURES = SCANNER_FEATURES + AI_FEATURES + ['ai_valid', 'ai_confidence']


def load_data(csv_path: str) -> pd.DataFrame:
    """Load training data from CSV export."""
    print(f"Loading data from: {csv_path}")
    df = pd.read_csv(csv_path)
    print(f"Loaded {len(df)} samples")
    return df


def prepare_features(df: pd.DataFrame) -> tuple:
    """Extract features and labels from dataframe."""
    # Feature columns (all numeric features)
    feature_cols = [col for col in df.columns if col not in ['symbol', 'timestamp', 'user_correct', 'label']]
    
    X = df[feature_cols].values
    y = df['label'].values
    
    print(f"Features shape: {X.shape}")
    print(f"Labels distribution: {np.bincount(y.astype(int))}")
    
    return X, y, feature_cols


def train_models(X: np.ndarray, y: np.ndarray) -> dict:
    """Train multiple models and compare performance."""
    
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    # Scale features
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    models = {
        'Logistic Regression': LogisticRegression(random_state=42, max_iter=1000),
        'Random Forest': RandomForestClassifier(n_estimators=100, random_state=42, max_depth=5),
        'Gradient Boosting': GradientBoostingClassifier(n_estimators=100, random_state=42, max_depth=3)
    }
    
    results = {}
    
    print("\n" + "="*60)
    print("MODEL COMPARISON")
    print("="*60)
    
    for name, model in models.items():
        # Use scaled data for logistic regression
        if 'Logistic' in name:
            model.fit(X_train_scaled, y_train)
            y_pred = model.predict(X_test_scaled)
            cv_scores = cross_val_score(model, X_train_scaled, y_train, cv=5)
        else:
            model.fit(X_train, y_train)
            y_pred = model.predict(X_test)
            cv_scores = cross_val_score(model, X_train, y_train, cv=5)
        
        accuracy = accuracy_score(y_test, y_pred)
        
        print(f"\n{name}:")
        print(f"  Test Accuracy: {accuracy:.2%}")
        print(f"  CV Score (5-fold): {cv_scores.mean():.2%} (+/- {cv_scores.std()*2:.2%})")
        
        results[name] = {
            'model': model,
            'accuracy': accuracy,
            'cv_mean': cv_scores.mean(),
            'cv_std': cv_scores.std()
        }
    
    return results, scaler, (X_test, y_test)


def analyze_features(model, feature_names: list) -> None:
    """Analyze feature importance."""
    if hasattr(model, 'feature_importances_'):
        importances = model.feature_importances_
        indices = np.argsort(importances)[::-1]
        
        print("\n" + "="*60)
        print("FEATURE IMPORTANCE")
        print("="*60)
        
        for i, idx in enumerate(indices[:10]):
            print(f"  {i+1}. {feature_names[idx]}: {importances[idx]:.4f}")


def save_model(model, scaler, feature_names: list, output_dir: str) -> None:
    """Save the trained model and metadata."""
    os.makedirs(output_dir, exist_ok=True)
    
    # Save model
    model_path = os.path.join(output_dir, 'pattern_classifier.joblib')
    joblib.dump(model, model_path)
    print(f"\nModel saved to: {model_path}")
    
    # Save scaler
    scaler_path = os.path.join(output_dir, 'feature_scaler.joblib')
    joblib.dump(scaler, scaler_path)
    print(f"Scaler saved to: {scaler_path}")
    
    # Save metadata
    metadata = {
        'feature_names': feature_names,
        'model_type': type(model).__name__,
        'n_features': len(feature_names)
    }
    metadata_path = os.path.join(output_dir, 'model_metadata.json')
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"Metadata saved to: {metadata_path}")


def predict_example(model, scaler, feature_names: list) -> None:
    """Show example prediction."""
    print("\n" + "="*60)
    print("EXAMPLE PREDICTION")
    print("="*60)
    
    # Create a sample "good" pattern vector
    sample_good = {
        'drawdown_pct': 0.6,
        'position_in_range': 0.3,
        'retracement': 0.75,
        'base_tightness': 0.8,
        'pattern_duration': 0.5,
        'volume_trend': 0.5,
        'momentum': 0.6,
        'volatility': 0.3,
        'ai_pattern_likeness': 0.85,
        'ai_structural_clarity': 0.80,
        'ai_phase_completeness': 0.90,
        'ai_failure_risk': 0.20,
        'ai_entry_quality': 0.75,
        'ai_valid': 1,
        'ai_confidence': 0.85
    }
    
    X_sample = np.array([[sample_good.get(f, 0.5) for f in feature_names]])
    
    if hasattr(model, 'predict_proba'):
        proba = model.predict_proba(X_sample)[0]
        pred = model.predict(X_sample)[0]
        print(f"Sample 'good pattern' prediction:")
        print(f"  Prediction: {'VALID PATTERN' if pred == 1 else 'NOT VALID'}")
        print(f"  Confidence: {max(proba):.1%}")


def main():
    parser = argparse.ArgumentParser(description='Train pattern classifier')
    parser.add_argument('--data', type=str, required=True, help='Path to training CSV file')
    parser.add_argument('--output', type=str, default='./models', help='Output directory for model')
    args = parser.parse_args()
    
    # Load data
    df = load_data(args.data)
    
    if len(df) < 20:
        print(f"\n⚠️  WARNING: Only {len(df)} samples. Need at least 20 for reliable training.")
        print("Keep labeling more patterns!")
        if len(df) < 10:
            print("Exiting - need at least 10 samples to train.")
            return
    
    # Prepare features
    X, y, feature_names = prepare_features(df)
    
    # Check class balance
    unique, counts = np.unique(y, return_counts=True)
    print(f"\nClass distribution:")
    for u, c in zip(unique, counts):
        label = 'CORRECT' if u == 1 else 'INCORRECT'
        print(f"  {label}: {c} samples ({c/len(y):.1%})")
    
    if min(counts) < 5:
        print("\n⚠️  WARNING: Imbalanced classes. Try to get more examples of the minority class.")
    
    # Train models
    results, scaler, (X_test, y_test) = train_models(X, y)
    
    # Select best model
    best_name = max(results.keys(), key=lambda k: results[k]['cv_mean'])
    best_model = results[best_name]['model']
    print(f"\n✅ Best model: {best_name}")
    
    # Feature importance
    analyze_features(best_model, feature_names)
    
    # Detailed report for best model
    print("\n" + "="*60)
    print(f"DETAILED REPORT: {best_name}")
    print("="*60)
    
    if 'Logistic' in best_name:
        y_pred = best_model.predict(scaler.transform(X_test))
    else:
        y_pred = best_model.predict(X_test)
    
    print("\nConfusion Matrix:")
    print(confusion_matrix(y_test, y_pred))
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred, target_names=['INCORRECT', 'CORRECT']))
    
    # Save model
    save_model(best_model, scaler, feature_names, args.output)
    
    # Example prediction
    predict_example(best_model, scaler, feature_names)
    
    print("\n" + "="*60)
    print("TRAINING COMPLETE!")
    print("="*60)
    print(f"\nNext steps:")
    print(f"1. Keep labeling patterns to improve accuracy")
    print(f"2. Re-train periodically as you add more data")
    print(f"3. The model will be integrated into the Pattern Detector")


if __name__ == '__main__':
    main()

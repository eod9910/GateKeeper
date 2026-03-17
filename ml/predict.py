"""
Pattern Classifier Prediction Script

Use the trained model to predict whether a pattern is valid.

Usage:
  python predict.py --vector "0.6,0.3,0.75,0.8,0.5,0.5,0.6,0.3,0.85,0.80,0.90,0.20,0.75,1,0.85"

Or import as a module:
  from predict import PatternClassifier
  clf = PatternClassifier('models/')
  result = clf.predict(feature_vector)
"""

import argparse
import json
import os
from typing import Dict, List, Optional

import numpy as np
import joblib


class PatternClassifier:
    """Wrapper for the trained pattern classifier."""
    
    def __init__(self, model_dir: str = './models'):
        self.model_dir = model_dir
        self.model = None
        self.scaler = None
        self.feature_names = None
        self._load()
    
    def _load(self) -> None:
        """Load the trained model and metadata."""
        model_path = os.path.join(self.model_dir, 'pattern_classifier.joblib')
        scaler_path = os.path.join(self.model_dir, 'feature_scaler.joblib')
        metadata_path = os.path.join(self.model_dir, 'model_metadata.json')
        
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model not found at {model_path}. Train first!")
        
        self.model = joblib.load(model_path)
        
        if os.path.exists(scaler_path):
            self.scaler = joblib.load(scaler_path)
        
        if os.path.exists(metadata_path):
            with open(metadata_path, 'r') as f:
                metadata = json.load(f)
                self.feature_names = metadata.get('feature_names', [])
    
    def predict(self, features: List[float]) -> Dict:
        """
        Predict whether the pattern is valid.
        
        Args:
            features: List of 15 feature values
                [8 scanner features + 5 AI scores + ai_valid + ai_confidence]
        
        Returns:
            Dict with prediction, confidence, and explanation
        """
        X = np.array(features).reshape(1, -1)
        
        # Scale if scaler exists (for logistic regression)
        if self.scaler is not None and 'Logistic' in type(self.model).__name__:
            X = self.scaler.transform(X)
        
        prediction = int(self.model.predict(X)[0])
        
        # Get probability if available
        confidence = 0.5
        if hasattr(self.model, 'predict_proba'):
            proba = self.model.predict_proba(X)[0]
            confidence = float(max(proba))
        
        # Generate explanation
        is_valid = prediction == 1
        explanation = self._generate_explanation(features, is_valid, confidence)
        
        return {
            'prediction': 'VALID' if is_valid else 'INVALID',
            'is_valid': is_valid,
            'confidence': confidence,
            'confidence_pct': f"{confidence:.1%}",
            'explanation': explanation
        }
    
    def _generate_explanation(self, features: List[float], is_valid: bool, confidence: float) -> str:
        """Generate a human-readable explanation."""
        if not self.feature_names or len(features) < 15:
            return "Prediction based on learned patterns."
        
        # Map features to names
        feature_dict = dict(zip(self.feature_names, features))
        
        reasons = []
        
        # Analyze key features
        ai_likeness = feature_dict.get('ai_pattern_likeness', 0.5)
        ai_clarity = feature_dict.get('ai_structural_clarity', 0.5)
        ai_risk = feature_dict.get('ai_failure_risk', 0.5)
        base_tightness = feature_dict.get('base_tightness', 0.5)
        
        if is_valid:
            if ai_likeness > 0.7:
                reasons.append(f"strong pattern likeness ({ai_likeness:.0%})")
            if ai_clarity > 0.7:
                reasons.append(f"clear structure ({ai_clarity:.0%})")
            if ai_risk < 0.3:
                reasons.append(f"low failure risk ({ai_risk:.0%})")
            if base_tightness > 0.6:
                reasons.append(f"tight consolidation base")
        else:
            if ai_likeness < 0.5:
                reasons.append(f"weak pattern match ({ai_likeness:.0%})")
            if ai_clarity < 0.5:
                reasons.append(f"unclear structure ({ai_clarity:.0%})")
            if ai_risk > 0.6:
                reasons.append(f"high failure risk ({ai_risk:.0%})")
        
        if reasons:
            return f"{'Valid' if is_valid else 'Invalid'} pattern: " + ", ".join(reasons[:3])
        else:
            return f"Prediction based on overall feature combination (confidence: {confidence:.0%})"
    
    def predict_from_dict(self, feature_dict: Dict[str, float]) -> Dict:
        """
        Predict from a dictionary of named features.
        
        Args:
            feature_dict: Dict mapping feature names to values
        
        Returns:
            Dict with prediction result
        """
        if not self.feature_names:
            raise ValueError("Feature names not loaded")
        
        features = [feature_dict.get(name, 0.5) for name in self.feature_names]
        return self.predict(features)


def main():
    parser = argparse.ArgumentParser(description='Predict pattern validity')
    parser.add_argument('--vector', type=str, help='Comma-separated feature values')
    parser.add_argument('--model-dir', type=str, default='./models', help='Model directory')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    args = parser.parse_args()
    
    try:
        clf = PatternClassifier(args.model_dir)
    except FileNotFoundError as e:
        print(f"Error: {e}")
        print("Train the model first with: python train_classifier.py --data your_data.csv")
        return
    
    if args.vector:
        features = [float(x.strip()) for x in args.vector.split(',')]
        result = clf.predict(features)
        
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"\n{'='*50}")
            print(f"PATTERN PREDICTION")
            print(f"{'='*50}")
            print(f"  Result: {result['prediction']}")
            print(f"  Confidence: {result['confidence_pct']}")
            print(f"  Explanation: {result['explanation']}")
    else:
        print("Usage: python predict.py --vector \"0.6,0.3,...\" ")
        print("       (15 comma-separated feature values)")


if __name__ == '__main__':
    main()

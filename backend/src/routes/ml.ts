/**
 * ML API Routes
 *
 * Runtime scoring endpoints for the local pattern classifier in /ml.
 */

import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { ApiResponse } from '../types';

type MlBatchItem = {
  id?: string;
  vector: number[];
};

type MlPrediction = {
  id?: string;
  prediction: 'VALID' | 'INVALID';
  is_valid: boolean;
  confidence: number;
  confidence_pct: string;
  explanation: string;
};

const router = Router();

function projectRootPath(): string {
  // Works from both backend/src/routes and backend/dist/routes
  return path.resolve(__dirname, '..', '..', '..');
}

function defaultModelDir(): string {
  return path.join(projectRootPath(), 'ml', 'models');
}

function modelExists(modelDir = defaultModelDir()): boolean {
  return fs.existsSync(path.join(modelDir, 'pattern_classifier.joblib'));
}

function runMlPredictBatch(
  vectors: MlBatchItem[],
  modelDir = defaultModelDir()
): Promise<{ predictions: MlPrediction[]; n_features?: number }> {
  const payload = {
    vectors,
    modelDir,
    projectRoot: projectRootPath(),
  };

  const pyScript = `
import json, os, sys

def _to_float_list(raw):
    out = []
    for x in (raw or []):
        try:
            out.append(float(x))
        except Exception:
            out.append(0.5)
    return out

try:
    req = json.loads(sys.stdin.read() or "{}")
    project_root = req.get("projectRoot") or os.getcwd()
    ml_dir = os.path.join(project_root, "ml")
    if ml_dir not in sys.path:
        sys.path.insert(0, ml_dir)

    from predict import PatternClassifier

    model_dir = req.get("modelDir") or os.path.join(ml_dir, "models")
    clf = PatternClassifier(model_dir)
    vectors = req.get("vectors") or []

    n_features = 0
    try:
        n_features = int(getattr(clf.model, "n_features_in_", 0) or 0)
    except Exception:
        n_features = 0
    if not n_features:
        try:
            n_features = len(clf.feature_names or [])
        except Exception:
            n_features = 0

    preds = []
    for item in vectors:
        if isinstance(item, dict):
            cid = item.get("id")
            vec = _to_float_list(item.get("vector"))
        else:
            cid = None
            vec = _to_float_list(item)

        if n_features > 0:
            if len(vec) < n_features:
                vec = vec + [0.5] * (n_features - len(vec))
            elif len(vec) > n_features:
                vec = vec[:n_features]

        res = clf.predict(vec)
        if cid is not None:
            res["id"] = str(cid)
        preds.append(res)

    print(json.dumps({"ok": True, "predictions": preds, "n_features": n_features}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
    sys.exit(1)
`.trim();

  const tryCommands = ['py', 'python'];

  return new Promise((resolve, reject) => {
    let idx = 0;

    const runNext = () => {
      if (idx >= tryCommands.length) {
        return reject(new Error('No Python runtime found (tried: py, python)'));
      }
      const cmd = tryCommands[idx++];
      const child = spawn(cmd, ['-c', pyScript], {
        cwd: projectRootPath(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let spawnError: Error | null = null;

      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('error', (err) => { spawnError = err; });

      child.on('close', (code: number) => {
        // Try next command if executable missing
        if (spawnError && /ENOENT/i.test(String(spawnError.message || ''))) {
          return runNext();
        }

        if (code !== 0) {
          const msg = stderr.trim() || stdout.trim() || `ML predict process failed (exit ${code})`;
          return reject(new Error(msg));
        }

        let parsed: any;
        try {
          parsed = JSON.parse(stdout);
        } catch (e: any) {
          return reject(new Error(`Failed to parse ML output: ${e.message}`));
        }

        if (!parsed?.ok) {
          return reject(new Error(parsed?.error || 'ML prediction failed'));
        }

        resolve({
          predictions: Array.isArray(parsed.predictions) ? parsed.predictions : [],
          n_features: typeof parsed.n_features === 'number' ? parsed.n_features : undefined,
        });
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    };

    runNext();
  });
}

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const modelDir = defaultModelDir();
    const exists = modelExists(modelDir);
    return res.json({
      success: true,
      data: {
        ready: exists,
        modelDir,
        modelFile: path.join(modelDir, 'pattern_classifier.joblib'),
      },
    } as ApiResponse<any>);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    } as ApiResponse<null>);
  }
});

/**
 * POST /api/ml/predict
 * Body: { vector: number[] } or { vectors: [{id?, vector:number[]}] }
 */
router.post('/predict', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const modelDir = typeof body.modelDir === 'string' && body.modelDir.trim()
      ? body.modelDir.trim()
      : defaultModelDir();

    if (!modelExists(modelDir)) {
      return res.status(404).json({
        success: false,
        error: `Model not found at ${path.join(modelDir, 'pattern_classifier.joblib')}. Train first with ml/train_classifier.py.`,
      } as ApiResponse<null>);
    }

    let vectors: MlBatchItem[] = [];
    if (Array.isArray(body.vectors)) {
      vectors = body.vectors
        .filter((v: any) => v && Array.isArray(v.vector))
        .map((v: any) => ({
          id: v.id != null ? String(v.id) : undefined,
          vector: v.vector.map((x: any) => Number(x)),
        }));
    } else if (Array.isArray(body.vector)) {
      vectors = [{ id: body.id != null ? String(body.id) : undefined, vector: body.vector.map((x: any) => Number(x)) }];
    } else {
      return res.status(400).json({
        success: false,
        error: 'Body must include either vector:number[] or vectors:[{id?, vector:number[]}]',
      } as ApiResponse<null>);
    }

    const result = await runMlPredictBatch(vectors, modelDir);

    // Preserve compatibility: if single vector input, also return first prediction shortcut.
    const single = !!Array.isArray(body.vector);
    return res.json({
      success: true,
      data: single
        ? { prediction: result.predictions[0] || null, n_features: result.n_features }
        : { predictions: result.predictions, n_features: result.n_features },
    } as ApiResponse<any>);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    } as ApiResponse<null>);
  }
});

export default router;


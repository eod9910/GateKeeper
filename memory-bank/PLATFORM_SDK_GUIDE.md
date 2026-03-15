# Platform SDK Architecture & Refactor Report

## 1. Overview of the Refactor
The backend of the Pattern Detector previously stored core algorithmic modules (math, geometry, data fetching) in the same flat directory as the service runners (`backend/services/`). 

To create a clean boundary between **Core Algorithms** and **Plugins/Runners**, we created a dedicated `platform_sdk` namespace. This isolates the mathematical and foundational logic from the application infrastructure, making it easier for both humans and the AI (Plugin Engineer) to understand what tools are available to build trading strategies.

## 2. What Was Changed and Created

### Moved Files (The Core SDK Modules)
The following files were moved from `backend/services/` into the new `backend/services/platform_sdk/` directory:
*   `rdp.py` (Ramer-Douglas-Peucker geometry algorithms)
*   `swing_structure.py` (Trend classification and swing point detection)
*   `ohlcv.py` (Data fetching, caching, and OHLCV structures)
*   `energy.py` (Buying/selling pressure calculations)
*   `fib_analysis.py` (Fibonacci retracement math)
*   `numba_indicators.py` (High-performance JIT-compiled indicators like SMA, RSI, MACD)
*   `copilot.py` (Wyckoff pattern scanners and analysis)

### Created Files
*   **`backend/services/platform_sdk/__init__.py`**: This file re-exports all the functions from the modules listed above. It turns the `platform_sdk` folder into a proper, importable Python package.
*   **`backend/services/platform_sdk/manifest.json`**: A machine-readable catalog of every public function in the SDK. It includes function signatures, parameters, return types, and descriptions. **This is the instruction manual for the AI Plugin Engineer.**

### Altered Files
*   **`backend/services/patternScanner.py`**: Converted into a backward-compatibility shim. It now imports everything from `platform_sdk` and re-exports it, so any external scripts relying on it won't break.
*   **Plugins (`backend/services/plugins/*.py`)**: Over 30 plugin files were updated. Their imports were changed from `from rdp import ...` to `from platform_sdk.rdp import ...`.
*   **System Services**: Files like `strategyRunner.py`, `backtestEngine.py`, `validatorPipeline.py`, and `plugin_service.py` had their imports updated to point to the new `platform_sdk` namespace.

---

## 3. Step-by-Step Guide: How to Create a New SDK Package

If you develop new algorithmic logic (e.g., a complex Volume Profile analyzer or a Fourier Transform module), you need to add it to the SDK so that plugins can use it and the AI knows it exists.

**Step 1: Create the Python Module**
Create your new Python file directly inside the SDK folder.
*   *Path:* `backend/services/platform_sdk/my_new_algo.py`
*   *Rule:* Keep it focused purely on data processing, math, or pattern recognition. Do not put UI or web-server logic here.

**Step 2: Expose it to the Backend Framework**
Open the SDK's initialization file:
*   *Path:* `backend/services/platform_sdk/__init__.py`
Add your module to the export list so it becomes part of the unified SDK namespace:
```python
from .my_new_algo import *
```

**Step 3: Expose it to the AI Plugin Engineer**
The AI is blind to Python files; it only reads the manifest. You must document your new module in the manifest so the AI can use it to build plugins.
*   *Path:* `backend/services/platform_sdk/manifest.json`
*   Add a new entry block following this exact format:
```json
{
  "module": "my_new_algo",
  "functions": [
    {
      "name": "calculate_volume_profile",
      "signature": "calculate_volume_profile(data: List[OHLCV], bins: int) -> dict",
      "description": "Calculates the volume profile for a given set of price data.",
      "params": [
        {"name": "data", "type": "List[OHLCV]", "description": "The price data"},
        {"name": "bins", "type": "int", "description": "Number of price bins"}
      ],
      "returns": "dict"
    }
  ]
}
```

---

## 4. Step-by-Step Guide: How to Import from the SDK

Once a package is in the SDK, here is how you (or the AI) import it when writing a **Plugin** (Primitive or Composite) or a new backend service.

Because `backend/services/` is always in the Python system path, you use absolute imports starting with `platform_sdk`.

**Method A: Import directly from the specific module (Preferred for clarity)**
```python
from platform_sdk.rdp import detect_swings_rdp
from platform_sdk.ohlcv import OHLCV
from platform_sdk.my_new_algo import calculate_volume_profile
```

**Method B: Import from the root SDK namespace (Works because of `__init__.py`)**
```python
from platform_sdk import detect_swings_rdp, OHLCV, calculate_volume_profile
```

**Method C: Importing inside the SDK itself (Internal routing)**
If you are writing code *inside* one of the SDK modules (e.g., you are editing `copilot.py` and need a function from `rdp.py`), you must use a relative import:
```python
from .rdp import detect_swings_rdp
from .ohlcv import OHLCV
```

---

## Summary
The **Platform SDK** is the brain of the system. 
1. Math goes into `platform_sdk/`.
2. It gets exported via `__init__.py`. 
3. It gets documented for the AI in `manifest.json`.
4. Plugins (`backend/services/plugins/`) import it using `from platform_sdk.module_name import function_name` to turn that math into visual chart indicators and trading strategies.

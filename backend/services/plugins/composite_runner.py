#!/usr/bin/env python3
"""
Generic Composite Indicator Runner.

Supports two execution modes:
  - **filter** (default): All primitives run independently on the same data.
    A boolean reducer (AND/OR/N-of-M) combines pass/fail verdicts.
  - **pipeline**: Primitives form a DAG. Upstream output ports are routed
    to downstream input ports before execution. Execution follows
    topological order so dependencies resolve first.

Any composite indicator (entry, exit, regime, analysis) uses this runner.
The specific behavior is defined entirely by the composite_spec JSON — not
by this Python code.
"""
from __future__ import annotations

import json
import os
from collections import deque
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Set

from platform_sdk.ohlcv import OHLCV
from fib_energy_primitives import build_chart_data, compute_spec_hash

SERVICES_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
PATTERNS_DIR = os.path.normpath(os.path.join(SERVICES_DIR, "..", "data", "patterns"))
REGISTRY_FILE = os.path.join(PATTERNS_DIR, "registry.json")

# Set COMPOSITE_DEBUG=1 in env to enable verbose per-bar stage logging.
# Disabled by default — printing full swing structures on every bar adds
# significant I/O overhead during backtests (thousands of calls × KB payloads).
_DEBUG = os.environ.get("COMPOSITE_DEBUG", "").lower() in ("1", "true", "yes")
_STAGE_FN_CACHE: Dict[str, Dict[str, Any]] = {}


def _is_within(base_dir: str, target_path: str) -> bool:
    rel = os.path.relpath(target_path, base_dir)
    return rel == "." or (not rel.startswith("..") and not os.path.isabs(rel))


def _resolve_stage_plugin(pattern_id: str) -> Optional[Callable[..., List[Dict[str, Any]]]]:
    if not pattern_id or not os.path.exists(REGISTRY_FILE):
        return None

    with open(REGISTRY_FILE, "r", encoding="utf-8-sig") as f:
        registry = json.load(f)
    entry = None
    for p in registry.get("patterns", []):
        if str(p.get("pattern_id", "")).strip() == pattern_id:
            entry = p
            break
    if not entry:
        return None

    definition_file = str(entry.get("definition_file", "")).strip()
    if not definition_file:
        return None
    definition_path = os.path.join(PATTERNS_DIR, definition_file)
    if not os.path.exists(definition_path):
        return None

    with open(definition_path, "r", encoding="utf-8-sig") as f:
        definition = json.load(f)
    plugin_file = str(definition.get("plugin_file", "")).strip().replace("\\", "/")
    plugin_function = str(definition.get("plugin_function", "")).strip() or f"run_{pattern_id}_plugin"
    if not plugin_file:
        return None

    if os.path.isabs(plugin_file):
        plugin_path = os.path.normpath(plugin_file)
    else:
        plugin_path = os.path.normpath(os.path.join(SERVICES_DIR, plugin_file))
    if not _is_within(SERVICES_DIR, plugin_path) or not os.path.exists(plugin_path):
        return None

    mtime = os.path.getmtime(plugin_path)
    cache_key = f"{pattern_id}::{plugin_path}::{plugin_function}"
    cached = _STAGE_FN_CACHE.get(cache_key)
    if cached and cached.get("mtime") == mtime and callable(cached.get("fn")):
        return cached["fn"]

    with open(plugin_path, "r", encoding="utf-8") as f:
        source = f.read()
    plugin_globals: Dict[str, Any] = {
        "__name__": f"plugin_stage_{pattern_id}",
        "__file__": plugin_path,
        "__package__": None,
    }
    exec(compile(source, plugin_path, "exec"), plugin_globals)

    fn = plugin_globals.get(plugin_function)
    if not callable(fn):
        fallback_name = f"run_{pattern_id}_plugin"
        fn = plugin_globals.get(fallback_name)
    if not callable(fn):
        for k, v in plugin_globals.items():
            if callable(v) and k.startswith("run_") and k.endswith("_plugin"):
                fn = v
                break
    if not callable(fn):
        return None
    _STAGE_FN_CACHE[cache_key] = {"mtime": mtime, "fn": fn}
    return fn


def _build_stage_spec(
    parent_spec: Dict[str, Any], stage_pattern_id: str, stage_setup_overrides: Dict[str, Any]
) -> Dict[str, Any]:
    stage_spec = dict(parent_spec)
    setup = dict((parent_spec.get("setup_config", {}) or {}))
    setup.update(stage_setup_overrides or {})
    setup["pattern_type"] = stage_pattern_id
    stage_spec["setup_config"] = setup
    return stage_spec


def _node_from_candidate(stage_pattern_id: str, candidate: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not candidate:
        return {
            "passed": False,
            "score": 0.0,
            "features": {"pattern_id": stage_pattern_id},
            "anchors": {},
            "reason": "no_candidate",
        }
    node = candidate.get("node_result")
    if isinstance(node, dict) and "passed" in node:
        return {
            "passed": bool(node.get("passed")),
            "score": float(node.get("score", 0.0)),
            "features": dict(node.get("features", {}) or {}),
            "anchors": dict(node.get("anchors", {}) or {}),
            "reason": str(node.get("reason", "unknown")),
        }

    rules = candidate.get("rule_checklist") or []
    passed = bool(rules) and all(bool(r.get("passed")) for r in rules if isinstance(r, dict))
    return {
        "passed": passed,
        "score": float(candidate.get("score", 0.0)),
        "features": {"pattern_id": stage_pattern_id},
        "anchors": dict(candidate.get("anchors", {}) or {}),
        "reason": "derived_from_candidate",
    }


def _merge_chart_data(
    base_data: List[OHLCV], stage_candidates: Dict[str, Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Merge chart_data from all stage candidates into a single chart dataset.
    Takes the first non-empty chart_data as the base (likely from RDP with swing pivots),
    then overlays additional annotations (fib levels, etc.) from other stages.
    """
    merged_chart = None
    
    # Find a stage with rich chart_data (RDP's chart_data has swing pivots pre-annotated)
    for stage_id, candidate in stage_candidates.items():
        stage_chart = candidate.get("chart_data", [])
        if isinstance(stage_chart, list) and len(stage_chart) > 0:
            # Look for a chart with pre-existing markers (RDP)
            has_markers = any(isinstance(bar, dict) and bar.get("markers") for bar in stage_chart)
            if has_markers:
                merged_chart = [dict(bar) for bar in stage_chart]  # Deep copy
                break
    
    # Fallback: use plain chart if no annotated chart found
    if merged_chart is None:
        merged_chart = build_chart_data(base_data)
    
    # Now overlay additional annotations from other stages (Fib levels, etc.)
    for stage_id, candidate in stage_candidates.items():
        stage_chart = candidate.get("chart_data", [])
        if not isinstance(stage_chart, list):
            continue
        
        # Extract fib levels from output_ports if present
        output_ports = candidate.get("output_ports", {})
        fib_levels_data = output_ports.get("fib_levels") if isinstance(output_ports, dict) else None
        
        if fib_levels_data and isinstance(fib_levels_data, dict):
            # Add fib levels as horizontal lines on the last bar
            if merged_chart and len(merged_chart) > 0:
                last_bar = merged_chart[-1]
                if "levels" not in last_bar:
                    last_bar["levels"] = []
                
                # Add fib retracement levels
                range_high = fib_levels_data.get("range_high")
                range_low = fib_levels_data.get("range_low")
                retracement_pct = fib_levels_data.get("retracement_pct")
                
                if range_high and range_low:
                    fib_pcts = [0.236, 0.382, 0.50, 0.618, 0.70, 0.786]
                    for pct in fib_pcts:
                        price = range_high - ((range_high - range_low) * pct)
                        last_bar["levels"].append({
                            "price": price,
                            "label": f"Fib {pct*100:.1f}%",
                            "color": "#4ba864" if pct == 0.70 else "#666",
                            "style": "solid" if pct == 0.70 else "dashed",
                        })
                    
                    # Add range high/low markers
                    last_bar["levels"].append({
                        "price": range_high,
                        "label": "Fib High",
                        "color": "#5a8bd8",
                        "style": "solid",
                    })
                    last_bar["levels"].append({
                        "price": range_low,
                        "label": "Fib Low",
                        "color": "#5a8bd8",
                        "style": "solid",
                    })
    
    return merged_chart


def _evaluate_reducer(reducer: Dict[str, Any], stage_trace: Dict[str, Dict[str, Any]]) -> bool:
    op = str((reducer or {}).get("op", "AND")).upper()
    inputs = list((reducer or {}).get("inputs", []) or [])
    if not inputs:
        inputs = list(stage_trace.keys())
    input_values = [bool(stage_trace.get(i, {}).get("passed")) for i in inputs]

    if op == "AND":
        return all(input_values)
    if op == "OR":
        return any(input_values)
    if op in ("N_OF_M", "AT_LEAST"):
        n = int((reducer or {}).get("n", len(inputs)))
        return sum(1 for v in input_values if v) >= n
    return all(input_values)


# ---------------------------------------------------------------------------
# DAG / Pipeline helpers
# ---------------------------------------------------------------------------

def _topological_sort(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> List[str]:
    """
    Return node IDs in topological order so every node is executed after
    all its upstream dependencies. Raises ValueError on cycles.
    """
    node_ids = [str(n.get("id", "")).strip() for n in nodes if n.get("id")]
    id_set: Set[str] = set(node_ids)

    in_degree: Dict[str, int] = {nid: 0 for nid in node_ids}
    adjacency: Dict[str, List[str]] = {nid: [] for nid in node_ids}

    for edge in edges:
        src = str(edge.get("from", "")).strip()
        dst = str(edge.get("to", "")).strip()
        if src in id_set and dst in id_set:
            adjacency[src].append(dst)
            in_degree[dst] = in_degree.get(dst, 0) + 1

    queue: deque[str] = deque(nid for nid in node_ids if in_degree[nid] == 0)
    ordered: List[str] = []
    while queue:
        nid = queue.popleft()
        ordered.append(nid)
        for child in adjacency.get(nid, []):
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)

    if len(ordered) != len(node_ids):
        raise ValueError(
            f"Pipeline DAG contains a cycle. Sorted {len(ordered)}/{len(node_ids)} nodes."
        )
    return ordered


def _resolve_upstream(
    edges: List[Dict[str, Any]],
    stage_id: str,
    stage_candidates: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Collect upstream output_ports data for *stage_id* by following edges.
    Returns a dict mapping to_port_name → upstream data value.
    """
    upstream: Dict[str, Any] = {}
    for edge in edges:
        if str(edge.get("to", "")).strip() != stage_id:
            continue
        src_id = str(edge.get("from", "")).strip()
        from_port = str(edge.get("from_port", "")).strip()
        to_port = str(edge.get("to_port", "")).strip()
        if not src_id or not from_port or not to_port:
            continue

        source_candidate = stage_candidates.get(src_id)
        if not source_candidate:
            continue

        output_ports = source_candidate.get("output_ports")
        if isinstance(output_ports, dict) and from_port in output_ports:
            upstream[to_port] = output_ports[from_port]

    return upstream


def _run_pipeline_mode(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    composite_spec: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """
    Execute composite in pipeline (DAG) mode.
    Nodes execute in topological order; upstream output_ports are routed
    to downstream primitives via the 'upstream' kwarg.
    """
    # Accept both "nodes" (preferred) and "stages" (backwards compat)
    nodes = list(composite_spec.get("nodes") or composite_spec.get("stages", []) or [])
    edges = list(composite_spec.get("edges", []) or [])
    reducer = dict(composite_spec.get("reducer", {}) or {})
    pattern_type = (spec.get("setup_config", {}) or {}).get("pattern_type", "composite")

    if not nodes:
        return []

    try:
        exec_order = _topological_sort(nodes, edges)
    except ValueError:
        return []

    node_map: Dict[str, Dict[str, Any]] = {}
    for n in nodes:
        nid = str(n.get("id", "")).strip()
        if nid:
            node_map[nid] = n

    stage_trace: Dict[str, Dict[str, Any]] = {}
    stage_candidates: Dict[str, Dict[str, Any]] = {}
    self_ids = {"composite_runner", pattern_type}

    for stage_id in exec_order:
        node_def = node_map.get(stage_id)
        if not node_def:
            continue
        stage_pattern_id = str(node_def.get("pattern_id", "")).strip()
        if not stage_pattern_id:
            continue
        if stage_pattern_id in self_ids:
            stage_trace[stage_id] = {
                "passed": False, "score": 0.0,
                "features": {"pattern_id": stage_pattern_id},
                "anchors": {}, "reason": "recursive_stage_blocked",
            }
            continue

        stage_setup_overrides = dict(node_def.get("params", {}) or node_def.get("setup_overrides", {}) or {})
        stage_spec = _build_stage_spec(spec, stage_pattern_id, stage_setup_overrides)
        stage_fn = _resolve_stage_plugin(stage_pattern_id)

        if not callable(stage_fn):
            stage_trace[stage_id] = {
                "passed": False, "score": 0.0,
                "features": {"pattern_id": stage_pattern_id},
                "anchors": {}, "reason": "stage_plugin_not_found",
            }
            continue

        try:
            upstream = _resolve_upstream(edges, stage_id, stage_candidates)
            if _DEBUG: print(f"[Composite] Executing stage '{stage_id}' ({stage_pattern_id}) with upstream: {list(upstream.keys())}")
            results = stage_fn(data, structure, stage_spec, symbol, timeframe, upstream=upstream) or []
            if _DEBUG: print(f"[Composite] Stage '{stage_id}' returned {len(results)} results")
            candidate = results[0] if results else None
            if candidate:
                stage_candidates[stage_id] = candidate
                if _DEBUG: print(f"[Composite] Stage '{stage_id}' candidate added to stage_candidates")
            else:
                if _DEBUG: print(f"[Composite] Stage '{stage_id}' returned no candidate")
            stage_trace[stage_id] = _node_from_candidate(stage_pattern_id, candidate)
        except TypeError as te:
            # Primitive doesn't accept upstream kwarg — call without it
            if _DEBUG: print(f"[Composite] Stage '{stage_id}' doesn't accept upstream kwarg, retrying without it: {te}")
            try:
                results = stage_fn(data, structure, stage_spec, symbol, timeframe) or []
                if _DEBUG: print(f"[Composite] Stage '{stage_id}' (no upstream) returned {len(results)} results")
                candidate = results[0] if results else None
                if candidate:
                    stage_candidates[stage_id] = candidate
                    if _DEBUG: print(f"[Composite] Stage '{stage_id}' candidate added to stage_candidates")
                else:
                    if _DEBUG: print(f"[Composite] Stage '{stage_id}' returned no candidate")
                stage_trace[stage_id] = _node_from_candidate(stage_pattern_id, candidate)
            except Exception as e:
                if _DEBUG: print(f"[Composite] Stage '{stage_id}' error (fallback): {type(e).__name__}: {e}")
                stage_trace[stage_id] = {
                    "passed": False, "score": 0.0,
                    "features": {"pattern_id": stage_pattern_id},
                    "anchors": {}, "reason": f"stage_execution_error:{type(e).__name__}",
                }
        except Exception as e:
            if _DEBUG: print(f"[Composite] Stage '{stage_id}' error: {type(e).__name__}: {e}")
            stage_trace[stage_id] = {
                "passed": False, "score": 0.0,
                "features": {"pattern_id": stage_pattern_id},
                "anchors": {}, "reason": f"stage_execution_error:{type(e).__name__}",
            }

    # Reducer & result assembly (same as filter mode)
    entry_go = _evaluate_reducer(reducer, stage_trace)
    score = 0.0
    if stage_trace:
        score = sum(float(n.get("score", 0.0)) for n in stage_trace.values()) / len(stage_trace)

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    svid = spec.get("strategy_version_id", f"{pattern_type}_v1")
    window_start = 0
    window_end = len(data) - 1
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_{window_start}_{window_end}"

    rules = []
    for sid, node in stage_trace.items():
        rules.append({
            "rule_name": f"stage:{sid}",
            "passed": bool(node.get("passed")),
            "value": str(node.get("reason", "")),
            "threshold": True,
        })

    location_anchors = {}
    if "location" in stage_trace:
        location_anchors = dict(stage_trace["location"].get("anchors", {}) or {})
    elif "location" in stage_candidates:
        location_anchors = dict(stage_candidates["location"].get("anchors", {}) or {})

    # Pass through visualization data from stages
    rdp_pivot_data = None
    swing_structure_data = None
    fib_levels_array = None
    
    if _DEBUG: print(f"[Composite] Processing {len(stage_candidates)} stages: {list(stage_candidates.keys())}")
    for stage_id, candidate_obj in stage_candidates.items():
        if _DEBUG: print(f"[Composite] Stage '{stage_id}' keys: {list(candidate_obj.keys())}")
        
        # Extract RDP swing visualization
        if "rdp_pivots" in candidate_obj:
            rdp_pivot_data = candidate_obj["rdp_pivots"]
        if "swing_structure" in candidate_obj:
            swing_structure_data = candidate_obj["swing_structure"]
        
        # Extract Fib levels from output_ports and convert to frontend format
        output_ports = candidate_obj.get("output_ports", {})
        if _DEBUG: print(f"[Composite] Stage '{stage_id}' output_ports: {output_ports}")
        fib_data = output_ports.get("fib_levels") if isinstance(output_ports, dict) else None
        
        if fib_data and isinstance(fib_data, dict):
            if _DEBUG: print(f"[Composite] Found fib_data in stage {stage_id}: {fib_data}")
            range_high = fib_data.get("range_high")
            range_low = fib_data.get("range_low")
            
            if range_high and range_low:
                total_range = range_high - range_low
                fib_pcts = [0.0, 0.50, 0.618, 0.70, 0.786, 1.0]
                fib_levels_array = []
                current_price = data[-1].close if data else 0
                
                for pct in fib_pcts:
                    price = range_high - (total_range * pct)
                    level_str = f"{int(pct * 100)}%"
                    # Check if current price is near this level (within 2%)
                    is_near = abs(current_price - price) / current_price < 0.02 if current_price > 0 else False
                    
                    fib_levels_array.append({
                        "price": round(price, 2),
                        "level": level_str,
                        "is_near": is_near,
                    })
                if _DEBUG: print(f"[Composite] Built fib_levels_array with {len(fib_levels_array)} levels")
    
    candidate = {
        "candidate_id": cid,
        "id": cid,
        "strategy_version_id": svid,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": round(score, 2),
        "entry_ready": entry_go,
        "entry_go": entry_go,
        "rule_checklist": rules,
        "anchors": location_anchors,
        "window_start": window_start,
        "window_end": window_end,
        "pattern_type": pattern_type,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": _merge_chart_data(data, stage_candidates),
        "composite_trace": {
            **stage_trace,
            "reducer": reducer or {"op": "AND", "inputs": list(stage_trace.keys())},
            "composite_spec": composite_spec,
            "mode": "pipeline",
            "execution_order": exec_order,
            "verdict": "entry_go" if entry_go else "no_go",
        },
    }
    
    # Pass through RDP swing pivots for frontend rendering
    if rdp_pivot_data:
        candidate["rdp_pivots"] = rdp_pivot_data
    if swing_structure_data:
        candidate["swing_structure"] = swing_structure_data
    
    # Pass through Fib levels for frontend rendering
    if fib_levels_array:
        if _DEBUG: print(f"[Composite] Attaching fib_levels_array to candidate: {len(fib_levels_array)} levels")
        candidate["fib_levels"] = fib_levels_array
    else:
        if _DEBUG: print("[Composite] No fib_levels_array found to attach")
    
    return [candidate]


# ---------------------------------------------------------------------------
# Conditional composition helpers
# ---------------------------------------------------------------------------

def _run_one_stage(
    pattern_id: str,
    params: Optional[Dict[str, Any]],
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
) -> Optional[Dict[str, Any]]:
    """Run a single primitive and return its first candidate, or None."""
    fn = _resolve_stage_plugin(pattern_id)
    if not callable(fn):
        return None
    stage_spec = _build_stage_spec(spec, pattern_id, params or {})
    try:
        results = fn(data, structure, stage_spec, symbol, timeframe) or []
        return results[0] if results else None
    except Exception as e:
        if _DEBUG: print(f"[Conditional] Stage '{pattern_id}' error: {type(e).__name__}: {e}")
        return None


def _candidate_matches_verdict(candidate: Dict[str, Any], verdict_check: str) -> bool:
    """Check if a candidate's verdict matches the requested string."""
    if verdict_check == "ANY":
        return True
    node_result = candidate.get("node_result") or {}
    reason = str(node_result.get("reason", "")).upper()
    top_verdict = str(candidate.get("verdict", "")).upper()
    if verdict_check in reason or verdict_check in top_verdict:
        return True
    output_ports = candidate.get("output_ports") or {}
    signal = output_ports.get("signal") or {}
    if isinstance(signal, dict) and verdict_check in str(signal.get("reason", "")).upper():
        return True
    visual = candidate.get("visual") or {}
    for m in (visual.get("markers") or []):
        t = str(m.get("text", "")).upper()
        if verdict_check in ("SWING_HIGH",) and t == "H":
            return True
        if verdict_check in ("SWING_LOW",) and t == "L":
            return True
    return False


def _evaluate_condition_tree(
    tree: Dict[str, Any],
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
) -> bool:
    """
    Recursively evaluate a condition tree from the Blockly Logic blocks.

    Node types:
      check          — check_verdict block
      score          — score_threshold block
      time           — time_filter block
      cooldown       — cooldown_gate block
      compare        — compare_primitives block
      sequence       — sequence_check block
      regime         — regime_gate block
      op             — logic_operation / logic_negate blocks
    """
    if not isinstance(tree, dict):
        return False

    node_type = str(tree.get("type", "")).strip()

    # ------------------------------------------------------------------
    # check_verdict — run primitive, check verdict + confidence
    # ------------------------------------------------------------------
    if node_type == "check":
        primitive_id = str(tree.get("primitive_id", "")).strip()
        verdict_check = str(tree.get("verdict", "ANY")).strip().upper()
        confidence_min = float(tree.get("confidence_min", 70)) / 100.0
        params = tree.get("params") or {}
        candidate = _run_one_stage(primitive_id, params, data, structure, spec, symbol, timeframe)
        if not candidate:
            return False
        if float(candidate.get("score", 0.0)) < confidence_min:
            return False
        return _candidate_matches_verdict(candidate, verdict_check)

    # ------------------------------------------------------------------
    # score_threshold — run primitive, check raw score only
    # ------------------------------------------------------------------
    if node_type == "score":
        primitive_id = str(tree.get("primitive_id", "")).strip()
        threshold = float(tree.get("threshold", 0.7))
        params = tree.get("params") or {}
        candidate = _run_one_stage(primitive_id, params, data, structure, spec, symbol, timeframe)
        if not candidate:
            return False
        return float(candidate.get("score", 0.0)) >= threshold

    # ------------------------------------------------------------------
    # time_filter — check current bar timestamp against session/day
    # ------------------------------------------------------------------
    if node_type == "time":
        session = str(tree.get("session", "ANY")).strip().upper()
        if session == "ANY" or not data:
            return True
        import datetime as _dt
        last_bar = data[-1]
        ts = last_bar.timestamp
        try:
            if isinstance(ts, (int, float)):
                dt = _dt.datetime.utcfromtimestamp(float(ts))
            elif isinstance(ts, str):
                dt = _dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).replace(tzinfo=None)
            else:
                dt = ts
            # Approximate ET offset (UTC-4 during EDT, UTC-5 during EST)
            et_hour = (dt.hour - 4) % 24
            weekday = dt.weekday()  # 0=Mon, 4=Fri
            SESSION_MAP = {
                "OPEN":      lambda h, d: 9 <= h < 11,
                "MIDDAY":    lambda h, d: 11 <= h < 14,
                "POWER":     lambda h, d: 14 <= h < 16,
                "PREMARKET": lambda h, d: 4 <= h < 9,
                "AFTERHOURS":lambda h, d: 16 <= h < 20,
                "MON":       lambda h, d: d == 0,
                "TUE":       lambda h, d: d == 1,
                "WED":       lambda h, d: d == 2,
                "THU":       lambda h, d: d == 3,
                "FRI":       lambda h, d: d == 4,
                "EARLYWEEK": lambda h, d: d <= 2,
                "LATEWEEK":  lambda h, d: d >= 3,
            }
            check_fn = SESSION_MAP.get(session)
            return check_fn(et_hour, weekday) if check_fn else True
        except Exception:
            return True

    # ------------------------------------------------------------------
    # cooldown_gate — true if primitive has NOT fired within N bars
    # ------------------------------------------------------------------
    if node_type == "cooldown":
        primitive_id = str(tree.get("primitive_id", "")).strip()
        lookback_bars = max(1, int(tree.get("bars", 5)))
        params = tree.get("params") or {}
        # Run the primitive on the lookback window (exclude the last bar)
        window_start = max(0, len(data) - lookback_bars - 1)
        window_end = max(0, len(data) - 1)
        fired_recently = False
        for bar_idx in range(window_start, window_end):
            slice_data = data[:bar_idx + 1]
            candidate = _run_one_stage(primitive_id, params, slice_data, structure, spec, symbol, timeframe)
            if candidate and float(candidate.get("score", 0.0)) > 0.0:
                fired_recently = True
                break
        return not fired_recently

    # ------------------------------------------------------------------
    # compare_primitives — A score OP B score
    # ------------------------------------------------------------------
    if node_type == "compare":
        primitive_a = str(tree.get("primitive_a", "")).strip()
        primitive_b = str(tree.get("primitive_b", "")).strip()
        op = str(tree.get("op", "GT")).strip().upper()
        params_a = tree.get("params_a") or {}
        params_b = tree.get("params_b") or {}
        cand_a = _run_one_stage(primitive_a, params_a, data, structure, spec, symbol, timeframe)
        cand_b = _run_one_stage(primitive_b, params_b, data, structure, spec, symbol, timeframe)
        score_a = float(cand_a.get("score", 0.0)) if cand_a else 0.0
        score_b = float(cand_b.get("score", 0.0)) if cand_b else 0.0
        if op == "GT":  return score_a > score_b
        if op == "LT":  return score_a < score_b
        if op == "GTE": return score_a >= score_b
        if op == "LTE": return score_a <= score_b
        return False

    # ------------------------------------------------------------------
    # sequence_check — FIRST fired within N bars ago AND SECOND fires now
    # ------------------------------------------------------------------
    if node_type == "sequence":
        first_id = str(tree.get("first_id", "")).strip()
        second_id = str(tree.get("second_id", "")).strip()
        lookback = max(1, int(tree.get("lookback", 5)))
        params_first = tree.get("params_first") or {}
        params_second = tree.get("params_second") or {}

        # Check SECOND fires on the current bar
        cand_second = _run_one_stage(second_id, params_second, data, structure, spec, symbol, timeframe)
        if not cand_second or float(cand_second.get("score", 0.0)) <= 0.0:
            return False

        # Check FIRST fired within lookback bars (excluding the current bar)
        window_start = max(0, len(data) - lookback - 1)
        window_end = max(0, len(data) - 1)
        first_fired = False
        for bar_idx in range(window_start, window_end):
            slice_data = data[:bar_idx + 1]
            cand_first = _run_one_stage(first_id, params_first, slice_data, structure, spec, symbol, timeframe)
            if cand_first and float(cand_first.get("score", 0.0)) > 0.0:
                first_fired = True
                break
        return first_fired

    # ------------------------------------------------------------------
    # regime_gate — signal fires only if regime matches expected state
    # ------------------------------------------------------------------
    if node_type == "regime":
        regime_id = str(tree.get("regime_id", "")).strip()
        expected_state = str(tree.get("regime_state", "ANY")).strip().upper()
        signal_id = str(tree.get("signal_id", "")).strip()
        params_regime = tree.get("params_regime") or {}
        params_signal = tree.get("params_signal") or {}

        if expected_state != "ANY":
            regime_candidate = _run_one_stage(regime_id, params_regime, data, structure, spec, symbol, timeframe)
            if not regime_candidate:
                return False
            if not _candidate_matches_verdict(regime_candidate, expected_state):
                return False

        signal_candidate = _run_one_stage(signal_id, params_signal, data, structure, spec, symbol, timeframe)
        return bool(signal_candidate and float(signal_candidate.get("score", 0.0)) > 0.0)

    # ------------------------------------------------------------------
    # op — AND / OR / NOT (Blockly built-in logic blocks)
    # ------------------------------------------------------------------
    if node_type == "op":
        op = str(tree.get("op", "AND")).strip().upper()
        if op == "NOT":
            inner = tree.get("condition")
            return not _evaluate_condition_tree(inner, data, structure, spec, symbol, timeframe)
        left = tree.get("left")
        right = tree.get("right")
        left_result = _evaluate_condition_tree(left, data, structure, spec, symbol, timeframe)
        if op == "AND" and not left_result:
            return False  # short-circuit
        if op == "OR" and left_result:
            return True   # short-circuit
        right_result = _evaluate_condition_tree(right, data, structure, spec, symbol, timeframe)
        if op == "AND": return left_result and right_result
        if op == "OR":  return left_result or right_result

    return False


def _execute_conditional(
    composite_spec: Dict[str, Any],
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
) -> List[Dict[str, Any]]:
    """
    Execute a conditional composite.
    Evaluates each branch's condition tree; runs THEN on true, ELSE on false.
    """
    branches = list(composite_spec.get("branches", []) or [])
    if not branches:
        return []

    pattern_type = (spec.get("setup_config", {}) or {}).get("pattern_type", "conditional_composite")
    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    svid = spec.get("strategy_version_id", f"{pattern_type}_v1")

    all_candidates: List[Dict[str, Any]] = []

    for i, branch in enumerate(branches):
        condition_tree = branch.get("condition")
        then_stage = branch.get("then") or {}
        else_stage = branch.get("else")

        condition_passed = _evaluate_condition_tree(
            condition_tree, data, structure, spec, symbol, timeframe
        )
        if _DEBUG: print(f"[Conditional] Branch {i} condition evaluated: {condition_passed}")

        active_stage = then_stage if condition_passed else (else_stage if else_stage else None)
        if not active_stage:
            if _DEBUG: print(f"[Conditional] Branch {i}: condition {'passed' if condition_passed else 'failed'}, no {'THEN' if not condition_passed else 'ELSE'} stage")
            continue

        stage_pattern_id = str(active_stage.get("pattern_id", "")).strip()
        stage_params = active_stage.get("params") or {}
        candidate = _run_one_stage(stage_pattern_id, stage_params, data, structure, spec, symbol, timeframe)

        branch_label = "THEN" if condition_passed else "ELSE"
        if _DEBUG: print(f"[Conditional] Branch {i} {branch_label} ({stage_pattern_id}): {'found candidate' if candidate else 'no candidate'}")

        window_end = len(data) - 1
        cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_branch{i}_{branch_label.lower()}"

        result_candidate: Dict[str, Any] = {
            "candidate_id": cid,
            "id": cid,
            "strategy_version_id": svid,
            "spec_hash": spec_hash,
            "symbol": symbol,
            "timeframe": timeframe,
            "score": float(candidate.get("score", 0.0)) if candidate else 0.0,
            "entry_ready": bool(candidate) and bool(candidate.get("entry_ready", False) or candidate.get("node_result", {}).get("passed", False)),
            "entry_go": bool(candidate),
            "rule_checklist": [
                {"rule_name": "condition_check", "passed": condition_passed, "value": branch_label, "threshold": True},
                {"rule_name": f"stage:{stage_pattern_id}", "passed": bool(candidate), "value": stage_pattern_id, "threshold": True},
            ],
            "anchors": (candidate or {}).get("anchors", {}),
            "window_start": 0,
            "window_end": window_end,
            "pattern_type": pattern_type,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "chart_data": (candidate or {}).get("chart_data", build_chart_data(data)),
            "visual": (candidate or {}).get("visual", {"markers": [], "overlay_series": []}),
            "node_result": (candidate or {}).get("node_result", {
                "passed": bool(candidate),
                "score": float(candidate.get("score", 0.0)) if candidate else 0.0,
                "features": {},
                "anchors": {},
                "reason": f"conditional:{branch_label}:{stage_pattern_id}",
            }),
            "output_ports": (candidate or {}).get("output_ports", {
                "signal": {"passed": bool(candidate), "score": float(candidate.get("score", 0.0)) if candidate else 0.0, "reason": f"{branch_label}:{stage_pattern_id}"}
            }),
            "composite_trace": {
                "type": "conditional",
                "branch": i,
                "condition_passed": condition_passed,
                "active_stage": stage_pattern_id,
                "branch_label": branch_label,
            },
        }

        if candidate and "rdp_pivots" in candidate:
            result_candidate["rdp_pivots"] = candidate["rdp_pivots"]
        if candidate and "swing_structure" in candidate:
            result_candidate["swing_structure"] = candidate["swing_structure"]

        all_candidates.append(result_candidate)

    return all_candidates


def run_composite_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
) -> List[Dict[str, Any]]:
    """
    Generic composite indicator runner.

    Reads composite_spec from spec['setup_config']['composite_spec'],
    resolves each stage primitive from the registry, runs them,
    and applies the reducer to produce a single GO/NO_GO verdict.
    """
    setup = spec.get("setup_config", {}) or {}
    composite_spec = dict(setup.get("composite_spec") or {})
    if not composite_spec:
        return []

    # Conditional mode: IF condition THEN primitive ELSE primitive
    if str(composite_spec.get("type", "")).strip().lower() == "conditional":
        return _execute_conditional(composite_spec, data, structure, spec, symbol, timeframe)

    # Pipeline mode: DAG-based execution with upstream data passing
    mode = str(composite_spec.get("mode", "filter")).strip().lower()
    if mode == "pipeline":
        return _run_pipeline_mode(data, structure, spec, symbol, timeframe, composite_spec)

    # Filter mode (default): independent execution + boolean reducer
    if not composite_spec.get("stages"):
        return []

    stages = list(composite_spec.get("stages", []) or [])
    reducer = dict(composite_spec.get("reducer", {}) or {})
    pattern_type = setup.get("pattern_type", "composite")

    stage_trace: Dict[str, Dict[str, Any]] = {}
    stage_candidates: Dict[str, Dict[str, Any]] = {}

    # Block recursive self-references
    self_ids = {"composite_runner", pattern_type}

    for stage in stages:
        stage_id = str(stage.get("id", "")).strip()
        stage_pattern_id = str(stage.get("pattern_id", "")).strip()
        if not stage_id or not stage_pattern_id:
            continue
        if stage_pattern_id in self_ids:
            stage_trace[stage_id] = {
                "passed": False,
                "score": 0.0,
                "features": {"pattern_id": stage_pattern_id},
                "anchors": {},
                "reason": "recursive_stage_blocked",
            }
            continue

        stage_setup_overrides = dict(stage.get("params", {}) or stage.get("setup_overrides", {}) or {})
        stage_spec = _build_stage_spec(spec, stage_pattern_id, stage_setup_overrides)
        stage_fn = _resolve_stage_plugin(stage_pattern_id)
        if not callable(stage_fn):
            stage_trace[stage_id] = {
                "passed": False,
                "score": 0.0,
                "features": {"pattern_id": stage_pattern_id},
                "anchors": {},
                "reason": "stage_plugin_not_found",
            }
            continue
        try:
            results = stage_fn(data, structure, stage_spec, symbol, timeframe) or []
            candidate = results[0] if results else None
            if candidate:
                stage_candidates[stage_id] = candidate
            stage_trace[stage_id] = _node_from_candidate(stage_pattern_id, candidate)
        except Exception as e:
            stage_trace[stage_id] = {
                "passed": False,
                "score": 0.0,
                "features": {"pattern_id": stage_pattern_id},
                "anchors": {},
                "reason": f"stage_execution_error:{type(e).__name__}",
            }

    entry_go = _evaluate_reducer(reducer, stage_trace)
    score = 0.0
    if stage_trace:
        score = sum(float(n.get("score", 0.0)) for n in stage_trace.values()) / len(stage_trace)

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    svid = spec.get("strategy_version_id", f"{pattern_type}_v1")
    window_start = 0
    window_end = len(data) - 1
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_{window_start}_{window_end}"

    rules = []
    for stage_id, node in stage_trace.items():
        rules.append(
            {
                "rule_name": f"stage:{stage_id}",
                "passed": bool(node.get("passed")),
                "value": str(node.get("reason", "")),
                "threshold": True,
            }
        )

    location_anchors = {}
    if "location" in stage_trace:
        location_anchors = dict(stage_trace["location"].get("anchors", {}) or {})
    elif "location" in stage_candidates:
        location_anchors = dict(stage_candidates["location"].get("anchors", {}) or {})

    # Pass through visualization data from stages
    rdp_pivot_data = None
    swing_structure_data = None
    fib_levels_array = None
    
    if _DEBUG: print(f"[Composite] Processing {len(stage_candidates)} stages: {list(stage_candidates.keys())}")
    for stage_id, candidate_obj in stage_candidates.items():
        if _DEBUG: print(f"[Composite] Stage '{stage_id}' keys: {list(candidate_obj.keys())}")
        
        # Extract RDP swing visualization
        if "rdp_pivots" in candidate_obj:
            rdp_pivot_data = candidate_obj["rdp_pivots"]
        if "swing_structure" in candidate_obj:
            swing_structure_data = candidate_obj["swing_structure"]
        
        # Extract Fib levels from output_ports and convert to frontend format
        output_ports = candidate_obj.get("output_ports", {})
        if _DEBUG: print(f"[Composite] Stage '{stage_id}' output_ports: {output_ports}")
        fib_data = output_ports.get("fib_levels") if isinstance(output_ports, dict) else None
        
        if fib_data and isinstance(fib_data, dict):
            if _DEBUG: print(f"[Composite] Found fib_data in stage {stage_id}: {fib_data}")
            range_high = fib_data.get("range_high")
            range_low = fib_data.get("range_low")
            
            if range_high and range_low:
                total_range = range_high - range_low
                fib_pcts = [0.0, 0.50, 0.618, 0.70, 0.786, 1.0]
                fib_levels_array = []
                current_price = data[-1].close if data else 0
                
                for pct in fib_pcts:
                    price = range_high - (total_range * pct)
                    level_str = f"{int(pct * 100)}%"
                    # Check if current price is near this level (within 2%)
                    is_near = abs(current_price - price) / current_price < 0.02 if current_price > 0 else False
                    
                    fib_levels_array.append({
                        "price": round(price, 2),
                        "level": level_str,
                        "is_near": is_near,
                    })
                if _DEBUG: print(f"[Composite] Built fib_levels_array with {len(fib_levels_array)} levels")
    
    candidate = {
        "candidate_id": cid,
        "id": cid,
        "strategy_version_id": svid,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": round(score, 2),
        "entry_ready": entry_go,
        "entry_go": entry_go,
        "rule_checklist": rules,
        "anchors": location_anchors,
        "window_start": window_start,
        "window_end": window_end,
        "pattern_type": pattern_type,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": _merge_chart_data(data, stage_candidates),
        "composite_trace": {
            **stage_trace,
            "reducer": reducer or {"op": "AND", "inputs": list(stage_trace.keys())},
            "composite_spec": composite_spec,
            "verdict": "entry_go" if entry_go else "no_go",
        },
    }
    
    # Pass through RDP swing pivots for frontend rendering
    if rdp_pivot_data:
        candidate["rdp_pivots"] = rdp_pivot_data
    if swing_structure_data:
        candidate["swing_structure"] = swing_structure_data

    # Pass through Fib levels for frontend rendering
    if fib_levels_array:
        if _DEBUG: print(f"[Composite] Attaching fib_levels_array to candidate: {len(fib_levels_array)} levels")
        candidate["fib_levels"] = fib_levels_array
    else:
        if _DEBUG: print("[Composite] No fib_levels_array found to attach")

    # Merge visual.markers from ALL stage candidates so OB markers, regime
    # markers, etc. all appear on the composite chart output.
    merged_markers = []
    merged_overlay_series = []
    for _sid, _cobj in stage_candidates.items():
        _visual = _cobj.get("visual") or {}
        merged_markers.extend(_visual.get("markers") or [])
        merged_overlay_series.extend(_visual.get("overlay_series") or [])
    if merged_markers or merged_overlay_series:
        candidate["visual"] = {
            "markers": merged_markers,
            "overlay_series": merged_overlay_series,
        }

    return [candidate]


# Backward-compatible alias so existing definitions referencing fib_energy still work
run_fib_energy_plugin = run_composite_plugin

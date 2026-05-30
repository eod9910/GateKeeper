#!/usr/bin/env python3
"""Precompile cached Eigen investigation reports after the daily residual scan."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Precompile Eigen investigation reports")
    parser.add_argument("--limit", type=int, default=12, help="Maximum pressure-hit reports to precompile")
    parser.add_argument(
        "--base-url",
        default=os.environ.get("PATTERN_DETECTOR_API_BASE", "http://localhost:3002"),
        help="Pattern Detector backend base URL",
    )
    parser.add_argument("--timeout", type=int, default=900, help="HTTP timeout in seconds")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    base_url = args.base_url.rstrip("/")
    url = f"{base_url}/api/market-intelligence/eigen-perturbations/precompile?limit={max(1, args.limit)}"
    request = urllib.request.Request(
        url,
        data=b"{}",
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"[eigen_report_precompiler] HTTP {exc.code}: {body}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"[eigen_report_precompiler] failed: {exc}", file=sys.stderr)
        return 1

    if not payload.get("success"):
        print(f"[eigen_report_precompiler] unsuccessful response: {payload}", file=sys.stderr)
        return 1

    data = payload.get("data") or {}
    print(
        "[eigen_report_precompiler] "
        f"scan_id={data.get('scan_id')} attempted={data.get('attempted')} "
        f"cached={data.get('cached')} failed={len(data.get('failed') or [])}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# Legacy Plugin Conversion Checklist

Percent complete: 0% (0 complete, 0 partial, 5 remaining)

Status: ACTIVE
Created: 2026-06-02
PRD: legacy-plugin-conversion-prd.md

## Goal

Track conversion of legacy `patternScanner.py` scan modes into StrategyRunner plugins.

## Checklist

- [ ] Re-audit remaining legacy `scanner_mode` plugins.
- [ ] Convert each remaining mode to a StrategyRunner plugin.
- [ ] Remove or disable the legacy spawn-per-call path after coverage is verified.
- [ ] Run scanner smoke tests for converted plugins.
- [ ] Update docs once the legacy path is no longer active.

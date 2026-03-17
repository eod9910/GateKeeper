"""Order Blocks + Regime Filter (Long Entry) composite — delegates to generic runner."""
from plugins.composite_runner import run_composite_plugin  # noqa: F401


def run_ob_regime_long_entry_composite_plugin(data, structure, spec, symbol, timeframe, **kwargs):
    """Delegates to the generic composite runner."""
    return run_composite_plugin(data, structure, spec, symbol, timeframe, **kwargs)

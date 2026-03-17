"""Composite wrapper for rdp_exhaustion_entry_composite — uses composite_runner.py"""

from plugins.composite_runner import run_composite_plugin  # noqa: F401


def run_rdp_exhaustion_entry_composite_plugin(config, structure, setup_params=None, data=None):
    """Delegates to the generic composite runner."""
    return run_composite_plugin(config, structure, setup_params=setup_params, data=data)
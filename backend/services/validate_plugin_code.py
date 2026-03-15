#!/usr/bin/env python3
"""
Deterministic Python plugin code validator.

Called by the Node.js backend via subprocess.
Reads Python source from stdin, validates via AST parsing.
Outputs JSON result to stdout.

Usage:
    echo "<python_code>" | python validate_plugin_code.py <pattern_id>
"""
import ast
import json
import sys


def validate(code: str, pattern_id: str) -> dict:
    errors = []

    # 1. Syntax check
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {
            "valid": False,
            "errors": [f"Python syntax error on line {e.lineno}: {e.msg}"],
        }

    # 2. Collect all top-level function names
    funcs = [
        node.name
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef)
    ]

    # 3. Check for required plugin function
    expected_fn = f"run_{pattern_id}_plugin"
    if expected_fn not in funcs:
        errors.append(
            f"Missing required function '{expected_fn}'. "
            f"Found functions: {funcs or '(none)'}"
        )

    # 4. Check for compute_spec_hash
    if "compute_spec_hash" not in funcs:
        errors.append(
            "Missing required function 'compute_spec_hash'. "
            "Every primitive must include compute_spec_hash()."
        )

    # 5. Check that the plugin function accepts **kwargs for pipeline support
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == expected_fn:
            has_kwargs = node.args.kwarg is not None
            if not has_kwargs:
                errors.append(
                    f"Function '{expected_fn}' must accept **kwargs for pipeline "
                    "upstream data support. Add '**kwargs: Any' as the last parameter."
                )
            break

    # 6. Check for dangerous imports (importing other plugin files)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                name = alias.name
                if name.startswith("plugins.") or name == "composite_runner":
                    errors.append(
                        f"Primitives must not import other plugins: 'import {name}'. "
                        "Each primitive must be self-contained."
                    )
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module.startswith("plugins.") or module == "composite_runner":
                errors.append(
                    f"Primitives must not import other plugins: 'from {module} import ...'. "
                    "Each primitive must be self-contained."
                )

    if errors:
        return {"valid": False, "errors": errors}

    return {"valid": True, "errors": []}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({
            "valid": False,
            "errors": ["Usage: python validate_plugin_code.py <pattern_id>"],
        }))
        sys.exit(1)

    pattern_id = sys.argv[1]
    code = sys.stdin.read()

    result = validate(code, pattern_id)
    print(json.dumps(result))


if __name__ == "__main__":
    main()

"""
Safe evaluator for gplearn-style symbolic-regression formulas.

Parses the serialized expression tree instead of using Python eval().
"""

from __future__ import annotations

import math
import re
from typing import List, Tuple, Union


NumberNode = Tuple[str, float]
VarNode = Tuple[str, int]
CallNode = Tuple[str, str, List["Node"]]
Node = Union[NumberNode, VarNode, CallNode]


_NUM_RE = re.compile(r"[+-]?(?:\d+\.\d*|\d*\.\d+|\d+)(?:[eE][+-]?\d+)?")


class FormulaParser:
    def __init__(self, text: str):
        self.text = text.strip()
        self.pos = 0

    def parse(self) -> Node:
        node = self._parse_expr()
        self._skip_ws()
        if self.pos != len(self.text):
            raise ValueError(f"Unexpected trailing text at position {self.pos}")
        return node

    def _skip_ws(self) -> None:
        while self.pos < len(self.text) and self.text[self.pos].isspace():
            self.pos += 1

    def _peek(self) -> str:
        return self.text[self.pos] if self.pos < len(self.text) else ""

    def _parse_expr(self) -> Node:
        self._skip_ws()
        if self.pos >= len(self.text):
            raise ValueError("Unexpected end of formula")

        token = self._peek()
        if token == "X":
            return self._parse_variable()
        if token.isalpha() or token == "_":
            return self._parse_call()
        return self._parse_number()

    def _parse_variable(self) -> VarNode:
        start = self.pos
        self.pos += 1
        while self.pos < len(self.text) and self.text[self.pos].isdigit():
            self.pos += 1
        if self.pos == start + 1:
            raise ValueError(f"Invalid variable token at position {start}")
        return ("var", int(self.text[start + 1:self.pos]))

    def _parse_identifier(self) -> str:
        start = self.pos
        while self.pos < len(self.text) and (self.text[self.pos].isalnum() or self.text[self.pos] == "_"):
            self.pos += 1
        if self.pos == start:
            raise ValueError(f"Expected identifier at position {start}")
        return self.text[start:self.pos]

    def _parse_call(self) -> CallNode:
        name = self._parse_identifier()
        self._skip_ws()
        if self._peek() != "(":
            raise ValueError(f"Expected '(' after function '{name}'")
        self.pos += 1
        args: List[Node] = []
        self._skip_ws()
        if self._peek() == ")":
            self.pos += 1
            return ("call", name, args)
        while True:
            args.append(self._parse_expr())
            self._skip_ws()
            token = self._peek()
            if token == ",":
                self.pos += 1
                continue
            if token == ")":
                self.pos += 1
                break
            raise ValueError(f"Expected ',' or ')' at position {self.pos}")
        return ("call", name, args)

    def _parse_number(self) -> NumberNode:
        match = _NUM_RE.match(self.text[self.pos:])
        if not match:
            raise ValueError(f"Expected number at position {self.pos}")
        token = match.group(0)
        self.pos += len(token)
        return ("num", float(token))


def _protected_div(a: float, b: float) -> float:
    return a / b if abs(b) > 1e-6 else 1.0


def _protected_sqrt(x: float) -> float:
    return math.sqrt(abs(x))


def _protected_log(x: float) -> float:
    return math.log(abs(x)) if abs(x) > 1e-6 else 0.0


def _finite(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return float(value)


def _eval_node(node: Node, row: List[float]) -> float:
    kind = node[0]
    if kind == "num":
        return _finite(node[1])
    if kind == "var":
        idx = node[1]
        if idx < 0 or idx >= len(row):
            raise IndexError(f"Feature index X{idx} is out of bounds for row length {len(row)}")
        return _finite(float(row[idx]))

    _, name, args = node
    values = [_eval_node(arg, row) for arg in args]

    if name == "add" and len(values) == 2:
        return _finite(values[0] + values[1])
    if name == "sub" and len(values) == 2:
        return _finite(values[0] - values[1])
    if name == "mul" and len(values) == 2:
        return _finite(values[0] * values[1])
    if name == "div" and len(values) == 2:
        return _finite(_protected_div(values[0], values[1]))
    if name == "sqrt" and len(values) == 1:
        return _finite(_protected_sqrt(values[0]))
    if name == "log" and len(values) == 1:
        return _finite(_protected_log(values[0]))
    if name == "abs" and len(values) == 1:
        return _finite(abs(values[0]))
    if name == "neg" and len(values) == 1:
        return _finite(-values[0])

    raise ValueError(f"Unsupported function '{name}' with {len(values)} args")


def evaluate_formula(formula: str, row: List[float]) -> float:
    parsed = FormulaParser(formula).parse()
    return _eval_node(parsed, row)

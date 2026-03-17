# Blockly-Based Indicator Studio – Design Report

## Executive Summary

This report documents the decision to adopt a **Blockly-style block-based visual programming system** as the primary user interface for building trading indicators within the platform. The objective is to **enforce architectural correctness**, prevent monolithic indicator design, and align user workflows with the system’s core philosophy: **Primitives → Indicators → Strategies**, with **Patterns as classifiers and permission gates**.

Blockly is selected not as an educational tool, but as a **structural enforcement mechanism**—a visual type system that makes illegal indicator designs impossible to construct.

---

## Problem Statement

Most trading platforms allow users to build indicators in ways that:
- conflate data, logic, and execution
- mix structure, location, timing, and pattern interpretation
- produce opaque, untestable monoliths

Users naturally attempt to express complex ideas as single indicators. Without enforcement, AI-assisted code generation reinforces this behavior, creating brittle systems that cannot be validated, reused, or understood.

The platform requires a system that:
- forces decomposition
- enforces semantic roles
- prevents invalid combinations
- aligns with how disciplined traders *think*, not how code is traditionally written

---

## Design Philosophy

The platform distinguishes between four concepts:

- **Primitive** – answers one atomic question
- **Indicator** – composed decision pipeline (Structure + Location + Entry)
- **Pattern** – classifier that labels market behavior
- **Strategy** – execution, risk, and capital management

Key rule:

> **Primitives measure. Patterns classify. Indicators decide. Strategies act.**

Blockly is used to make this rule structurally unavoidable.

---

## Why Blockly

Blockly provides:
- Typed input/output connections
- Visual composition with enforced constraints
- Code generation (used here to generate JSON specs, not executable code)
- Apache 2.0 license (commercially safe)

This allows the UI itself to function as a **semantic compiler**, ensuring users cannot build invalid indicator logic even if they try.

---

## Indicator Construction Model

### Primitives (Atomic Blocks)

Each primitive block answers exactly one question and outputs a typed result:

- **Structure Primitives** – anchors, pivots, swings
- **Location Primitives** – discount/premium zones, ranges
- **Timing Primitives** – event detection (cross, break, reclaim)

Primitives:
- cannot import other primitives
- cannot trigger trades
- cannot classify patterns

---

### Pattern Blocks (Classifiers)

Pattern blocks:
- consume structure outputs
- classify market state (e.g., Wyckoff accumulation)
- output labels and confidence
- do not produce entry/exit signals

Patterns act as **permission gates**, not execution logic.

---

### Indicator Blocks (Composites)

An Indicator is defined as a **composed decision pipeline** that answers:

> “Should I act now?”

An ENTRY indicator must include:

1. One Structure primitive
2. One Location primitive
3. One Timing primitive
4. Optional Pattern gate
5. A reducer (AND / OR / N-of-M)

The Indicator block assembles these inputs and outputs a single **GO / NO_GO verdict**.

---

## Enforcement via Blockly

Blockly enforces architecture through:

- Typed sockets (STRUCTURE_RESULT, LOCATION_RESULT, TRIGGER_RESULT, PATTERN_RESULT)
- Restricted connections (e.g., Timing blocks cannot plug into Structure sockets)
- Absence of free-form code blocks
- A single “Compose Indicator” block that defines what an Indicator is

This makes it impossible to:
- embed pattern logic inside indicators
- create monolithic detection code
- misuse raw values (e.g., RSI value vs RSI cross)

---

## AI Governance Integration

The in-app AI operates as an **architect and validator**, not a free-form coder.

Responsibilities:
- Decompose user ideas into primitives, patterns, and indicators
- Refuse to generate monolithic designs
- Guide users into valid block compositions
- Explain violations when designs are invalid

Blockly serves as the **physical enforcement layer**; the AI serves as the **conceptual enforcement layer**.

---

## Expected Outcomes

Adopting Blockly enables:

- Architectural discipline by default
- Reusable and testable indicator components
- Clear separation of meaning vs execution
- Faster onboarding for users who think structurally
- Alignment between human cognition and system design

Most importantly, it ensures that users cannot build systems that the platform itself does not understand.

---

## Conclusion

Blockly is not being adopted for ease of use—it is being adopted for **correctness**.

By turning indicator construction into a typed, constrained, visual language, the platform enforces its philosophy at the UI level. This prevents design drift, eliminates monoliths, and ensures that every indicator built is structurally valid, explainable, and compatible with automated validation and testing.

This decision is foundational and non-reversible.


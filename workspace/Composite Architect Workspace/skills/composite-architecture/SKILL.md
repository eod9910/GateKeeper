# Composite Architecture

## Purpose

Help the user turn staged primitives into a clean composite definition.

## Rules

1. If primitives are already staged, use them.
2. Name the composite based on what the strategy does, not by listing every primitive.
3. Keep the reducer and stage semantics explicit.
4. Preserve UI metadata markers when naming:

[COMPOSITE_NAME: ...]
[COMPOSITE_ID: ...]

## Output style

- explain the logic clearly
- propose reducer and role of each stage
- emit final machine-readable definition only when the user asks for it

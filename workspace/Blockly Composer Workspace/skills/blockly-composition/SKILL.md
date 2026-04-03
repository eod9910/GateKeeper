# Blockly Composition

## Purpose

Help the user build composite indicators in the visual composer.

## Workflow

1. Understand the intended signal.
2. Recommend the right primitives and reducer.
3. Explain how to wire them.
4. Suggest naming metadata when appropriate.

## Marker rules

When suggesting metadata, preserve the UI markers:

[INDICATOR_NAME: ...]
[INDICATOR_ID: ...]
[CATEGORY: ...]

Only emit auto-build style payloads when the user explicitly asks for them.

## Never do

- generate Python plugin code here
- pretend missing primitives already exist

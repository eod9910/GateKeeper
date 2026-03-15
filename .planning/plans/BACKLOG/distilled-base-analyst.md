# Distilled Base Analyst — Implementation Plan

## Vision

Build a **domain-specific AI** that understands market structure the way a human trader does — not a general-purpose LLM with a prompt, not an ML classifier that outputs YES/NO, but a specialized reasoning engine that can look at a chart and explain what it sees in terms of floors, caps, accumulation, distribution, and change of character.

The end state: a small (3-8B parameter) model that runs locally, costs nothing per inference, and produces structured analysis like:

> "I see floors at $1.11, $2.01, $2.45 clustering in a $1.11–$2.45 band. Caps at $6.33 and $6.72 forming a ceiling band. Price has oscillated in this range for 47 weeks with compressing amplitude. This is Stage 1 accumulation. CHoCH triggers above $6.72."

## Why Distillation (Not Fine-Tuning, Not Quantization, Not ML)

| Approach | What you get | Limitation |
|---|---|---|
| Fine-tuning GPT-4o | Smart, API-dependent | Expensive per call. Not yours. Can't run offline. |
| Quantization (e.g. Llama 70B → 4-bit) | Compressed general model | Still general purpose. Knows Shakespeare, not bases. |
| ML classifier | Fast YES/NO score | No reasoning. No comprehension. Black box. |
| **Distillation** | Small specialized model that reasons like the teacher | Runs locally. Fast. Domain-specific. Yours. |

Distillation trains a small student model on the *reasoning outputs* of a large teacher model. The student doesn't just learn labels — it learns *how to think about the problem*.

## Current Baseline (Already in Repo)

### Indicators (Feature Layer)
- `rdp_wiggle_base_primitive.py` — marks floors, caps, wiggle scores, escape events
- `regime_filter.py` — HH/HL/LH/LL Dow Theory classification, majority vote
- `energy.py` — energy state, buying/selling pressure
- `rdp.py` + `swing_structure.py` — RDP swing detection, structural analysis
- `numba_indicators.py` — compiled SMA/EMA/RSI/MACD/ATR/Bollinger

### Labels (Ground Truth)
- ~150 manually labeled charts (target: 300+)
- Labels stored via `GET/POST /api/labels` in `labels.ts`
- Corrections stored via `GET/POST /api/corrections` in `corrections.ts`
- Label types: `yes` / `no` / `skip` / `close` with optional base top/bottom corrections

### AI Infrastructure
- Vision service: `backend/src/services/visionService.ts`
- Pattern Analyst chat: already renders in scanner UI
- Ollama integration: already configured for local model inference (`minicpm-v`)
- Auto Labeler plan: `.planning/plans/auto labeler.md` (feeds into this)

## Key Insight: Accidental Intelligence

The RDP Wiggle Base primitive is already marking bases — it just doesn't know it.

**Observation 1 (ABSI):** Multiple floor/cap events from the wiggle base trace the boundaries of a single accumulation zone. Floors at $1.11, $2.01, $2.45 cluster into a floor band. Caps at $6.33, $6.72 cluster into a ceiling band. The indicator "accidentally" boxes in the base.

**Observation 2 (ACIC):** When price V-bottoms and breaks through the prior cap, that's a Change of Character (CHoCH). The wiggle base marks the floor ($0.26), the prior high ($6.99), and the escape. The CHoCH signal is implicit in the data — floor, cap, breakout — but never explicitly recognized.

The distilled model's job: take these accidental markings and recognize them as intentional structure.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    PERCEPTION                        │
│  Wiggle Base → floors, caps, wiggle scores           │
│  Regime Filter → HH/HL/LH/LL, expansion/distribution│
│  Energy State → velocity, acceleration, pressure     │
│  RDP Swings → structural highs and lows              │
└──────────────────────┬──────────────────────────────┘
                       │ structured features
                       ▼
┌─────────────────────────────────────────────────────┐
│               INTERPRETATION (new)                   │
│  Clustering: group nearby floors → floor band        │
│              group nearby caps → ceiling band         │
│  Classification: is this a base? accumulation?       │
│  Transition detection: CHoCH when cap breaks         │
│  Context: where is price relative to the box?        │
└──────────────────────┬──────────────────────────────┘
                       │ structured analysis
                       ▼
┌─────────────────────────────────────────────────────┐
│              REASONING (distilled model)              │
│  "I see three floors clustering at $1-2.50 and       │
│   two caps at $6.33-$6.72. This is a 47-week         │
│   accumulation zone. CHoCH triggers above $6.72."    │
│                                                       │
│  Runs locally. 3-8B params. Domain-specific.          │
│  Trained on teacher (GPT-4o) reasoning + your labels. │
└─────────────────────────────────────────────────────┘
```

## Phased Rollout

### Phase 0: Interpretation Layer (Rule-Based, No AI)
**Goal:** Encode the "accidental" base-boxing behavior as explicit logic.

Build a clustering + CHoCH detection pass on top of wiggle base output:

1. **Floor/Cap Clustering**
   - Group wiggle base events whose floor prices are within X% of each other → floor band
   - Group events whose cap prices are within X% of each other → ceiling band
   - X% default: 15-20% (tunable)
   - Output: `{ floor_band: [min, max], ceiling_band: [min, max], bar_count, event_count }`

2. **Base Classification**
   - If floor band and ceiling band exist, and price oscillated inside for N+ bars → base
   - Classify: `accumulation` (after prior downtrend), `re-accumulation` (after prior uptrend pause), `distribution` (at highs)
   - Use regime filter context for classification

3. **Change of Character (CHoCH)**
   - When close > max(ceiling_band) → CHoCH confirmed
   - Floor band becomes invalidation level
   - Ceiling band becomes re-test entry zone (old resistance → new support)

4. **Visual Output**
   - Render the unified box on chart (floor band → ceiling band, shaded)
   - CHoCH marker when breakout occurs
   - Re-test zone highlighting

**Implementation:** New primitive `base_structure_primitive.py` that consumes wiggle base output, or extension of the existing wiggle base primitive.

**Deliverables:**
- [ ] Floor/cap clustering logic
- [ ] Base classification rules
- [ ] CHoCH detection
- [ ] Chart rendering (box + markers)
- [ ] Register as chart indicator

### Phase 1: Teacher Data Generation
**Goal:** Use GPT-4o to produce rich reasoning for every labeled chart.

**Prerequisites:** 300+ labeled charts (currently ~150, need ~150 more).

1. **Build teacher prompt**
   - System prompt encoding your framework: floors, caps, accumulation, distribution, CHoCH, Wyckoff stages
   - Include the structured indicator output (wiggle base events, regime classification, energy state) as context
   - Include the chart image (screenshot or rendered from chart_data)
   - Include your label and corrections as ground truth

2. **Generate reasoning dataset**
   - For each labeled chart, call GPT-4o with:
     - Chart image
     - Wiggle base output (floors, caps, wiggle scores)
     - Regime filter output (HH/HL/LH/LL)
     - Your label (yes/no) and corrections (base_top, base_bottom)
   - Prompt: "Analyze this chart. Explain the base structure you see. Where are the floors? Where are the caps? Do they cluster? Is this a valid base? Why or why not? Is there a CHoCH? What stage is this?"
   - Save: `{ chart_data, indicator_features, label, corrections, teacher_reasoning }`

3. **Quality filter**
   - Review a sample of teacher outputs (50-100) for accuracy
   - Discard or re-generate any where the teacher contradicts your label
   - Enrich with your corrections where the teacher got close but not exact

**Deliverables:**
- [ ] Teacher prompt template
- [ ] Batch reasoning generation script (`backend/services/distillation/generate_teacher_data.py`)
- [ ] Teacher dataset stored as JSONL (`backend/data/distillation/teacher_reasoning.jsonl`)
- [ ] Quality review pass on sample
- [ ] Cost estimate: ~$50-100 for 300 charts at GPT-4o rates

### Phase 2: Student Model Training
**Goal:** Distill GPT-4o's reasoning into a small local model.

1. **Select student architecture**
   - Candidates: Phi-3 (3.8B), Qwen2.5 (7B), Llama 3.2 (8B)
   - Selection criteria: runs on local machine via Ollama, fast inference (<3s per chart), good at structured output
   - Recommendation: start with Qwen2.5-7B (strong reasoning for size, good structured output)

2. **Prepare training data**
   - Format: instruction tuning format (system + user + assistant)
   - System: your framework definitions (floors, caps, CHoCH, stages)
   - User: chart features (indicator output as structured text) + optional image
   - Assistant: teacher reasoning + label + corrections
   - Split: 80% train, 10% validation, 10% test

3. **Train**
   - Method: LoRA fine-tuning (parameter-efficient, doesn't need full model retraining)
   - Hardware: cloud GPU (~$20-50 for a few hours on A100/H100)
   - Tools: `unsloth` or `axolotl` for efficient LoRA training
   - Epochs: 3-5 with early stopping on validation loss

4. **Export and deploy**
   - Export to GGUF format (Ollama-compatible)
   - Create Ollama Modelfile with custom system prompt
   - Test locally: `ollama run base-analyst`

**Deliverables:**
- [ ] Student model selection and justification
- [ ] Training data formatter script
- [ ] Training script with LoRA config
- [ ] Exported GGUF model
- [ ] Ollama Modelfile
- [ ] Inference benchmark (speed, memory, quality)

### Phase 3: Integration — Replace Pattern Analyst
**Goal:** Wire the distilled model into the scanner as the Pattern Analyst.

1. **Model adapter**
   - New service: `backend/src/services/baseAnalystService.ts`
   - Input: chart_data + wiggle base output + regime output + energy state
   - Output: structured analysis (reasoning + label + corrections + CHoCH status)
   - Falls back to GPT-4o if local model unavailable

2. **Scanner integration**
   - Replace general-purpose Pattern Analyst chat with Base Analyst
   - Auto-analyze on candidate load (not just on user request)
   - Display structured analysis: floor band, ceiling band, base classification, CHoCH status, reasoning
   - Highlight disagreements with ML classifier (if both are running)

3. **Auto-labeler upgrade**
   - Base Analyst replaces the auto-labeler's model adapter
   - Confidence comes from the model's own reasoning, not just a score
   - Corrections come with explanations ("I moved the cap from $6.72 to $6.33 because...")

**Deliverables:**
- [ ] Base Analyst service with local model adapter
- [ ] Scanner UI integration
- [ ] Auto-labeler adapter swap
- [ ] Fallback to GPT-4o when local unavailable

### Phase 4: Continuous Improvement Loop
**Goal:** The model gets smarter over time.

1. **Disagreement tracking**
   - When you override the model's label or correction, log the disagreement
   - Format: `{ model_said, human_said, chart_features, reasoning }`

2. **Periodic re-distillation**
   - Every 100 new labels/corrections, re-generate teacher data for the new examples
   - Retrain student with expanded dataset
   - A/B test new model vs old on held-out set

3. **Edge case curriculum**
   - Identify chart types where the model is weakest
   - Generate extra teacher reasoning for those types
   - Weighted training on hard examples

4. **Reasoning audit**
   - Periodically read the model's reasoning to check for degradation
   - Ensure it's using your framework terms, not drifting into generic language

**Deliverables:**
- [ ] Disagreement logger
- [ ] Re-distillation pipeline script
- [ ] A/B evaluation framework
- [ ] Edge case identification report

## File Structure

```
backend/
  services/
    distillation/
      generate_teacher_data.py    # Phase 1: GPT-4o reasoning generation
      format_training_data.py     # Phase 2: convert to instruction tuning format
      train_student.py            # Phase 2: LoRA training script
      evaluate_student.py         # Phase 2: test set evaluation
      export_gguf.py              # Phase 2: export to Ollama format
  src/
    services/
      baseAnalystService.ts       # Phase 3: model adapter + inference
  data/
    distillation/
      teacher_reasoning.jsonl     # Phase 1 output
      training_data/              # Phase 2 formatted data
      models/                     # Phase 2 exported models
      disagreements.jsonl         # Phase 4 feedback loop
  models/
    base-analyst/
      Modelfile                   # Ollama model definition
```

## Dependencies

### Phase 0 (Rule-Based)
- No new dependencies. Pure Python, uses existing indicator output.

### Phase 1 (Teacher Data)
- OpenAI API (already configured)
- ~$50-100 budget for GPT-4o calls

### Phase 2 (Training)
- `unsloth` or `axolotl` (training framework)
- `transformers`, `peft`, `bitsandbytes` (HuggingFace ecosystem)
- Cloud GPU rental: ~$20-50 (RunPod, Lambda, or similar)
- `llama.cpp` or `ctransformers` for GGUF export

### Phase 3 (Integration)
- Ollama (already installed)
- No new Node.js dependencies

## Success Metrics

| Metric | Target | How to measure |
|---|---|---|
| Label agreement (model vs human) | >= 85% | Test set of 30 held-out charts |
| Correction accuracy (top/bottom) | Median error < 10% of range | Absolute distance vs human correction |
| Reasoning quality | Passes human review | Read 20 random analyses, check framework adherence |
| Inference speed | < 3 seconds per chart | Local benchmark on your machine |
| CHoCH detection accuracy | >= 80% recall | Manual review of known CHoCH events |
| Cost per 1,000 charts | $0 (local inference) | No API calls in production |

## Risk Controls

- **Phase 0 ships independently.** Even if distillation never happens, the clustering + CHoCH logic adds value.
- **Teacher quality gate.** Review teacher outputs before training. Bad teacher = bad student.
- **Human override always wins.** Model suggestions are never auto-saved without confidence gating.
- **Fallback to GPT-4o.** If local model quality degrades, switch back to API-based analysis.
- **Version control on models.** Each trained model gets a version tag. Can always roll back.

## Relationship to Other Plans

- **Auto Labeler** (`auto labeler.md`): Phase 3 of this plan upgrades the auto-labeler's model adapter. The auto-labeler produces labels → those labels feed the distillation dataset → the distilled model replaces the auto-labeler's AI. Circular reinforcement.
- **Adaptive Optimizer** (`adaptive-optimizer-plan.md`): The CHoCH signal from Phase 0 can be composed as a primitive in strategy composites, swept and optimized like any other.
- **Research Agent** (`evolutionary-strategy-lab.md`): The distilled model's analysis could feed the research agent's hypothesis generation — "this symbol has a confirmed CHoCH above a 47-week base" is much richer context than raw indicator output.
- **Execution Bridge**: A high-confidence CHoCH detection from the distilled model could be a signal source for autonomous trading.

## Recommended Execution Order

1. **Now:** Finish labeling (get to 300+ charts). This is the bottleneck for everything downstream.
2. **Phase 0:** Build the interpretation layer (clustering + CHoCH). Pure code, no AI, immediate value. Can be visually verified on charts like ACIC and ABSI.
3. **Phase 1:** Generate teacher data once labels are complete. ~1 day of API calls.
4. **Phase 2:** Train student. ~1-2 days including setup.
5. **Phase 3:** Integrate. ~1 day.
6. **Phase 4:** Ongoing. Continuous improvement as you label more charts.

Total time to first working distilled model: **~1 week after labels are complete.**

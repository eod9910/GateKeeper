"""Memory-summary helpers for the Codex transcript mirror."""

from __future__ import annotations

from typing import Any


QUESTION_PREFIXES = (
    "what",
    "why",
    "how",
    "when",
    "where",
    "which",
    "who",
    "can we",
    "could we",
    "do we",
    "does",
    "did",
    "is",
    "are",
    "will",
    "would",
    "should",
)

APPROVAL_PHRASES = {
    "yes",
    "yes please",
    "ok",
    "okay",
    "ok do that",
    "okay do that",
    "do that",
    "sounds good",
    "lets do that",
    "let's do that",
    "please do that",
    "nice",
    "update",
}

DIRECTIVE_PREFIXES = (
    "add ",
    "build ",
    "change ",
    "close ",
    "create ",
    "default ",
    "download ",
    "filter ",
    "fix ",
    "force ",
    "give ",
    "go ",
    "make ",
    "move ",
    "put ",
    "restart ",
    "run ",
    "set ",
    "show ",
    "stream ",
    "switch ",
    "take ",
    "update ",
    "use ",
)

TOPIC_DEFINITIONS = [
    {
        "id": "tri_agent_relay",
        "label": "Tri-agent relay and governance",
        "summary": "Validator, Builder, Editor roles, router records, contracts, and repo-local agent memory",
        "next_step": "Keep role handoffs in agent-relay and keep AGENTS.md pointing at the governing contracts.",
        "keywords": (
            "tri agent",
            "tri-agent",
            "validator",
            "builder",
            "editor",
            "agent relay",
            "router",
            "contract",
            "governance",
        ),
    },
    {
        "id": "codex_continuity",
        "label": "Codex transcript continuity",
        "summary": "offline mirroring of Codex session rollouts and compact startup memory",
        "next_step": "Keep the Codex transcript mirror running and use CODEX_CONTINUITY.md as the compact startup bridge.",
        "keywords": (
            "codex",
            "transcript",
            "conversation",
            "chat log",
            "memory",
            "mirror",
            "continuity",
            "session",
        ),
    },
    {
        "id": "backtest_contract",
        "label": "Backtest and research contract",
        "summary": "backtest engine routing, research study storage, and avoiding ad hoc backtest code",
        "next_step": "For future backtests, classify the request and store artifacts in the approved contract locations.",
        "keywords": (
            "backtest",
            "back test",
            "research study",
            "study framework",
            "engine",
            "sweep",
            "valuation",
        ),
    },
    {
        "id": "market_ai_trade",
        "label": "AI trade and market risk",
        "summary": "AI valuation, model progress risk, Nvidia/Marvell valuation, and market-cycle concerns",
        "next_step": "When market claims need numbers, verify live prices, earnings, and valuation ratios before analysis.",
        "keywords": (
            "ai revolution",
            "mythos",
            "fable",
            "anthropic",
            "nvidia",
            "marvell",
            "market",
            "valuation",
            "standard deviation",
        ),
    },
]

CUT_MARKERS = (
    "Based on the current analysis",
    "### Technical Analysis",
    "### Fundamental Analysis",
    "### Trade Considerations",
    "### Conclusion",
)


def normalize_text(value: str) -> str:
    return " ".join(str(value or "").replace("\r", "\n").split())


def shorten_text(value: str, max_chars: int | None = None) -> str:
    text = normalize_text(value)
    if max_chars is None or len(text) <= max_chars:
        return text
    return text[: max_chars - 3].rstrip() + "..."


def extract_memory_headline(value: str, max_chars: int = 180) -> str:
    raw_text = str(value or "")
    lines = [line.strip() for line in raw_text.replace("\r", "\n").split("\n") if line.strip()]
    text = lines[0] if lines else ""
    if len(text) < 24 and len(lines) > 1:
        text = " ".join(lines[:2])
    text = normalize_text(text)
    lower_text = text.lower()
    for marker in CUT_MARKERS:
        index = lower_text.find(marker.lower())
        if index > 0:
            text = text[:index].strip()
            break
    return shorten_text(text, max_chars=max_chars)


def is_question_prompt(text: str) -> bool:
    normalized = normalize_text(text).lower()
    if not normalized:
        return False
    if "?" in str(text):
        return True
    return any(normalized.startswith(prefix) for prefix in QUESTION_PREFIXES)


def is_approval_prompt(text: str) -> bool:
    normalized = normalize_text(text).lower()
    return normalized in APPROVAL_PHRASES


def is_directive_prompt(text: str) -> bool:
    normalized = normalize_text(text).lower()
    if not normalized or is_question_prompt(normalized) or is_approval_prompt(normalized):
        return False
    if "i want" in normalized or "we need to" in normalized or "let's " in normalized:
        return True
    return any(normalized.startswith(prefix) for prefix in DIRECTIVE_PREFIXES)


def score_topic(prompt: str, topic: dict[str, Any]) -> int:
    normalized = normalize_text(prompt).lower()
    return sum(1 for keyword in topic["keywords"] if keyword in normalized)


def classify_prompt_topic(prompt: str) -> dict[str, Any] | None:
    best_topic: dict[str, Any] | None = None
    best_score = 0
    for topic in TOPIC_DEFINITIONS:
        score = score_topic(prompt, topic)
        if score > best_score:
            best_score = score
            best_topic = topic
    return best_topic


def dedupe_strings(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        value = str(item or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def build_topic_matches(prompts: list[str]) -> list[tuple[dict[str, Any], list[str]]]:
    topic_matches: dict[str, list[str]] = {topic["id"]: [] for topic in TOPIC_DEFINITIONS}
    for prompt in prompts:
        topic = classify_prompt_topic(prompt)
        if not topic:
            continue
        topic_matches[topic["id"]].append(extract_memory_headline(prompt, max_chars=120))

    ordered: list[tuple[dict[str, Any], list[str]]] = []
    for topic in TOPIC_DEFINITIONS:
        matches = dedupe_strings(topic_matches[topic["id"]])
        if matches:
            ordered.append((topic, matches))
    ordered.sort(key=lambda item: len(item[1]), reverse=True)
    return ordered


def format_bullets(
    items: list[str],
    limit: int | None = None,
    max_chars: int | None = None,
) -> list[str]:
    values = items if limit is None else items[-limit:]
    if not values:
        return ["- None captured yet"]
    return [f"- {shorten_text(value, max_chars=max_chars)}" for value in values]


def build_active_thread_bullets(prompts: list[str]) -> list[str]:
    threads = build_topic_matches(prompts)
    if not threads:
        return ["- No dominant thread detected yet"]

    bullets: list[str] = []
    for topic, matches in threads[:3]:
        recent_examples = "; ".join(f"`{item}`" for item in matches[-2:])
        bullets.append(
            f"- {topic['label']}: {topic['summary']}. Recent prompts: {recent_examples}"
        )
    return bullets


def build_recent_directive_bullets(prompts: list[str]) -> list[str]:
    directives = [
        extract_memory_headline(prompt, max_chars=150)
        for prompt in prompts
        if is_directive_prompt(prompt)
    ]
    values = dedupe_strings(directives)
    if not values:
        return ["- No strong user directives captured yet"]
    return [f"- {item}" for item in values[-6:]]


def build_open_question_bullets(prompts: list[str]) -> list[str]:
    open_questions: list[str] = []
    recent_prompts = prompts[-10:]
    for index, prompt in enumerate(recent_prompts):
        if not is_question_prompt(prompt):
            continue
        trailing_prompts = recent_prompts[index + 1 :]
        if any(is_approval_prompt(item) or is_directive_prompt(item) for item in trailing_prompts):
            continue
        open_questions.append(extract_memory_headline(prompt, max_chars=150))

    values = dedupe_strings(open_questions)
    if not values:
        return ["- No unresolved question detected in the latest prompt window"]
    return [f"- {item}" for item in values[-3:]]


def build_likely_next_step_bullets(prompts: list[str]) -> list[str]:
    threads = build_topic_matches(prompts)
    next_steps = dedupe_strings([topic["next_step"] for topic, _matches in threads[:3]])
    next_steps.append(
        "Use the long-term transcript files only for targeted recall; do not preload them into startup context."
    )
    return [f"- {item}" for item in next_steps[:4]]


def extract_last_substantive_prompt(prompts: list[str]) -> str:
    for prompt in reversed(prompts):
        if is_approval_prompt(prompt):
            continue
        headline = extract_memory_headline(prompt, max_chars=160)
        if headline:
            return headline
    return "No recent substantive prompt captured"


def extract_last_prompt(prompts: list[str]) -> str:
    if not prompts:
        return "No recent prompt captured"
    return extract_memory_headline(prompts[-1], max_chars=120)

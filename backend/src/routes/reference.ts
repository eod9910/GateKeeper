import { Router, Request, Response } from 'express';
import path from 'path';
import { readSection } from '../services/searchService';

const router = Router();
const REF_PATH = path.join(__dirname, '..', '..', 'data', 'app-reference.md');

type HelpConfig = {
  title: string;
  intro: string;
  sections: string[];
};

const PAGE_HELP: Record<string, HelpConfig> = {
  'index.html': {
    title: 'Scanner Help',
    intro: 'Use Scanner to find candidates, inspect the chart, and send strong setups into the rest of the app. Start with the scan mode, inspect the chart context, then hand off qualified ideas into Trading Desk or Validator.',
    sections: ['Discount Zone Scanner', 'Chart Features', 'AI Chat', 'Buttons and Controls Reference'],
  },
  'validator.html': {
    title: 'Validator Help',
    intro: 'Validator is the statistical gate. Use it to decide whether a strategy should be discarded, needs more evidence, or is robust enough to move forward.',
    sections: ['Validator Reports Page', 'Backtesting & Validation \u2014 What It Is and How It Works', 'Strategy Details Page'],
  },
  'strategy.html': {
    title: 'Strategy Details Help',
    intro: 'Strategy Details is where you edit the saved strategy spec, inspect its status, and launch validation from the actual version you intend to test.',
    sections: ['Strategy Details Page', 'Backtesting & Validation \u2014 What It Is and How It Works'],
  },
  'sweep.html': {
    title: 'Parameter Sweep Help',
    intro: 'Parameter Sweep runs validator-backed variants of one strategy parameter at a time. Use it after a strategy has reached Tier 2 or T2R, compare each variant against the original validator report, and only promote a variant if it materially improves the gate criteria.',
    sections: ['Backtesting & Validation \u2014 What It Is and How It Works', 'Validator Reports Page'],
  },
  'execution.html': {
    title: 'Execution Desk Help',
    intro: 'Execution Desk is for broker-connected, post-validation execution. It should only run approved strategies with the required validator pass state.',
    sections: ['P&L Calculator', 'Position Sizing', 'Risk Rules', 'Verdict Engine'],
  },
  'history.html': {
    title: 'Position Book Help',
    intro: 'Position Book is the audit trail for trades and positions. Use it to inspect outcomes, closeouts, and historical performance rather than to define strategy logic.',
    sections: ['Trade History', 'P&L Calculator'],
  },
  'workshop.html': {
    title: 'Indicator Studio Help',
    intro: 'Indicator Studio is where you build and register primitives, composites, and scanner patterns. Use the Builder for pattern definitions, Blockly Composer for socket-based composition, and the assistant for wiring guidance.',
    sections: ['Indicator Studio', 'Blockly Composer'],
  },
  'blockly-composer.html': {
    title: 'Blockly Composer Help',
    intro: 'Blockly Composer is the socket-based entry builder. Compose Structure, Location, Timing Trigger, and optional Regime Filter primitives into a valid composite signal.',
    sections: ['Blockly Composer'],
  },
  'pipeline-composer.html': {
    title: 'Pipeline Composer Help',
    intro: 'Pipeline Composer is for chaining indicator and analysis stages into a larger workflow. Use it when a single primitive or composite is not enough.',
    sections: ['Indicator Studio', 'Blockly Composer'],
  },
  'research.html': {
    title: 'Research Agent Help',
    intro: 'Research Agent is for idea generation, motif inspection, and hypothesis building. Use it to find promising edges before you formalize them into strategy versions.',
    sections: ['Backtesting & Validation \u2014 What It Is and How It Works', 'Indicator Studio'],
  },
  'training.html': {
    title: 'Training Help',
    intro: 'Training is for forward-test and execution-training workflows. Use it to observe behavior under live-like conditions before trusting a strategy in execution.',
    sections: ['Trade History', 'Verdict Engine'],
  },
  'auto-labeler.html': {
    title: 'Auto Labeler Help',
    intro: 'Auto Labeler is for labeling patterns and building training data. Use it to improve the quality of future classifiers and research datasets.',
    sections: ['Scanner Pages', 'AI Chat'],
  },
  'vision-lab.html': {
    title: 'Vision Lab Help',
    intro: 'Vision Lab is for visual analysis and AI-assisted image reasoning. Use it when the chart itself is part of the decision process.',
    sections: ['Chart Features', 'AI Chat'],
  },
  'family-explorer.html': {
    title: 'Family Explorer Help',
    intro: 'Family Explorer is for inspecting structural motif families, stability, and behavior summaries produced by the research pipeline.',
    sections: ['Backtesting & Validation \u2014 What It Is and How It Works'],
  },
  'settings.html': {
    title: 'Settings Help',
    intro: 'Settings controls risk defaults, AI defaults, and app-wide behavior. Changes here affect downstream workflows in Trading Desk, Validator, and Execution Desk.',
    sections: ['Buttons and Controls Reference', 'Risk Rules'],
  },
};

function normalizePage(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'index.html';
  const normalized = trimmed.replace(/\\/g, '/').toLowerCase();
  const leaf = normalized.split('/').filter(Boolean).pop() || 'index.html';
  if (leaf === 'validator') return 'validator.html';
  if (leaf === 'strategy') return 'strategy.html';
  if (leaf === 'workshop') return 'workshop.html';
  if (leaf === 'research') return 'research.html';
  if (leaf === 'sweep') return 'sweep.html';
  if (leaf === 'execution') return 'execution.html';
  if (leaf === 'training') return 'training.html';
  if (leaf === 'auto-labeler') return 'auto-labeler.html';
  if (leaf === 'vision-lab') return 'vision-lab.html';
  if (leaf === 'family-explorer') return 'family-explorer.html';
  return leaf.includes('.') ? leaf : `${leaf}.html`;
}

router.get('/page-help', (req: Request, res: Response) => {
  try {
    const page = normalizePage(String(req.query.page || 'index.html'));
    const config = PAGE_HELP[page] || {
      title: 'Page Help',
      intro: 'Use this page-specific help as the canonical quick reference for the current screen. If this page does not yet have a dedicated guide, the app falls back to the main reference sections below.',
      sections: ['Buttons and Controls Reference', 'AI Chat'],
    };

    const sections = config.sections.map((sectionName) => ({
      section: sectionName,
      markdown: readSection(REF_PATH, sectionName) || `### ${sectionName}\nNo reference section found yet.`,
    }));

    res.json({
      success: true,
      data: {
        page,
        title: config.title,
        intro: config.intro,
        source: 'backend/data/app-reference.md',
        sections,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to load page help' });
  }
});

export default router;

import assert from 'assert';
import {
  buildLedgerNarrativeCaseLines,
  ledgerDisplayMoney,
  ledgerDisplayNumber,
  ledgerDisplayPct,
  ledgerEvidenceText,
  ledgerFirstFiniteNumber,
  ledgerMetricValue,
  ledgerScaleNumber,
  ledgerTechnologyClues,
} from './ledgerFormatting';

function testDisplayNumber() {
  assert.strictEqual(ledgerDisplayNumber(12.345), '12.3');
  assert.strictEqual(ledgerDisplayNumber(12.345, 2), '12.35');
  assert.strictEqual(ledgerDisplayNumber('not-a-number'), 'N/A');
}

function testDisplayMoney() {
  assert.strictEqual(ledgerDisplayMoney(12.3), '$12.30');
  assert.strictEqual(ledgerDisplayMoney(1234), '$1.2K');
  assert.strictEqual(ledgerDisplayMoney(1234567), '$1.2M');
  assert.strictEqual(ledgerDisplayMoney(1234567890), '$1.23B');
  assert.strictEqual(ledgerDisplayMoney(-1234567), '$-1.2M');
  assert.strictEqual(ledgerDisplayMoney(undefined), 'N/A');
}

function testDisplayPct() {
  assert.strictEqual(ledgerDisplayPct(12.34), '12.3%');
  assert.strictEqual(ledgerDisplayPct('bad'), 'N/A');
}

function testScaleNumber() {
  assert.strictEqual(ledgerScaleNumber(3, 'thousands'), 3000);
  assert.strictEqual(ledgerScaleNumber(3, 'millions'), 3000000);
  assert.strictEqual(ledgerScaleNumber(3, 'billions'), 3000000000);
  assert.strictEqual(ledgerScaleNumber(3, 'raw'), 3);
  assert.strictEqual(ledgerScaleNumber('bad', 'millions'), null);
}

function testMetricValue() {
  assert.strictEqual(ledgerMetricValue({ value: 2, scale: 'millions' }), 2000000);
  assert.strictEqual(ledgerMetricValue(5), 5);
  assert.strictEqual(ledgerMetricValue({ nope: 1 }), null);
}

function testFirstFiniteNumber() {
  assert.strictEqual(ledgerFirstFiniteNumber(undefined, 'bad', 0, 5), 0);
  assert.strictEqual(ledgerFirstFiniteNumber(undefined, 'bad', 5), 5);
  assert.strictEqual(ledgerFirstFiniteNumber(undefined, 'bad'), null);
}

function testEvidenceText() {
  const text = ledgerEvidenceText({
    key_evidence_refs: [
      {
        section_heading: 'Business',
        text_excerpt: ' Proprietary platform evidence. ',
        summary: '',
      },
      {
        section_heading: null,
        text_excerpt: 'Manufacturing process detail.',
        summary: 'Automation summary.',
      },
    ],
  });

  assert.strictEqual(text, 'Business Proprietary platform evidence. Manufacturing process detail. Automation summary.');
  assert.strictEqual(ledgerEvidenceText({}), '');
}

function testTechnologyClues() {
  const clues = ledgerTechnologyClues({
    key_evidence_refs: [
      {
        section_heading: 'Technology',
        text_excerpt: 'The company uses proprietary AI software and patented chemistry.',
        summary: 'Its proprietary platform automates a process.',
      },
    ],
  });

  assert.deepStrictEqual(clues, ['technology', 'proprietary', 'ai', 'software', 'patented', 'chemistry', 'platform', 'process']);
  assert.deepStrictEqual(ledgerTechnologyClues({}), []);
}

function testNarrativeCaseLines() {
  const lines = buildLedgerNarrativeCaseLines({
    applied: true,
    rationale: 'Social attention could lift near-term demand.',
    base_revenue_growth_pct: 10,
    adjusted_revenue_growth_pct: 25,
    base_fair_value_per_share: 15,
    fair_value_per_share: 22,
    narrative_vs_base_pct: 46.7,
    price_vs_narrative_pct: -12,
  });

  assert.strictEqual(lines[1], 'Narrative-adjusted case (social-thesis overlay):');
  assert.ok(lines[2].includes('Social attention'));
  assert.ok(lines[3].includes('10.0%'));
  assert.ok(lines[4].includes('$15.00'));
  assert.ok(lines[5].includes('downside of 12%'));
  assert.deepStrictEqual(buildLedgerNarrativeCaseLines({ applied: false }), []);
  assert.deepStrictEqual(buildLedgerNarrativeCaseLines(null), []);
}

function main() {
  testDisplayNumber();
  testDisplayMoney();
  testDisplayPct();
  testScaleNumber();
  testMetricValue();
  testFirstFiniteNumber();
  testEvidenceText();
  testTechnologyClues();
  testNarrativeCaseLines();
  console.log('ledgerFormatting tests passed');
}

main();

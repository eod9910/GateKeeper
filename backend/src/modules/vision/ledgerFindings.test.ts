import assert from 'assert';
import {
  buildLedgerCategorySection,
  classifyLedgerFinding,
  formatLedgerEvidenceLine,
  inferLedgerFindingSignificance,
  inferLedgerSoftPedaledMeaning,
  isLedgerGenericRiskBoilerplate,
} from './ledgerFindings';

function testClassifyLedgerFinding() {
  assert.strictEqual(classifyLedgerFinding({ text_excerpt: 'Debt covenant liquidity pressure' }), 'balance_sheet');
  assert.strictEqual(classifyLedgerFinding({ text_excerpt: 'Legal investigation and compliance issue' }), 'legal_regulatory');
  assert.strictEqual(classifyLedgerFinding({ text_excerpt: 'Major customer concentration' }), 'concentration');
  assert.strictEqual(classifyLedgerFinding({ text_excerpt: 'Stock-based compensation and dilution' }), 'accounting');
  assert.strictEqual(classifyLedgerFinding({ text_excerpt: 'Management believes demand may soften' }), 'management_language');
}

function testFormatLedgerEvidenceLine() {
  assert.strictEqual(
    formatLedgerEvidenceLine({
      section_heading: 'Risk Factors',
      form: '10-K',
      filing_date: '2026-01-01',
      text_excerpt: '  This   is   compacted.  ',
    }),
    'Risk Factors | 10-K | 2026-01-01: This is compacted.'
  );
}

function testBoilerplateDetection() {
  assert.strictEqual(isLedgerGenericRiskBoilerplate({
    text_excerpt: 'You should carefully consider the following risk factors.',
  }), true);
  assert.strictEqual(isLedgerGenericRiskBoilerplate({
    text_excerpt: 'A specific supplier concentration issue exists.',
  }), false);
}

function testInferences() {
  assert.ok(inferLedgerSoftPedaledMeaning({ text_excerpt: 'pricing pressure is increasing' }).includes('pricing pressure'));
  assert.ok(inferLedgerFindingSignificance('balance_sheet', {
    text_excerpt: 'Cash and cash equivalents decreased by $12.5 million.',
  })?.includes('$12.5M'));
  assert.ok(inferLedgerFindingSignificance('concentration', {
    text_excerpt: 'Major customer dependency.',
  })?.includes('Concentration matters'));
}

function testBuildCategorySection() {
  assert.deepStrictEqual(buildLedgerCategorySection('Legal', 'legal_regulatory', [], 'none found'), [
    'Legal:',
    '- none found',
  ]);

  const lines = buildLedgerCategorySection('Accounting', 'accounting', [
    {
      section_heading: 'Notes',
      form: '10-Q',
      filing_date: '2026-02-01',
      text_excerpt: 'Stock-based compensation increased.',
    },
  ]);

  assert.strictEqual(lines[0], 'Accounting:');
  assert.ok(lines[1].includes('Notes | 10-Q | 2026-02-01'));
  assert.ok(lines[2].includes('Stock-based compensation matters'));
}

function main() {
  testClassifyLedgerFinding();
  testFormatLedgerEvidenceLine();
  testBoilerplateDetection();
  testInferences();
  testBuildCategorySection();
  console.log('ledgerFindings tests passed');
}

main();

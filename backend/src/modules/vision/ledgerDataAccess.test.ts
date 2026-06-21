import assert from 'assert';
import { getLedgerCorporateAction, getLedgerHardFlags } from './ledgerDataAccess';

function testCorporateAction() {
  const action = { summary: 'pending acquisition' };

  assert.strictEqual(getLedgerCorporateAction({
    special_situations: { corporate_action: action },
  }), action);
  assert.strictEqual(getLedgerCorporateAction({}), null);
  assert.strictEqual(getLedgerCorporateAction(null), null);
}

function testHardFlags() {
  const hardFlags = [{ code: 'pending_acquisition' }];

  assert.deepStrictEqual(getLedgerHardFlags({
    special_situations: { hard_flags: hardFlags },
  }), hardFlags);
  assert.deepStrictEqual(getLedgerHardFlags({
    special_situations: { hard_flags: 'not-array' },
  }), []);
  assert.deepStrictEqual(getLedgerHardFlags({}), []);
}

function main() {
  testCorporateAction();
  testHardFlags();
  console.log('ledgerDataAccess tests passed');
}

main();

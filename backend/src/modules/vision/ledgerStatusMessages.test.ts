import assert from 'assert';
import { isLedgerNoDataStatus } from './ledgerStatusMessages';

function main() {
  assert.strictEqual(isLedgerNoDataStatus({ status: 'no_company_data' }), true);
  assert.strictEqual(isLedgerNoDataStatus({ status: 'not_in_database' }), true);
  assert.strictEqual(isLedgerNoDataStatus({ status: 'ok' }), false);
  assert.strictEqual(isLedgerNoDataStatus(null), false);
  console.log('ledgerStatusMessages tests passed');
}

main();

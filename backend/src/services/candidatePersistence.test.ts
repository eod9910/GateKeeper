import assert from 'assert';
import { attachPersistedCandidateIds } from './candidatePersistence';

function testAttachPersistedCandidateIds(): void {
  const rows = attachPersistedCandidateIds([
    { candidate_id: 'orig_1', symbol: 'AAPL' } as any,
    { candidate_id: 'orig_2', id: 'orig_2', symbol: 'MSFT' } as any,
  ], ['saved_1']);

  assert.equal(rows[0].candidate_id, 'saved_1');
  assert.equal((rows[0] as any).id, 'saved_1');
  assert.equal(rows[1].candidate_id, 'orig_2');
  assert.equal((rows[1] as any).id, 'orig_2');
}

function runTests(): void {
  testAttachPersistedCandidateIds();
}

runTests();
console.log('candidatePersistence tests passed');

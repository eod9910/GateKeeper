/**
 * One-time cleanup: retroactively apply the expectancy gate to existing
 * research-agent strategies. Strategies that fail the gate are tombstoned
 * and their JSON files deleted.
 *
 * Usage: node backend/scripts/cleanup-research-strategies.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STRATEGIES_DIR = path.join(DATA_DIR, 'strategies');
const REPORTS_DIR = path.join(DATA_DIR, 'validation-reports');
const TOMBSTONE_PATH = path.join(DATA_DIR, 'research-tombstones.json');

const GATE_MIN_TRADES = 100;
const GATE_MIN_EXPECTANCY = 0;
const GATE_MIN_PROFIT_FACTOR = 1.0;

const dryRun = process.argv.includes('--dry-run');

function passesGate(report) {
  if (!report) return { pass: false, reason: 'no validation report found' };
  const trades = report.trades_summary?.total_trades ?? 0;
  const expectancy = report.trades_summary?.expectancy_R ?? 0;
  const pf = report.trades_summary?.profit_factor ?? 0;

  if (trades < GATE_MIN_TRADES) return { pass: false, reason: `only ${trades} trades (need >=${GATE_MIN_TRADES})` };
  if (expectancy <= GATE_MIN_EXPECTANCY) return { pass: false, reason: `negative expectancy (${expectancy.toFixed(4)}R)` };
  if (pf < GATE_MIN_PROFIT_FACTOR) return { pass: false, reason: `profit factor ${pf.toFixed(3)} < ${GATE_MIN_PROFIT_FACTOR}` };
  return { pass: true, reason: '' };
}

// Build a map of strategy_version_id -> report
function buildReportIndex() {
  const index = {};
  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const report = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), 'utf-8'));
      const svid = report.strategy_version_id;
      if (svid && svid.startsWith('research_')) {
        if (!index[svid] || new Date(report.created_at) > new Date(index[svid].created_at)) {
          index[svid] = report;
        }
      }
    } catch {}
  }
  return index;
}

function main() {
  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Research Strategy Cleanup\n${'='.repeat(50)}`);

  const reportIndex = buildReportIndex();
  console.log(`Found ${Object.keys(reportIndex).length} validation reports for research strategies.\n`);

  const strategyFiles = fs.readdirSync(STRATEGIES_DIR)
    .filter(f => f.startsWith('research_') && f.endsWith('.json'));
  console.log(`Found ${strategyFiles.length} research strategy files.\n`);

  let tombstones = [];
  try {
    tombstones = JSON.parse(fs.readFileSync(TOMBSTONE_PATH, 'utf-8'));
  } catch {}

  let kept = 0;
  let discarded = 0;

  for (const file of strategyFiles) {
    const filePath = path.join(STRATEGIES_DIR, file);
    const spec = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const svid = spec.strategy_version_id;
    const report = reportIndex[svid] || null;
    const gate = passesGate(report);

    const trades = report?.trades_summary?.total_trades ?? 0;
    const exp = report?.trades_summary?.expectancy_R ?? 0;
    const pf = report?.trades_summary?.profit_factor ?? 0;

    if (gate.pass) {
      console.log(`  KEEP  ${svid} — ${spec.name} (${trades} trades, ${exp.toFixed(3)}R, PF ${pf.toFixed(2)})`);
      kept++;
    } else {
      console.log(`  DROP  ${svid} — ${spec.name} — ${gate.reason}`);
      discarded++;

      tombstones.push({
        strategy_version_id: svid,
        name: spec.name || svid,
        hypothesis: spec.description || '',
        expectancy_R: exp,
        total_trades: trades,
        profit_factor: pf,
        reason: gate.reason,
        discarded_at: new Date().toISOString(),
      });

      if (!dryRun) {
        fs.unlinkSync(filePath);
      }
    }
  }

  if (!dryRun && tombstones.length > 0) {
    fs.writeFileSync(TOMBSTONE_PATH, JSON.stringify(tombstones, null, 2), 'utf-8');
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Kept: ${kept}  |  Discarded: ${discarded}`);
  if (dryRun) console.log('(dry run — no files were deleted)');
  console.log();
}

main();

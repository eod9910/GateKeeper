/**
 * Research Studio UI
 *
 * Handles session management, live SSE streaming, generation timeline,
 * leaderboard, and hypothesis detail panel.
 */

const API = '/api/research';

// ─── State ────────────────────────────────────────────────────────────────────

let sessions = [];
let activeSessionId = null;
let activeEventSource = null;
let selectedGeneration = null;
let showArchived = false;
let sessionModeFilter = 'all'; // 'all' | 'strategy_discovery' | 'symbolic_regression'
/** Follow-up Q&A per session+gen: key = "sessionId-gen", value = [{ role: 'user'|'assistant', content }] */
let interpretConversation = new Map();

function applyCollapsedKeys() {
  if (typeof window.AppCollapse !== 'undefined') window.AppCollapse.apply();
}

function saveResearchState() {
  if (typeof window.AppState !== 'undefined' && window.AppState.save) {
    window.AppState.save({
      activeSessionId: activeSessionId,
      selectedGeneration: selectedGeneration,
      showArchived: showArchived,
      sessionModeFilter: sessionModeFilter,
    });
  }
  // Collapsed panel state is managed by AppCollapse — it saves on every toggle automatically.
}

function restoreResearchState() {
  if (activeSessionId != null) return; // already have a session (e.g. after refresh)
  var state = null;
  if (typeof window.AppState !== 'undefined' && window.AppState.restore) {
    state = window.AppState.restore();
  }
  if (!state) return;
  try {
    if (state.showArchived !== undefined) {
      showArchived = state.showArchived;
      const cb = document.getElementById('toggle-archived');
      if (cb) cb.checked = showArchived;
    }
    if (state.sessionModeFilter && ['all', 'strategy_discovery', 'symbolic_regression'].includes(state.sessionModeFilter)) {
      sessionModeFilter = state.sessionModeFilter;
      document.querySelectorAll('.mode-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === sessionModeFilter);
      });
    }
    renderSessionList();
    const sessionId = state.activeSessionId;
    if (sessionId && sessions.some(s => s.session_id === sessionId)) {
      selectSession(sessionId).then(() => {
        const gen = state.selectedGeneration;
        if (gen != null && currentGenome.some(e => e.generation === gen)) {
          showDetail(gen);
        }
      });
    }
  } catch (e) {}
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function buildSdInterpretation(r, fitness) {
  const lines = [];

  // Overall verdict
  if (r.pass_fail === 'PASS' && r.expectancy_R > 0.1 && r.profit_factor >= 1.5) {
    lines.push(`Overall: This strategy passed validation with positive metrics. It shows a real edge worth investigating further. Consider promoting to Tier-2 for walk-forward testing.`);
  } else if (r.expectancy_R > 0 && r.profit_factor >= 1.0) {
    lines.push(`Overall: This strategy is marginally profitable but not strong enough to pass the gate. It has a small positive edge that might improve with parameter tuning (stop distance, take profit, entry timing).`);
  } else if (r.expectancy_R <= 0) {
    lines.push(`Overall: This strategy loses money. Negative expectancy means on average every trade loses. The hypothesis or the implementation needs fundamental changes, not just parameter tweaks.`);
  }

  // Trades
  if (r.total_trades < 50) {
    lines.push(`\nTrades: ${r.total_trades} — Far too few trades to draw conclusions. Results are statistically meaningless. Need at least 100+ trades; 200+ is the minimum for the gate.`);
  } else if (r.total_trades < 100) {
    lines.push(`\nTrades: ${r.total_trades} — Low sample size. Results may be driven by a few lucky or unlucky trades. Need 200+ to be statistically meaningful.`);
  } else if (r.total_trades < 200) {
    lines.push(`\nTrades: ${r.total_trades} — Below the gate minimum of 200. Close, but more data or a broader scan scope is needed.`);
  } else {
    lines.push(`\nTrades: ${r.total_trades} — Sufficient sample size for statistical significance.`);
  }

  // Expectancy
  if (r.expectancy_R < -0.5) {
    lines.push(`\nExpectancy: ${r.expectancy_R.toFixed(3)}R — Severely negative. The average trade loses more than half the risked amount. This is a losing strategy — the entry logic, stop placement, or both are fundamentally flawed.`);
  } else if (r.expectancy_R < 0) {
    lines.push(`\nExpectancy: ${r.expectancy_R.toFixed(3)}R — Negative. On average, each trade loses money. The strategy doesn't have an edge in its current form.`);
  } else if (r.expectancy_R < 0.1) {
    lines.push(`\nExpectancy: ${r.expectancy_R.toFixed(3)}R — Barely positive. After commissions and slippage this would likely be break-even or negative. Needs improvement.`);
  } else if (r.expectancy_R < 0.3) {
    lines.push(`\nExpectancy: ${r.expectancy_R.toFixed(3)}R — Modest positive edge. Could be viable if other metrics (drawdown, win rate) are acceptable.`);
  } else {
    lines.push(`\nExpectancy: ${r.expectancy_R.toFixed(3)}R — Strong positive edge. Each trade earns a meaningful fraction of the risk on average.`);
  }

  // Win rate
  const wr = r.win_rate * 100;
  if (wr < 30) {
    lines.push(`\nWin Rate: ${wr.toFixed(1)}% — Very low. Fewer than 1 in 3 trades win. This can work if winners are much larger than losers, but it's psychologically difficult to trade and prone to long losing streaks.`);
  } else if (wr < 45) {
    lines.push(`\nWin Rate: ${wr.toFixed(1)}% — Below average. Can still be profitable if the reward-to-risk is high enough (winners are 2–3x the size of losers).`);
  } else if (wr < 55) {
    lines.push(`\nWin Rate: ${wr.toFixed(1)}% — Near 50/50. Profitability depends entirely on whether winners are bigger than losers.`);
  } else {
    lines.push(`\nWin Rate: ${wr.toFixed(1)}% — Good win rate. Most trades are winners, which makes the strategy easier to trade consistently.`);
  }

  // Profit factor
  if (r.profit_factor != null) {
    if (r.profit_factor < 0.5) {
      lines.push(`\nProfit Factor: ${r.profit_factor.toFixed(2)} — Extremely poor. Losses are more than double the gains. The strategy is hemorrhaging money.`);
    } else if (r.profit_factor < 1.0) {
      lines.push(`\nProfit Factor: ${r.profit_factor.toFixed(2)} — Below 1.0 means total losses exceed total gains. This is a losing strategy.`);
    } else if (r.profit_factor < 1.3) {
      lines.push(`\nProfit Factor: ${r.profit_factor.toFixed(2)} — Barely above breakeven. After real-world costs (commissions, slippage), this would likely be unprofitable.`);
    } else if (r.profit_factor < 2.0) {
      lines.push(`\nProfit Factor: ${r.profit_factor.toFixed(2)} — Decent. For every dollar lost, you make $${r.profit_factor.toFixed(2)}. Viable but not exceptional.`);
    } else {
      lines.push(`\nProfit Factor: ${r.profit_factor.toFixed(2)} — Strong. Total gains significantly exceed total losses.`);
    }
  }

  // Max drawdown
  if (r.max_drawdown_pct != null) {
    if (r.max_drawdown_pct > 50) {
      lines.push(`\nMax Drawdown: ${r.max_drawdown_pct.toFixed(1)}% — Catastrophic. Losing more than half the account is unacceptable for any strategy. The stops are too wide or the position sizing is too aggressive.`);
    } else if (r.max_drawdown_pct > 30) {
      lines.push(`\nMax Drawdown: ${r.max_drawdown_pct.toFixed(1)}% — Very high. Most traders would abandon a strategy after a 30%+ drawdown. Consider tighter stops or smaller position sizes.`);
    } else if (r.max_drawdown_pct > 15) {
      lines.push(`\nMax Drawdown: ${r.max_drawdown_pct.toFixed(1)}% — Moderate. Manageable for a longer-term strategy, but uncomfortable for most traders.`);
    } else {
      lines.push(`\nMax Drawdown: ${r.max_drawdown_pct.toFixed(1)}% — Well-controlled. Drawdown stays within acceptable bounds.`);
    }
  }

  // Sharpe
  if (r.sharpe_ratio != null) {
    if (r.sharpe_ratio < 0) {
      lines.push(`\nSharpe Ratio: ${r.sharpe_ratio.toFixed(2)} — Negative. The strategy loses money on a risk-adjusted basis. Not viable.`);
    } else if (r.sharpe_ratio < 0.5) {
      lines.push(`\nSharpe Ratio: ${r.sharpe_ratio.toFixed(2)} — Poor risk-adjusted returns. The volatility of returns is too high relative to the gains.`);
    } else if (r.sharpe_ratio < 1.0) {
      lines.push(`\nSharpe Ratio: ${r.sharpe_ratio.toFixed(2)} — Below average. Acceptable for some strategies, but ideally you want above 1.0.`);
    } else if (r.sharpe_ratio < 2.0) {
      lines.push(`\nSharpe Ratio: ${r.sharpe_ratio.toFixed(2)} — Good. Returns are solid relative to the risk taken.`);
    } else {
      lines.push(`\nSharpe Ratio: ${r.sharpe_ratio.toFixed(2)} — Excellent risk-adjusted returns.`);
    }
  }

  // OOS degradation
  if (r.oos_degradation_pct != null) {
    if (r.oos_degradation_pct > 60) {
      lines.push(`\nOOS Degradation: ${r.oos_degradation_pct.toFixed(1)}% — Severe. The strategy performs much worse on out-of-sample data than in-sample. This is a strong sign of curve-fitting — the strategy is tuned to past data and won't hold up going forward.`);
    } else if (r.oos_degradation_pct > 30) {
      lines.push(`\nOOS Degradation: ${r.oos_degradation_pct.toFixed(1)}% — Moderate. Some performance drop on unseen data, which is normal, but watch for overfitting.`);
    } else {
      lines.push(`\nOOS Degradation: ${r.oos_degradation_pct.toFixed(1)}% — Low. The strategy holds up well on data it wasn't trained on. Good sign of robustness.`);
    }
  }

  // Fitness
  if (fitness < 0.2) {
    lines.push(`\nFitness Score: ${fitness.toFixed(3)} — Very low overall fitness. This strategy needs fundamental changes.`);
  } else if (fitness < 0.5) {
    lines.push(`\nFitness Score: ${fitness.toFixed(3)} — Below the promotion threshold. May improve with parameter tuning.`);
  } else if (fitness < 0.7) {
    lines.push(`\nFitness Score: ${fitness.toFixed(3)} — Approaching viable. Close to the promotion threshold.`);
  } else {
    lines.push(`\nFitness Score: ${fitness.toFixed(3)} — Strong overall fitness. Consider promoting for Tier-2 validation.`);
  }

  return lines.join('\n');
}

function buildSrInterpretation(r2, complexity, formula, isConstant) {
  const lines = [];

  // R² assessment
  if (r2 <= 0) {
    lines.push(`R² = ${r2.toFixed(3)} — The formula has no predictive power. It explains none of the variance in the target (forward return). This means the selected features, in the combinations gplearn explored, do not predict the target any better than guessing the average.`);
  } else if (r2 < 0.02) {
    lines.push(`R² = ${r2.toFixed(3)} — Very weak predictive power. The formula explains less than 2% of the variance. In financial data this is common; most indicator combos don't predict returns well. This is borderline — might contain a tiny signal, but likely noise.`);
  } else if (r2 < 0.05) {
    lines.push(`R² = ${r2.toFixed(3)} — Weak but potentially meaningful. In financial data, even 2–5% explained variance can represent a real edge. Worth investigating further: try validating by wrapping this in a strategy and running the validator.`);
  } else if (r2 < 0.10) {
    lines.push(`R² = ${r2.toFixed(3)} — Moderate predictive power. This is a promising result for financial data. The formula captures real structure in the relationship between the features and forward returns. Validate carefully — there's a risk of overfitting, especially with high complexity.`);
  } else if (r2 < 0.20) {
    lines.push(`R² = ${r2.toFixed(3)} — Suspiciously high for financial data. R² above 0.10 on price returns is rare and usually means the formula is overfitting the training data. The more complex the formula, the more likely this is noise-fitting rather than a real signal. Do not trust this without walk-forward validation on unseen data.`);
  } else {
    lines.push(`R² = ${r2.toFixed(3)} — Almost certainly overfitting. An R² this high on financial return data is not realistic — real market edges are tiny (R² 0.01–0.05). The formula has memorized patterns in the training data that won't repeat. This is not a usable signal. Try increasing the parsimony penalty, reducing complexity, or using fewer features.`);
  }

  // Constant formula
  if (isConstant) {
    lines.push(`\nThe formula is a constant (no features used). This means gplearn could not find any combination of the selected features that predicts the target better than a flat number. This tells you the features you selected likely don't have a detectable relationship with the target at this timeframe.`);
    lines.push(`\nWhat to try:\n• Add more features (SMA Distance, RSI Slope, Range %)\n• Change the target horizon (try 10 or 20 bars instead of 5)\n• Try a different symbol or timeframe\n• Increase GP generations or population size`);
  } else {
    // Complexity assessment
    if (complexity <= 5) {
      lines.push(`\nComplexity = ${complexity} — Simple formula. This is good: simpler formulas are less likely to overfit and are easier to interpret.`);
    } else if (complexity <= 15) {
      lines.push(`\nComplexity = ${complexity} — Moderate complexity. The formula uses several operations. Check that it makes intuitive sense — if it doesn't, it may be fitting noise.`);
    } else if (complexity <= 30) {
      lines.push(`\nComplexity = ${complexity} — High complexity. Complex formulas are more likely to overfit the training data. Consider increasing the parsimony penalty or using fewer features.`);
    } else {
      lines.push(`\nComplexity = ${complexity} — Very high complexity. A formula this complex is almost guaranteed to be overfitting. It has enough degrees of freedom to memorize the training data rather than find real patterns. Increase the parsimony_coefficient (try 0.05 or 0.1 instead of 0.01), reduce GP generations, or add fewer features.`);
    }

    // Combined high-R² + high-complexity warning
    if (r2 > 0.15 && complexity > 20) {
      lines.push(`\n⚠ High R² (${r2.toFixed(3)}) combined with high complexity (${complexity}) is the classic signature of overfitting. The formula is curve-fitting the training data. A simpler formula with a lower R² (even 0.02–0.05) is far more likely to work on new data.`);
    }

    // Feature usage
    const features = [];
    if (/RSI/i.test(formula)) features.push('RSI');
    if (/ATR/i.test(formula)) features.push('ATR');
    if (/Mom/i.test(formula)) features.push('Momentum');
    if (/SMA/i.test(formula)) features.push('SMA Distance');
    if (/Range/i.test(formula)) features.push('Range %');
    if (/slope/i.test(formula)) features.push('RSI Slope');
    if (features.length > 0) {
      lines.push(`\nFeatures used in formula: ${features.join(', ')}.`);
    }
  }

  // Next steps
  if (!isConstant) {
    if (r2 > 0.20 || (r2 > 0.10 && complexity > 20)) {
      lines.push(`\nNext steps: Do not use this formula as-is. Try re-running with a higher parsimony penalty (0.05–0.1) to force simpler formulas, or reduce the number of features. Look for formulas with R² in the 0.02–0.08 range and complexity under 15 — those are more likely to hold up.`);
    } else if (r2 > 0.02) {
      lines.push(`\nNext steps: This formula could be packaged as a primitive and wrapped in a composite strategy for validation. Use Parameter Sweep to tune the score_threshold.`);
    }
  }

  return lines.join('\n');
}

function initCollapsiblePanels(container) {
  if (typeof window.AppCollapse !== 'undefined') window.AppCollapse.apply(container);
}

function initCollapsibleSections(container) {
  if (typeof window.AppCollapse !== 'undefined') window.AppCollapse.apply(container);
}

function followupListKey() {
  return activeSessionId && selectedGeneration != null ? `${activeSessionId}-${selectedGeneration}` : '';
}

function renderFollowupListHtml(key) {
  const arr = key ? (interpretConversation.get(key) || []) : [];
  if (arr.length === 0) return '';
  return arr.map(m => {
    const isUser = m.role === 'user';
    const label = isUser ? 'You' : 'AI';
    const style = isUser
      ? 'background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);padding:var(--space-8) var(--space-12);margin-bottom:var(--space-8);font-size:var(--text-small);'
      : 'background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);border-left:3px solid #10b981;border-radius:var(--radius);padding:var(--space-8) var(--space-12);margin-bottom:var(--space-8);font-size:var(--text-small);white-space:pre-wrap;';
    return `<div style="${style}"><strong style="color:var(--color-text-muted);font-size:10px;">${escHtml(label)}</strong><div style="margin-top:4px;">${escHtml(m.content)}</div></div>`;
  }).join('');
}

function toggleSrForm(mode) {
  const srEl = document.getElementById('sr-form-fields');
  const strategyEl = document.getElementById('strategy-form-fields');
  if (srEl) srEl.style.display = mode === 'symbolic_regression' ? 'block' : 'none';
  if (strategyEl) strategyEl.style.display = mode === 'symbolic_regression' ? 'none' : 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  loadSessions();
  setInterval(loadSessions, 30_000);
  toggleSrForm(document.getElementById('input-mode')?.value || 'strategy_discovery');

  // Check for seed hypothesis from URL
  const params = new URLSearchParams(window.location.search);
  const seed = params.get('seed');
  if (seed) {
    const seedInput = document.getElementById('new-session-seed');
    if (seedInput) {
      seedInput.value = decodeURIComponent(seed);
    }
  }
});

// ─── Session list ─────────────────────────────────────────────────────────────

async function loadSessions() {
  try {
    const res = await fetch(`${API}/sessions`);
    const payload = await res.json();
    if (!payload.success) return;
    sessions = payload.data || [];
    renderSessionList();
    restoreResearchState();
  } catch (e) {}
}

function setSessionModeFilter(mode) {
  sessionModeFilter = mode;
  saveResearchState();
  renderSessionList();

  // Auto-select the most recent non-archived session matching the new filter
  let candidates = showArchived ? sessions : sessions.filter(s => !s.archived);
  if (mode !== 'all') {
    candidates = candidates.filter(s => (s.config?.mode || 'strategy_discovery') === mode);
  }
  if (candidates.length > 0) {
    // Sessions are ordered most-recent first from the API; pick the first
    const best = candidates[0];
    if (best.session_id !== activeSessionId) {
      selectSession(best.session_id);
    }
  }
}

function activateFilterBtn(btn) {
  document.querySelectorAll('.mode-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function renderSessionList() {
  const el = document.getElementById('session-list');
  const count = document.getElementById('session-count');
  let filtered = showArchived ? sessions : sessions.filter(s => !s.archived);
  if (sessionModeFilter !== 'all') {
    filtered = filtered.filter(s => {
      const m = s.config?.mode || 'strategy_discovery';
      return m === sessionModeFilter;
    });
  }
  const archivedCount = sessions.filter(s => s.archived).length;
  const totalVisible = (showArchived ? sessions : sessions.filter(s => !s.archived)).length;
  if (count) count.textContent = `${filtered.length}${filtered.length !== totalVisible ? ` of ${totalVisible}` : ''}${archivedCount ? ` (${archivedCount} archived)` : ''}`;

  if (!filtered.length) {
    el.innerHTML = '<div class="empty-state" style="padding:var(--space-24);"><div class="empty-state-sub">No sessions match this filter.</div></div>';
    return;
  }

  const displayNames = getResearchSessionDisplayNames();

  el.innerHTML = filtered.map(s => {
    const isRunning = s.status === 'running';
    const isArchived = s.archived;
    const mode = s.config?.mode || 'strategy_discovery';
    const displayName = displayNames.get(s.session_id) || getResearchSessionBaseName(s.config?.name);
    const modeBadge = mode === 'symbolic_regression'
      ? '<span class="badge badge-kept" style="font-size:9px;margin-left:4px;">SR</span>'
      : '<span class="badge badge-completed" style="font-size:9px;margin-left:4px;">SD</span>';
    const encodedDisplayName = encodeURIComponent(displayName);
    return `
    <div class="session-item ${s.session_id === activeSessionId ? 'active' : ''} ${isArchived ? 'archived' : ''}"
         onclick="selectSession('${s.session_id}')">
      <div class="session-item-name">
        <div class="session-item-title-group">
          <span class="session-item-title">${escHtml(displayName)}</span>
          ${modeBadge}
          <span class="badge badge-${s.status}">${s.status}</span>
          ${isRunning ? '<span class="pulse-dot"></span>' : ''}
        </div>
        ${!isRunning ? `<div class="session-item-actions" onclick="event.stopPropagation()">
          ${(s.status === 'completed' || s.status === 'stopped') && !isArchived
            ? `<button title="Rerun with mandated params" onclick="continueSessionFrom('${s.session_id}')" style="color:#6366f1;font-weight:600;">rerun</button>`
            : ''}
          ${isArchived
            ? `<button title="Unarchive" onclick="unarchiveSession('${s.session_id}')">restore</button>`
            : `<button title="Archive" onclick="archiveSession('${s.session_id}')">archive</button>`
          }
          <button class="btn-delete" title="Delete permanently" onclick="deleteSessionConfirm('${s.session_id}', decodeURIComponent('${encodedDisplayName}'))">delete</button>
        </div>` : ''}
      </div>
      <div class="session-item-meta">
        Gen ${s.generation}/${s.max_generations} &middot;
        ${s.genome_count} tested &middot;
        ${s.config.target_interval}
        ${s.best ? ` &middot; best fitness: ${s.best.fitness_score.toFixed(3)}` : ''}
      </div>
    </div>`;
  }).join('');
}

// ─── Session select ───────────────────────────────────────────────────────────

async function selectSession(sessionId) {
  activeSessionId = sessionId;
  selectedGeneration = null;
  saveResearchState();
  renderSessionList();

  // Close existing SSE
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }

  try {
    const res = await fetch(`${API}/sessions/${sessionId}`);
    const payload = await res.json();
    if (!payload.success) return;
    renderSessionDetail(payload.data);
    connectSSE(sessionId);
  } catch (err) {
    console.error('Failed to load session', err);
  }
}

// ─── SSE connection ───────────────────────────────────────────────────────────

function connectSSE(sessionId) {
  const es = new EventSource(`${API}/sessions/${sessionId}/stream`);
  activeEventSource = es;

  es.addEventListener('snapshot', (e) => {
    const data = JSON.parse(e.data);
    const session = sessions.find(s => s.session_id === sessionId);
    if (session) {
      Object.assign(session, {
        status: data.status,
        generation: data.generation,
        genome_count: (data.genome || []).length,
        best: data.best,
        current_hypothesis: data.current_hypothesis,
      });
      renderSessionList();
    }
    renderSessionDetail(data);
  });

  es.addEventListener('hypothesis', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Gen ${data.generation}: ${data.hypothesis}`, 'highlight');
    updateLiveHypothesis(data.hypothesis);
    updateProgress(data.generation);
  });

  es.addEventListener('backtest_started', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Gen ${data.generation}: Backtest started (job ${data.job_id?.slice(0, 8)})`, '');
  });

  es.addEventListener('backtest_progress', (e) => {
    const data = JSON.parse(e.data);
    updateBtProgress(data.stage, data.detail, data.pct);
  });

  es.addEventListener('reflecting', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Gen ${data.generation}: AI reflecting on backtest results...`, 'highlight');
  });

  es.addEventListener('reflection_complete', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Gen ${data.generation}: Reflection complete`, 'success');
  });

  es.addEventListener('reflection_error', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Gen ${data.generation}: Reflection failed — ${data.error}`, 'warn');
  });

  es.addEventListener('generation_complete', (e) => {
    const data = JSON.parse(e.data);
    const verdict = data.verdict;
    const cls = verdict === 'promoted' ? 'success' : verdict === 'kept' ? 'highlight' : '';
    appendLog(`Gen ${data.generation} complete — fitness: ${data.fitness_score?.toFixed(3)} — ${verdict}`, cls);
    addOrUpdateGenomeEntry(data);
    updateProgress(data.generation);
    const session = sessions.find(s => s.session_id === activeSessionId);
    if (session) session.genome_count = (session.genome_count || 0);
    renderLeaderboard();
    renderSessionList();
  });

  es.addEventListener('plugin_created', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Plugin created: ${data.pattern_id}`, 'highlight');
  });

  es.addEventListener('promoted', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Gen ${data.generation} PROMOTED to Tier-2! Fitness: ${data.fitness_score}`, 'success');
  });

  es.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    appendLog(data.message, '');
    updateLiveHypothesis(data.message);
  });

  es.addEventListener('warning', (e) => {
    const data = JSON.parse(e.data);
    appendLog(data.message, 'warn');
  });

  es.addEventListener('error', (e) => {
    if (e.data) {
      try {
        const data = JSON.parse(e.data);
        appendLog(`Error: ${data.error || data.message}`, 'error');
      } catch { appendLog('Connection error', 'error'); }
    }
  });

  es.addEventListener('session_end', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Session ${data.status}.`, data.status === 'completed' ? 'success' : '');
    es.close();
    const session = sessions.find(s => s.session_id === sessionId);
    if (session) session.status = data.status;
    renderSessionList();
    updateLiveHypothesis(null);
    // Update the status badge and remove pulse dot in the detail header
    const statusEl = document.querySelector('.session-detail-status');
    if (statusEl) {
      const badgeClass = data.status === 'completed' ? 'badge-completed'
        : data.status === 'stopped' ? 'badge-stopped'
        : data.status === 'error' ? 'badge-error' : 'badge-completed';
      statusEl.className = `badge ${badgeClass} session-detail-status`;
      statusEl.innerHTML = data.status.toUpperCase();
    }
    const pulseEl = document.querySelector('.session-detail-pulse');
    if (pulseEl) pulseEl.remove();
  });

  es.onerror = () => {
    // Reconnect handled by browser
  };
}

// ─── Session detail rendering ─────────────────────────────────────────────────

let currentGenome = [];

function renderSessionDetail(data) {
  currentGenome = data.genome || [];
  selectedGeneration = null;

  const isRunning = data.status === 'running';
  const pct = data.max_generations > 0 ? (data.generation / data.max_generations) * 100 : 0;

  document.getElementById('research-main').innerHTML = `
    <!-- Header -->
    <div class="panel">
      <div class="panel-body">
        <div class="session-detail-header">
          <div>
            <div class="session-name">${escHtml(data.config?.name || 'Session')}</div>
            <div class="session-meta">
              <div class="meta-item">
                <div class="meta-label">Status</div>
                <div class="meta-value">
                  <span class="badge badge-${data.status} session-detail-status">${data.status}</span>
                  ${isRunning ? '<span class="pulse-dot session-detail-pulse" style="margin-left:6px;"></span>' : ''}
                </div>
              </div>
              <div class="meta-item">
                <div class="meta-label">Generation</div>
                <div class="meta-value" id="session-detail-gen">${data.generation} / ${data.max_generations}</div>
              </div>
              <div class="meta-item">
                <div class="meta-label">Interval</div>
                <div class="meta-value">${data.config?.target_interval || '1wk'}</div>
              </div>
              <div class="meta-item">
                <div class="meta-label">Tested</div>
                <div class="meta-value" id="session-detail-tested">${currentGenome.length}</div>
              </div>
              ${data.best ? `<div class="meta-item">
                <div class="meta-label">Best Fitness</div>
                <div class="meta-value" style="color:var(--color-accent)">${data.best.fitness_score.toFixed(3)}</div>
              </div>` : ''}
            </div>
          </div>
          ${isRunning ? `<button class="btn-danger" onclick="stopCurrentSession()">Stop Session</button>` : ''}
        </div>

        <!-- Progress -->
        <div class="progress-container">
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" id="gen-progress-bar" style="width:${pct.toFixed(1)}%"></div>
          </div>
          <div class="progress-label">
            <span id="gen-progress-label">${data.generation} of ${data.max_generations} generations</span>
            <span id="bt-progress-label"></span>
          </div>
        </div>

        <!-- Live hypothesis -->
        <div id="live-hypothesis" class="hypothesis-live ${data.current_hypothesis ? '' : 'empty'}">
          ${escHtml(data.current_hypothesis || 'Waiting for next generation...')}
        </div>

        <!-- Live log -->
        <div id="live-log" class="live-log"></div>
      </div>
    </div>

    <!-- Leaderboard -->
    <div class="panel collapsible" id="leaderboard-panel" data-collapse-key="leaderboard">
      <div class="panel-header"><span class="panel-chevron">&#9660;</span><span>Leaderboard</span></div>
      <div class="panel-body" id="leaderboard-body">
        ${renderLeaderboardHtml(currentGenome)}
      </div>
    </div>

    <!-- Detail drawer -->
    <div id="detail-drawer" style="display:none;"></div>
  `;
  initCollapsiblePanels(document.getElementById('research-main'));
  applyCollapsedKeys();
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

function renderLeaderboard() {
  const el = document.getElementById('leaderboard-body');
  if (el) el.innerHTML = renderLeaderboardHtml(currentGenome);
}

function renderLeaderboardHtml(genome) {
  if (!genome.length) {
    return '<div class="empty-state" style="padding:var(--space-24);"><div class="empty-state-sub">No results yet.</div></div>';
  }
  const session = sessions.find(s => s.session_id === activeSessionId);
  const isSr = session?.config?.mode === 'symbolic_regression';

  if (isSr) {
    const sorted = [...genome].sort((a, b) => (b.fitness_score || 0) - (a.fitness_score || 0));
    const rows = sorted.map((e, rank) => `
      <tr onclick="showDetail(${e.generation})" style="cursor:pointer;">
        <td class="mono">#${rank + 1}</td>
        <td class="mono" style="color:var(--color-text-subtle)">Gen ${e.generation}</td>
        <td style="max-width:360px;font-size:11px;font-family:var(--font-mono);color:var(--color-text-muted);line-height:1.3;word-break:break-all">${escHtml(truncate(e.formula_readable || e.hypothesis || '—', 120))}</td>
        <td class="mono">${e.complexity != null ? e.complexity : '—'}</td>
        <td>
          <div class="fitness-bar-inline">
            <div class="fitness-bar-bg">
              <div class="fitness-bar-fill" style="width:${Math.min(100, ((e.fitness_score || 0) * 100).toFixed(1))}%"></div>
            </div>
            <span class="fitness-val" style="color:${fitnessColor(e.fitness_score || 0)}">${(e.fitness_score ?? 0).toFixed(3)}</span>
          </div>
        </td>
        <td><span class="badge badge-${e.verdict}">${e.verdict}</span></td>
        <td>
          ${e.verdict !== 'promoted'
            ? `<button class="btn-ghost" onclick="event.stopPropagation();manualPromote(${e.generation})">Promote to Tier-1</button>`
            : '<span style="color:#82c850;font-size:11px;">&#10003; promoted</span>'}
        </td>
      </tr>
    `).join('');
    return `
    <table class="leaderboard-table">
      <thead>
        <tr>
          <th>#</th><th>Gen</th><th>Formula</th><th>Complexity</th><th>R²</th><th>Verdict</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  const sorted = [...genome]
    .filter(e => e.report_summary)
    .sort((a, b) => b.fitness_score - a.fitness_score);

  if (!sorted.length) {
    return '<div class="empty-state" style="padding:var(--space-24);"><div class="empty-state-sub">No completed backtests yet.</div></div>';
  }

  const rows = sorted.map((e, rank) => {
    const r = e.report_summary;
    return `
      <tr onclick="showDetail(${e.generation})" style="cursor:pointer;">
        <td class="mono">#${rank + 1}</td>
        <td class="mono" style="color:var(--color-text-subtle)">Gen ${e.generation}</td>
        <td style="max-width:260px;font-size:12px;color:var(--color-text-muted);line-height:1.3">${escHtml(truncate(e.hypothesis, 80))}</td>
        <td>
          <div class="fitness-bar-inline">
            <div class="fitness-bar-bg">
              <div class="fitness-bar-fill" style="width:${(e.fitness_score * 100).toFixed(1)}%"></div>
            </div>
            <span class="fitness-val" style="color:${fitnessColor(e.fitness_score)}">${e.fitness_score.toFixed(3)}</span>
          </div>
        </td>
        <td class="mono">${r.total_trades}</td>
        <td class="mono">${(r.win_rate * 100).toFixed(1)}%</td>
        <td class="mono" style="color:${r.expectancy_R > 0 ? '#50b478' : '#e05c5c'}">${r.expectancy_R.toFixed(3)}R</td>
        <td class="mono">${r.sharpe_ratio?.toFixed(2) || '—'}</td>
        <td><span class="badge badge-${e.verdict}">${e.verdict}</span></td>
        <td>
          ${e.verdict !== 'promoted'
            ? `<button class="btn-ghost" onclick="event.stopPropagation();manualPromote(${e.generation})">Promote</button>`
            : '<span style="color:#82c850;font-size:11px;">&#10003; promoted</span>'}
        </td>
      </tr>
    `;
  }).join('');

  return `
    <table class="leaderboard-table">
      <thead>
        <tr>
          <th>#</th><th>Gen</th><th>Hypothesis</th><th>Fitness</th>
          <th>Trades</th><th>Win%</th><th>Exp</th><th>Sharpe</th>
          <th>Verdict</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ─── Timeline ─────────────────────────────────────────────────────────────────


// ─── Detail drawer ────────────────────────────────────────────────────────────

function showDetail(generation) {
  selectedGeneration = generation;
  saveResearchState();
  const entry = currentGenome.find(e => e.generation === generation);
  if (!entry) return;

  const drawer = document.getElementById('detail-drawer');
  if (!drawer) return;
  drawer.style.display = 'block';

  const isFormulaEntry = entry.formula_readable != null || entry.formula != null;
  if (isFormulaEntry) {
    const r2 = entry.fitness_score ?? 0;
    const cx = entry.complexity ?? 0;
    const formula = entry.formula_readable || entry.formula || '';
    const isConstant = cx <= 1 || /^-?[\d.]+$/.test(formula.trim());
    const interpretation = buildSrInterpretation(r2, cx, formula, isConstant);
    drawer.innerHTML = `
    <div class="detail-drawer panel collapsible" data-collapse-key="detail">
      <div class="panel-header" style="text-transform:none;font-family:var(--font-sans);">
        <span class="panel-chevron">&#9660;</span>
        <span style="font-size:var(--text-small);font-weight:700;color:var(--color-text);">Generation ${entry.generation} — Formula</span>
        <span class="badge badge-${entry.verdict}" style="margin-left:auto;">${entry.verdict}</span>
        ${entry.verdict !== 'promoted'
          ? `<button class="btn-ghost" onclick="event.stopPropagation();manualPromote(${entry.generation})">Promote to Tier-1</button>`
          : ''}
        <button class="btn-ghost" onclick="event.stopPropagation();closeDetail()">&#10005; Close</button>
      </div>
      <div class="panel-body">
      <div class="detail-section collapsible" data-collapse-key="sr-formula-readable">
        <div class="detail-section-header"><span class="detail-section-chevron">&#9660;</span><span class="detail-section-title">Formula (readable)</span></div>
        <div class="detail-section-body"><div style="font-size:12px;font-family:var(--font-mono);color:var(--color-text);line-height:1.5;word-break:break-all;background:var(--color-bg);border:1px solid var(--color-border);border-left:3px solid var(--color-accent);border-radius:var(--radius);padding:var(--space-12);">${escHtml(formula || '—')}</div></div>
      </div>
      ${entry.formula && entry.formula !== (entry.formula_readable || '') ? `
      <div class="detail-section collapsible" data-collapse-key="sr-formula-raw">
        <div class="detail-section-header"><span class="detail-section-chevron">&#9660;</span><span class="detail-section-title">Formula (raw)</span></div>
        <div class="detail-section-body"><div style="font-size:11px;font-family:var(--font-mono);color:var(--color-text-muted);word-break:break-all;background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);padding:var(--space-12);">${escHtml(entry.formula)}</div></div>
      </div>
      ` : ''}
      <div class="detail-section collapsible" data-collapse-key="sr-metrics">
        <div class="detail-section-header"><span class="detail-section-chevron">&#9660;</span><span class="detail-section-title">Metrics</span></div>
        <div class="detail-section-body"><div class="metrics-grid">
          <div class="metric-card"><div class="metric-card-label">R² (fitness)</div><div class="metric-card-value" style="color:${fitnessColor(r2)}">${r2.toFixed(3)}</div></div>
          <div class="metric-card"><div class="metric-card-label">Complexity</div><div class="metric-card-value">${cx || '—'}</div></div>
        </div></div>
      </div>
      <div class="section-divider"></div>
      <div class="detail-section collapsible" data-collapse-key="sr-ai-analysis">
        <div class="detail-section-header">
          <span class="detail-section-chevron">&#9660;</span>
          <span class="detail-section-title">AI Analysis</span>
          <button class="btn-sm-outline" id="btn-interpret" onclick="event.stopPropagation();requestInterpretation(${entry.generation})" style="font-size:10px;padding:2px 8px;cursor:pointer;background:transparent;border:1px solid var(--color-border);border-radius:var(--radius);color:var(--color-text-muted);margin-left:auto;">Analyze with AI</button>
        </div>
        <div class="detail-section-body">
          <div style="font-size:10px;font-weight:600;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--space-8);">Quick Read</div>
          <div id="interpretation-content" style="font-size:var(--text-small);color:var(--color-text);line-height:1.6;background:var(--color-bg);border:1px solid var(--color-border);border-left:3px solid #f59e0b;border-radius:var(--radius);padding:var(--space-12);white-space:pre-wrap;margin-bottom:var(--space-12);">${interpretation}</div>
          <div style="font-size:10px;font-weight:600;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--space-8);">AI Verdict</div>
          <div id="ai-analysis-content" style="font-size:var(--text-small);color:var(--color-text);line-height:1.6;background:var(--color-bg);border:1px solid var(--color-border);border-left:3px solid ${entry.interpretation ? '#10b981' : 'var(--color-border)'};border-radius:var(--radius);padding:var(--space-12);white-space:pre-wrap;">${entry.interpretation ? escHtml(entry.interpretation) : '<span style="color:var(--color-text-subtle);font-style:italic;">Click \u201CAnalyze with AI\u201D for a deep analysis of this formula.</span>'}</div>
        </div>
      </div>
      <div class="section-divider"></div>
      <div class="detail-section collapsible" data-collapse-key="sr-followup">
        <div class="detail-section-header"><span class="detail-section-chevron">&#9660;</span><span class="detail-section-title">Ask a follow-up</span></div>
        <div class="detail-section-body"><div id="interpret-followup-list" style="margin-bottom:var(--space-12);">${renderFollowupListHtml(followupListKey())}</div>
        <div style="display:flex;gap:var(--space-8);align-items:center;">
          <input type="text" id="interpret-followup-input" placeholder="e.g. Why is that? What if I use more features?" style="flex:1;padding:var(--space-8) var(--space-12);font-size:var(--text-small);border:1px solid var(--color-border);border-radius:var(--radius);background:var(--color-bg);color:var(--color-text);" onkeydown="if(event.key==='Enter') submitFollowUp(${entry.generation})" />
          <button type="button" class="btn-sm-outline" id="btn-followup-ask" onclick="submitFollowUp(${entry.generation})" style="padding:var(--space-8) var(--space-12);cursor:pointer;">Ask</button>
        </div></div>
      </div>
    </div></div>`;
    initCollapsiblePanels(drawer);
    initCollapsibleSections(drawer);
    applyCollapsedKeys();
    return;
  }

  const r = entry.report_summary;
  const sdQuickRead = r ? buildSdInterpretation(r, entry.fitness_score) : '';
  // Determine what AI text to show: prefer deeper interpret result, fall back to reflection
  const aiVerdictText = entry.interpretation || entry.reflection || '';
  const metricsHtml = r ? `
    <div class="detail-section collapsible" data-collapse-key="sd-backtest-metrics">
      <div class="detail-section-header"><span class="detail-section-chevron">&#9660;</span><span class="detail-section-title">Backtest Metrics</span></div>
      <div class="detail-section-body"><div class="metrics-grid">
        <div class="metric-card"><div class="metric-card-label">Trades</div><div class="metric-card-value ${r.total_trades >= 200 ? 'good' : 'bad'}">${r.total_trades}</div></div>
        <div class="metric-card"><div class="metric-card-label">Win Rate</div><div class="metric-card-value ${r.win_rate >= 0.5 ? 'good' : 'bad'}">${(r.win_rate * 100).toFixed(1)}%</div></div>
        <div class="metric-card"><div class="metric-card-label">Expectancy</div><div class="metric-card-value ${r.expectancy_R > 0 ? 'good' : 'bad'}">${r.expectancy_R.toFixed(3)}R</div></div>
        <div class="metric-card"><div class="metric-card-label">Profit Factor</div><div class="metric-card-value ${r.profit_factor >= 1.5 ? 'good' : r.profit_factor < 1 ? 'bad' : ''}">${r.profit_factor?.toFixed(2) || '—'}</div></div>
        <div class="metric-card"><div class="metric-card-label">Max Drawdown</div><div class="metric-card-value ${r.max_drawdown_pct < 20 ? 'good' : r.max_drawdown_pct > 40 ? 'bad' : ''}">${r.max_drawdown_pct?.toFixed(1) || '—'}%</div></div>
        <div class="metric-card"><div class="metric-card-label">Sharpe</div><div class="metric-card-value ${r.sharpe_ratio >= 1 ? 'good' : r.sharpe_ratio < 0 ? 'bad' : ''}">${r.sharpe_ratio?.toFixed(2) || '—'}</div></div>
        <div class="metric-card"><div class="metric-card-label">OOS Degradation</div><div class="metric-card-value ${r.oos_degradation_pct < 30 ? 'good' : r.oos_degradation_pct > 60 ? 'bad' : ''}">${r.oos_degradation_pct?.toFixed(1) || '—'}%</div></div>
        <div class="metric-card"><div class="metric-card-label">Pass/Fail</div><div class="metric-card-value ${r.pass_fail === 'PASS' ? 'good' : 'bad'}">${r.pass_fail}</div></div>
        <div class="metric-card"><div class="metric-card-label">Fitness Score</div><div class="metric-card-value" style="color:${fitnessColor(entry.fitness_score)}">${entry.fitness_score.toFixed(3)}</div></div>
      </div></div>
    </div>
    <div class="section-divider"></div>
    <div class="detail-section collapsible" data-collapse-key="sd-ai-analysis">
      <div class="detail-section-header">
        <span class="detail-section-chevron">&#9660;</span>
        <span class="detail-section-title">AI Analysis</span>
        <div style="display:flex;gap:6px;margin-left:auto;">
          <button class="btn-sm-outline" id="btn-interpret" onclick="event.stopPropagation();requestInterpretation(${entry.generation})" style="font-size:10px;padding:2px 8px;cursor:pointer;background:transparent;border:1px solid var(--color-border);border-radius:var(--radius);color:var(--color-text-muted);">Analyze with AI</button>
          <button class="btn-sm-outline" id="btn-regen-reflection" onclick="event.stopPropagation();regenReflection(${entry.generation})" style="font-size:10px;padding:2px 8px;cursor:pointer;background:transparent;border:1px solid var(--color-border);border-radius:var(--radius);color:var(--color-text-muted);">Regenerate</button>
        </div>
      </div>
      <div class="detail-section-body">
        <div style="font-size:10px;font-weight:600;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--space-8);">Quick Read</div>
        <div id="interpretation-content" style="font-size:var(--text-small);color:var(--color-text);line-height:1.6;background:var(--color-bg);border:1px solid var(--color-border);border-left:3px solid #f59e0b;border-radius:var(--radius);padding:var(--space-12);white-space:pre-wrap;margin-bottom:var(--space-12);">${sdQuickRead}</div>
        <div style="font-size:10px;font-weight:600;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--space-8);">AI Verdict</div>
        <div id="ai-analysis-content" style="font-size:var(--text-small);color:var(--color-text);line-height:1.6;background:var(--color-bg);border:1px solid var(--color-border);border-left:3px solid ${aiVerdictText ? '#10b981' : 'var(--color-border)'};border-radius:var(--radius);padding:var(--space-12);white-space:pre-wrap;">${aiVerdictText ? escHtml(aiVerdictText) : '<span style="color:var(--color-text-subtle);font-style:italic;">Click \u201CAnalyze with AI\u201D for a deep analysis, or \u201CRegenerate\u201D to re-run the strategy-gen reflection.</span>'}</div>
        ${entry.suggested_params ? `
        <div style="margin-top:var(--space-8);background:var(--color-bg);border:1px solid var(--color-border);border-left:3px solid #6366f1;border-radius:var(--radius);padding:var(--space-8) var(--space-12);">
          <div style="font-size:10px;font-weight:600;color:#6366f1;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--space-4);">Mandated for Next Gen</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">${Object.entries(entry.suggested_params).map(([k, v]) =>
            `<span style="font-size:10px;padding:2px 6px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.3);border-radius:4px;color:var(--color-text);font-family:monospace;">${escHtml(k)}: <strong>${escHtml(String(v))}</strong></span>`
          ).join('')}</div>
        </div>` : ''}
      </div>
    </div>
    <div class="section-divider"></div>
  ` : '<div style="color:var(--color-text-subtle);font-size:var(--text-small);margin-bottom:var(--space-16);">No backtest results available.</div>';

  const followupBlock = `
    <div class="section-divider"></div>
    <div class="detail-section collapsible" data-collapse-key="sd-followup">
      <div class="detail-section-header"><span class="detail-section-chevron">&#9660;</span><span class="detail-section-title">Ask a follow-up</span></div>
      <div class="detail-section-body"><div id="interpret-followup-list" style="margin-bottom:var(--space-12);">${renderFollowupListHtml(followupListKey())}</div>
      <div style="display:flex;gap:var(--space-8);align-items:center;">
        <input type="text" id="interpret-followup-input" placeholder="e.g. Why did it fail? What should I change?" style="flex:1;padding:var(--space-8) var(--space-12);font-size:var(--text-small);border:1px solid var(--color-border);border-radius:var(--radius);background:var(--color-bg);color:var(--color-text);" onkeydown="if(event.key==='Enter') submitFollowUp(${entry.generation})" />
        <button type="button" class="btn-sm-outline" id="btn-followup-ask" onclick="submitFollowUp(${entry.generation})" style="padding:var(--space-8) var(--space-12);cursor:pointer;">Ask</button>
      </div></div>
    </div>`;

  drawer.innerHTML = `
    <div class="detail-drawer panel collapsible" data-collapse-key="detail">
      <div class="panel-header" style="text-transform:none;font-family:var(--font-sans);">
        <span class="panel-chevron">&#9660;</span>
        <span style="font-size:var(--text-small);font-weight:700;color:var(--color-text);">Generation ${entry.generation} Detail</span>
        <span class="badge badge-${entry.verdict}" style="margin-left:auto;">${entry.verdict}</span>
        ${entry.verdict !== 'promoted'
          ? `<button class="btn-ghost" onclick="event.stopPropagation();manualPromote(${entry.generation})">Promote to Tier-2</button>`
          : ''}
        <button class="btn-ghost" onclick="event.stopPropagation();closeDetail()">&#10005; Close</button>
      </div>
      <div class="panel-body">
      <div class="detail-section collapsible" data-collapse-key="sd-hypothesis">
        <div class="detail-section-header"><span class="detail-section-chevron">&#9660;</span><span class="detail-section-title">Hypothesis</span></div>
        <div class="detail-section-body"><div style="font-size:var(--text-small);color:var(--color-text);line-height:1.6;background:var(--color-bg);border:1px solid var(--color-border);border-left:3px solid var(--color-accent);border-radius:var(--radius);padding:var(--space-12);">${escHtml(entry.hypothesis)}</div></div>
      </div>

      ${entry.new_plugins_created?.length ? `
      <div class="detail-section collapsible" data-collapse-key="sd-plugins">
        <div class="detail-section-header"><span class="detail-section-chevron">&#9660;</span><span class="detail-section-title">New Plugins Created</span></div>
        <div class="detail-section-body"><div style="display:flex;gap:var(--space-8);flex-wrap:wrap;">${entry.new_plugins_created.map(p => `<span class="badge badge-kept">${escHtml(p)}</span>`).join('')}</div></div>
      </div>
      ` : ''}

      <div class="section-divider"></div>
      ${metricsHtml}
      ${followupBlock}


    </div></div>
  `;

  initCollapsiblePanels(drawer);
  initCollapsibleSections(drawer);
  applyCollapsedKeys();
}


function closeDetail() {
  selectedGeneration = null;
  saveResearchState();
  const drawer = document.getElementById('detail-drawer');
  if (drawer) drawer.style.display = 'none';
}

async function regenReflection(generation) {
  if (!activeSessionId) return;

  const btn = document.getElementById('btn-regen-reflection');
  const contentEl = document.getElementById('ai-analysis-content');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing...'; }
  if (contentEl) {
    contentEl.style.borderLeftColor = '#6366f1';
    contentEl.textContent = 'Regenerating reflection with current model...';
  }

  let storedSettings = {};
  try { storedSettings = JSON.parse(localStorage.getItem('copilotSettings') || '{}'); } catch(e) {}
  const model = storedSettings.researchAnalystModel || undefined;

  try {
    const res = await fetch(`${API}/sessions/${activeSessionId}/reflect/${generation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error || 'Failed');

    const entry = currentGenome.find(e => e.generation === generation);
    if (entry) {
      entry.reflection = payload.data.reflection;
      if (payload.data.param_changes) entry.suggested_params = payload.data.param_changes;
    }

    if (contentEl) {
      contentEl.style.borderLeftColor = '#f59e0b';
      contentEl.textContent = payload.data.reflection;
    }

    // Re-render detail to show updated mandated params badge
    if (entry) renderGenerationDetail(entry);
  } catch (err) {
    if (contentEl) {
      contentEl.style.borderLeftColor = '#e05c5c';
      contentEl.textContent = err.message.includes('404')
        ? 'Session no longer exists on server (lost after restart). Start a new session to use this feature.'
        : `Reflection failed: ${err.message}`;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Regenerate'; }
  }
}

async function requestInterpretation(generation) {
  if (!activeSessionId) return;

  const btn = document.getElementById('btn-interpret');
  const contentEl = document.getElementById('ai-analysis-content');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing...'; }
  if (contentEl) {
    contentEl.style.borderLeftColor = '#6366f1';
    contentEl.textContent = 'Asking AI to analyze these results...';
  }

  let storedSettings = {};
  try { storedSettings = JSON.parse(localStorage.getItem('copilotSettings') || '{}'); } catch(e) {}
  const model = storedSettings.researchAnalystModel || undefined;

  try {
    const res = await fetch(`${API}/sessions/${activeSessionId}/interpret/${generation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error || 'Analysis failed');

    const entry = currentGenome.find(e => e.generation === generation);
    if (entry) entry.interpretation = payload.data.interpretation;

    if (contentEl) {
      contentEl.style.borderLeftColor = '#10b981';
      contentEl.textContent = payload.data.interpretation;
    }
  } catch (err) {
    if (contentEl) {
      contentEl.style.borderLeftColor = '#e05c5c';
      contentEl.textContent = err.message.includes('404')
        ? 'Session no longer exists on server. Start a new session to use this feature.'
        : `Analysis failed: ${err.message}`;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Analyze with AI'; }
  }
}

async function submitFollowUp(generation) {
  if (!activeSessionId) return;

  const inputEl = document.getElementById('interpret-followup-input');
  const listEl = document.getElementById('interpret-followup-list');
  const contentEl = document.getElementById('ai-analysis-content');
  const btn = document.getElementById('btn-followup-ask');

  const question = inputEl?.value?.trim();
  if (!question) return;

  const key = `${activeSessionId}-${generation}`;
  let conversation = interpretConversation.get(key) || [];
  const initialInterpretation = contentEl?.textContent?.trim() || '';

  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  if (inputEl) inputEl.value = '';

  // Append user message to list immediately
  conversation.push({ role: 'user', content: question });
  interpretConversation.set(key, conversation);
  const userHtml = `<div style="background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);padding:var(--space-8) var(--space-12);margin-bottom:var(--space-8);font-size:var(--text-small);"><strong style="color:var(--color-text-muted);font-size:10px;">You</strong><div style="margin-top:4px;">${escHtml(question)}</div></div>`;
  if (listEl) listEl.insertAdjacentHTML('beforeend', userHtml);

  let storedSettings = {};
  try { storedSettings = JSON.parse(localStorage.getItem('copilotSettings') || '{}'); } catch (e) {}

  try {
    const res = await fetch(`${API}/sessions/${activeSessionId}/interpret/${generation}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        initial_interpretation: initialInterpretation,
        conversation: conversation.slice(0, -1), // history without the one we just added
        model: storedSettings.researchAnalystModel,
      }),
    });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error || 'Failed');

    const answer = payload.data.answer;
    conversation.push({ role: 'assistant', content: answer });
    interpretConversation.set(key, conversation);

    const answerHtml = `<div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);border-left:3px solid #10b981;border-radius:var(--radius);padding:var(--space-8) var(--space-12);margin-bottom:var(--space-8);font-size:var(--text-small);white-space:pre-wrap;"><strong style="color:var(--color-text-muted);font-size:10px;">AI</strong><div style="margin-top:4px;">${escHtml(answer)}</div></div>`;
    if (listEl) listEl.insertAdjacentHTML('beforeend', answerHtml);
  } catch (err) {
    conversation.pop(); // remove the user message we added so they can retry
    interpretConversation.set(key, conversation);
    const lastDiv = listEl?.lastElementChild;
    if (lastDiv) lastDiv.insertAdjacentHTML('afterend', `<div style="color:#e05c5c;font-size:var(--text-small);margin-bottom:var(--space-8);">${escHtml(err.message)}</div>`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Ask'; }
  }
}

// ─── Live update helpers ──────────────────────────────────────────────────────

function updateLiveHypothesis(text) {
  const el = document.getElementById('live-hypothesis');
  if (!el) return;
  if (text) {
    el.classList.remove('empty');
    el.textContent = text;
  } else {
    el.classList.add('empty');
    el.textContent = 'Session complete.';
  }
}

function updateProgress(generation) {
  const session = sessions.find(s => s.session_id === activeSessionId);
  if (!session) return;
  const max = session.max_generations || 1;
  const pct = (generation / max) * 100;
  const bar = document.getElementById('gen-progress-bar');
  const label = document.getElementById('gen-progress-label');
  if (bar) bar.style.width = `${pct.toFixed(1)}%`;
  if (label) label.textContent = `${generation} of ${max} generations`;
  const genEl = document.getElementById('session-detail-gen');
  if (genEl) genEl.textContent = `${generation} / ${max}`;
  const testedEl = document.getElementById('session-detail-tested');
  if (testedEl) testedEl.textContent = `${currentGenome.length}`;
}

function updateBtProgress(stage, detail, pct) {
  const el = document.getElementById('bt-progress-label');
  if (el) el.textContent = detail ? `${stage}: ${truncate(detail, 40)}` : stage;
}

function appendLog(message, cls) {
  const el = document.getElementById('live-log');
  if (!el) return;
  const now = new Date().toTimeString().slice(0, 8);
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-ts">${now}</span><span class="log-msg ${cls}">${escHtml(message)}</span>`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
  // Keep only last 100 lines
  while (el.children.length > 100) el.removeChild(el.firstChild);
}

function addOrUpdateGenomeEntry(entry) {
  const existing = currentGenome.findIndex(e => e.generation === entry.generation);
  if (existing >= 0) currentGenome[existing] = entry;
  else currentGenome.push(entry);
}

// ─── Start session ────────────────────────────────────────────────────────────

async function startSession() {
  const name = document.getElementById('input-name').value.trim();
  if (!name) { alert('Please enter a session name.'); return; }

  let storedSettings = {};
  try { storedSettings = JSON.parse(localStorage.getItem('copilotSettings') || '{}'); } catch(e) {}

  // Build risk defaults from Settings for the research agent
  let riskDefaults = undefined;
  if (storedSettings.defaultStopType || storedSettings.defaultTakeProfitR || storedSettings.defaultMaxHold) {
    riskDefaults = {
      defaultStopType: storedSettings.defaultStopType || 'atr_multiple',
      defaultStopValue: storedSettings.defaultStopValue || '2.0',
      defaultStopBuffer: storedSettings.defaultStopBuffer || '2',
      minRR: storedSettings.minRR || '1.5',
      defaultTakeProfitR: storedSettings.defaultTakeProfitR || '2.0',
      defaultMaxHold: storedSettings.defaultMaxHold || '30',
      defaultBreakevenR: storedSettings.defaultBreakevenR || '1.0',
      defaultTrailingType: storedSettings.defaultTrailingType || 'none',
      defaultTrailingValue: storedSettings.defaultTrailingValue || '2.0',
      riskPercent: storedSettings.riskPercent || '2',
    };
  }

  const mode = document.getElementById('input-mode')?.value || 'strategy_discovery';
  const config = {
    name,
    max_generations: parseInt(document.getElementById('input-gens').value, 10) || 5,
    target_interval: document.getElementById('input-interval').value,
    target_asset_class: document.getElementById('input-asset').value,
    seed_hypothesis: document.getElementById('input-seed').value.trim() || undefined,
    promotion_min_fitness: parseFloat(document.getElementById('input-threshold').value) || 0.6,
    promotion_requires_pass: true,
    allow_new_primitives: document.getElementById('input-allow-primitives').checked,
    hypothesis_model: storedSettings.researchStrategistModel || undefined,
    reflection_model: storedSettings.researchAnalystModel || undefined,
    risk_defaults: riskDefaults,
    mode,
  };
  if (mode === 'symbolic_regression') {
    const features = [];
    document.querySelectorAll('.sr-feat-check:checked').forEach(cb => {
      const fid = cb.dataset.feat;
      const periodEl = document.querySelector(`.sr-feat-period[data-feat="${fid}"]`);
      const entry = { id: fid };
      if (periodEl) entry.period = parseInt(periodEl.value, 10) || undefined;
      features.push(entry);
    });
    config.sr_config = {
      symbol: document.getElementById('input-sr-symbol')?.value?.trim() || 'SPY',
      interval: document.getElementById('input-sr-interval')?.value || '1d',
      years: parseFloat(document.getElementById('input-sr-years')?.value) || 2,
      target_bars: parseInt(document.getElementById('input-sr-target-bars')?.value, 10) || 5,
      population_size: parseInt(document.getElementById('input-sr-population')?.value, 10) || 500,
      generations: parseInt(document.getElementById('input-sr-gens')?.value, 10) || 20,
      features: features.length > 0 ? features : undefined,
    };
  }

  const btn = document.getElementById('btn-start');
  btn.disabled = true;
  btn.textContent = 'Starting...';

  try {
    const res = await fetch(`${API}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error || 'Failed');

    sessions.unshift(payload.data);
    renderSessionList();
    await selectSession(payload.data.session_id);

    // Reset form
    document.getElementById('input-name').value = '';
    document.getElementById('input-seed').value = '';
  } catch (err) {
    alert(`Failed to start session: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start Session';
  }
}

// ─── Stop session ─────────────────────────────────────────────────────────────

async function stopCurrentSession() {
  if (!activeSessionId) return;
  if (!confirm('Stop this session?')) return;
  try {
    await fetch(`${API}/sessions/${activeSessionId}/stop`, { method: 'POST' });
    const session = sessions.find(s => s.session_id === activeSessionId);
    if (session) session.status = 'stopped';
    renderSessionList();
  } catch (err) {
    alert(`Failed to stop: ${err.message}`);
  }
}

// ─── Manual promotion ─────────────────────────────────────────────────────────

async function manualPromote(generation) {
  if (!activeSessionId) return;
  const entry = currentGenome.find(e => e.generation === generation);
  const isFormulaEntry = entry && (entry.formula_id || entry.formula_readable != null || entry.formula != null);
  const targetTier = isFormulaEntry ? 'Tier-1' : 'Tier-2';
  if (!confirm(`Promote generation ${generation} to ${targetTier} backtesting?`)) return;
  try {
    const res = await fetch(`${API}/sessions/${activeSessionId}/promote/${generation}`, { method: 'POST' });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error);
    if (entry) {
      entry.verdict = 'promoted';
      renderLeaderboard();
      if (selectedGeneration === generation) showDetail(generation);
    }
  } catch (err) {
    alert(`Promotion failed: ${err.message}`);
  }
}

// ─── Delete / Archive / Unarchive ─────────────────────────────────────────────

async function continueSessionFrom(sessionId) {
  try {
    const res = await fetch(`${API}/sessions/${sessionId}/continue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error || 'Failed');
    await loadSessions();
    selectSession(payload.data.session_id);
  } catch (err) {
    alert(`Rerun failed: ${err.message}`);
  }
}

async function deleteSessionConfirm(sessionId, name) {
  if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
  try {
    const res = await fetch(`${API}/sessions/${sessionId}`, { method: 'DELETE' });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error);
    sessions = sessions.filter(s => s.session_id !== sessionId);
    if (activeSessionId === sessionId) {
      activeSessionId = null;
      selectedGeneration = null;
      saveResearchState();
      document.getElementById('research-main').innerHTML = '<div class="empty-state"><div class="empty-state-sub">Select a session from the sidebar.</div></div>';
    }
    renderSessionList();
  } catch (err) {
    alert(`Delete failed: ${err.message}`);
  }
}

async function archiveSession(sessionId) {
  try {
    const res = await fetch(`${API}/sessions/${sessionId}/archive`, { method: 'POST' });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error);
    const session = sessions.find(s => s.session_id === sessionId);
    if (session) session.archived = true;
    renderSessionList();
  } catch (err) {
    alert(`Archive failed: ${err.message}`);
  }
}

async function unarchiveSession(sessionId) {
  try {
    const res = await fetch(`${API}/sessions/${sessionId}/unarchive`, { method: 'POST' });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error);
    const session = sessions.find(s => s.session_id === sessionId);
    if (session) session.archived = false;
    renderSessionList();
  } catch (err) {
    alert(`Unarchive failed: ${err.message}`);
  }
}

function toggleShowArchived(checked) {
  showArchived = checked;
  saveResearchState();
  renderSessionList();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

const RESEARCH_LEGACY_CONTINUED_SUFFIX_RE = /(\s*\(continued\))+$/i;
const RESEARCH_VERSION_SUFFIX_RE = /\s+V(\d+)$/i;

function parseResearchSessionName(name) {
  const cleaned = String(name || '')
    .replace(RESEARCH_LEGACY_CONTINUED_SUFFIX_RE, '')
    .trim() || 'Untitled session';
  const match = cleaned.match(RESEARCH_VERSION_SUFFIX_RE);
  if (!match || match.index == null) {
    return { baseName: cleaned, version: null };
  }
  const version = parseInt(match[1], 10);
  return {
    baseName: cleaned.slice(0, match.index).trim() || 'Untitled session',
    version: Number.isFinite(version) && version > 0 ? version : null,
  };
}

function getResearchSessionBaseName(name) {
  return parseResearchSessionName(name).baseName;
}

function getResearchSessionRootId(sessionById, session) {
  let current = session;
  const seen = new Set();
  while (current?.config?.continued_from && !seen.has(current.session_id)) {
    seen.add(current.session_id);
    const parent = sessionById.get(current.config.continued_from);
    if (!parent) break;
    current = parent;
  }
  return current?.session_id || session.session_id;
}

function getResearchSessionDisplayNames() {
  const sessionById = new Map(sessions.map((session) => [session.session_id, session]));
  const grouped = new Map();

  sessions.forEach((session) => {
    const rootId = getResearchSessionRootId(sessionById, session);
    if (!grouped.has(rootId)) grouped.set(rootId, []);
    grouped.get(rootId).push(session);
  });

  const displayNames = new Map();
  grouped.forEach((group, rootId) => {
    group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const rootSession = sessionById.get(rootId) || group[0];
    const baseName = getResearchSessionBaseName(rootSession?.config?.name);
    group.forEach((session, index) => {
      const parsed = parseResearchSessionName(session.config?.name);
      const version = parsed.version || (index + 1);
      displayNames.set(session.session_id, `${baseName} V${version}`);
    });
  });

  return displayNames;
}

function fitnessColor(score) {
  if (score >= 0.7) return '#82c850';
  if (score >= 0.5) return '#50b478';
  if (score >= 0.3) return 'var(--color-accent)';
  if (score > 0)    return 'var(--color-text-muted)';
  return 'var(--color-text-subtle)';
}

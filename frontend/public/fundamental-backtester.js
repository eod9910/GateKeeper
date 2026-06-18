(function () {
  var STORAGE_KEY = 'fundamentalBacktester.savedConfigs';

  var METRICS = [
    ['price_drawdown_6m_pct', '6M drawdown %'],
    ['revenue_growth_yoy_pct', 'Revenue growth YoY %'],
    ['revenue_acceleration_qoq_pct', 'Revenue acceleration QoQ %'],
    ['eps_surprise_pct', 'EPS surprise %'],
    ['eps_surprise_age_days', 'EPS surprise age days'],
    ['sales_surprise_pct', 'Sales surprise %'],
    ['sales_surprise_age_days', 'Sales surprise age days'],
    ['dcf_gap_pct', 'DCF gap %'],
    ['dcf_state', 'DCF state'],
    ['valuation_gap_pct', 'Valuation gap %'],
    ['valuation_state', 'Valuation state'],
    ['quality_score', 'Quality score'],
    ['current_ratio', 'Current ratio'],
    ['net_debt_to_market_cap', 'Net debt / market cap'],
    ['market_cap', 'Market cap'],
    ['dollar_volume_20d', '20D dollar volume'],
    ['below_200d', 'Below 200D'],
    ['reverse_split_within_days', 'Reverse split within days']
  ];

  var OPS = ['>', '>=', '<', '<=', '=', '!=', 'between', 'is_true', 'is_false'];

  var PRESETS = {
    depressed_revenue_reacceleration_v1: {
      name: 'depressed_revenue_reacceleration_v1',
      universe: 'clean',
      as_of_start: '2021-01-01',
      as_of_end: '2025-12-31',
      rebalance_frequency: 'monthly',
      entry: {
        all: [
          { metric: 'price_drawdown_6m_pct', op: '<=', value: -50 },
          { metric: 'revenue_growth_yoy_pct', op: '>', value: 0 },
          { metric: 'revenue_acceleration_qoq_pct', op: '>', value: 0 },
          { metric: 'dollar_volume_20d', op: '>=', value: 1000000 }
        ]
      },
      exclusions: [
        { metric: 'reverse_split_within_days', op: '<=', value: 365 },
        { metric: 'current_ratio', op: '<', value: 0.5 },
        { metric: 'eps_surprise_age_days', op: '>', value: 75 }
      ],
      exit: {
        max_hold_days: 180,
        stop_loss_pct: -35,
        take_profit_ladder_pct: [50, 100, 200],
        trailing_stop_pct: 35
      },
      benchmark: 'SPY',
      result_mode: 'equal_weight',
      top_n_per_date: 0,
      max_symbols: 500
    },
    depressed_eps_surprise_v1: {
      name: 'depressed_eps_surprise_v1',
      universe: 'clean',
      as_of_start: '2016-08-01',
      as_of_end: '2025-12-31',
      rebalance_frequency: 'monthly',
      entry: {
        all: [
          { metric: 'price_drawdown_6m_pct', op: '<=', value: -50 },
          { metric: 'eps_surprise_pct', op: '>', value: 10 },
          { metric: 'dollar_volume_20d', op: '>=', value: 1000000 }
        ]
      },
      exclusions: [
        { metric: 'reverse_split_within_days', op: '<=', value: 365 },
        { metric: 'eps_surprise_age_days', op: '>', value: 75 }
      ],
      exit: {
        max_hold_days: 180,
        stop_loss_pct: -35,
        take_profit_ladder_pct: [50, 100, 200],
        trailing_stop_pct: 35
      },
      benchmark: 'SPY',
      result_mode: 'equal_weight',
      top_n_per_date: 0,
      max_symbols: 500
    },
    dcf_gap_plus_reacceleration_v1: {
      name: 'dcf_gap_plus_reacceleration_v1',
      universe: 'liquid_clean',
      as_of_start: '2021-01-01',
      as_of_end: '2025-12-31',
      rebalance_frequency: 'monthly',
      entry: {
        all: [
          { metric: 'dcf_gap_pct', op: '>=', value: 30 },
          { metric: 'revenue_acceleration_qoq_pct', op: '>', value: 0 },
          { metric: 'dollar_volume_20d', op: '>=', value: 1000000 }
        ]
      },
      exclusions: [
        { metric: 'net_debt_to_market_cap', op: '>', value: 5 },
        { metric: 'reverse_split_within_days', op: '<=', value: 365 }
      ],
      exit: {
        max_hold_days: 252,
        stop_loss_pct: -35,
        take_profit_ladder_pct: [50, 100, 200],
        trailing_stop_pct: 35
      },
      benchmark: 'SPY',
      result_mode: 'top_n',
      top_n_per_date: 20,
      max_symbols: 500
    }
  };

  var state = clone(PRESETS.depressed_revenue_reacceleration_v1);
  var pollTimer = null;
  var latestSnapshot = null;
  var savedRuns = [];

  function $(id) {
    return document.getElementById(id);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function parseNumberMaybe(value) {
    if (value === '' || value === null || typeof value === 'undefined') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : value;
  }

  function parseCsvNumbers(value) {
    return String(value || '')
      .split(',')
      .map(function (x) { return Number(String(x).trim()); })
      .filter(function (x) { return Number.isFinite(x); });
  }

  function metricOptions(selected) {
    return METRICS.map(function (m) {
      return '<option value="' + esc(m[0]) + '"' + (m[0] === selected ? ' selected' : '') + '>' + esc(m[1]) + '</option>';
    }).join('');
  }

  function metricLabel(metric) {
    var found = METRICS.find(function (m) { return m[0] === metric; });
    return found ? found[1] : String(metric || '-');
  }

  function formatRuleValue(value) {
    if (Array.isArray(value)) return value.join(' to ');
    if (value === null || typeof value === 'undefined' || value === '') return '-';
    var n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function formatRule(rule) {
    if (!rule) return '-';
    if (rule.op === 'is_true') return metricLabel(rule.metric) + ' is true';
    if (rule.op === 'is_false') return metricLabel(rule.metric) + ' is false';
    return metricLabel(rule.metric) + ' ' + (rule.op || '-') + ' ' + formatRuleValue(rule.value);
  }

  function testedRuleLines(config) {
    var cfg = config || state || {};
    var rules = ((cfg.entry && cfg.entry.all) || []);
    if (!rules.length) return ['No entry rules'];
    return rules.map(formatRule);
  }

  function summarizeTestedRules(config) {
    return testedRuleLines(config).join('\n');
  }

  function summarizeTestedRulesHtml(config) {
    return testedRuleLines(config).map(esc).join('<br>');
  }

  function summarizeSavedRunRules(run) {
    var lines = Array.isArray(run && run.tested_rules) ? run.tested_rules : testedRuleLines(run && run.config);
    return lines.length ? lines : ['No entry rules'];
  }

  function opOptions(selected) {
    return OPS.map(function (op) {
      return '<option value="' + esc(op) + '"' + (op === selected ? ' selected' : '') + '>' + esc(op) + '</option>';
    }).join('');
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderRuleRows(kind) {
    var host = $(kind === 'entry' ? 'fb-entry-rules' : 'fb-exclusion-rules');
    var rows = kind === 'entry' ? state.entry.all : state.exclusions;
    host.innerHTML = rows.map(function (rule, idx) {
      return [
        '<div class="fb-rule-row" data-kind="' + kind + '" data-index="' + idx + '">',
        '<div class="fb-field" data-rule-field="metric"><label class="fb-label">Metric</label><select class="fb-select" data-field="metric">', metricOptions(rule.metric), '</select></div>',
        '<div class="fb-field" data-rule-field="op"><label class="fb-label">Op</label><select class="fb-select" data-field="op">', opOptions(rule.op), '</select></div>',
        '<div class="fb-field" data-rule-field="value"><label class="fb-label">Value</label><input class="fb-input" data-field="value" type="text" value="', esc(rule.value), '"></div>',
        '<button class="fb-icon-btn" data-remove-rule title="Remove rule">-</button>',
        '</div>'
      ].join('');
    }).join('');

    host.querySelectorAll('[data-field]').forEach(function (el) {
      el.addEventListener('change', handleRuleChange);
      el.addEventListener('input', handleRuleChange);
    });
    host.querySelectorAll('[data-remove-rule]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = btn.closest('.fb-rule-row');
        var list = row.dataset.kind === 'entry' ? state.entry.all : state.exclusions;
        list.splice(Number(row.dataset.index), 1);
        renderAll();
      });
    });
  }

  function handleRuleChange(event) {
    var row = event.target.closest('.fb-rule-row');
    if (!row) return;
    var list = row.dataset.kind === 'entry' ? state.entry.all : state.exclusions;
    var rule = list[Number(row.dataset.index)];
    var field = event.target.dataset.field;
    rule[field] = field === 'value' ? parseNumberMaybe(event.target.value) : event.target.value;
    syncFormToState(false);
    renderJson();
  }

  function syncStateToForm() {
    $('fb-name').value = state.name || '';
    $('fb-universe').value = state.universe || 'clean';
    $('fb-start').value = state.as_of_start || '';
    $('fb-end').value = state.as_of_end || '';
    $('fb-rebalance').value = state.rebalance_frequency || 'monthly';
    $('fb-max-symbols').value = state.max_symbols || 500;
    $('fb-max-hold').value = state.exit?.max_hold_days ?? '';
    $('fb-top-n').value = state.top_n_per_date ?? 0;
    $('fb-stop').value = state.exit?.stop_loss_pct ?? '';
    $('fb-trailing').value = state.exit?.trailing_stop_pct ?? '';
    $('fb-take-profit').value = Array.isArray(state.exit?.take_profit_ladder_pct)
      ? state.exit.take_profit_ladder_pct.join(', ')
      : '';
    $('fb-benchmark').value = state.benchmark || 'SPY';
    $('fb-result-mode').value = state.result_mode || 'equal_weight';
  }

  function syncFormToState(includeRules) {
    state.name = $('fb-name').value.trim() || 'untitled_fundamental_rule';
    state.universe = $('fb-universe').value;
    state.as_of_start = $('fb-start').value;
    state.as_of_end = $('fb-end').value;
    state.rebalance_frequency = $('fb-rebalance').value;
    state.max_symbols = Number($('fb-max-symbols').value) || 0;
    state.benchmark = $('fb-benchmark').value.trim() || 'SPY';
    state.result_mode = $('fb-result-mode').value;
    state.top_n_per_date = Number($('fb-top-n').value) || 0;
    state.exit = {
      max_hold_days: Number($('fb-max-hold').value) || null,
      stop_loss_pct: parseNumberMaybe($('fb-stop').value),
      take_profit_ladder_pct: parseCsvNumbers($('fb-take-profit').value),
      trailing_stop_pct: parseNumberMaybe($('fb-trailing').value)
    };
    if (includeRules) {
      state.entry.all = collectRules('entry');
      state.exclusions = collectRules('exclusion');
    }
  }

  function collectRules(kind) {
    var host = $(kind === 'entry' ? 'fb-entry-rules' : 'fb-exclusion-rules');
    return Array.from(host.querySelectorAll('.fb-rule-row')).map(function (row) {
      return {
        metric: row.querySelector('[data-field="metric"]').value,
        op: row.querySelector('[data-field="op"]').value,
        value: parseNumberMaybe(row.querySelector('[data-field="value"]').value)
      };
    });
  }

  function renderJson() {
    syncFormToState(false);
    $('fb-json').value = JSON.stringify(state, null, 2);
    $('fb-metric-entry').textContent = String(state.entry.all.length);
    $('fb-metric-exclusions').textContent = String(state.exclusions.length);
    $('fb-metric-hold').textContent = state.exit.max_hold_days ? String(state.exit.max_hold_days) + 'D' : '-';
    $('fb-metric-benchmark').textContent = state.benchmark || 'SPY';
  }

  function renderSaved() {
    var rows = loadSaved();
    var body = $('fb-saved-body');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="text-muted">No saved configs.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (row, idx) {
      var cfg = row.config || {};
      var count = ((cfg.entry && cfg.entry.all) || []).length + (cfg.exclusions || []).length;
      return [
        '<tr>',
        '<td>', esc(cfg.name || 'untitled'), '</td>',
        '<td>', esc(cfg.universe || '-'), '</td>',
        '<td>', esc(cfg.rebalance_frequency || '-'), '</td>',
        '<td>', count, '</td>',
        '<td>', esc(row.saved_at || '-'), '</td>',
        '<td><button class="fb-icon-btn" data-load-saved="', idx, '" title="Load saved config">&gt;</button></td>',
        '</tr>'
      ].join('');
    }).join('');
    body.querySelectorAll('[data-load-saved]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var saved = loadSaved()[Number(btn.dataset.loadSaved)];
        if (!saved) return;
        state = clone(saved.config);
        renderAll();
        setStatus('Loaded ' + state.name + '.');
      });
    });
  }

  function loadSaved() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveCurrent() {
    syncFormToState(true);
    var rows = loadSaved();
    rows.unshift({
      saved_at: new Date().toISOString(),
      config: clone(state)
    });
    rows = rows.slice(0, 25);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    renderSaved();
    setStatus('Saved ' + state.name + '.');
  }

  function setStatus(text) {
    $('fb-status').textContent = text || '';
  }

  function pct(value) {
    if (value === null || typeof value === 'undefined' || value === '') return '-';
    var n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return (n * 100).toFixed(1) + '%';
  }

  function num(value, digits) {
    if (value === null || typeof value === 'undefined' || value === '') return '-';
    var n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toLocaleString(undefined, {
      maximumFractionDigits: typeof digits === 'number' ? digits : 2
    });
  }

  function returnPct(value) {
    if (value === null || typeof value === 'undefined' || value === '') return '-';
    var n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toFixed(1) + '%';
  }

  function metricPct(value) {
    if (value === null || typeof value === 'undefined' || value === '') return '-';
    var n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toFixed(1) + '%';
  }

  function formatDateTime(value) {
    if (!value) return '-';
    var dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return dt.toLocaleString();
  }

  function savedRunSnapshot(run) {
    return {
      runtime: {
        running: false,
        last_exit_code: 0,
        last_message: '[FundamentalBacktester] Loaded saved research run.',
        last_error: null
      },
      summary: run && run.result,
      saved_run: run || null
    };
  }

  function sortRuns(rows) {
    var sort = ($('fb-run-sort') && $('fb-run-sort').value) || 'score';
    var getters = {
      score: function (r) { return Number(r.research_score || 0); },
      created: function (r) { return new Date(r.created_at || 0).getTime(); },
      median: function (r) { return Number(r.metrics && r.metrics.median_return_pct || 0); },
      average: function (r) { return Number(r.metrics && r.metrics.average_return_pct || 0); },
      win: function (r) { return Number(r.metrics && r.metrics.win_rate_pct || 0); },
      beat: function (r) { return Number(r.metrics && r.metrics.benchmark_beat_rate_pct || 0); },
      trades: function (r) { return Number(r.metrics && r.metrics.trade_count || 0); }
    };
    var getter = getters[sort] || getters.score;
    return rows.slice().sort(function (a, b) {
      var diff = getter(b) - getter(a);
      if (diff !== 0) return diff;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
  }

  function renderResearchRuns() {
    var body = $('fb-runs-body');
    if (!body) return;
    var rows = sortRuns(savedRuns);
    $('fb-run-count').textContent = rows.length + (rows.length === 1 ? ' run' : ' runs');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="11" class="text-muted">No saved research runs yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (run) {
      var metrics = run.metrics || {};
      var rules = summarizeSavedRunRules(run).map(esc).join('<br>');
      return [
        '<tr>',
        '<td><input type="checkbox" data-compare-run="', esc(run.id), '"></td>',
        '<td class="fb-score">', num(run.research_score, 1), '</td>',
        '<td>', esc(run.rule_name || '-'), '</td>',
        '<td class="fb-run-rules">', rules, '</td>',
        '<td>', num(metrics.trade_count, 0), '</td>',
        '<td>', metricPct(metrics.median_return_pct), '</td>',
        '<td>', metricPct(metrics.average_return_pct), '</td>',
        '<td>', metricPct(metrics.win_rate_pct), '</td>',
        '<td>', metricPct(metrics.benchmark_beat_rate_pct), '</td>',
        '<td>', esc(formatDateTime(run.created_at)), '</td>',
        '<td><button class="fb-action compact" data-view-run="', esc(run.id), '">View</button> ',
        '<button class="fb-action compact" data-reload-study="', esc(run.id), '" title="Reload this saved run into the study configuration">Reload Study</button> ',
        '<button class="fb-action compact" data-promote-sweep="', esc(run.id), '" title="Promote this research candidate into Parameter Sweep">Promote To Sweep</button></td>',
        '</tr>'
      ].join('');
    }).join('');

    body.querySelectorAll('[data-view-run]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var run = savedRuns.find(function (row) { return row.id === btn.dataset.viewRun; });
        if (!run) return;
        renderResults(savedRunSnapshot(run));
        setStatus('Viewed saved run ' + run.id + '.');
      });
    });
    body.querySelectorAll('[data-reload-study]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var run = savedRuns.find(function (row) { return row.id === btn.dataset.reloadStudy; });
        if (!run || !run.config) return;
        state = clone(run.config);
        renderAll();
        renderResults(savedRunSnapshot(run));
        setStatus('Reloaded saved run into the study configuration.');
      });
    });
    body.querySelectorAll('[data-promote-sweep]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var runId = btn.dataset.promoteSweep;
        if (!runId) return;
        btn.disabled = true;
        btn.textContent = 'Promoting...';
        fetch('/api/research/fundamental-backtest/runs/' + encodeURIComponent(runId) + '/promote-sweep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
          .then(function (res) { return res.json(); })
          .then(function (payload) {
            if (!payload.success) throw new Error(payload.error || 'Promotion failed.');
            var url = payload.data && payload.data.url;
            if (!url) throw new Error('Promotion did not return a Parameter Sweep URL.');
            window.location.href = url;
          })
          .catch(function (err) {
            btn.disabled = false;
            btn.textContent = 'Promote To Sweep';
            setStatus('Promote To Sweep failed: ' + (err.message || String(err)));
          });
      });
    });
  }

  function loadResearchRuns() {
    return fetch('/api/research/fundamental-backtest/runs?limit=100')
      .then(function (res) { return res.json(); })
      .then(function (payload) {
        if (!payload.success) throw new Error(payload.error || 'Saved runs request failed.');
        savedRuns = Array.isArray(payload.data) ? payload.data : [];
        renderResearchRuns();
        return savedRuns;
      })
      .catch(function (err) {
        var body = $('fb-runs-body');
        if (body) body.innerHTML = '<tr><td colspan="11" class="text-muted">' + esc(err.message || String(err)) + '</td></tr>';
      });
  }

  function selectedCompareIds() {
    return Array.from(document.querySelectorAll('[data-compare-run]:checked')).map(function (el) {
      return el.dataset.compareRun;
    }).filter(Boolean);
  }

  function buildComparisonText(rows) {
    if (!rows.length) return 'Select two or more saved runs to compare.';
    var lines = ['Fundamental Backtester Saved Run Comparison', ''];
    rows.forEach(function (run, idx) {
      var metrics = run.metrics || {};
      lines.push(String(idx + 1) + '. ' + (run.rule_name || '-'));
      lines.push('Saved run id: ' + (run.id || '-'));
      lines.push('Score: ' + num(run.research_score, 1));
      lines.push('Tested:');
      summarizeSavedRunRules(run).forEach(function (rule) { lines.push(rule); });
      lines.push('Trades: ' + num(metrics.trade_count, 0));
      lines.push('Win rate: ' + metricPct(metrics.win_rate_pct));
      lines.push('Average return: ' + metricPct(metrics.average_return_pct));
      lines.push('Median return: ' + metricPct(metrics.median_return_pct));
      lines.push('Average benchmark return: ' + metricPct(metrics.average_benchmark_return_pct));
      lines.push('Trades beating benchmark: ' + metricPct(metrics.benchmark_beat_rate_pct));
      lines.push('Outlier dependency: ' + metricPct(metrics.outlier_dependency_pct));
      lines.push('');
    });
    return lines.join('\n');
  }

  function compareSelectedRuns() {
    var ids = selectedCompareIds();
    var out = $('fb-compare-output');
    if (!out) return;
    if (ids.length < 2) {
      out.style.display = 'block';
      out.textContent = 'Select two or more saved runs to compare.';
      return;
    }
    fetch('/api/research/fundamental-backtest/runs/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids })
    })
      .then(function (res) { return res.json(); })
      .then(function (payload) {
        if (!payload.success) throw new Error(payload.error || 'Compare request failed.');
        out.style.display = 'block';
        out.textContent = buildComparisonText(Array.isArray(payload.data) ? payload.data : []);
      })
      .catch(function (err) {
        out.style.display = 'block';
        out.textContent = err.message || String(err);
      });
  }

  function renderResults(snapshot) {
    latestSnapshot = snapshot || null;
    var summary = snapshot && snapshot.summary;
    var runtime = snapshot && snapshot.runtime;
    var stats = summary && summary.summary;
    var savedRun = snapshot && snapshot.saved_run;
    var body = $('fb-results-body');
    if (!summary || !stats) {
      var emptyStatus = runtime && runtime.running ? 'Running' : 'No completed run';
      var testedConfig = runtime && runtime.last_config ? runtime.last_config : state;
      var pendingValue = runtime && runtime.running ? 'Pending' : '-';
      var benchmarkLabel = esc(testedConfig.benchmark || state.benchmark || 'SPY');
      var dateRange = esc(testedConfig.as_of_start || '-') + ' to ' + esc(testedConfig.as_of_end || '-');
      body.innerHTML = [
        runtime && runtime.running ? ['Run state', 'Backtest in progress', emptyStatus] : null,
        ['Tested', summarizeTestedRulesHtml(testedConfig), emptyStatus],
        ['Benchmark', benchmarkLabel, emptyStatus],
        ['Date range', dateRange, emptyStatus],
        ['Universe symbols', num(testedConfig.max_symbols, 0), emptyStatus],
        ['Data source', 'pit_fundamental_facts', emptyStatus],
        ['Trade count', pendingValue, emptyStatus],
        ['Win rate', pendingValue, emptyStatus],
        ['Average return', pendingValue, emptyStatus],
        ['Median return', pendingValue, emptyStatus],
        ['Average ' + benchmarkLabel + ' return over same windows', pendingValue, emptyStatus],
        ['Trades beating ' + benchmarkLabel, pendingValue, emptyStatus],
        ['Outlier dependency', pendingValue, emptyStatus]
      ].filter(Boolean).map(function (row) {
        return '<tr><td>' + row[0] + '</td><td>' + row[1] + '</td><td>' + row[2] + '</td></tr>';
      }).join('');
      return;
    }
    var status = runtime && runtime.last_exit_code === 0 ? 'Complete' : (runtime && runtime.running ? 'Running' : 'Last run');
    var testedConfig = summary.config || state;
    var noTrades = Number(stats.trade_count || 0) === 0;
    var skipped = summary.skipped || {};
    var resultRows = [
      savedRun ? ['Saved run id', esc(savedRun.id || '-'), status] : null,
      savedRun ? ['Research score', esc(num(savedRun.research_score, 1)), status] : null,
      noTrades ? ['Run result', 'No trades matched', status] : null,
      ['Tested', summarizeTestedRulesHtml(testedConfig), status],
      ['Data source', esc(summary.data_source || '-'), status],
      ['Snapshot range', esc((summary.available_snapshot_range && summary.available_snapshot_range.start) || '-') + ' to ' + esc((summary.available_snapshot_range && summary.available_snapshot_range.end) || '-'), status],
      ['Universe symbols', num(summary.universe_symbol_count, 0), status],
      ['PIT snapshots', num(summary.snapshot_count, 0), status],
      ['Candidates', num(summary.candidate_count, 0), status],
      noTrades ? ['Entry-rule rejects', num(skipped.entry_rules, 0), status] : null,
      noTrades ? ['Exclusion rejects', num(skipped.exclusions, 0), status] : null,
      noTrades && Number(skipped.valuation_missing || 0) > 0 ? ['Missing valuation observations', num(skipped.valuation_missing, 0), status] : null,
      ['Trade count', num(stats.trade_count, 0), status],
      ['Win rate', noTrades ? 'No trades' : pct(stats.win_rate), status],
      ['Average return', noTrades ? 'No trades' : returnPct(stats.avg_return_pct), status],
      ['Median return', noTrades ? 'No trades' : returnPct(stats.median_return_pct), status],
      ['Average ' + esc(stats.benchmark || 'SPY') + ' return over same windows', noTrades ? 'No trades' : returnPct(stats.avg_benchmark_return_pct), status],
      ['Trades beating ' + esc(stats.benchmark || 'SPY'), noTrades ? 'No trades' : pct(stats.beat_benchmark_rate), status],
      ['Outlier dependency', noTrades ? 'No trades' : pct(stats.outlier_dependency), status]
    ];
    body.innerHTML = [
      resultRows
    ].flat().filter(Boolean).map(function (row) {
      return '<tr><td>' + row[0] + '</td><td>' + row[1] + '</td><td>' + row[2] + '</td></tr>';
    }).join('');
  }

  function buildResultsText() {
    syncFormToState(false);
    var lines = [
      'Fundamental Backtester Results',
      'Rule: ' + (state.name || '-'),
      'Universe: ' + (state.universe || '-'),
      'Date range: ' + (state.as_of_start || '-') + ' to ' + (state.as_of_end || '-'),
      'Rebalance: ' + (state.rebalance_frequency || '-'),
      'Benchmark: ' + (state.benchmark || 'SPY'),
      'Max symbols: ' + (state.max_symbols || 0),
      'Tested:',
      summarizeTestedRules(state),
      ''
    ];
    var savedRun = latestSnapshot && latestSnapshot.saved_run;
    if (savedRun) {
      lines.splice(1, 0, 'Saved run id: ' + (savedRun.id || '-'));
      lines.splice(2, 0, 'Research score: ' + num(savedRun.research_score, 1));
    }
    var rows = Array.prototype.slice.call(document.querySelectorAll('#fb-results-body tr'));
    if (!rows.length) {
      lines.push('No result rows available.');
      return lines.join('\n');
    }
    rows.forEach(function (row) {
      var cells = Array.prototype.slice.call(row.querySelectorAll('td')).map(function (cell) {
        return cell.textContent.trim();
      });
      if (cells.length >= 3) {
        if (cells[0] === 'Tested') return;
        lines.push(cells[0] + ': ' + cells[1] + ' (' + cells[2] + ')');
      }
    });
    var runtime = latestSnapshot && latestSnapshot.runtime;
    if (runtime && runtime.last_message) {
      lines.push('', 'Runner: ' + runtime.last_message);
    }
    return lines.join('\n');
  }

  function applyRunSnapshot(snapshot) {
    var runtime = snapshot && snapshot.runtime;
    var message = (runtime && runtime.last_message) || 'Waiting for runner.';
    if (runtime && runtime.running && message === 'Waiting for runner.') {
      message = '[FundamentalBacktester] Running PIT fundamental backtest...';
    }
    $('fb-run-status').textContent = message;
    $('fb-run').disabled = !!(runtime && runtime.running);
    renderResults(snapshot);
    if (runtime && runtime.last_error) setStatus(runtime.last_error);
    if (runtime && !runtime.running && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
      loadResearchRuns();
    }
  }

  function fetchStatus() {
    return fetch('/api/research/fundamental-backtest')
      .then(function (res) { return res.json(); })
      .then(function (payload) {
        if (!payload.success) throw new Error(payload.error || 'Status request failed.');
        applyRunSnapshot(payload.data);
        return payload.data;
      });
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      fetchStatus().catch(function (err) {
        $('fb-run-status').textContent = err.message || String(err);
      });
    }, 1500);
  }

  function runBacktest() {
    syncFormToState(true);
    renderJson();
    $('fb-run-status').textContent = 'Starting fundamental backtest...';
    $('fb-run').disabled = true;
    setStatus('Running ' + state.name + '.');
    fetch('/api/research/fundamental-backtest/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    })
      .then(function (res) { return res.json(); })
      .then(function (payload) {
        if (!payload.success) throw new Error(payload.error || 'Run request failed.');
        applyRunSnapshot(payload.data);
        startPolling();
      })
      .catch(function (err) {
        $('fb-run-status').textContent = err.message || String(err);
        setStatus(err.message || String(err));
      })
      .finally(function () {
        $('fb-run').disabled = false;
      });
  }

  function renderAll() {
    syncStateToForm();
    renderRuleRows('entry');
    renderRuleRows('exclusion');
    renderJson();
    renderSaved();
  }

  function loadFromJson() {
    try {
      var parsed = JSON.parse($('fb-json').value);
      if (!parsed || typeof parsed !== 'object') throw new Error('Config must be an object.');
      if (!parsed.entry || !Array.isArray(parsed.entry.all)) throw new Error('Config requires entry.all array.');
      if (!Array.isArray(parsed.exclusions)) parsed.exclusions = [];
      state = parsed;
      renderAll();
      setStatus('JSON applied.');
    } catch (err) {
      setStatus(err.message || String(err));
    }
  }

  function initPresets() {
    var preset = $('fb-preset');
    preset.innerHTML = Object.keys(PRESETS).map(function (key) {
      return '<option value="' + esc(key) + '">' + esc(key) + '</option>';
    }).join('');
    preset.value = 'depressed_revenue_reacceleration_v1';
    preset.addEventListener('change', function () {
      state = clone(PRESETS[preset.value]);
      renderAll();
      setStatus('Loaded preset.');
    });
  }

  function bindStaticControls() {
    [
      'fb-name', 'fb-universe', 'fb-start', 'fb-end', 'fb-rebalance', 'fb-max-symbols',
      'fb-max-hold', 'fb-top-n', 'fb-stop', 'fb-trailing',
      'fb-take-profit', 'fb-benchmark', 'fb-result-mode'
    ].forEach(function (id) {
      var el = $(id);
      el.addEventListener('input', renderJson);
      el.addEventListener('change', renderJson);
    });

    $('fb-add-entry').addEventListener('click', function () {
      state.entry.all.push({ metric: 'revenue_growth_yoy_pct', op: '>', value: 0 });
      renderAll();
    });
    $('fb-add-exclusion').addEventListener('click', function () {
      state.exclusions.push({ metric: 'reverse_split_within_days', op: '<=', value: 365 });
      renderAll();
    });
    $('fb-save').addEventListener('click', saveCurrent);
    $('fb-reset').addEventListener('click', function () {
      state = clone(PRESETS.depressed_revenue_reacceleration_v1);
      $('fb-preset').value = 'depressed_revenue_reacceleration_v1';
      renderAll();
      setStatus('Reset.');
    });
    $('fb-copy').addEventListener('click', function () {
      renderJson();
      navigator.clipboard.writeText($('fb-json').value).then(function () {
        setStatus('JSON copied.');
      }).catch(function () {
        setStatus('Clipboard unavailable.');
      });
    });
    $('fb-copy-results').addEventListener('click', function () {
      navigator.clipboard.writeText(buildResultsText()).then(function () {
        setStatus('Results copied.');
      }).catch(function () {
        setStatus('Clipboard unavailable.');
      });
    });
    $('fb-json').addEventListener('blur', loadFromJson);
    $('fb-run').addEventListener('click', runBacktest);
    $('fb-refresh-runs').addEventListener('click', loadResearchRuns);
    $('fb-run-sort').addEventListener('change', renderResearchRuns);
    $('fb-compare-runs').addEventListener('click', compareSelectedRuns);
  }

  document.addEventListener('DOMContentLoaded', function () {
    initPresets();
    bindStaticControls();
    renderAll();
    loadResearchRuns();
    fetchStatus().catch(function () {});
  });
})();

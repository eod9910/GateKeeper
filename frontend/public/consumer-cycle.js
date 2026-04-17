(function () {
  var summaryState = null;
  var monitorState = null;
  var CATEGORY_GROUPS = {
    highly_cyclical: [
      'motor_vehicles_parts',
      'furnishings_household_equipment',
      'recreational_goods_vehicles',
      'transportation_services',
      'other_durable_goods',
      'residential_investment',
      'business_equipment_investment'
    ],
    mildly_cyclical: [
      'clothing_footwear',
      'other_nondurable_goods',
      'food_service_accommodations',
      'other_services',
      'gas_energy_goods'
    ],
    stable: [
      'recreation_services',
      'food_beverages_home',
      'housing_utilities',
      'healthcare',
      'financial_services_insurance'
    ]
  };

  var CATEGORY_LABELS = {
    motor_vehicles_parts: 'Motor Vehicles & Parts',
    furnishings_household_equipment: 'Furnishings & Household Equipment',
    recreational_goods_vehicles: 'Recreational Goods & Vehicles',
    transportation_services: 'Transportation Services',
    other_durable_goods: 'Other Durable Goods',
    residential_investment: 'Residential Investment',
    business_equipment_investment: 'Business Equipment Investment',
    clothing_footwear: 'Clothing & Footwear',
    other_nondurable_goods: 'Other Nondurable Goods',
    food_service_accommodations: 'Food Service & Accommodations',
    other_services: 'Other Services',
    gas_energy_goods: 'Gasoline & Energy Goods',
    recreation_services: 'Recreation Services',
    food_beverages_home: 'Food & Beverages (Home)',
    housing_utilities: 'Housing & Utilities',
    healthcare: 'Health Care',
    financial_services_insurance: 'Financial Services & Insurance'
  };

  function $(id) {
    return document.getElementById(id);
  }

  function titleCase(value) {
    return String(value || '')
      .split('_')
      .filter(Boolean)
      .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); })
      .join(' ');
  }

  function fmtPct(value) {
    if (value == null || !isFinite(Number(value))) return '—';
    var num = Number(value);
    return (num >= 0 ? '+' : '') + num.toFixed(1) + '%';
  }

  function getFilters() {
    return {
      q: $('consumer-search').value.trim(),
      cycleBucket: $('consumer-sensitivity').value,
      spendClass: $('consumer-spend-class').value,
      category: $('consumer-bucket').value,
      profile: $('consumer-profile').value,
      preference: $('consumer-preference').value,
      optionableOnly: $('consumer-optionable').checked ? 'true' : '',
      limit: $('consumer-limit').value || '250'
    };
  }

  function toQuery(params) {
    var query = new URLSearchParams();
    Object.keys(params).forEach(function (key) {
      if (params[key]) query.set(key, params[key]);
    });
    return query.toString();
  }

  function renderKpis(data) {
    var el = $('consumer-kpis');
    el.innerHTML = [
      { label: 'Tradable Stocks', value: data.filteredCount, hint: 'Filtered rows from the tradable-stock default universe.' },
      { label: 'Slowdown Longs', value: data.preferInSlowdownCount, hint: 'Resilient names that are usually safer when the cycle cools.' },
      { label: 'Slowdown Avoids', value: data.avoidInSlowdownCount, hint: 'Cyclical pockets likely to weaken first as demand rolls over.' },
      { label: 'Highly Cyclical', value: data.highlyCyclicalCount, hint: 'The swingiest part of consumer demand, usually big-ticket and finance-sensitive.' },
      { label: 'Defensive', value: data.defensiveCount, hint: 'Healthcare, staples, and housing-utility style exposures.' },
      { label: 'Optionable', value: data.optionableCount, hint: 'Subset currently optionable inside the filtered universe.' }
    ].map(function (item) {
      return (
        '<div class="consumer-kpi">' +
          '<div class="consumer-kpi-label">' + item.label + '</div>' +
          '<div class="consumer-kpi-value">' + Number(item.value || 0).toLocaleString() + '</div>' +
          '<div class="consumer-kpi-hint">' + item.hint + '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderBucketChips(data) {
    var rows = data.byCategory || [];
    var counts = {};
    rows.forEach(function (row) {
      counts[row.key] = Number(row.count || 0);
    });

    [
      { id: 'consumer-group-highly', key: 'highly_cyclical', empty: 'No highly cyclical categories matched this filter set.' },
      { id: 'consumer-group-mildly', key: 'mildly_cyclical', empty: 'No mildly cyclical categories matched this filter set.' },
      { id: 'consumer-group-stable', key: 'stable', empty: 'No stable categories matched this filter set.' }
    ].forEach(function (group) {
      var el = $(group.id);
      if (!el) return;
      var keys = CATEGORY_GROUPS[group.key] || [];
      var chips = keys.map(function (key) {
          return (
            '<div class="consumer-chip">' +
              '<strong>' + (CATEGORY_LABELS[key] || titleCase(key)) + '</strong>' +
              '<span>' + Number(counts[key] || 0).toLocaleString() + ' symbols</span>' +
            '</div>'
          );
        });
      el.innerHTML = chips.length
        ? chips.join('')
        : '<div class="consumer-empty">' + group.empty + '</div>';
    });
  }

  function renderSpendClassChips(data) {
    var el = $('consumer-spend-classes');
    if (!el) return;
    var rows = data.bySpendClass || [];
    if (!rows.length) {
      el.innerHTML = '<div class="consumer-empty">No spend-class classifications matched this filter set yet.</div>';
      return;
    }
    el.innerHTML = rows.map(function (row) {
      return (
        '<div class="consumer-chip">' +
          '<strong>' + titleCase(row.key) + '</strong>' +
          '<span>' + Number(row.count || 0).toLocaleString() + ' symbols</span>' +
        '</div>'
      );
    }).join('');
  }

  function monitorStatusLabel(value) {
    return titleCase(value || 'unknown');
  }

  function renderMonitor(data) {
    monitorState = data;
    $('consumer-monitor-status').textContent = 'Official macro input: ' + (data.source || 'FRED');
    $('consumer-monitor-status-pill').className = 'monitor-status ' + (data.overallStatus || 'yellow');
    $('consumer-monitor-status-pill').textContent = monitorStatusLabel(data.overallStatus);
    $('consumer-monitor-title').textContent = 'Overall cyclical-demand regime: ' + monitorStatusLabel(data.overallStatus);
    $('consumer-monitor-copy').textContent = data.scoreHint || 'No score narrative available yet.';
    $('consumer-monitor-meta').textContent =
      'As of ' + (data.asOf || 'n/a') +
      ' · severity ' + Number(data.averageSeverity || 0).toFixed(2) +
      ' · primary weak buckets ' + Number(data.weakeningPrimaryCount || 0) +
      ' · total weak buckets ' + Number(data.weakeningTotalCount || 0);

    var rows = []
      .concat(data.cyclicalConsumerSeries || [])
      .concat(data.companionSeries || []);
    var container = $('consumer-monitor-series');
    if (!rows.length) {
      container.innerHTML = '<div class="consumer-empty">No macro series were available.</div>';
      return;
    }
    container.innerHTML = rows.map(function (row) {
      return (
        '<div class="monitor-card">' +
          '<div class="monitor-card-title">' +
            '<span>' + row.label + '</span>' +
            '<span class="monitor-status ' + row.status + '">' + monitorStatusLabel(row.status) + '</span>' +
          '</div>' +
          '<div class="monitor-card-copy">' + (row.description || '') + '</div>' +
          '<div class="monitor-metrics">' +
            '<div class="monitor-metric">' +
              '<span class="monitor-metric-label">YoY</span>' +
              '<span class="monitor-metric-value">' + fmtPct(row.yoyPct) + '</span>' +
            '</div>' +
            '<div class="monitor-metric">' +
              '<span class="monitor-metric-label">QoQ Ann.</span>' +
              '<span class="monitor-metric-value">' + fmtPct(row.qoqAnnualizedPct) + '</span>' +
            '</div>' +
            '<div class="monitor-metric">' +
              '<span class="monitor-metric-label">2Q Trend</span>' +
              '<span class="monitor-metric-value">' + fmtPct(row.twoQuarterPct) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderTable(data) {
    var body = $('consumer-table-body');
    var rows = data.rows || [];
    $('consumer-table-status').textContent = rows.length
      ? ('Showing ' + rows.length.toLocaleString() + ' of ' + Number(data.total || 0).toLocaleString() + ' matching symbols')
      : 'No matching symbols';
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" class="consumer-empty">No symbols matched this filter set.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (row) {
      return (
        '<tr>' +
          '<td><code>' + (row.symbol || '') + '</code></td>' +
          '<td>' + (row.name || '—') + '</td>' +
          '<td><span class="consumer-badge">' + titleCase(row.consumerCycleBucket || 'unknown') + '</span></td>' +
          '<td><span class="consumer-badge">' + titleCase(row.consumerSpendingCategory || 'unknown') + '</span></td>' +
          '<td><span class="consumer-badge">' + titleCase(row.consumerSpendClass || 'unknown') + '</span></td>' +
          '<td>' + titleCase(row.recessionProfile || 'unknown') + '</td>' +
          '<td>' + titleCase(row.macroRegimePreference || 'unknown') + '</td>' +
          '<td>' + (row.optionable ? 'Yes' : 'No') + '</td>' +
          '<td>' + titleCase(row.classificationSource || 'name_rule') +
            (row.classificationConfidence != null ? (' · ' + Math.round(Number(row.classificationConfidence) * 100) + '%') : '') +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function fillSelect(selectId, rows, currentValue) {
    var select = $(selectId);
    var current = currentValue || select.value || '';
    var options = ['<option value="">All</option>'];
    (rows || []).forEach(function (row) {
      options.push('<option value="' + row.key + '">' + titleCase(row.key) + ' (' + row.count + ')</option>');
    });
    select.innerHTML = options.join('');
    select.value = current;
  }

  function updateStatus(message) {
    $('consumer-filter-status').textContent = message;
  }

  function persistState() {
    if (!window.AppState || !window.AppState.save) return;
    window.AppState.save(getFilters());
  }

  function restoreState() {
    if (!window.AppState || !window.AppState.restore) return;
    var saved = window.AppState.restore();
    if (!saved) return;
    $('consumer-search').value = saved.q || '';
    $('consumer-sensitivity').value = saved.cycleBucket || '';
    if ($('consumer-spend-class')) $('consumer-spend-class').value = saved.spendClass || '';
    $('consumer-bucket').value = saved.category || '';
    $('consumer-profile').value = saved.profile || '';
    $('consumer-preference').value = saved.preference || '';
    $('consumer-limit').value = saved.limit || '250';
    $('consumer-optionable').checked = String(saved.optionableOnly || '') === 'true';
  }

  async function refresh() {
    var filters = getFilters();
    persistState();
    updateStatus('Refreshing consumer-cycle map…');
    try {
      var summaryQuery = toQuery(filters);
      var symbolsQuery = toQuery(filters);
      var results = await Promise.all([
        fetch('/api/consumer-cycle/monitor'),
        fetch('/api/consumer-cycle/summary' + (summaryQuery ? ('?' + summaryQuery) : '')),
        fetch('/api/consumer-cycle/symbols' + (symbolsQuery ? ('?' + symbolsQuery) : ''))
      ]);
      var monitorPayload = await results[0].json();
      var summaryPayload = await results[1].json();
      var symbolsPayload = await results[2].json();
      if (!monitorPayload.success) throw new Error(monitorPayload.error || 'Failed to load monitor');
      if (!summaryPayload.success) throw new Error(summaryPayload.error || 'Failed to load summary');
      if (!symbolsPayload.success) throw new Error(symbolsPayload.error || 'Failed to load symbols');
      renderMonitor(monitorPayload.data);
      summaryState = summaryPayload.data;
      renderKpis(summaryPayload.data);
      renderSpendClassChips(summaryPayload.data);
      renderBucketChips(summaryPayload.data);
      fillSelect('consumer-sensitivity', summaryPayload.data.byCycleBucket, filters.cycleBucket);
      fillSelect('consumer-spend-class', summaryPayload.data.bySpendClass, filters.spendClass);
      fillSelect('consumer-bucket', summaryPayload.data.byCategory, filters.category);
      fillSelect('consumer-profile', summaryPayload.data.byProfile, filters.profile);
      fillSelect('consumer-preference', summaryPayload.data.byPreference, filters.preference);
      renderTable(symbolsPayload.data);
      updateStatus('Using tradable-stock default universe (' + Number(summaryPayload.data.totalTradableStocks || 0).toLocaleString() + ' symbols) with consumer-cycle classifications.');
    } catch (error) {
      updateStatus((error && error.message) || 'Failed to load consumer-cycle page.');
      $('consumer-monitor-status').textContent = (error && error.message) || 'Failed to load macro monitor.';
      $('consumer-monitor-status-pill').className = 'monitor-status red';
      $('consumer-monitor-status-pill').textContent = 'Offline';
      $('consumer-monitor-title').textContent = 'Cyclical-demand monitor unavailable';
      $('consumer-monitor-copy').textContent = 'The macro series could not be loaded right now.';
      $('consumer-monitor-meta').textContent = '';
      $('consumer-monitor-series').innerHTML = '<div class="consumer-empty">Failed to load macro series.</div>';
      if ($('consumer-spend-classes')) $('consumer-spend-classes').innerHTML = '<div class="consumer-empty">Failed to load spend classes.</div>';
      ['consumer-group-highly', 'consumer-group-mildly', 'consumer-group-stable'].forEach(function (id) {
        if ($(id)) $(id).innerHTML = '<div class="consumer-empty">Failed to load categories.</div>';
      });
      $('consumer-table-body').innerHTML = '<tr><td colspan="9" class="consumer-empty">Failed to load consumer-cycle data.</td></tr>';
    }
  }

  function wire() {
    [
      'consumer-spend-class',
      'consumer-bucket',
      'consumer-sensitivity',
      'consumer-profile',
      'consumer-preference',
      'consumer-limit',
      'consumer-optionable'
    ].forEach(function (id) {
      $(id).addEventListener('change', refresh);
    });
    $('consumer-search').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') refresh();
    });
    $('consumer-refresh').addEventListener('click', refresh);
  }

  document.addEventListener('DOMContentLoaded', function () {
    restoreState();
    wire();
    refresh();
  });
})();

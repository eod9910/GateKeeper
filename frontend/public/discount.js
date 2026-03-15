// =========================================================================
// discount.js — Discount zone scanner, candidate display, entry gate
// =========================================================================

let discountCandidates = [];

async function fetchDiscountCandidates() {
  try {
    const res = await fetch(`${API_URL}/api/candidates/discount`);
    const data = await res.json();
    return data.success ? (data.data || []) : [];
  } catch (err) {
    console.error('Failed to fetch discount candidates:', err);
    return [];
  }
}

async function loadDiscountCandidates() {
  try {
    const res = await fetch(`${API_URL}/api/candidates/discount`);
    const data = await res.json();
    if (data.success) {
      discountCandidates = data.data || [];
      displayDiscountResults(discountCandidates);
    }
  } catch (err) {
    console.error('Failed to load discount candidates:', err);
  }
}

function displayDiscountResults(candidates) {
  const panel = document.getElementById('discount-results-panel');
  const tbody = document.getElementById('discount-results-body');
  const countEl = document.getElementById('discount-count');

  if (!candidates || candidates.length === 0) { panel.classList.add('hidden'); return; }

  panel.classList.remove('hidden');
  countEl.textContent = `${candidates.length} results`;

  tbody.innerHTML = candidates.map((c, i) => {
    const tierClass = c.tier === 'SWEET_SPOT' ? 'tier-sweet-spot' : c.tier === 'DISCOUNT' ? 'tier-discount' : 'tier-deep-discount';
    const tierLabel = c.tier === 'SWEET_SPOT' ? 'Sweet Spot' : c.tier === 'DISCOUNT' ? 'Discount' : 'Deep';
    const energyColor = c.energy_state === 'EXHAUSTED' ? 'text-green-400' : c.energy_state === 'RECOVERING' ? 'text-green-300' : c.energy_state === 'WANING' ? 'text-yellow-400' : c.energy_state === 'STRONG' && c.energy_direction === 'DOWN' ? 'text-red-400' : 'text-gray-400';
    const pressureColor = c.selling_pressure < 30 ? 'text-green-400' : c.selling_pressure < 50 ? 'text-yellow-400' : 'text-red-400';

    let labelHtml = '';
    if (c.user_label === 'good') { labelHtml = '<span class="label-btn label-good label-set">GOOD</span>'; }
    else if (c.user_label === 'bad') { labelHtml = '<span class="label-btn label-bad label-set">BAD</span>'; }
    else {
      labelHtml = `<button class="label-btn label-good" onclick="event.stopPropagation(); labelDiscount('${c.symbol}', '${c.timeframe}', 'good')">Good</button>
        <button class="label-btn label-bad" onclick="event.stopPropagation(); labelDiscount('${c.symbol}', '${c.timeframe}', 'bad')">Bad</button>`;
    }

    let wyckoffHtml = '';
    if (c.wyckoff_count > 0) { wyckoffHtml = `<span class="wyckoff-badge wyckoff-found">${c.wyckoff_count} pattern${c.wyckoff_count > 1 ? 's' : ''}</span>`; }
    else if (c.wyckoff_count === 0) { wyckoffHtml = '<span class="text-gray-600">-</span>'; }
    else { wyckoffHtml = '<span class="text-gray-600">?</span>'; }

    return `<tr onclick="viewDiscountCandidate(${i})" title="Click to view chart" class="${c.wyckoff_count > 0 ? 'wyckoff-confirmed' : ''}">
      <td class="px-3 py-2 text-gray-500">${i + 1}</td>
      <td class="px-3 py-2 font-bold text-white">${c.symbol}</td>
      <td class="px-3 py-2">$${c.current_price}</td>
      <td class="px-3 py-2">${c.retracement}%</td>
      <td class="px-3 py-2"><span class="tier-badge ${tierClass}">${tierLabel}</span></td>
      <td class="px-3 py-2 ${energyColor}">${c.energy_state}</td>
      <td class="px-3 py-2 ${pressureColor}">${c.selling_pressure}/100 ${c.pressure_trend}</td>
      <td class="px-3 py-2 font-bold">${c.rank_score}</td>
      <td class="px-3 py-2">${wyckoffHtml}</td>
      <td class="px-3 py-2">${labelHtml}</td>
      <td class="px-3 py-2">
        <a href="copilot.html?symbol=${c.symbol}&interval=1wk" onclick="event.stopPropagation()" class="text-blue-400 hover:text-blue-300 text-xs underline" target="_blank">Trading Desk</a>
      </td>
    </tr>`;
  }).join('');
}

function viewDiscountCandidate(index) {
  const c = discountCandidates[index];
  if (!c) return;

  const chartTitle = document.getElementById('chart-title');
  const chartSymbol = document.getElementById('chart-symbol');
  if (chartTitle) chartTitle.textContent = 'Discount Zone';
  if (chartSymbol) chartSymbol.textContent = `${c.symbol} (${c.timeframe}) \u2014 ${c.tier} ${c.retracement}%`;

  const rows = document.querySelectorAll('#discount-results-body tr');
  rows.forEach(r => r.classList.remove('selected'));
  if (rows[index]) rows[index].classList.add('selected');

  const symbolInput = document.getElementById('symbol-input');
  if (symbolInput) symbolInput.value = c.symbol;

  if (c.chart_data && c.chart_data.length > 0) {
    initPatternChart();
    const safeData = sanitizeChartData(c.chart_data);
    if (safeData.length === 0) return;
    try { patternSeries.setData(safeData); } catch (e) { console.warn('Chart setData error:', e.message); return; }

    const timeSet = new Set(safeData.map(b => b.time));
    if (c.swing_points && c.swing_points.length > 0) {
      const markers = c.swing_points.filter(sp => timeSet.has(sp.time)).map(sp => ({
        time: sp.time,
        position: sp.type === 'HIGH' ? 'aboveBar' : 'belowBar',
        color: sp.type === 'HIGH' ? '#ef4444' : '#22c55e',
        shape: sp.type === 'HIGH' ? 'arrowDown' : 'arrowUp',
        text: sp.type === 'HIGH' ? 'H' : 'L'
      }));
      markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      try { setPatternMarkers(markers); } catch (e) { console.warn('setMarkers error:', e.message); }
    }

    if (c.fib_levels && c.fib_levels.length > 0) {
      for (const level of c.fib_levels) {
        patternSeries.createPriceLine({
          price: level.price, color: level.is_near ? '#fbbf24' : '#6b7280',
          lineWidth: level.is_near ? 2 : 1, lineStyle: 2,
          axisLabelVisible: true, title: level.level_name
        });
      }
    }

    patternChart.timeScale().fitContent();

    const statusEl = document.getElementById('scan-status');
    if (statusEl) { statusEl.textContent = `${c.symbol} \u2014 ${c.tier} (${c.retracement}% retrace) \u2014 Score: ${c.rank_score}/100`; }
  }
}

async function labelDiscount(symbol, timeframe, label) {
  try {
    const res = await fetch(`${API_URL}/api/candidates/discount-label`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, timeframe, label })
    });
    const data = await res.json();
    if (data.success) {
      const candidate = discountCandidates.find(c => c.symbol === symbol && c.timeframe === timeframe);
      if (candidate) { candidate.user_label = label; candidate.label_date = new Date().toISOString(); }
      displayDiscountResults(discountCandidates);
    }
  } catch (err) { console.error('Failed to label discount candidate:', err); }
}

async function clearDiscountCandidates() {
  if (!confirm('Clear all discount zone candidates?')) return;
  try {
    await fetch(`${API_URL}/api/candidates/discount`, { method: 'DELETE' });
    discountCandidates = [];
    displayDiscountResults([]);
  } catch (err) { console.error('Failed to clear discount candidates:', err); }
}

async function loadCorrectionChart(symbol, timeframe, candidateId) {
  if (!symbol) { alert('No symbol available for this correction'); return; }
  await loadSymbolIntoChart(symbol, timeframe, 'wyckoff');
}

async function loadLabelChart(candidateId, symbol, timeframe) {
  if (symbol) { await loadSymbolIntoChart(symbol, timeframe, 'wyckoff'); return; }
  if (candidateId) {
    try {
      const res = await fetch(`${API_URL}/api/candidates/${candidateId}`);
      const data = await res.json();
      if (data.success && data.data) {
        await loadSymbolIntoChart(data.data.symbol, data.data.timeframe || 'W', data.data.pattern_type || 'wyckoff');
        return;
      }
    } catch (e) { console.error('Failed to look up candidate:', e); }
  }
  alert('Could not determine symbol for this label');
}

async function loadSymbolIntoChart(symbol, timeframe, scanMode) {
  if (!symbol) return;
  const intervalMap = { 'W': '1wk', 'D': '1d', 'M': '1mo' };
  const interval = intervalMap[timeframe] || '1wk';

  showPage('scanner');
  swingReviewMode = false;
  swingReviewSymbols = [];
  swingReviewIndex = 0;

  const statusEl = document.getElementById('scan-status');
  if (statusEl) statusEl.textContent = `Loading ${symbol}...`;

  try {
    const res = await fetch(`${API_URL}/api/candidates/scan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, period: 'max', interval, timeframe, scanMode: scanMode || 'wyckoff' })
    });
    const data = await res.json();
    if (data.success && data.data) {
      const mode = scanMode || 'wyckoff';
      if (mode === 'swing') {
        const swingData = Array.isArray(data.data) ? data.data[0] : data.data;
        displaySwingStructure(swingData);
        if (statusEl) statusEl.textContent = `${symbol} - ${swingData?.swing_points?.length || 0} swing points`;
      } else {
        const fullCandidate = { symbol, timeframe, ...data.data };
        const existsIdx = candidates.findIndex(c => c.symbol === symbol && c.timeframe === timeframe);
        if (existsIdx < 0) { candidates.push(fullCandidate); currentIndex = candidates.length - 1; }
        else { candidates[existsIdx] = fullCandidate; currentIndex = existsIdx; }
        showCandidate(currentIndex);
        updateStats();
        document.getElementById('current-index').textContent = currentIndex + 1;
        document.getElementById('total-count').textContent = candidates.length;
        if (statusEl) statusEl.textContent = `Loaded ${symbol}`;
      }
    } else {
      if (statusEl) statusEl.textContent = `Failed to load ${symbol}`;
    }
  } catch (err) {
    console.error('Failed to load symbol chart:', err);
    if (statusEl) statusEl.textContent = `Error loading ${symbol}`;
  }
}

// ── Entry Gate (Behavioral Lock) ─────────────────────────────────────────

function updateEntryGate(candidate) {
  const gateEl = document.getElementById('entry-gate');
  const stateEl = document.getElementById('entry-gate-state');
  const detailsEl = document.getElementById('entry-gate-details');
  if (!gateEl || !stateEl || !detailsEl) return;

  if (candidate.pattern_type === 'chart_only') { gateEl.classList.add('entry-gate--hidden'); return; }

  gateEl.classList.remove('entry-gate--hidden');

  const retracePct = candidate.pullback?.retracement ? (candidate.pullback.retracement * 100).toFixed(1) : null;
  const impulseHigh = candidate.markup?.high || candidate.first_markup?.high || null;
  const pullbackLow = candidate.pullback?.low || candidate.pullback?.low_price || null;

  let gateClass = 'entry-gate--locked';
  let stateText = 'SYSTEM LOCKED';
  let detailsHTML = '';

  if (!retracePct || !impulseHigh || !pullbackLow) {
    gateClass = 'entry-gate--locked'; stateText = 'LOCKED';
    detailsHTML = '<div class="entry-gate-message">No impulse detected \u00B7 System waiting</div>';
  } else {
    const retrace = parseFloat(retracePct);
    if (retrace < 50) {
      gateClass = 'entry-gate--early'; stateText = 'TOO EARLY';
      const impulseRange = impulseHigh - pullbackLow;
      const fib50 = pullbackLow + (impulseRange * 0.50);
      const fib618 = pullbackLow + (impulseRange * 0.618);
      detailsHTML = `
        <div class="entry-gate-row"><span class="entry-gate-row-label">Impulse</span><span class="entry-gate-row-value">${impulseHigh.toFixed(2)} \u2192 ${pullbackLow.toFixed(2)}</span></div>
        <div class="entry-gate-row"><span class="entry-gate-row-label">Retrace</span><span class="entry-gate-row-value">${retrace.toFixed(1)}%</span></div>
        <div class="entry-gate-row"><span class="entry-gate-row-label">Entry Zone</span><span class="entry-gate-row-value">${fib618.toFixed(2)} - ${fib50.toFixed(2)}</span></div>
        <div class="entry-gate-message">Waiting for discount zone \u00B7 50-78.6%</div>`;
    } else if (retrace >= 50 && retrace <= 78.6) {
      gateClass = 'entry-gate--qualified'; stateText = 'QUALIFIED';
      const impulseRange = impulseHigh - pullbackLow;
      const fib618 = pullbackLow + (impulseRange * 0.618);
      const currentPrice = pullbackLow + (impulseRange * (retrace / 100));
      detailsHTML = `
        <div class="entry-gate-row"><span class="entry-gate-row-label">Impulse</span><span class="entry-gate-row-value">${impulseHigh.toFixed(2)} \u2192 ${pullbackLow.toFixed(2)}</span></div>
        <div class="entry-gate-row"><span class="entry-gate-row-label">Retrace</span><span class="entry-gate-row-value">${retrace.toFixed(1)}%</span></div>
        <div class="entry-gate-row"><span class="entry-gate-row-label">0.618 Fib</span><span class="entry-gate-row-value">${fib618.toFixed(2)}</span></div>
        <div class="entry-gate-row"><span class="entry-gate-row-label">Risk</span><span class="entry-gate-row-value">${(currentPrice - pullbackLow).toFixed(2)}</span></div>`;
    } else {
      gateClass = 'entry-gate--invalidated'; stateText = 'INVALIDATED';
      const impulseRange = impulseHigh - pullbackLow;
      const fib786 = pullbackLow + (impulseRange * 0.786);
      detailsHTML = `
        <div class="entry-gate-row"><span class="entry-gate-row-label">Retrace</span><span class="entry-gate-row-value">${retrace.toFixed(1)}%</span></div>
        <div class="entry-gate-row"><span class="entry-gate-row-label">0.786 Level</span><span class="entry-gate-row-value">${fib786.toFixed(2)}</span></div>
        <div class="entry-gate-message">Too deep \u00B7 Wait for new impulse</div>`;
    }
  }

  gateEl.className = `entry-gate ${gateClass}`;
  stateEl.textContent = stateText;
  detailsEl.innerHTML = detailsHTML;
}

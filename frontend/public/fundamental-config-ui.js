(function () {
  const METRIC_OPTIONS = [
    { metric: 'revenueGrowthPct', label: 'Revenue Growth %' },
    { metric: 'earningsGrowthPct', label: 'Earnings Growth %' },
    { metric: 'revenueYoYGrowthPct', label: 'Revenue YoY Growth %' },
    { metric: 'revenueQoQGrowthPct', label: 'Revenue QoQ Growth %' },
    { metric: 'epsYoYGrowthPct', label: 'EPS YoY Growth %' },
    { metric: 'epsQoQGrowthPct', label: 'EPS QoQ Growth %' },
    { metric: 'grossMarginPct', label: 'Gross Margin %' },
    { metric: 'operatingMarginPct', label: 'Operating Margin %' },
    { metric: 'profitMarginPct', label: 'Profit Margin %' },
    { metric: 'returnOnEquityPct', label: 'Return on Equity %' },
    { metric: 'returnOnAssetsPct', label: 'Return on Assets %' },
    { metric: 'debtToEquity', label: 'Debt to Equity' },
    { metric: 'currentRatio', label: 'Current Ratio' },
    { metric: 'quickRatio', label: 'Quick Ratio' },
    { metric: 'institutionalOwnershipPct', label: 'Institutional Ownership %' },
    { metric: 'insiderOwnershipPct', label: 'Insider Ownership %' },
    { metric: 'floatShares', label: 'Float Shares' },
    { metric: 'sharesOutstanding', label: 'Shares Outstanding' },
    { metric: 'totalCash', label: 'Total Cash' },
    { metric: 'totalDebt', label: 'Total Debt' },
    { metric: 'operatingCashFlowTTM', label: 'Operating Cash Flow TTM' },
    { metric: 'freeCashFlowTTM', label: 'Free Cash Flow TTM' },
    { metric: 'salesSurprisePct', label: 'Sales Surprise %' },
    { metric: 'epsSurprisePct', label: 'EPS Surprise %' },
  ];

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function getCollapseStorageKey(prefix) {
    const page = typeof window !== 'undefined' && window.location ? window.location.pathname : 'unknown';
    return `fundamental-config-ui:${page}:${String(prefix || 'default')}:open`;
  }

  function readCollapseState(prefix) {
    try {
      const raw = localStorage.getItem(getCollapseStorageKey(prefix));
      if (raw == null) return true;
      return raw !== 'false';
    } catch {
      return true;
    }
  }

  function writeCollapseState(prefix, isOpen) {
    try {
      localStorage.setItem(getCollapseStorageKey(prefix), isOpen ? 'true' : 'false');
    } catch {}
  }

  function defaultVariable() {
    return {
      metric: 'operatingMarginPct',
      label: 'Operating Margin %',
      operator: '>=',
      threshold: 5,
      missing_policy: 'fail',
      sensitivity_enabled: true,
    };
  }

  function normalizeVariable(value) {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const metric = String(row.metric || '').trim();
    const threshold = Number(row.threshold);
    return {
      metric,
      label: String(row.label || '').trim() || undefined,
      operator: ['>=', '<=', '>', '<', '==', '!='].includes(String(row.operator || '')) ? String(row.operator) : '>=',
      threshold: Number.isFinite(threshold) ? threshold : null,
      missing_policy: String(row.missing_policy || 'fail') === 'pass' ? 'pass' : 'fail',
      sensitivity_enabled: row.sensitivity_enabled !== false,
    };
  }

  function normalizeConfig(value) {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const variables = Array.isArray(raw.variables)
      ? raw.variables.map(normalizeVariable).filter((row) => row.metric && row.threshold != null)
      : [];
    const forwardBars = Number(raw.forward_bars);
    const minSelectedCount = Number(raw.min_selected_count);
    const minExcludedCount = Number(raw.min_excluded_count);
    return {
      enabled: raw.enabled !== false,
      comparison_mode: 'selected_vs_excluded',
      rebalance_frequency: String(raw.rebalance_frequency || 'monthly') === 'quarterly' ? 'quarterly' : 'monthly',
      forward_bars: Number.isFinite(forwardBars) && forwardBars > 0 ? Math.floor(forwardBars) : 1,
      min_selected_count: Number.isFinite(minSelectedCount) && minSelectedCount > 0 ? Math.floor(minSelectedCount) : 5,
      min_excluded_count: Number.isFinite(minExcludedCount) && minExcludedCount > 0 ? Math.floor(minExcludedCount) : 5,
      variables,
    };
  }

  function readIssues(state) {
    const issues = [];
    if (!state.enabled) return issues;
    if (!Array.isArray(state.variables) || state.variables.length === 0) {
      issues.push('Add at least one fundamental variable or disable the fundamentals layer.');
      return issues;
    }
    state.variables.forEach((row, index) => {
      if (!String(row.metric || '').trim()) {
        issues.push(`Fundamental variable ${index + 1} is missing a metric.`);
      }
      if (!Number.isFinite(Number(row.threshold))) {
        issues.push(`Fundamental variable ${index + 1} has an invalid threshold.`);
      }
    });
    return issues;
  }

  function buildMetricOptionsHtml() {
    return METRIC_OPTIONS.map((item) => `<option value="${escapeHtml(item.metric)}">${escapeHtml(item.label)}</option>`).join('');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function render(host, state, prefix) {
    const isOpen = readCollapseState(prefix);
    const variableRows = (state.variables || []).map((row, index) => `
      <div class="panel" style="padding:10px 12px;border:1px solid var(--color-border);border-radius:10px;background:rgba(255,255,255,0.02);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
          <strong style="font-size:12px;">Variable ${index + 1}</strong>
          <button type="button" class="btn btn-sm btn-ghost" data-action="remove-variable" data-index="${index}">Remove</button>
        </div>
        <div style="display:grid;grid-template-columns:2fr 1.4fr 0.8fr 1fr 1fr auto;gap:8px;align-items:end;">
          <label class="workshop-meta-field" style="margin:0;">
            <span>Metric</span>
            <input type="text" list="${prefix}-metric-options" data-field="metric" data-index="${index}" value="${escapeHtml(row.metric)}" placeholder="operatingMarginPct">
          </label>
          <label class="workshop-meta-field" style="margin:0;">
            <span>Label</span>
            <input type="text" data-field="label" data-index="${index}" value="${escapeHtml(row.label || '')}" placeholder="Optional display label">
          </label>
          <label class="workshop-meta-field" style="margin:0;">
            <span>Op</span>
            <select class="select" data-field="operator" data-index="${index}">
              ${['>=', '<=', '>', '<', '==', '!='].map((op) => `<option value="${op}"${row.operator === op ? ' selected' : ''}>${op}</option>`).join('')}
            </select>
          </label>
          <label class="workshop-meta-field" style="margin:0;">
            <span>Threshold</span>
            <input type="number" step="any" data-field="threshold" data-index="${index}" value="${escapeHtml(row.threshold)}">
          </label>
          <label class="workshop-meta-field" style="margin:0;">
            <span>Missing</span>
            <select class="select" data-field="missing_policy" data-index="${index}">
              <option value="fail"${row.missing_policy !== 'pass' ? ' selected' : ''}>Fail</option>
              <option value="pass"${row.missing_policy === 'pass' ? ' selected' : ''}>Pass</option>
            </select>
          </label>
          <label class="text-muted" style="display:flex;align-items:center;gap:6px;font-size:12px;padding-bottom:8px;">
            <input type="checkbox" data-field="sensitivity_enabled" data-index="${index}" ${row.sensitivity_enabled !== false ? 'checked' : ''}>
            Sensitivity
          </label>
        </div>
      </div>
    `).join('');

    host.innerHTML = `
      <details class="panel" style="margin-top:12px;" ${isOpen ? 'open' : ''}>
        <summary class="panel-header" style="cursor:pointer;list-style:none;">
          <span class="panel-header-title">Fundamental Validation Layer</span>
          <span class="text-muted text-mono" style="font-size:11px;">Saved as \`fundamental_config\`</span>
        </summary>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:12px;">
          <label class="text-muted" style="display:flex;align-items:center;gap:8px;font-size:12px;">
            <input type="checkbox" id="${prefix}-enabled" ${state.enabled ? 'checked' : ''}>
            Enable PIT fundamentals for validator runs of this composite
          </label>

          <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;${state.enabled ? '' : 'opacity:0.55;'}">
            <label class="workshop-meta-field" style="margin:0;">
              <span>Rebalance</span>
              <select class="select" id="${prefix}-rebalance-frequency" ${state.enabled ? '' : 'disabled'}>
                <option value="monthly"${state.rebalance_frequency !== 'quarterly' ? ' selected' : ''}>Monthly</option>
                <option value="quarterly"${state.rebalance_frequency === 'quarterly' ? ' selected' : ''}>Quarterly</option>
              </select>
            </label>
            <label class="workshop-meta-field" style="margin:0;">
              <span>Forward Bars</span>
              <input type="number" min="1" step="1" id="${prefix}-forward-bars" value="${escapeHtml(state.forward_bars)}" ${state.enabled ? '' : 'disabled'}>
            </label>
            <label class="workshop-meta-field" style="margin:0;">
              <span>Min Selected</span>
              <input type="number" min="1" step="1" id="${prefix}-min-selected" value="${escapeHtml(state.min_selected_count)}" ${state.enabled ? '' : 'disabled'}>
            </label>
            <label class="workshop-meta-field" style="margin:0;">
              <span>Min Excluded</span>
              <input type="number" min="1" step="1" id="${prefix}-min-excluded" value="${escapeHtml(state.min_excluded_count)}" ${state.enabled ? '' : 'disabled'}>
            </label>
          </div>

          <datalist id="${prefix}-metric-options">${buildMetricOptionsHtml()}</datalist>

          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <div class="text-muted" style="font-size:12px;">Current mode: <code>selected_vs_excluded</code></div>
            <button type="button" class="btn btn-sm btn-ghost" data-action="add-variable" ${state.enabled ? '' : 'disabled'}>Add Variable</button>
          </div>

          <div id="${prefix}-variable-list" style="display:flex;flex-direction:column;gap:8px;">
            ${variableRows || '<p class="text-muted" style="margin:0;font-size:12px;">No fundamental variables yet.</p>'}
          </div>

          <div id="${prefix}-issues" class="text-muted" style="font-size:12px;color:${readIssues(state).length ? 'var(--color-negative)' : 'var(--color-text-muted)'};">
            ${readIssues(state).length ? escapeHtml(readIssues(state).join(' ')) : 'Use one or more variables to test selected vs excluded baskets during validation.'}
          </div>
        </div>
      </details>
    `;
  }

  function initFundamentalConfigEditor(options) {
    const host = document.getElementById(options.hostId);
    if (!host) return null;

    const prefix = String(options.prefix || options.hostId || 'fundamentals');
    let state = normalizeConfig(options.initialValue || { enabled: false, variables: [] });

    function notify() {
      if (typeof options.onChange === 'function') {
        options.onChange(api.getValue(), api.getIssues());
      }
    }

    function syncStateFromDom() {
      const enabledEl = host.querySelector(`#${prefix}-enabled`);
      const rebalanceEl = host.querySelector(`#${prefix}-rebalance-frequency`);
      const forwardBarsEl = host.querySelector(`#${prefix}-forward-bars`);
      const minSelectedEl = host.querySelector(`#${prefix}-min-selected`);
      const minExcludedEl = host.querySelector(`#${prefix}-min-excluded`);
      state.enabled = enabledEl ? enabledEl.checked : false;
      state.rebalance_frequency = rebalanceEl && rebalanceEl.value === 'quarterly' ? 'quarterly' : 'monthly';
      state.forward_bars = Math.max(1, Number(forwardBarsEl?.value || 1) || 1);
      state.min_selected_count = Math.max(1, Number(minSelectedEl?.value || 5) || 5);
      state.min_excluded_count = Math.max(1, Number(minExcludedEl?.value || 5) || 5);

      state.variables = state.variables.map((row, index) => {
        const metricEl = host.querySelector(`[data-field="metric"][data-index="${index}"]`);
        const labelEl = host.querySelector(`[data-field="label"][data-index="${index}"]`);
        const operatorEl = host.querySelector(`[data-field="operator"][data-index="${index}"]`);
        const thresholdEl = host.querySelector(`[data-field="threshold"][data-index="${index}"]`);
        const missingPolicyEl = host.querySelector(`[data-field="missing_policy"][data-index="${index}"]`);
        const sensitivityEl = host.querySelector(`[data-field="sensitivity_enabled"][data-index="${index}"]`);
        return normalizeVariable({
          metric: metricEl?.value,
          label: labelEl?.value,
          operator: operatorEl?.value,
          threshold: thresholdEl?.value,
          missing_policy: missingPolicyEl?.value,
          sensitivity_enabled: sensitivityEl?.checked,
        });
      });
    }

    function rerender() {
      render(host, state, prefix);
      bindEvents();
      notify();
    }

    function bindEvents() {
      const enabledEl = host.querySelector(`#${prefix}-enabled`);
      const detailsEl = host.querySelector('details.panel');
      if (enabledEl) {
        enabledEl.addEventListener('change', () => {
          syncStateFromDom();
          rerender();
        });
      }
      if (detailsEl) {
        detailsEl.addEventListener('toggle', () => {
          writeCollapseState(prefix, detailsEl.open);
        });
      }

      host.querySelectorAll('input, select').forEach((el) => {
        if (el.id === `${prefix}-enabled`) return;
        el.addEventListener('input', () => {
          syncStateFromDom();
          notify();
        });
        el.addEventListener('change', () => {
          syncStateFromDom();
          notify();
        });
      });

      host.querySelectorAll('[data-action="add-variable"]').forEach((el) => {
        el.addEventListener('click', () => {
          syncStateFromDom();
          state.variables.push(defaultVariable());
          rerender();
        });
      });

      host.querySelectorAll('[data-action="remove-variable"]').forEach((el) => {
        el.addEventListener('click', () => {
          syncStateFromDom();
          const index = Number(el.getAttribute('data-index'));
          if (Number.isFinite(index)) {
            state.variables.splice(index, 1);
            rerender();
          }
        });
      });
    }

    const api = {
      getValue() {
        syncStateFromDom();
        const normalized = normalizeConfig(state);
        if (!normalized.enabled || !normalized.variables.length) return null;
        return normalized;
      },
      getIssues() {
        syncStateFromDom();
        return readIssues(normalizeConfig(state));
      },
      setValue(value) {
        state = normalizeConfig(value || { enabled: false, variables: [] });
        rerender();
      },
      getMetricOptions() {
        return cloneValue(METRIC_OPTIONS);
      },
    };

    rerender();
    return api;
  }

  window.initFundamentalConfigEditor = initFundamentalConfigEditor;
  window.getFundamentalMetricOptions = function () {
    return cloneValue(METRIC_OPTIONS);
  };
})();

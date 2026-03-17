const API_BASE = '/api/validator';
const ASSET_CLASSES = ['futures', 'stocks', 'options', 'forex', 'crypto'];
const TIER_ORDER = ['tier1', 'tier2', 'tier3'];
const TIER_LABELS = {
  tier1: 'Tier 1 - Kill Test',
  tier2: 'Tier 2 - Core Validation',
  tier3: 'Tier 3 - Robustness',
};
const TIER_DESCRIPTIONS = {
  tier1: 'Fast kill test on a fixed Tier 1 universe. Target evidence: 200-300 trades.',
  tier2: 'Core validation on a fixed Tier 2 universe. Target evidence: 500-1500 trades. Requires Tier 1 PASS.',
  tier3: 'Robustness validation on a fixed Tier 3 universe. Stress tests for survivors. Requires Tier 2 PASS.',
};
const FALLBACK_TIER_UNIVERSES_BY_ASSET_CLASS = {
  futures: {
    tier1: ['ES=F', 'NQ=F', 'CL=F'],
    tier2: ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'GC=F', 'ZN=F'],
    tier3: ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'GC=F', 'ZN=F', 'SI=F', 'NG=F', 'HG=F', '6E=F'],
  },
  stocks: {
    tier1: ['SPY', 'QQQ', 'IWM'],
    tier2: ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'NVDA', 'AMD', 'TSLA', 'META', 'AMZN'],
    tier3: ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'NVDA', 'AMD', 'TSLA', 'META', 'AMZN', 'XLK', 'XLF', 'XLE', 'XLI', 'XLV'],
  },
  options: {
    tier1: ['SPY', 'QQQ'],
    tier2: ['SPY', 'QQQ', 'AAPL', 'MSFT'],
    tier3: ['SPY', 'QQQ', 'AAPL', 'MSFT', 'IWM', 'TLT'],
  },
  forex: {
    tier1: ['EURUSD=X', 'GBPUSD=X'],
    tier2: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X'],
    tier3: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X', 'USDCAD=X', 'NZDUSD=X'],
  },
  crypto: {
    tier1: ['BTC-USD', 'ETH-USD'],
    tier2: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD'],
    tier3: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'XRP-USD', 'ADA-USD'],
  },
};

function normalizeAssetClass(value) {
  const key = String(value || '').trim().toLowerCase();
  return ASSET_CLASSES.includes(key) ? key : 'stocks';
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setSourceText(text) {
  const el = document.getElementById('symbol-library-source');
  if (!el) return;
  el.textContent = text;
}

function buildFallbackTierConfig(assetClass) {
  const key = normalizeAssetClass(assetClass);
  const byClass = FALLBACK_TIER_UNIVERSES_BY_ASSET_CLASS[key] || FALLBACK_TIER_UNIVERSES_BY_ASSET_CLASS.stocks;
  const tiers = {};
  for (const tierKey of TIER_ORDER) {
    tiers[tierKey] = {
      key: tierKey,
      label: TIER_LABELS[tierKey],
      description: TIER_DESCRIPTIONS[tierKey],
      symbols: (byClass[tierKey] || []).slice(),
    };
  }
  return { asset_class: key, tiers };
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
}

async function loadTierConfig(assetClass) {
  const key = normalizeAssetClass(assetClass);
  const fallback = buildFallbackTierConfig(key);
  try {
    const data = await apiGet(`/tier-config?asset_class=${encodeURIComponent(key)}`);
    if (!data || typeof data !== 'object' || !data.tiers) {
      setSourceText('Source: fallback config (API returned no tier payload)');
      return fallback;
    }
    setSourceText('Source: backend validator tier config');
    return data;
  } catch (err) {
    setSourceText(`Source: fallback config (${err.message})`);
    return fallback;
  }
}

function renderTierCards(config) {
  const grid = document.getElementById('symbol-library-grid');
  if (!grid) return;
  let html = '';
  for (const tierKey of TIER_ORDER) {
    const tier = config?.tiers?.[tierKey] || {};
    const label = tier.label || TIER_LABELS[tierKey] || tierKey;
    const description = tier.description || TIER_DESCRIPTIONS[tierKey] || '';
    const symbols = Array.isArray(tier.symbols) ? tier.symbols : [];
    html += `
      <article class="symbol-tier-card">
        <div class="symbol-tier-card-header">
          <div class="symbol-tier-title">${escHtml(label)}</div>
          <div class="symbol-tier-count">${symbols.length} symbols</div>
        </div>
        <div class="symbol-tier-body">
          <div class="symbol-tier-description">${escHtml(description)}</div>
          <div class="symbol-list">${escHtml(symbols.join(', ') || 'No symbols configured')}</div>
        </div>
      </article>
    `;
  }
  grid.innerHTML = html;
}

function updateQuery(assetClass) {
  const url = new URL(window.location.href);
  url.searchParams.set('asset_class', assetClass);
  window.history.replaceState({}, '', url.toString());
}

async function handleAssetClassChange() {
  const select = document.getElementById('asset-class-select');
  const assetClass = normalizeAssetClass(select?.value);
  updateQuery(assetClass);
  const config = await loadTierConfig(assetClass);
  renderTierCards(config);
}

async function initSymbolLibraryPage() {
  const params = new URLSearchParams(window.location.search);
  const initialAssetClass = normalizeAssetClass(params.get('asset_class') || 'stocks');
  const select = document.getElementById('asset-class-select');
  if (select) {
    select.value = initialAssetClass;
    select.addEventListener('change', () => {
      void handleAssetClassChange();
    });
  }
  const config = await loadTierConfig(initialAssetClass);
  renderTierCards(config);
}

document.addEventListener('DOMContentLoaded', () => {
  void initSymbolLibraryPage();
});

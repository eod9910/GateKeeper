(function initSweepNameUtils(global) {
  const ACRONYMS = new Map([
    ['hs', 'H&S'],
    ['h&s', 'H&S'],
    ['macd', 'MACD'],
    ['rsi', 'RSI'],
    ['rdp', 'RDP'],
    ['ote', 'OTE'],
    ['atr', 'ATR'],
    ['ema', 'EMA'],
    ['sma', 'SMA'],
    ['vwap', 'VWAP'],
    ['fib', 'FIB'],
    ['adx', 'ADX'],
  ]);

  const LOWERCASE_WORDS = new Set(['and', 'or', 'of', 'in', 'to', 'for', 'with', 'the', 'a', 'an']);

  function toWords(value) {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/[–—]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titleizeToken(token, index) {
    const lower = token.toLowerCase();
    if (ACRONYMS.has(lower)) return ACRONYMS.get(lower);
    if (/^\d+[a-z]$/i.test(token)) return `${token.slice(0, -1)}${token.slice(-1).toUpperCase()}`;
    if (/^[a-z]\d+$/i.test(token)) return token.charAt(0).toUpperCase() + token.slice(1);
    if (LOWERCASE_WORDS.has(lower) && index > 0) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  function cleanupHumanName(raw) {
    let next = String(raw || '').trim();
    if (!next) return '';

    next = next.replace(/\s*\[(?!v\d+\])[^\]]+\]/gi, ' ');
    next = next.replace(/\(\s*pattern\s*\)/gi, ' ');
    next = next.replace(/\(\s*v\d+\s+migration\s*\)/gi, ' ');
    next = next.replace(/\bstateful\b/gi, ' ');
    next = next.replace(/\brestart\b/gi, ' ');
    next = next.replace(/\bsweep winner\b/gi, ' ');
    next = next.replace(/\[v\d+\]/gi, ' ');
    next = next.replace(/\bv\d{1,3}\b/gi, ' ');
    next = next.split(' — ')[0];
    next = next.split(' - ')[0];
    next = next.replace(/\s+[^\w()[\]&/]+\s+.*$/u, ' ');
    next = next.replace(/\(\s+\)/g, ' ');
    next = next.replace(/\s+/g, ' ').trim();
    return next;
  }

  function extractVersionTag(...candidates) {
    for (const candidate of candidates) {
      const raw = String(candidate || '').trim();
      if (!raw) continue;
      const bracket = raw.match(/\[v(\d{1,3})\]/i);
      if (bracket) return `v${Number(bracket[1])}`;
      const plain = raw.match(/(?:^|[\s_(])v(\d{1,3})(?:$|[\s)\]])/i);
      if (plain) return `v${Number(plain[1])}`;
      const suffixed = raw.match(/_v(\d{1,3})\b/i);
      if (suffixed) return `v${Number(suffixed[1])}`;
      if (/^\d{1,3}$/.test(raw)) return `v${Number(raw)}`;
    }
    return '';
  }

  function looksGeneratedId(value) {
    const raw = String(value || '').trim().toLowerCase();
    return /^sweep[_-]/.test(raw)
      || /^research_[a-f0-9]+/i.test(raw)
      || /_sweep_winner_/.test(raw)
      || (/^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(raw) && !/\s/.test(raw));
  }

  function chooseSeedName(rawName, strategyId, strategyVersionId) {
    const name = String(rawName || '').trim();
    if (name && !looksGeneratedId(name)) return name;

    const baseId = String(strategyId || strategyVersionId || '').trim();
    if (!baseId) return name;

    const cleanedId = baseId
      .replace(/_sweep_winner_v\d+(?:\d+)*/gi, '')
      .replace(/_v\d+\b/gi, '')
      .replace(/^sweep_[0-9]{8}_[0-9]{6}_[a-f0-9]+(?:_[a-z0-9]+)*/i, '')
      .replace(/^sweep_[a-f0-9-]+(?:_[0-9a-z]+)*/i, '')
      .replace(/^research_[a-f0-9_]+/i, '')
      .trim();

    if (cleanedId) return cleanedId;
    return looksGeneratedId(baseId) ? '' : baseId;
  }

  function titleizeName(raw) {
    const normalized = toWords(raw);
    if (!normalized) return '';
    return normalized
      .split(' ')
      .map((token, index) => titleizeToken(token, index))
      .join(' ')
      .replace(/\bHs\b/g, 'H&S')
      .replace(/\(\s*Long\s*\)/gi, '(Long)')
      .replace(/\(\s*Short\s*\)/gi, '(Short)')
      .trim();
  }

  function normalizeStrategyDisplayName({ rawName, strategyVersionId, strategyId, version } = {}) {
    const versionTag = extractVersionTag(rawName, strategyVersionId, strategyId, version);
    const seed = chooseSeedName(rawName, strategyId, strategyVersionId);
    const base = looksGeneratedId(rawName)
      ? (titleizeName(seed) || 'Unnamed Sweep Strategy')
      : (cleanupHumanName(rawName) || titleizeName(seed) || 'Unnamed Sweep Strategy');
    return versionTag ? `${base} [${versionTag}]` : base;
  }

  function getStrategyFamilyKey({ strategyVersionId, strategyId } = {}) {
    return String(strategyId || strategyVersionId || '')
      .replace(/_v\d+\b/gi, '')
      .replace(/_sweep_winner_v\d+(?:\d+)*/gi, '')
      .trim();
  }

  global.SweepNameUtils = {
    normalizeStrategyDisplayName,
    getStrategyFamilyKey,
  };
})(window);

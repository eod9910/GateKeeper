import fetch from 'node-fetch';

type LocalCorporateAction = {
  code?: string | null;
  status?: string | null;
  label?: string | null;
  confidence?: string | null;
  summary?: string | null;
  acquirer?: string | null;
  deal_price_per_share?: number | null;
  contingent_value_right_max_per_share?: number | null;
  expected_close?: string | null;
};

type WebSource = {
  title: string;
  url: string;
  source: string;
  snippet: string | null;
  excerpt: string | null;
};

export type SpecialSituationWebVerification = {
  triggered: boolean;
  status: 'confirmed' | 'inconclusive' | 'not_found' | 'error';
  symbol: string;
  company_name: string | null;
  query_used: string;
  summary: string;
  confidence: 'low' | 'moderate' | 'high';
  signals: {
    definitive_agreement: boolean;
    going_private: boolean;
    acquired_by: boolean;
    cash_consideration: boolean;
    contingent_value_right: boolean;
    expected_close: boolean;
    transaction_completed: boolean;
  };
  extracted_terms: {
    acquirer: string | null;
    deal_price_per_share: number | null;
    contingent_value_right_max_per_share: number | null;
    expected_close: string | null;
  };
  source_count: number;
  sources: WebSource[];
  error?: string | null;
};

type VerifyInput = {
  symbol: string;
  companyName?: string | null;
  localCorporateAction?: LocalCorporateAction | null;
  maxSources?: number;
  searchQuery?: string | null;
};

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_PAGE_FETCHES = 3;
const KNOWN_SOURCE_ORDER = [
  'sec.gov',
  'investor',
  'ir.',
  'globenewswire.com',
  'businesswire.com',
  'prnewswire.com',
  'reuters.com',
  'bloomberg.com',
  'wsj.com',
  'marketwatch.com',
  'finance.yahoo.com',
];

function trimString(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function toFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_match, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : '';
    });
}

function stripTags(value: string): string {
  return normalizeWhitespace(decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ')));
}

function abbreviate(value: string | null, maxChars: number = 320): string | null {
  const text = normalizeWhitespace(String(value || ''));
  if (!text) return null;
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3).trim()}...`;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]) : null;
}

function extractMetaDescription(html: string): string | null {
  const metaPatterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  ];
  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    if (match) return stripTags(match[1]);
  }
  return null;
}

function extractVisibleText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  return normalizeWhitespace(decodeHtmlEntities(withoutScripts.replace(/<[^>]+>/g, ' ')));
}

function sourceLabelFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return 'web';
  }
}

function unwrapDuckDuckGoUrl(rawUrl: string): string {
  const candidate = decodeHtmlEntities(rawUrl);
  try {
    const resolved = candidate.startsWith('//') ? `https:${candidate}` : candidate;
    const parsed = new URL(resolved);
    if (!/duckduckgo\.com$/i.test(parsed.hostname)) return resolved;
    const uddg = parsed.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : resolved;
  } catch {
    return candidate;
  }
}

function parseFirstNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const value = Number(match[1].replace(/,/g, ''));
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function parseFirstText(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return normalizeWhitespace(match[1]);
    }
  }
  return null;
}

function buildDealSignalSummary(signals: SpecialSituationWebVerification['signals']): string[] {
  const items: string[] = [];
  if (signals.definitive_agreement) items.push('definitive agreement');
  if (signals.going_private) items.push('go-private language');
  if (signals.acquired_by) items.push('identified acquirer');
  if (signals.cash_consideration) items.push('cash consideration');
  if (signals.contingent_value_right) items.push('CVR mention');
  if (signals.expected_close) items.push('expected close timing');
  if (signals.transaction_completed) items.push('completed transaction');
  return items;
}

function extractRelevantExcerpt(text: string): string | null {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return null;
  const patterns = [
    /\bmerger\b/i,
    /\bacquisition\b/i,
    /\bdefinitive agreement\b/i,
    /\bgo(?:ing)? private\b/i,
    /\bacquired by\b/i,
    /\bcompleted (?:our )?(?:merger|acquisition|transaction)\b/i,
    /\bcomplete (?:merger|acquisition)\b/i,
    /\btransaction closed\b/i,
    /\beffective [A-Za-z]+\.* \d{1,2}, \d{4}\b/i,
    /\bper share\b/i,
  ];
  const match = patterns.map((pattern) => pattern.exec(normalized)).find(Boolean);
  if (!match || match.index == null) {
    return abbreviate(normalized, 420);
  }
  const start = Math.max(0, match.index - 180);
  const end = Math.min(normalized.length, match.index + 420);
  return abbreviate(normalized.slice(start, end), 420);
}

function scoreSource(url: string, title: string, snippet: string | null): number {
  const source = sourceLabelFromUrl(url);
  const text = `${title} ${snippet || ''}`.toLowerCase();
  let score = 0;
  KNOWN_SOURCE_ORDER.forEach((needle, idx) => {
    if (source.includes(needle)) score += Math.max(1, 12 - idx);
  });
  if (/merger|acquisition|definitive agreement|go private|going private|stockholders to receive|per share/i.test(text)) {
    score += 10;
  }
  if (/investor|ir\./i.test(source)) score += 4;
  return score;
}

function sourceText(source: WebSource): string {
  return normalizeWhitespace([source.title, source.snippet, source.excerpt].filter(Boolean).join(' '));
}

function relevanceBoost(source: WebSource, symbol: string, companyName: string | null): number {
  const text = sourceText(source).toLowerCase();
  let boost = 0;
  if (symbol && text.includes(symbol.toLowerCase())) boost += 6;
  if (companyName) {
    const companyLower = companyName.toLowerCase();
    if (text.includes(companyLower)) boost += 10;
    const firstToken = companyLower.split(/\s+/)[0];
    if (firstToken && text.includes(firstToken)) boost += 4;
  }
  return boost;
}

async function fetchText(url: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'pattern-detector/0.1 (+local special-situation verification)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<WebSource[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url);
  const results: WebSource[] = [];
  const pattern = /<a[^>]+class=["']result__a["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class=["']result__snippet["'][^>]*>([\s\S]*?)<\/a>)?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && results.length < maxResults) {
    const url = unwrapDuckDuckGoUrl(match[1]);
    const title = stripTags(match[2] || '');
    const snippet = stripTags(match[3] || '');
    if (!title || !url) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    results.push({
      title,
      url,
      source: sourceLabelFromUrl(url),
      snippet: snippet || null,
      excerpt: null,
    });
  }
  return results;
}

async function enrichSources(sources: WebSource[]): Promise<WebSource[]> {
  const enriched = await Promise.all(sources.slice(0, MAX_PAGE_FETCHES).map(async (source) => {
    try {
      const html = await fetchText(source.url, 10000);
      const metaDescription = extractMetaDescription(html);
      const visibleText = extractVisibleText(html);
      const excerptSource = [metaDescription, visibleText]
        .map((value) => value || '')
        .find((value) => /\bmerger\b|\bacquisition\b|\bdefinitive agreement\b|\bgo(?:ing)? private\b|\bacquired by\b|\bcompleted (?:our )?(?:merger|acquisition|transaction)\b|\beffective [A-Za-z]+\.* \d{1,2}, \d{4}\b/i.test(value))
        || metaDescription
        || visibleText;
      return {
        ...source,
        title: extractTitle(html) || source.title,
        excerpt: extractRelevantExcerpt(excerptSource),
      };
    } catch {
      return source;
    }
  }));
  return [
    ...enriched,
    ...sources.slice(MAX_PAGE_FETCHES),
  ];
}

function dedupeSources(sources: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  const deduped: WebSource[] = [];
  sources.forEach((source) => {
    const key = `${source.url}|${source.title}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(source);
  });
  return deduped;
}

function buildSearchQuery(symbol: string, companyName: string | null, localCorporateAction?: LocalCorporateAction | null, override?: string | null): string {
  const explicit = trimString(override);
  if (explicit) return explicit;
  const dealTerms = [
    'merger',
    'acquisition',
    'definitive agreement',
    'go private',
    'per share',
  ];
  const namePart = companyName ? `"${companyName}"` : '';
  const acquirer = trimString(localCorporateAction?.acquirer);
  return [symbol, namePart, acquirer, ...dealTerms].filter(Boolean).join(' ');
}

function extractTerms(text: string): SpecialSituationWebVerification['extracted_terms'] {
  return {
    acquirer: parseFirstText(text, [
      /\bto be acquired by\s+([A-Z][A-Za-z0-9&.,'()\- ]{2,80}?)(?:\s+for\b|\.|,|$)/i,
      /\bacquired by\s+([A-Z][A-Za-z0-9&.,'()\- ]{2,80}?)(?:\s+for\b|\.|,|$)/i,
      /\bmerger with\s+([A-Z][A-Za-z0-9&.,'()\- ]{2,80}?)(?:\s+for\b|\.|,|$)/i,
    ]),
    deal_price_per_share: parseFirstNumber(text, [
      /\$([0-9]+(?:\.[0-9]+)?)\s+per share in cash/i,
      /stockholders?\s+to\s+receive[^$]{0,120}\$([0-9]+(?:\.[0-9]+)?)/i,
      /cash consideration[^$]{0,80}\$([0-9]+(?:\.[0-9]+)?)/i,
      /\bfor\s+\$([0-9]+(?:\.[0-9]+)?)\s+per share/i,
    ]),
    contingent_value_right_max_per_share: parseFirstNumber(text, [
      /contingent value right[^$]{0,100}up to \$([0-9]+(?:\.[0-9]+)?)/i,
      /\bCVR\b[^$]{0,80}up to \$([0-9]+(?:\.[0-9]+)?)/i,
    ]),
    expected_close: parseFirstText(text, [
      /expected to close(?: around| on| in)?\s+([A-Za-z]+ \d{1,2}, \d{4})/i,
      /expected to close(?: around| on| in)?\s+([A-Za-z]+ \d{4})/i,
      /expected to close(?: around| on| in)?\s+(Q[1-4]\s+\d{4})/i,
      /expected to close(?: by| during)?\s+the\s+([a-z0-9 ,\-]+?)(?:\.|,|;)/i,
    ]),
  };
}

function buildSignals(text: string): SpecialSituationWebVerification['signals'] {
  return {
    definitive_agreement: /\bdefinitive agreement\b|\bmerger agreement\b/i.test(text),
    going_private: /\bgo private\b|\bgoing private\b|\btake private\b|\btake-private\b/i.test(text),
    acquired_by: /\bacquired by\b|\bto be acquired by\b|\bmerger with\b/i.test(text),
    cash_consideration: /\bper share in cash\b|\bcash consideration\b|\bstockholders to receive\b/i.test(text),
    contingent_value_right: /\bcontingent value right\b|\bCVR\b/i.test(text),
    expected_close: /\bexpected to close\b/i.test(text),
    transaction_completed: /\bofficially completed\b|\bcompleted (?:our )?(?:merger|acquisition|transaction)\b|\bcomplete (?:merger|acquisition)\b|\btransaction closed\b|\bmerger closed\b/i.test(text),
  };
}

function hasIncompleteTerms(localCorporateAction?: LocalCorporateAction | null): boolean {
  if (!localCorporateAction) return true;
  return !trimString(localCorporateAction.acquirer)
    || toFiniteNumber(localCorporateAction.deal_price_per_share) == null
    || !trimString(localCorporateAction.expected_close);
}

export function shouldVerifySpecialSituationWeb(localCorporateAction?: LocalCorporateAction | null): boolean {
  const code = trimString(localCorporateAction?.code || localCorporateAction?.status)?.toLowerCase();
  if (code !== 'pending_acquisition') return false;
  if (trimString(localCorporateAction?.confidence)?.toLowerCase() !== 'high') return true;
  return hasIncompleteTerms(localCorporateAction);
}

export async function verifySpecialSituationWeb(input: VerifyInput): Promise<SpecialSituationWebVerification> {
  const symbol = trimString(input.symbol) || '';
  const companyName = trimString(input.companyName);
  const maxSources = Math.min(Math.max(Math.trunc(Number(input.maxSources) || 5), 1), 8);
  const query = buildSearchQuery(symbol, companyName, input.localCorporateAction, input.searchQuery);
  const emptyResult: SpecialSituationWebVerification = {
    triggered: true,
    status: 'not_found',
    symbol,
    company_name: companyName,
    query_used: query,
    summary: 'The web verifier did not find enough corroborating public-web evidence to confirm deal terms.',
    confidence: 'low',
    signals: {
      definitive_agreement: false,
      going_private: false,
      acquired_by: false,
      cash_consideration: false,
      contingent_value_right: false,
      expected_close: false,
      transaction_completed: false,
    },
    extracted_terms: {
      acquirer: null,
      deal_price_per_share: null,
      contingent_value_right_max_per_share: null,
      expected_close: null,
    },
    source_count: 0,
    sources: [],
    error: null,
  };

  if (!symbol) {
    return {
      ...emptyResult,
      triggered: false,
      status: 'error',
      summary: 'No symbol was provided for special-situation verification.',
      error: 'Missing symbol',
    };
  }

  try {
    const searchResults = await searchDuckDuckGo(query, Math.max(maxSources, 5));
    const ordered = dedupeSources(searchResults)
      .sort((a, b) => scoreSource(b.url, b.title, b.snippet) - scoreSource(a.url, a.title, a.snippet))
      .slice(0, maxSources);
    const enriched = await enrichSources(ordered);
    const sourceAnalyses = enriched.map((source) => {
      const text = sourceText(source);
      const companyToken = (companyName || symbol).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] || symbol.toLowerCase();
      const trustedDomain =
        KNOWN_SOURCE_ORDER.some((needle) => source.source.includes(needle))
        || source.source.includes(companyToken)
        || source.source.includes(symbol.toLowerCase());
      const termExtractionAllowed =
        trustedDomain &&
        /merger|acquisition|definitive agreement|go private|going private|acquired by|complete merger|completed merger/i.test(`${source.title} ${source.excerpt || ''}`)
        && !/news and press releases|press room|updates and announcements/i.test(source.title);
      return {
        source,
        text,
        signals: trustedDomain ? buildSignals(text) : {
          definitive_agreement: false,
          going_private: false,
          acquired_by: false,
          cash_consideration: false,
          contingent_value_right: false,
          expected_close: false,
          transaction_completed: false,
        },
        terms: termExtractionAllowed ? extractTerms(text) : {
          acquirer: null,
          deal_price_per_share: null,
          contingent_value_right_max_per_share: null,
          expected_close: null,
        },
        trustedDomain,
        rank: scoreSource(source.url, source.title, source.snippet) + relevanceBoost(source, symbol, companyName),
      };
    }).sort((a, b) => b.rank - a.rank);
    const evidenceText = sourceAnalyses
      .map((item) => item.text)
      .join(' \n ');
    const normalizedEvidence = normalizeWhitespace(evidenceText);
    const extractedTerms = sourceAnalyses.reduce<SpecialSituationWebVerification['extracted_terms']>((best, item) => {
      if (!best.acquirer && item.terms.acquirer) best.acquirer = item.terms.acquirer;
      if (best.deal_price_per_share == null && item.terms.deal_price_per_share != null) best.deal_price_per_share = item.terms.deal_price_per_share;
      if (best.contingent_value_right_max_per_share == null && item.terms.contingent_value_right_max_per_share != null) {
        best.contingent_value_right_max_per_share = item.terms.contingent_value_right_max_per_share;
      }
      if (!best.expected_close && item.terms.expected_close) best.expected_close = item.terms.expected_close;
      return best;
    }, {
      acquirer: null,
      deal_price_per_share: null,
      contingent_value_right_max_per_share: null,
      expected_close: null,
    });
    const signals = sourceAnalyses.reduce<SpecialSituationWebVerification['signals']>((combined, item) => ({
      definitive_agreement: combined.definitive_agreement || item.signals.definitive_agreement,
      going_private: combined.going_private || item.signals.going_private,
      acquired_by: combined.acquired_by || item.signals.acquired_by,
      cash_consideration: combined.cash_consideration || item.signals.cash_consideration,
      contingent_value_right: combined.contingent_value_right || item.signals.contingent_value_right,
      expected_close: combined.expected_close || item.signals.expected_close,
      transaction_completed: combined.transaction_completed || item.signals.transaction_completed,
    }), {
      definitive_agreement: false,
      going_private: false,
      acquired_by: false,
      cash_consideration: false,
      contingent_value_right: false,
      expected_close: false,
      transaction_completed: false,
    });
    const signalCount = Object.values(signals).filter(Boolean).length;
    const confirmed = signals.transaction_completed || (
      signalCount >= 2 && (
        extractedTerms.deal_price_per_share != null
        || extractedTerms.acquirer != null
        || signals.definitive_agreement
      )
    );
    const inconclusive = !confirmed && signalCount > 0;
    const status: SpecialSituationWebVerification['status'] = confirmed
      ? 'confirmed'
      : inconclusive
        ? 'inconclusive'
        : 'not_found';
    const confidence: SpecialSituationWebVerification['confidence'] = confirmed
      ? signalCount >= 4 ? 'high' : 'moderate'
      : inconclusive
        ? 'moderate'
        : 'low';
    const summarySignals = buildDealSignalSummary(signals);
    const summaryParts = [
      status === 'confirmed'
        ? 'The web verifier found public-web evidence supporting a live acquisition or go-private situation.'
        : status === 'inconclusive'
          ? 'The web verifier found some acquisition-related signals, but the public-web evidence is still incomplete.'
          : 'The web verifier did not find strong public-web confirmation of deal terms.',
      extractedTerms.acquirer ? `Possible acquirer: ${extractedTerms.acquirer}.` : null,
      extractedTerms.deal_price_per_share != null ? `Possible cash consideration: $${extractedTerms.deal_price_per_share.toFixed(2)} per share.` : null,
      extractedTerms.contingent_value_right_max_per_share != null ? `Possible CVR: up to $${extractedTerms.contingent_value_right_max_per_share.toFixed(2)} per share.` : null,
      extractedTerms.expected_close ? `Possible close timing: ${extractedTerms.expected_close}.` : null,
      summarySignals.length ? `Signals found: ${summarySignals.join(', ')}.` : null,
    ].filter(Boolean);

    return {
      triggered: true,
      status,
      symbol,
      company_name: companyName,
      query_used: query,
      summary: summaryParts.join(' '),
      confidence,
      signals,
      extracted_terms: extractedTerms,
      source_count: enriched.length,
      sources: sourceAnalyses.map(({ source }) => ({
        ...source,
        snippet: abbreviate(source.snippet, 220),
        excerpt: abbreviate(source.excerpt, 320),
      })),
      error: null,
    };
  } catch (error: any) {
    return {
      ...emptyResult,
      status: 'error',
      summary: 'The web verifier failed before it could confirm or reject the deal signal.',
      error: trimString(error?.message) || 'Unknown verification error',
    };
  }
}

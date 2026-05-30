import fetch from 'node-fetch';

const DEFAULT_TIMEOUT_MS = 9000;

export type WebCatalystSource = {
  title: string;
  url: string;
  source: string;
  published_at: string | null;
  snippet: string | null;
  query: string;
  source_type: 'google_news_rss' | 'duckduckgo_web';
};

export type WebCatalystCheck = {
  status: 'ok' | 'partial' | 'error';
  symbol: string;
  company_name: string | null;
  generated_at: string;
  queries: string[];
  source_count: number;
  sources: WebCatalystSource[];
  quality_flags: string[];
  error: string | null;
};

type SearchOptions = {
  symbol: string;
  companyName?: string | null;
  maxSources?: number;
};

function trimString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value || '').replace(/\s+/g, ' ').trim();
}

function stripTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, ' '));
}

function sourceLabelFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return 'unknown';
  }
}

function extractCdata(value: string): string {
  const cdata = value.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return normalizeWhitespace(cdata ? cdata[1] : value);
}

function extractXmlTag(item: string, tag: string): string | null {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? extractCdata(match[1]) : null;
}

function unwrapGoogleNewsUrl(rawUrl: string): string {
  const url = trimString(rawUrl) || '';
  try {
    const parsed = new URL(url);
    const nested = parsed.searchParams.get('url') || parsed.searchParams.get('q');
    if (nested && /^https?:\/\//i.test(nested)) return nested;
  } catch {
    return url;
  }
  return url;
}

function unwrapDuckDuckGoUrl(rawUrl: string): string {
  const url = trimString(rawUrl) || '';
  try {
    const parsed = new URL(url);
    const nested = parsed.searchParams.get('uddg');
    if (nested && /^https?:\/\//i.test(nested)) return decodeURIComponent(nested);
  } catch {
    return url;
  }
  return url;
}

async function fetchText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'pattern-detector/0.1 (+local catalyst verification)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function buildQueries(symbol: string, companyName: string | null): string[] {
  const namePart = companyName ? `"${companyName}"` : '';
  const anchor = [symbol, namePart].filter(Boolean).join(' ');
  return [
    `${anchor} earnings guidance revenue demand`,
    `${anchor} acquisition merger strategic review contract customer`,
    `${anchor} stock catalyst product demand pricing supply shortage`,
  ];
}

async function searchGoogleNewsRss(query: string, maxResults: number): Promise<WebCatalystSource[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await fetchText(url, 8000);
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  return items.slice(0, maxResults).map((item) => {
    const title = extractXmlTag(item, 'title') || 'Untitled news item';
    const rawUrl = extractXmlTag(item, 'link') || '';
    const publishedAt = extractXmlTag(item, 'pubDate');
    const snippet = stripTags(extractXmlTag(item, 'description') || '');
    const cleanUrl = unwrapGoogleNewsUrl(rawUrl);
    return {
      title: normalizeWhitespace(title),
      url: cleanUrl,
      source: sourceLabelFromUrl(cleanUrl),
      published_at: publishedAt,
      snippet: snippet || null,
      query,
      source_type: 'google_news_rss' as const,
    };
  }).filter((source) => /^https?:\/\//i.test(source.url));
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<WebCatalystSource[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url, 8000);
  const sources: WebCatalystSource[] = [];
  const pattern = /<a[^>]+class=["']result__a["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class=["']result__snippet["'][^>]*>([\s\S]*?)<\/a>)?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && sources.length < maxResults) {
    const cleanUrl = unwrapDuckDuckGoUrl(match[1]);
    const title = stripTags(match[2] || '');
    const snippet = stripTags(match[3] || '');
    if (!title || !/^https?:\/\//i.test(cleanUrl)) continue;
    sources.push({
      title,
      url: cleanUrl,
      source: sourceLabelFromUrl(cleanUrl),
      published_at: null,
      snippet: snippet || null,
      query,
      source_type: 'duckduckgo_web',
    });
  }
  return sources;
}

function dedupeSources(sources: WebCatalystSource[]): WebCatalystSource[] {
  const seen = new Set<string>();
  const deduped: WebCatalystSource[] = [];
  sources.forEach((source) => {
    const key = `${source.url}|${source.title}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(source);
  });
  return deduped;
}

function scoreSource(source: WebCatalystSource, symbol: string, companyName: string | null): number {
  const text = `${source.title} ${source.snippet || ''}`.toLowerCase();
  let score = source.source_type === 'google_news_rss' ? 5 : 2;
  if (text.includes(symbol.toLowerCase())) score += 8;
  if (companyName && text.includes(companyName.toLowerCase())) score += 12;
  if (/earnings|guidance|revenue|contract|customer|order|backlog|acquisition|merger|strategic review|upgrade|downgrade|pricing|demand|shortage|supply/i.test(text)) {
    score += 8;
  }
  if (/sec\.gov|investor|ir\.|businesswire|globenewswire|prnewswire|reuters|finance\.yahoo|marketwatch/i.test(source.source)) {
    score += 6;
  }
  return score;
}

export async function runWebCatalystCheck(options: SearchOptions): Promise<WebCatalystCheck> {
  const symbol = (trimString(options.symbol) || '').toUpperCase();
  const companyName = trimString(options.companyName);
  const maxSources = Math.min(Math.max(Math.trunc(Number(options.maxSources) || 8), 1), 12);
  const queries = buildQueries(symbol, companyName);
  const empty: WebCatalystCheck = {
    status: 'error',
    symbol,
    company_name: companyName,
    generated_at: new Date().toISOString(),
    queries,
    source_count: 0,
    sources: [],
    quality_flags: ['WEB_CHECK_FAILED'],
    error: null,
  };

  if (!symbol) {
    return { ...empty, error: 'Missing symbol' };
  }

  try {
    const perQueryLimit = Math.max(3, Math.ceil(maxSources / queries.length) + 1);
    const batches = await Promise.allSettled(queries.flatMap((query) => [
      searchGoogleNewsRss(query, perQueryLimit),
      searchDuckDuckGo(query, perQueryLimit),
    ]));
    const sources = dedupeSources(batches.flatMap((batch) => (
      batch.status === 'fulfilled' ? batch.value : []
    )))
      .sort((a, b) => scoreSource(b, symbol, companyName) - scoreSource(a, symbol, companyName))
      .slice(0, maxSources);
    const failedCount = batches.filter((batch) => batch.status === 'rejected').length;
    const qualityFlags: string[] = [];
    if (!sources.length) qualityFlags.push('NO_WEB_CATALYST_EVIDENCE');
    if (failedCount) qualityFlags.push('PARTIAL_WEB_SEARCH_FAILURE');
    if (!sources.some((source) => /sec\.gov|investor|ir\.|businesswire|globenewswire|prnewswire/i.test(source.source))) {
      qualityFlags.push('NO_PRIMARY_OR_COMPANY_SOURCE');
    }
    return {
      status: failedCount && sources.length ? 'partial' : 'ok',
      symbol,
      company_name: companyName,
      generated_at: new Date().toISOString(),
      queries,
      source_count: sources.length,
      sources,
      quality_flags: qualityFlags,
      error: null,
    };
  } catch (err: any) {
    return {
      ...empty,
      error: err?.message || String(err),
    };
  }
}

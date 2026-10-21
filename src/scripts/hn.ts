const BASE = 'https://hacker-news.firebaseio.com/v0';

export interface HNItem {
  id: number;
  type?: 'story' | 'comment' | 'job' | 'poll' | 'pollopt';
  by?: string;
  time?: number;
  text?: string;
  url?: string;
  score?: number;
  title?: string;
  descendants?: number;
  kids?: number[];
  dead?: boolean;
  deleted?: boolean;
}

export type Feed = 'top' | 'new' | 'best' | 'ask' | 'show' | 'job';

const FEED_ENDPOINT: Record<Feed, string> = {
  top: 'topstories',
  new: 'newstories',
  best: 'beststories',
  ask: 'askstories',
  show: 'showstories',
  job: 'jobstories',
};

export async function fetchFeedIds(feed: Feed = 'top', limit = 60): Promise<number[]> {
  const endpoint = FEED_ENDPOINT[feed];
  const r = await fetch(`${BASE}/${endpoint}.json`);
  if (!r.ok) throw new Error('No se pudieron cargar las historias');
  const ids: number[] = await r.json();
  return ids.slice(0, limit);
}

// Compatibilidad con código existente
export const fetchTopIds = (limit = 60) => fetchFeedIds('top', limit);

export async function fetchItem(id: number): Promise<HNItem | null> {
  const r = await fetch(`${BASE}/item/${id}.json`);
  if (!r.ok) return null;
  return r.json();
}

export function domainOf(url?: string): string {
  if (!url) return 'news.ycombinator.com';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'news.ycombinator.com';
  }
}

export function timeAgo(ts?: number): string {
  if (!ts) return '';
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 2592000) return `hace ${Math.floor(s / 86400)} d`;
  return `hace ${Math.floor(s / 2592000)} mes(es)`;
}

export function hnLink(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

const CTX_KEY = 'hn-ctx-cache-v1';
function readCtx(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(CTX_KEY) || '{}'); } catch { return {}; }
}
function writeCtx(c: Record<string, string>) {
  try { localStorage.setItem(CTX_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

export interface ContextResult {
  text: string;
  image: string;
}

export async function fetchContext(url: string): Promise<ContextResult> {
  if (!url) return { text: '', image: '' };
  const c = readCtx();
  // cache stores "text||image"
  if (c[url]) {
    const [text, image] = c[url].split('||');
    return { text: text || '', image: image || '' };
  }
  try {
    const r = await fetch(`https://r.jina.ai/${url}`);
    if (!r.ok) return { text: '', image: '' };
    const t = await r.text();
    const idx = t.indexOf('Markdown Content:');
    const content = idx >= 0 ? t.slice(idx + 'Markdown Content:'.length) : t;
    let snippet = content.replace(/\s+/g, ' ').trim();
    const imgMatch = content.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
    const image = imgMatch ? imgMatch[1] : '';
    c[url] = `${snippet}||${image}`;
    writeCtx(c);
    return { text: snippet, image };
  } catch {
    return { text: '', image: '' };
  }
}
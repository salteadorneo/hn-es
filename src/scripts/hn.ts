import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

export interface ContextImage {
  src: string;
  width: number;
  height: number;
  bytes: number;
}

export interface ContextResult {
  text: string;
  images: ContextImage[];
}

// ---------- image helpers ----------

const CTX_KEY = 'hn-ctx-cache-v2';
function readCtx(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(CTX_KEY) || '{}'); } catch { return {}; }
}
function writeCtx(c: Record<string, string>) {
  try { localStorage.setItem(CTX_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

function siteBase(): string {
  try {
    const b = (import.meta as any)?.env?.BASE_URL;
    if (b) return String(b).replace(/\/?$/, '/');
  } catch { /* ignore */ }
  return '/';
}

function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
}

function extFromContentType(ct: string): string {
  const m: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
  };
  const key = ct.split(';')[0].trim().toLowerCase();
  return m[key] || '';
}

function extFromUrl(u: string): string {
  try {
    const p = new URL(u).pathname;
    const m = p.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (m) return m[1].toLowerCase();
  } catch { /* ignore */ }
  return '';
}

function resolveUrl(candidate: string, base: string): string | null {
  try {
    return new URL(candidate, base).href;
  } catch {
    return null;
  }
}

function writeImageFile(name: string, buf: Buffer) {
  const dirs: string[] = [path.resolve(process.cwd(), 'public', 'og-images')];
  const dist = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(dist)) dirs.push(path.join(dist, 'og-images'));
  for (const d of dirs) {
    try {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, name), buf);
    } catch { /* ignore */ }
  }
}

function parseDimensions(buf: Buffer, ext: string): { width: number; height: number } {
  try {
    if (ext === 'png') {
      if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
      }
    }
    if (ext === 'gif') {
      if (buf.length >= 10) {
        return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
      }
    }
    if (ext === 'webp') {
      if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
        const chunk = buf.toString('ascii', 12, 16);
        if (chunk === 'VP8 ') {
          return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
        }
        if (chunk === 'VP8L') {
          const b = buf.readUInt32LE(21);
          return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
        }
        if (chunk === 'VP8X') {
          const w = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
          const h = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
          return { width: w, height: h };
        }
      }
    }
    if (ext === 'jpg' || ext === 'jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) { i += 2; continue; }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        if (i + 3 >= buf.length) break;
        const len = buf.readUInt16BE(i + 2);
        if (len < 2) break;
        i += 2 + len;
      }
    }
    if (ext === 'svg') {
      const s = buf.toString('utf8');
      const w = s.match(/\bwidth=["']([\d.]+)(px)?["']/i);
      const h = s.match(/\bheight=["']([\d.]+)(px)?["']/i);
      if (w && h) {
        return { width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) };
      }
      const vb = s.match(/\bviewBox=["'][\d.\s-]+["']/i);
      if (vb) {
        const nums = vb[0].match(/[\d.]+/g);
        if (nums && nums.length >= 4) {
          return { width: Math.round(Number(nums[2])), height: Math.round(Number(nums[3])) };
        }
      }
    }
  } catch { /* ignore */ }
  return { width: 0, height: 0 };
}

async function downloadImage(candidate: string, baseUrl: string): Promise<ContextImage | null> {
  const url = resolveUrl(candidate, baseUrl);
  if (!url || url.startsWith('data:')) return null;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HNEsBot/1.0)' },
      redirect: 'follow',
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.toLowerCase().startsWith('image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2048) return null;
    if (buf.length > 6 * 1024 * 1024) return null;
    const ext = extFromContentType(ct) || extFromUrl(url) || 'jpg';
    const hash = sha1(url);
    const name = `${hash}.${ext}`;
    writeImageFile(name, buf);
    const dims = parseDimensions(buf, ext);
    if (dims.width > 0 && dims.height > 0 && (dims.width < 120 || dims.height < 120)) return null;
    const base = siteBase();
    return { src: `${base}og-images/${name}`, width: dims.width, height: dims.height, bytes: buf.length };
  } catch {
    return null;
  }
}

function dedupeImages(list: ContextImage[]): ContextImage[] {
  const seen = new Set<string>();
  const out: ContextImage[] = [];
  for (const img of list) {
    if (seen.has(img.src)) continue;
    seen.add(img.src);
    out.push(img);
  }
  return out.sort((a, b) => (b.width * b.height) - (a.width * a.height));
}

function metaImageCandidates(html: string): string[] {
  const out: string[] = [];
  const metaRegex = /<meta\b[^>]*>/gi;
  for (const m of html.matchAll(metaRegex)) {
    const tag = m[0];
    const propMatch = tag.match(/\b(?:property|name)=["']([^"']+)["']/i);
    const prop = propMatch ? propMatch[1].toLowerCase() : '';
    const contentMatch = tag.match(/\bcontent=["']([^"']+)["']/i);
    const content = contentMatch ? contentMatch[1] : '';
    if (!content) continue;
    if (prop === 'og:image' || prop === 'og:image:secure_url' || prop === 'og:image:url' ||
        prop === 'twitter:image' || prop === 'twitter:image:src' || prop === 'image') {
      out.push(content);
    }
  }
  const linkRegex = /<link\b[^>]*>/gi;
  for (const m of html.matchAll(linkRegex)) {
    const tag = m[0];
    const relMatch = tag.match(/\brel=["']([^"']+)["']/i);
    const rel = relMatch ? relMatch[1].toLowerCase() : '';
    if (!rel.includes('image_src')) continue;
    const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
    if (hrefMatch) out.push(hrefMatch[1]);
  }
  return out;
}

function imgTagCandidates(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    let src = '';
    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    if (srcMatch) src = srcMatch[1];
    else {
      const dataMatch = tag.match(/\bdata-(?:src|lazy-src|original)=["']([^"']+)["']/i);
      if (dataMatch) src = dataMatch[1];
    }
    if (src) out.push(src);
    const srcsetMatch = tag.match(/\bsrcset=["']([^"']+)["']/i);
    if (srcsetMatch) {
      const parts = srcsetMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
      let best = '';
      let bestW = 0;
      for (const p of parts) {
        const bits = p.split(/\s+/);
        const u = bits[0];
        const w = bits[1] ? parseInt(bits[1], 10) : 0;
        if (w > bestW) { bestW = w; best = u; }
      }
      if (best) out.push(best);
      else if (parts.length) out.push(parts[parts.length - 1].split(/\s+/)[0]);
    }
  }
  return out;
}

export async function fetchPageImages(url: string): Promise<ContextImage[]> {
  if (!url) return [];
  const __t0 = Date.now();
  console.log('[HN][img] start', url);
  const candidates: string[] = [];
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HNEsBot/1.0)', 'Accept': 'text/html' },
      redirect: 'follow',
    });
    if (r.ok) {
      const html = await r.text();
      candidates.push(...metaImageCandidates(html));
      candidates.push(...imgTagCandidates(html));
    }
  } catch { /* ignore */ }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const c of candidates) {
    const abs = resolveUrl(c, url);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    unique.push(c);
  }

  const results: ContextImage[] = [];
  const toFetch = unique.slice(0, 2);
  for (const c of toFetch) {
    const img = await downloadImage(c, url);
    if (img) results.push(img);
  }
  const __imgs = dedupeImages(results);
  console.log('[HN][img] done', url, 'images=', __imgs.length, 'ms=', Date.now() - __t0);
  return __imgs;
}

export async function fetchContext(url: string): Promise<ContextResult> {
  if (!url) return { text: '', images: [] };
  const __t0 = Date.now();
  console.log('[HN][ctx] start', url);
  const c = readCtx();
  if (c[url]) {
    try {
      const parsed = JSON.parse(c[url]);
      return { text: parsed?.text || '', images: Array.isArray(parsed?.images) ? parsed.images : [] };
    } catch { /* fall through */ }
  }
  let snippet = '';
  const jinaImages: string[] = [];
  try {
    const r = await fetch(`https://r.jina.ai/${url}`);
    if (r.ok) {
      const t = await r.text();
      const idx = t.indexOf('Markdown Content:');
      const content = idx >= 0 ? t.slice(idx + 'Markdown Content:'.length) : t;
      snippet = content.replace(/\s+/g, ' ').trim();
      if (snippet.length > 4000) snippet = snippet.slice(0, 3997) + '…';
      for (const m of content.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
        jinaImages.push(m[1]);
      }
    }
  } catch { /* ignore */ }

  const pageImages = await fetchPageImages(url);
  const jinaDownloaded: ContextImage[] = [];
  for (const img of jinaImages.slice(0, 1)) {
    const d = await downloadImage(img, url);
    if (d) jinaDownloaded.push(d);
  }
  const images = dedupeImages([...pageImages, ...jinaDownloaded]);

  try {
    c[url] = JSON.stringify({ text: snippet, images });
    writeCtx(c);
  } catch { /* ignore */ }
  console.log('[HN][ctx] done', url, 'images=', images.length, 'snippet=', snippet.length, 'ms=', Date.now() - __t0);
  return { text: snippet, images };
}
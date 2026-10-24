import fs from 'node:fs';
import path from 'node:path';

const ORIGIN = 'https://www.indiehackers.com';
const CACHE_VERSION = 1;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** No hay API pública: Firebase responde 401 y el HTML actual no expone Algolia. */
const SOURCES: { path: string; category?: string }[] = [
  { path: '/products' },
  { path: '/products?board=15' },
  { path: '/products?businessModel=free', category: 'Gratis' },
  { path: '/products?businessModel=ads', category: 'Anuncios' },
  { path: '/products?businessModel=commission', category: 'Comisión' },
  { path: '/products?businessModel=transactions', category: 'Transacciones' },
  { path: '/products?businessModel=subscriptions', category: 'Suscripción' },
  { path: '/products?category=ai', category: 'IA' },
  { path: '/products?category=programming', category: 'Programación' },
  { path: '/products?category=marketing', category: 'Marketing' },
  { path: '/products?category=productivity', category: 'Productividad' },
  { path: '/products?category=finance', category: 'Finanzas' },
  { path: '/products?category=education', category: 'Educación' },
  { path: '/products?category=design', category: 'Diseño' },
  { path: '/products?category=e-commerce', category: 'Comercio' },
];

export interface IHProduct {
  slug: string;
  name: string;
  tagline: string;
  revenue: number;
  verified: boolean;
  avatar?: string;
  website?: string;
  ihUrl: string;
  categories: string[];
}

export interface IHBoardItem {
  slug: string;
  name: string;
  tagline: string;
  update: string;
  votes: number;
  rank: number;
  avatar?: string;
  website?: string;
  ihUrl: string;
}

export interface IHDirectory {
  products: IHProduct[];
  board: IHBoardItem[];
  fetchedAt: string;
}

function cacheFile(): string {
  return path.resolve(process.cwd(), '.cache', 'indiehackers.json');
}

function readCache(): IHDirectory | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as {
      version?: number;
      savedAt?: number;
      data?: IHDirectory;
    };
    if (raw.version !== CACHE_VERSION || !raw.savedAt || !raw.data) return null;
    if (Date.now() - raw.savedAt > CACHE_TTL_MS) return null;
    if (!raw.data.products?.length && !raw.data.board?.length) return null;
    return raw.data;
  } catch {
    return null;
  }
}

function writeCache(data: IHDirectory) {
  try {
    const file = cacheFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: CACHE_VERSION, savedAt: Date.now(), data }));
  } catch {
    /* ignore */
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attr(html: string, pattern: RegExp): string {
  return decodeEntities(html.match(pattern)?.[1] || '');
}

function absIh(href: string): string {
  if (!href) return ORIGIN + '/products';
  if (href.startsWith('http')) return href;
  return ORIGIN + (href.startsWith('/') ? href : `/${href}`);
}

function slugFrom(href: string): string {
  return decodeURIComponent(href.match(/\/product\/([^/?#]+)/)?.[1] || '');
}

function parseMoney(html: string): number {
  const raw = textOf(html).replace(/\s+/g, '');
  const m = raw.match(/([\d][\d,]*)/);
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseCards(html: string, category?: string): IHProduct[] {
  const start = html.indexOf('id="products-grid"');
  if (start < 0) return [];
  let end = html.length;
  for (const marker of ['Create a free account', 'products-index__signup', '</main>']) {
    const i = html.indexOf(marker, start);
    if (i > start && i < end) end = i;
  }
  const chunks = html.slice(start, end).split('<div class="product-card">').slice(1);
  const out: IHProduct[] = [];
  for (const chunk of chunks) {
    const href = attr(chunk, /class="product-card__link" href="([^"]+)"/);
    const slug = slugFrom(href);
    const name = textOf(chunk.match(/class="product-card__name">([\s\S]*?)<\/span>/)?.[1] || '');
    if (!slug || !name) continue;
    const tagline = textOf(chunk.match(/class="product-card__tagline">([\s\S]*?)<\/span>/)?.[1] || '');
    const revenueHtml = chunk.match(/class="product-card__revenue-number">([\s\S]*?)<\/span>\s*<\/span>/)?.[1]
      || chunk.match(/class="product-card__revenue-number">([\s\S]*?)<\/span>/)?.[1]
      || '';
    const explanation = textOf(chunk.match(/class="product-card__revenue-explanation">([\s\S]*?)<\/span>/)?.[1] || '');
    const verified = /stripe/i.test(chunk) || /verified revenue/i.test(explanation);
    const selfReported = /self-reported/i.test(explanation);
    const revenue = parseMoney(revenueHtml);
    if (selfReported && !verified) continue;
    if (!verified) continue;
    const avatar = attr(chunk, /<img[^>]+src="(https?:\/\/[^"]+)"/);
    out.push({
      slug,
      name,
      tagline,
      revenue,
      verified: true,
      avatar: avatar || undefined,
      ihUrl: absIh(`/product/${slug}`),
      categories: category ? [category] : [],
    });
  }
  return out;
}

function parseBoard(html: string): IHBoardItem[] {
  const start = html.indexOf('top-products__list');
  if (start < 0) return [];
  const end = html.indexOf('</ol>', start);
  const list = html.slice(start, end > start ? end : start + 30000);
  const out: IHBoardItem[] = [];
  for (const m of list.matchAll(/<li class="top-product top-product--post"[\s\S]*?<\/li>/g)) {
    const block = m[0];
    const href = attr(block, /class="top-product__overlay" href="([^"]+)"/);
    const slug = slugFrom(href);
    const name = textOf(block.match(/<strong>([\s\S]*?)<\/strong>/)?.[1] || '');
    if (!slug || !name) continue;
    const tagline = textOf(block.match(/top-product__snippet--product-info[\s\S]*?<span>([\s\S]*?)<\/span>/)?.[1] || '');
    const update = attr(block, /aria-label="([^"]*)"/) || textOf(block.match(/class="top-product__title">([\s\S]*?)<\/div>/)?.[1] || '');
    const website = attr(block, /class="top-product__website-button" href="([^"]+)"/);
    const avatar = attr(block, /<img[^>]+src="(https?:\/\/[^"]+)"/);
    const votes = Number((block.match(/post-liker__count">([\d,]+)/)?.[1] || '0').replace(/,/g, ''));
    const rank = Number(block.match(/top-product__ranking">(\d+)/)?.[1] || 0);
    out.push({
      slug,
      name,
      tagline,
      update,
      votes: Number.isFinite(votes) ? votes : 0,
      rank: rank || out.length + 1,
      avatar: avatar || undefined,
      website: website || undefined,
      ihUrl: absIh(href),
    });
  }
  return out;
}

async function fetchHtml(pagePath: string): Promise<string> {
  const url = ORIGIN + pagePath;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
  };
  try {
    const direct = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(12_000) });
    if (direct.ok) {
      const html = await direct.text();
      if (html.includes('product-card') || html.includes('top-product')) return html;
    }
  } catch {
    /* Cloudflare u otro bloqueo: seguimos con el lector */
  }

  const proxied = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; HNEsBot/1.0)',
      Accept: 'text/html',
      'X-Return-Format': 'html',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000),
  });
  if (!proxied.ok) throw new Error(`No se pudo leer ${pagePath} (${proxied.status})`);
  const raw = await proxied.text();
  const start = raw.search(/<!DOCTYPE|<html/i);
  return start > 0 ? raw.slice(start) : raw;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function mergeDirectory(pages: { products: IHProduct[]; board: IHBoardItem[] }[]): IHDirectory {
  const products = new Map<string, IHProduct>();
  for (const page of pages) {
    for (const product of page.products) {
      const prev = products.get(product.slug);
      if (!prev) {
        products.set(product.slug, { ...product, categories: [...product.categories] });
        continue;
      }
      const categories = [...new Set([...prev.categories, ...product.categories])];
      const richer = product.revenue > prev.revenue ? product : prev;
      products.set(product.slug, {
        ...richer,
        tagline: richer.tagline || prev.tagline || product.tagline,
        avatar: richer.avatar || prev.avatar,
        website: richer.website || prev.website,
        categories,
        verified: prev.verified || product.verified,
      });
    }
  }

  const board = new Map<string, IHBoardItem>();
  for (const page of pages) {
    for (const item of page.board) {
      const key = item.ihUrl || item.slug;
      const prev = board.get(key);
      if (!prev || item.votes > prev.votes || (item.votes === prev.votes && item.rank < prev.rank)) {
        board.set(key, { ...item, website: item.website || prev?.website, avatar: item.avatar || prev?.avatar });
      }
    }
  }

  const websiteBySlug = new Map<string, string>();
  for (const item of board.values()) {
    if (item.website) websiteBySlug.set(item.slug, item.website);
  }
  for (const product of products.values()) {
    if (!product.website && websiteBySlug.has(product.slug)) {
      product.website = websiteBySlug.get(product.slug);
    }
  }

  return {
    products: [...products.values()].sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, 'es')),
    board: [...board.values()].sort((a, b) => a.rank - b.rank || b.votes - a.votes),
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchIndieHackers(): Promise<IHDirectory> {
  const cached = readCache();
  if (cached) return cached;

  const pages = await mapPool(SOURCES, 3, async (source) => {
    try {
      const html = await fetchHtml(source.path);
      return { products: parseCards(html, source.category), board: parseBoard(html) };
    } catch (error) {
      console.warn('[IH]', source.path, error instanceof Error ? error.message : error);
      return { products: [], board: [] };
    }
  });

  const data = mergeDirectory(pages);
  if (data.products.length || data.board.length) writeCache(data);
  return data;
}

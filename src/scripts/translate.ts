import { NO_TRANSLATE_UNIQUE } from './dictionary';

const KEY = 'hn-es-cache-v2';

function readCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function writeCache(c: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore quota errors */
  }
}

// Protege las palabras del diccionario sustituyéndolas por marcadores únicos
// antes de enviar el texto al traductor, para restaurarlas después.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PROTECT_RE = new RegExp(
  NO_TRANSLATE_UNIQUE.map((w) => '\\b' + escapeRegex(w) + '\\b').join('|'),
  'gi',
);

export function protect(text: string): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  const out = text.replace(PROTECT_RE, (match) => {
    const idx = tokens.length;
    tokens.push(match);
    return `__NT${idx}__`;
  });
  return { text: out, tokens };
}

export function restore(text: string, tokens: string[]): string {
  if (!tokens.length) return text;
  return text.replace(/__NT(\d+)__/g, (_, i) => {
    const idx = Number(i);
    return Number.isInteger(idx) && idx >= 0 && idx < tokens.length ? tokens[idx] : `__NT${i}__`;
  });
}

export async function toSpanish(text: string): Promise<string> {
  if (!text) return text;
  const c = readCache();
  if (c[text]) return c[text];

  const { text: protectedText, tokens } = protect(text);
  const input = protectedText.length > 2000 ? protectedText.slice(0, 1997) + '…' : protectedText;

  // 1) Google Translate (no key, CORS *)
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(input)}`;
    const r = await fetch(url);
    if (r.ok) {
      const d = await r.json();
      const t = (d?.[0] || []).map((x: any) => x?.[0] || '').join('');
      if (t && t.trim()) {
        const restored = restore(t, tokens);
        c[text] = restored;
        writeCache(c);
        return restored;
      }
    }
  } catch {
    /* fall through */
  }

  // 2) Fallback MyMemory
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(input)}&langpair=en|es`;
    const r = await fetch(url);
    if (r.ok) {
      const d = await r.json();
      let t = d?.responseData?.translatedText || text;
      if (!t || /MYMEMORY WARNING/i.test(t)) t = text;
      const restored = t === text ? text : restore(t, tokens);
      c[text] = restored;
      writeCache(c);
      return restored;
    }
  } catch {
    /* ignore */
  }

  return text;
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

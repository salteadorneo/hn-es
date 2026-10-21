const KEY = 'hn-es-cache-v1';

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

export async function toSpanish(text: string): Promise<string> {
  if (!text) return text;
  const c = readCache();
  if (c[text]) return c[text];

  const input = text.length > 2000 ? text.slice(0, 1997) + '…' : text;

  // 1) Google Translate (no key, CORS *)
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(input)}`;
    const r = await fetch(url);
    if (r.ok) {
      const d = await r.json();
      const t = (d?.[0] || []).map((x: any) => x?.[0] || '').join('');
      if (t && t.trim()) {
        c[text] = t;
        writeCache(c);
        return t;
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
      c[text] = t;
      writeCache(c);
      return t;
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
import { NO_TRANSLATE_UNIQUE } from './dictionary';

const KEY = 'hn-es-cache-v6';

// @ts-ignore
const OPENROUTER_KEY = (import.meta.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '') as string;
// @ts-ignore
const OPENROUTER_MODEL = (import.meta.env.OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-6-luna') as string;
export const OPENROUTER_ENABLED = Boolean(OPENROUTER_KEY);
const memoryCache = new Map<string, string>();
console.info(`[translate] OpenRouter ${OPENROUTER_ENABLED ? 'activo' : 'desactivado'}${OPENROUTER_ENABLED ? `; modelo=${OPENROUTER_MODEL}` : '; fallback Google/MyMemory'}`);


function readCache(): Record<string, string> {
  try {
    return { ...Object.fromEntries(memoryCache), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return Object.fromEntries(memoryCache);
  }
}

function writeCache(c: Record<string, string>) {
  for (const [key, value] of Object.entries(c)) memoryCache.set(key, value);
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore quota errors */
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSentenceStart(str: string, offset: number): boolean {
  let i = offset - 1;
  while (i >= 0 && /\s/.test(str[i])) i--;
  if (i < 0) return true;
  const ch = str[i];
  return ch === '.' || ch === '!' || ch === '?' || ch === '\n' || ch === '\r';
}

const DICT_RE = new RegExp(
  NO_TRANSLATE_UNIQUE.map((w) => '\\b' + escapeRegex(w) + '\\b').join('|'),
  'gi',
);

const CAP_RE = /\b[A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9'-]*\b/g;

export function protect(text: string): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  let out = text.replace(DICT_RE, (match) => {
    const idx = tokens.length;
    tokens.push(match);
    return `__NT${idx}__`;
  });
  out = out.replace(CAP_RE, (match, offset, str) => {
    if (isSentenceStart(str, offset)) return match;
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

async function translateWithOpenRouter(text: string): Promise<string | null> {
  if (!OPENROUTER_KEY) return null;
  const started = Date.now();
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://salteadorneo.github.io',
        'X-Title': 'Hacker News en Espanol',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          {
            role: 'system',
            content: 'Traduce todo el contenido al español con un estilo periodístico claro y natural. La respuesta debe estar íntegramente en español, salvo nombres propios, código y tokens protegidos. No resumas ni omitas información. Devuelve únicamente la traducción, sin comentarios ni explicaciones. Conserva exactamente los tokens __NT0__, __NT1__, etc.',
          },
          {
            role: 'user',
            content: text,
          },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      console.warn(`[translate][openrouter] HTTP ${r.status} model=${OPENROUTER_MODEL} chars=${text.length} ms=${Date.now() - started}: ${detail}`);
      return null;
    }
    const d = await r.json();
    const t = d?.choices?.[0]?.message?.content?.trim();
    if (!t) {
      console.warn(`[translate][openrouter] respuesta vacía model=${OPENROUTER_MODEL} chars=${text.length} ms=${Date.now() - started}`);
      return null;
    }
    console.log(`[translate][openrouter] ok model=${OPENROUTER_MODEL} chars=${text.length} ms=${Date.now() - started}`);
    return t;
  } catch (error) {
    console.warn(`[translate][openrouter] error model=${OPENROUTER_MODEL} chars=${text.length} ms=${Date.now() - started}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function splitChunks(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length <= max) {
      cur += s;
    } else {
      if (cur.trim()) chunks.push(cur.trim());
      if (s.length > max) {
        for (let i = 0; i < s.length; i += max) {
          const part = s.slice(i, i + max).trim();
          if (part) chunks.push(part);
        }
        cur = '';
      } else {
        cur = s;
      }
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length ? chunks : [text.slice(0, max)];
}

export async function toSpanish(text: string): Promise<string> {
  if (!text) return text;
  const c = readCache();
  if (c[text]) return c[text];

  const chunkSize = OPENROUTER_KEY ? 5000 : 450;
  // Troceamos textos largos (MyMemory limita a 500 chars; LLM acepta mas).
  if (text.length > chunkSize) {
    const chunks = splitChunks(text, chunkSize);
    const results: string[] = [];
    for (const ch of chunks) {
      results.push(await toSpanish(ch));
    }
    const joined = results.join(' ');
    c[text] = joined;
    writeCache(c);
    return joined;
  }

  const { text: protectedText, tokens } = protect(text);

  // Con clave, usar el LLM también para titulares; sin clave, usar los traductores gratuitos.
  if (OPENROUTER_KEY) {
    const or = await translateWithOpenRouter(protectedText);
    if (or) {
      const restored = restore(or, tokens);
      c[text] = restored;
      writeCache(c);
      return restored;
    }
  }

  const input = protectedText.length > 2000 ? protectedText.slice(0, 1997) + '…' : protectedText;

  try {
    const started = Date.now();
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(input)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (r.ok) {
      const d = await r.json();
      const t = (d?.[0] || []).map((x: any) => x?.[0] || '').join('');
      if (t && t.trim()) {
        console.log(`[translate][google] ok chars=${text.length} ms=${Date.now() - started}`);
        const restored = restore(t, tokens);
        c[text] = restored;
        writeCache(c);
        return restored;
      }
      console.warn(`[translate][google] respuesta vacía chars=${text.length} ms=${Date.now() - started}`);
    } else {
      console.warn(`[translate][google] HTTP ${r.status} chars=${text.length} ms=${Date.now() - started}`);
    }
  } catch (error) {
    console.warn(`[translate][google] error chars=${text.length}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(input)}&langpair=en|es`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (r.ok) {
      const d = await r.json();
      let t = d?.responseData?.translatedText || text;
      if (!t || /MYMEMORY WARNING/i.test(t) || /QUERY LENGTH LIMIT EXCEEDED/i.test(t)) {
        console.warn(`[translate][mymemory] respuesta no traducida chars=${text.length}`);
      } else {
        console.log(`[translate][mymemory] ok chars=${text.length}`);
        const restored = restore(t, tokens);
        c[text] = restored;
        writeCache(c);
        return restored;
      }
    }
  } catch (error) {
    console.warn(`[translate][mymemory] error chars=${text.length}: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.warn(`[translate] proveedores sin respuesta válida; se conserva el texto original (chars=${text.length})`);
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

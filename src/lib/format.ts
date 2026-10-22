import type { ContextImage } from '../scripts/hn';

export function isLargeImage(img: ContextImage): boolean {
  return (img.width >= 500 || img.height >= 350 || img.width * img.height >= 150000);
}

export function titleSize(score: number): string {
  const s = score ?? 0;
  if (s >= 400) return 'text-3xl';
  if (s >= 250) return 'text-2xl';
  if (s >= 100) return 'text-xl';
  return 'text-lg';
}

export function stripHtml(html: string): string {
  let h = html.replace(/<a\b[^>]*?\shref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, url, text) => {
    const t = String(text).replace(/<[^>]*>/g, '').trim();
    return `[${t}](${url})`;
  });
  const tmp = (globalThis as any).document ? document.createElement('textarea') : null;
  if (tmp) {
    tmp.innerHTML = h.replace(/<[^>]*>/g, ' ');
    return (tmp.value || '').replace(/\s+/g, ' ').trim();
  }
  const decoded = h
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
  return decoded.replace(/\s+/g, ' ').trim();
}

export function mdToHtml(md: string, linkify = true): string {
  if (!md) return '';
  let s = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  const links: { text: string; url: string }[] = [];
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, text, url) => {
    const idx = links.length;
    links.push({ text, url });
    return `\u0000LINK${idx}\u0000`;
  });
  s = s.replace(/https?:\/\/\S+/g, '');
  s = s.replace(/\u0000LINK(\d+)\u0000/g, (_m, i) => {
    const { text, url } = links[Number(i)];
    if (!linkify) return text;
    return `<a href="${url}" target="_blank" rel="noopener" class="text-accent hover:underline">${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/^### (.+)$/gm, '<h4 class="mt-3 font-serif text-lg font-semibold text-ink">$1</h4>');
  s = s.replace(/^## (.+)$/gm, '<h3 class="mt-3 font-serif text-xl font-semibold text-ink">$1</h3>');
  s = s.replace(/^# (.+)$/gm, '<h2 class="mt-3 font-serif text-2xl font-semibold text-ink">$1</h2>');
  const lines = s.split(/\n/);
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s+(.+)/);
    if (m) {
      if (!inList) { out.push('<ul class="ml-5 list-disc space-y-1">'); inList = true; }
      out.push(`<li>${m[1]}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (line.trim() === '') out.push('</p><p class="mt-2">');
      else if (line.trim().startsWith('<h') || line.trim().startsWith('<ul') || line.trim().startsWith('</ul>')) out.push(line);
      else out.push(line + '<br>');
    }
  }
  if (inList) out.push('</ul>');
  s = out.join('\n');
  if (!/^<[hupul]/.test(s.trim())) s = `<p>${s}</p>`;
  s = s.replace(/<p>\s*<\/p>/g, '');
  return s;
}

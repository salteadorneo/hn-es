/** Prefija `base` de astro.config. BASE_URL no siempre termina en `/`. */
export function withBase(path = ''): string {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${path.replace(/^\/+/, '')}`;
}

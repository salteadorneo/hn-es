// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://salteadorneo.github.io',
  base: '/hn-es',
  vite: {
    plugins: [tailwindcss()],
  },
});
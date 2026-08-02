import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Injects a `<link rel="preload">` for the Persian font face.
 *
 * The font is discovered late otherwise: the browser has to download and parse
 * the stylesheet before it learns the font exists, which shows a flash of
 * fallback text on every cold load. Writing the tag by hand in `index.html` is
 * not an option because the emitted filename carries a content hash, so we look
 * the real name up in the bundle after it is built.
 */
function preloadPersianFont(): Plugin {
  const PLACEHOLDER = '<!--persian-font-preload-->';
  return {
    name: 'hokm-preload-persian-font',
    enforce: 'post',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const fontFile = Object.keys(ctx.bundle ?? {}).find(
          (name) => name.includes('vazirmatn-arabic') && name.endsWith('.woff2'),
        );
        if (!fontFile) return html;
        const tag = `<link rel="preload" as="font" type="font/woff2" href="/${fontFile}" crossorigin>`;
        return html.includes(PLACEHOLDER)
          ? html.replace(PLACEHOLDER, tag)
          : html.replace('</head>', `  ${tag}\n  </head>`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), preloadPersianFont()],
  server: {
    port: 5173,
  },
});

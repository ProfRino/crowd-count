import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Single-file build: every asset (JS, CSS, fonts, images) is inlined into
// `dist/index.html`. The resulting file works when opened straight from
// `file://` — no local web server required. The hosted version uses the
// same file too; there's no separate "deploy" build.
export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  base: './',
  server: { port: Number(process.env.PORT) || 5173 },
  build: {
    target: 'es2022',
    sourcemap: false,
    // viteSingleFile already requires assetsInlineLimit: huge — but we set it
    // explicitly here so future Vite versions can't override the default.
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 5000,
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
})

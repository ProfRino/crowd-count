import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  server: { port: Number(process.env.PORT) || 5173 },
  build: { target: 'es2022', sourcemap: true },
})

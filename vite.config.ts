import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { licenses } from './licenses/plugin'
import { serviceWorker } from './pwa/plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), licenses(import.meta.dirname), serviceWorker()],
  // GitHub Pages の独自ドメイン（public/CNAME の bani.hashrock.info）でルートから配信する
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})

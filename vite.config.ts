import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { serviceWorker } from './pwa/plugin'

// GitHub Pages はリポジトリ名のサブパスで配信されるので、Actions 上ではそこから base を決める。
// リポジトリ名を変えても設定を書き換えずに済む
const repository = process.env.GITHUB_REPOSITORY?.split('/')[1]

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  base: process.env.GITHUB_ACTIONS && repository ? `/${repository}/` : '/',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})

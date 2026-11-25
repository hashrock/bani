import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// 配色（.dark）を最初の描画より前に決める
import './app/theme'
import App from './App.tsx'
import { I18nProvider } from './i18n/I18nProvider'

// 本番ビルドだけ Service Worker を入れて、2 回目以降はオフラインでも開けるようにする。
// 開発サーバーでは入れない（HMR とキャッシュがぶつかる）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((err) => console.error('Service Worker registration failed:', err))
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)

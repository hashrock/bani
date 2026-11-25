import { useSyncExternalStore } from 'react'
import { formatRoute, parseHash } from './routes'
import type { Route } from './routes'

/**
 * hash ベースの小さな router。
 * GitHub Pages のサブパスでも、Service Worker でオフライン配信しても、
 * サーバー側の設定なしに深いリンクがそのまま開ける。
 */
function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

const getHash = () => window.location.hash

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash)
  return parseHash(hash)
}

export function navigate(route: Route) {
  const next = formatRoute(route)
  if (window.location.hash !== next) window.location.hash = next
}

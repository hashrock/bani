import { useSyncExternalStore } from 'react'
import { createHashGuard } from './hashGuard'
import { confirmLeave, hasUnsaved } from './leaveGuard'
import { formatRoute, parseHash } from './routes'
import type { Route } from './routes'

/**
 * hash ベースの小さな router。
 * GitHub Pages のサブパスでも、Service Worker でオフライン配信しても、
 * サーバー側の設定なしに深いリンクがそのまま開ける。
 *
 * 画面は URL の hash ではなく、確認を通った hash（hashGuard）から決める。
 * 保存していない変更があるときにブラウザの戻る・進むで離れようとしたら、確かめてから移る。
 */
const listeners = new Set<() => void>()

const sameScreen = (a: string, b: string) => formatRoute(parseHash(a)) === formatRoute(parseHash(b))

const guard = createHashGuard({
  history: window.history,
  getHash: () => window.location.hash,
  needsConfirm: (from, to) => hasUnsaved() && !sameScreen(from, to),
  confirm: () => confirmLeave(),
  onCommit: () => listeners.forEach((listener) => listener()),
})

window.addEventListener('popstate', () => guard.handlePopState())
window.addEventListener('hashchange', () => guard.handleHashChange())

/** 画面が移ったとき（確認を通った後）に呼ぶ */
export function subscribeRoute(onChange: () => void) {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

export function currentRoute(): Route {
  return parseHash(guard.committed())
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribeRoute, guard.committed)
  return parseHash(hash)
}

export function navigate(route: Route) {
  const next = formatRoute(route)
  if (window.location.hash !== next) window.location.hash = next
}

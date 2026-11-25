import { useI18n } from './context'
import type { Lang } from './messages'

/**
 * 画面ごとの文言。共通の messages.ts に全部を集めると並行作業でぶつかるので、
 * 各画面は自分のフォルダに `{ ja, en }` を置いてこれで引く。
 * 日本語を正とし、英語は同じ形にする（`defineMessages` が型で揃える）。
 */
export function defineMessages<T>(messages: { ja: T } & { [L in Exclude<Lang, 'ja'>]: T }) {
  return messages
}

export function useLocalMessages<T>(messages: Record<Lang, T>): T {
  const { lang } = useI18n()
  return messages[lang]
}

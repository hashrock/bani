/*
 * ブラウザの戻る・進むで編集画面を離れるときの確認。
 *
 * hashchange が届いた時点で URL はもう変わっていて、取り消す API はない。そこで
 * - 画面に出すのは「確定した hash」で、URL の hash ではない（確かめるあいだ編集画面を作り直さない）
 * - 履歴の各項目に番号（history.state.baniIndex）を振り、戻る・進むで何歩動いたかを知る
 * - 離れてよいと言われたら確定し、断られたら同じ歩数だけ逆に動いて元の項目へ戻す
 * 戻す動き自身の hashchange は確かめずに受け流すので、確認が繰り返したり履歴が増えたりしない。
 */

/** window.history のうち使う部分。テストでは偽物を渡す */
export interface HistoryLike {
  readonly state: unknown
  replaceState(data: unknown, unused: string): void
  go(delta: number): void
}

export interface HashGuardDeps {
  history: HistoryLike
  getHash: () => string
  /** from から to へ移るのに確認が要るか（保存していない変更があり、画面が変わるとき） */
  needsConfirm: (from: string, to: string) => boolean
  /** 確かめる。true なら離れてよい */
  confirm: () => boolean
  /** 確定した hash が変わったとき */
  onCommit: (hash: string) => void
}

export interface HashGuard {
  /** 画面に出す hash */
  committed(): string
  handlePopState(): void
  handleHashChange(): void
}

const INDEX_KEY = 'baniIndex'

function readIndex(state: unknown): number | null {
  if (typeof state !== 'object' || state === null) return null
  const value = (state as Record<string, unknown>)[INDEX_KEY]
  return typeof value === 'number' ? value : null
}

function writeIndex(history: HistoryLike, index: number) {
  const base = typeof history.state === 'object' && history.state !== null ? history.state : {}
  history.replaceState({ ...base, [INDEX_KEY]: index }, '')
}

export function createHashGuard(deps: HashGuardDeps): HashGuard {
  const { history } = deps
  let committed = deps.getHash()
  // 再読み込みしても history.state は残るので、振ってあればそれを引き継ぐ
  let index = readIndex(history.state) ?? 0
  writeIndex(history, index)
  /** 断られて元の項目へ戻している最中。次に元の hash が届いたら受け流す */
  let reverting = false

  const commit = (hash: string, nextIndex: number) => {
    index = nextIndex
    writeIndex(history, nextIndex)
    if (hash === committed) return
    committed = hash
    deps.onCommit(hash)
  }

  return {
    committed: () => committed,
    /**
     * 戻る・進むのたびに届く（hashchange より先）。hash が同じ項目へ動いたときは hashchange が来ないので、
     * ここで番号だけ合わせておく。合わせないと次の歩数を数え違え、断ったときに別の項目へ戻してしまう
     */
    handlePopState() {
      if (deps.getHash() !== committed) return
      reverting = false
      index = readIndex(history.state) ?? index
    },
    handleHashChange() {
      const hash = deps.getHash()
      const entry = readIndex(history.state)

      if (reverting && hash === committed) {
        reverting = false
        index = entry ?? index
        return
      }
      reverting = false

      // 番号のない項目は、リンクや hash の代入で新しく積まれたもの（今の 1 つ先）
      const nextIndex = entry ?? index + 1
      if (!deps.needsConfirm(committed, hash) || deps.confirm()) {
        commit(hash, nextIndex)
        return
      }

      // 動いた歩数だけ逆に戻す。新しく積まれた項目は進む側に残るが、ブラウザの通常の動きと同じ
      const delta = nextIndex - index
      if (delta === 0) {
        // 歩数がわからない（番号が壊れている）ときは戻せないので、そのまま受け入れる
        commit(hash, nextIndex)
        return
      }
      // 戻す前に、いま居る項目へ番号を振っておく。新しく積まれた項目は番号のないまま進む側に残り、
      // あとで 2 歩以上の go で来たときに「今の 1 つ先」と数え違えるため
      writeIndex(history, nextIndex)
      reverting = true
      history.go(-delta)
    },
  }
}

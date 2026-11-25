import type { OpenedFile } from '../core/opened'
import type { ResumedSession } from '../core/session'

/** すべての単体編集画面が受け取るもの。画面はファイルごとに作り直される（key） */
export interface EditPageProps {
  /** 開いているファイル。入口の「編集」から来たときは null（空の画面・新規の文書から始める） */
  opened: OpenedFile | null
  /** アプリ全体でファイルをドラッグしているか（ドロップ先の見た目に使う） */
  isDragging: boolean
  /**
   * ファイルを開き直す。種類と数による振り分け（planIntake）を通り、
   * 保存していない変更があれば先に確かめる
   */
  onFiles: (files: OpenedFile[]) => void
  /** 保存で元ファイルを書き換えたとき。保存済みなので確かめずに開き直す */
  onReopen: (opened: OpenedFile) => void
  /**
   * 保存していない変更があるかを知らせる（src/app/leaveGuard.ts の useReportUnsaved で渡す）。
   * レシピのある画面は、開いた・保存したときからレシピが変わっていれば変更あり
   */
  onDirtyChange: (dirty: boolean) => void
  /**
   * 入口の「前回の作業を再開」から来たとき。opened はそのとき読み直したファイル。
   * 画面は useSessionRecipe に渡し、残っていたレシピを当てる
   */
  resumed?: ResumedSession | null
}

/**
 * 単体編集の画面の対応状況。各メディアの `src/pages/<kind>/meta.ts` に置く。
 * 一括変換で受け付ける種類は src/pages/convert/kinds.ts が持つ
 */
export interface PageMeta {
  /** 単体編集の画面があるか */
  edit: boolean
}

import type { OpenedFile } from '../core/opened'

/** すべての単体編集画面が受け取るもの。画面はファイルごとに作り直される（key） */
export interface EditPageProps {
  /** 開いているファイル。入口の「編集」から来たときなどは null */
  opened: OpenedFile | null
  /** アプリ全体でファイルをドラッグしているか（ドロップ先の見た目に使う） */
  isDragging: boolean
  /** ファイルを開き直す。種類と数による振り分け（planIntake）を通る */
  onFiles: (files: OpenedFile[]) => void
}

/** 画面の対応状況。各メディアの `src/pages/<kind>/meta.ts` に置く */
export interface PageMeta {
  /** 単体編集の画面があるか */
  edit: boolean
  /** 一括変換（#/convert）で受け付けるか */
  convert: boolean
}

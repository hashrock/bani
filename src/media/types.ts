/**
 * すべてのメディア（src/media/<kind>/）が共有する約束事。
 *
 * 各メディアは次の形で作る:
 * - `<Kind>Recipe`: 非破壊編集の内容を表す不変オブジェクト。元ファイルは持たない
 * - `apply<Kind>Edit(recipe, edit, info)`: 編集操作を 1 つ適用した新しいレシピを返す純粋関数
 * - `probe<Kind>(file)`: 元ファイルから情報（尺・寸法・ページ数など）を読む
 * - `render<Kind>(file, recipe, output, options)`: 元ファイル + レシピ + 出力設定 から書き出す
 *
 * 取り消し・やり直しはレシピを src/core/history.ts に入れて扱う。
 */

/** 書き出しの中断と進み具合。すべての render が受け取る */
export interface RenderOptions {
  signal?: AbortSignal
  /** 0〜1 の進み具合 */
  onProgress?: (progress: number) => void
}

/** 書き出した結果。ダウンロードやフォルダへの保存は呼び出し側が行う */
export interface RenderedFile {
  blob: Blob
  filename: string
}

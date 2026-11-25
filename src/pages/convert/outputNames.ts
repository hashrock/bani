/**
 * 一括変換の出力名の衝突を解く。`a.mov` と `a.mp4` をどちらも MP4 にすると同じ `a.mp4` になるため、
 * 書き出す前に全件の名前を決めておく。
 *
 * - 衝突しない名前はそのまま使う（重複している名前だけを付け替える）
 * - 付け替えは入力順で 2 件目以降に ` (2)`、` (3)`… を拡張子の前に足す。番号は空いているもののうち最小
 * - 大文字・小文字だけの違いも衝突とみなす（macOS・Windows のフォルダや ZIP の展開先で同じ名前になるため）
 * 同じ入力からは常に同じ結果になる。
 */
export function resolveOutputNames(names: readonly string[]): string[] {
  const fold = (name: string) => name.toLowerCase()
  // 入力にある名前はすべて先に押さえておき、付け替えた名前がどれとも重ならないようにする
  const taken = new Set(names.map(fold))
  const used = new Set<string>()

  return names.map((name) => {
    const key = fold(name)
    // 同じ名前のうち最初の 1 件だけが元の名前を使う
    if (!used.has(key)) {
      used.add(key)
      return name
    }
    const { base, extension } = splitExtension(name)
    for (let n = 2; ; n++) {
      const candidate = `${base} (${n})${extension}`
      if (!taken.has(fold(candidate))) {
        taken.add(fold(candidate))
        used.add(fold(candidate))
        return candidate
      }
    }
  })
}

/** `a.tar.gz` のような二重の拡張子は気にせず、最後の 1 つだけを拡張子とみなす。先頭の `.` は名前の一部 */
export function splitExtension(name: string): { base: string; extension: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return { base: name, extension: '' }
  return { base: name.slice(0, dot), extension: name.slice(dot) }
}

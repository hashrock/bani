import { defineMessages } from '../../i18n/local'

/**
 * 一括変換の画面から「GIF にまとめる」で画像を渡すための受け渡し場所。
 * 編集画面はファイルを 1 つしか受け取らない（EditPageProps.opened）ので、
 * 渡したい画像をここに置いてから #/edit/gif へ移り、GIF の画面が空で開いたときに 1 回だけ受け取る。
 */
let pending: File[] | null = null

export function handOffFrames(files: readonly File[]): void {
  pending = files.length > 0 ? [...files] : null
}

/** 置いてある画像を受け取る（受け取ったら空にする） */
export function takeHandedOffFrames(): File[] | null {
  const files = pending
  pending = null
  return files
}

/** 一括変換の画面に出すボタンの文言（その画面の文言表を触らずに済むよう、ここに置く） */
export const handoffMessages = defineMessages({
  ja: {
    makeGif: (count: number) => `${count} 枚の画像を GIF にまとめる`,
    makeGifHint: '並んでいる順にフレームにして、GIF・アニメーションの画面で開きます。',
  },
  en: {
    makeGif: (count: number) => `Combine ${count} images into a GIF`,
    makeGifHint: 'Opens them as frames, in this order, on the GIF & animation screen.',
  },
})

import type { MediaKind } from '../app/routes'
import { defineMessages } from '../i18n/local'

/** 入口の種類カードに出す文言 */
export const hubMessages = defineMessages({
  ja: {
    inputs: '読み込み',
    outputs: '書き出し',
    private: 'ファイルはどこにも送信されません',
    kindsTitle: '対応しているファイル',
    kindDescription: {
      video: 'トリム・切り抜き・回転・速さの変更・字幕',
      audio: 'トリム・フェード・ノーマライズ・無音カット',
      image: '切り抜き・縮小・形式の変換',
      gif: 'フレームの並べ替え・表示時間・静止画から作る',
      pdf: 'ページの並べ替え・削除・画像への書き出し',
      text: '文字コードと改行の変換、Markdown のプレビュー',
      archive: '中身の閲覧・取り出し、新しく固める',
    } satisfies Record<MediaKind, string>,
  },
  en: {
    inputs: 'Opens',
    outputs: 'Saves as',
    private: 'Nothing is uploaded',
    kindsTitle: 'Supported files',
    kindDescription: {
      video: 'Trim, crop, rotate, change speed, subtitles',
      audio: 'Trim, fade, normalize, cut silence',
      image: 'Crop, resize, convert formats',
      gif: 'Reorder frames, set timing, build from stills',
      pdf: 'Reorder and delete pages, export as images',
      text: 'Change encoding and line endings, preview Markdown',
      archive: 'Browse and extract, or create new archives',
    } satisfies Record<MediaKind, string>,
  },
})

/**
 * 種類ごとに読み込める・書き出せる形式（入口で見せる代表的なもの）。
 * 読み込みは src/app/intake.ts の判定、書き出しは各メディアの出力の型に合わせる
 */
export const KIND_FORMATS: Record<MediaKind, { inputs: string[]; outputs: string[] }> = {
  video: { inputs: ['MP4', 'MOV', 'WebM', 'MKV', 'AVI', 'TS'], outputs: ['MP4', 'WebM', 'GIF'] },
  audio: { inputs: ['MP3', 'M4A', 'AAC', 'WAV', 'FLAC', 'OGG', 'Opus'], outputs: ['MP3', 'M4A', 'Opus', 'WAV', 'FLAC'] },
  image: { inputs: ['PNG', 'JPEG', 'WebP', 'AVIF', 'HEIC', 'BMP', 'SVG'], outputs: ['PNG', 'JPEG', 'WebP', 'AVIF'] },
  gif: { inputs: ['GIF', 'APNG', 'WebP'], outputs: ['GIF', 'WebP', 'MP4', 'WebM'] },
  pdf: { inputs: ['PDF'], outputs: ['PDF', 'PNG', 'JPEG'] },
  text: { inputs: ['TXT', 'MD', 'CSV', 'JSON', 'SRT', 'VTT', 'HTML', 'JS', 'YAML', 'SVG'], outputs: ['TXT', 'SRT', 'VTT', 'PNG'] },
  archive: { inputs: ['ZIP', 'tar', 'tar.gz', '7z', 'RAR'], outputs: ['ZIP', 'tar.gz'] },
}

import type { MediaKind } from '../../app/routes'
import { isSvgFile } from '../../media/image/svg'

/** 一括変換（#/convert）で受け付ける種類。対応を広げたらここに足す（並びは画面に出す順） */
export const CONVERT_KINDS = ['video', 'audio', 'image', 'text'] as const satisfies readonly MediaKind[]

export type ConvertKind = (typeof CONVERT_KINDS)[number]

export function isConvertKind(kind: MediaKind | null): kind is ConvertKind {
  return kind !== null && (CONVERT_KINDS as readonly MediaKind[]).includes(kind)
}

/**
 * 一括変換での種類。SVG は入口ではテキスト（コードとして編集する）だが、
 * 一括変換で文字コードを付け替えるより、画像として書き出すほうが役に立つので画像に回す
 */
export function batchKindOf(file: { name: string; type: string }, kind: MediaKind | null): MediaKind | null {
  return isSvgFile(file) ? 'image' : kind
}

/**
 * ファイル選択で絞り込む種類。MIME の指定だけだと text/* に入らないコード（.json や .ts）を
 * 選べないので、テキストは拡張子も並べる
 */
export const CONVERT_ACCEPT = [
  'video/*',
  'audio/*',
  'image/*',
  'text/*',
  '.txt',
  '.md',
  '.csv',
  '.tsv',
  '.json',
  '.srt',
  '.vtt',
  '.xml',
  '.yaml',
  '.yml',
  '.log',
].join(',')

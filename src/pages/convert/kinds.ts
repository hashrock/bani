import type { MediaKind } from '../../app/routes'

/** 一括変換（#/convert）で受け付ける種類。対応を広げたらここに足す（並びは画面に出す順） */
export const CONVERT_KINDS = ['video', 'audio', 'image', 'text'] as const satisfies readonly MediaKind[]

export type ConvertKind = (typeof CONVERT_KINDS)[number]

export function isConvertKind(kind: MediaKind | null): kind is ConvertKind {
  return kind !== null && (CONVERT_KINDS as readonly MediaKind[]).includes(kind)
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

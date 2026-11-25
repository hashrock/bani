import type { NewlineStyle, TextEncodingName } from '../../media/text'

/** 形式の名前。訳さずにそのまま出す */
export const ENCODING_LABELS: Record<TextEncodingName, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  shift_jis: 'Shift_JIS',
  'euc-jp': 'EUC-JP',
  'iso-2022-jp': 'ISO-2022-JP',
}

export const NEWLINE_LABELS: Record<Exclude<NewlineStyle, 'mixed' | 'none'>, string> = {
  lf: 'LF',
  crlf: 'CRLF',
  cr: 'CR',
}

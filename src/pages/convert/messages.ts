import { defineMessages } from '../../i18n/local'

/** 一括変換の画面の文言。共通のもの（中止、出力形式など）は messages.ts から引く */
export const convertMessages = defineMessages({
  ja: {
    dropHere: '一括変換する動画・音声・画像・テキストをここにドロップ',
    dropHint: '種類ごとに出力設定を選び、まとめて書き出します。ファイルはどこにも送信されません。',
    queued: (count: number) => `${count} ファイル`,
    addFiles: '追加',
    clearAll: 'すべて外す',
    removeFile: (name: string) => `${name} を一覧から外す`,
    groupTitle: (kind: string, count: number) => `${kind}（${count}）`,

    // 音声
    stepBitrate: 'ビットレート',
    bitrateLabel: 'kbps',
    losslessHint: '可逆形式なので、ビットレートは選べません。',
    audioUnavailable: 'このブラウザでは書き出せません',

    // 画像
    stepMaxSize: '大きさ',
    maxSizeLabel: '長辺の上限（px）',
    maxSizeHint: '空欄なら元の大きさのまま。小さい画像は引き伸ばしません。',
    imageLosslessHint: 'PNG は可逆形式なので、画質は選べません。',
    imageTarget: (size: string) => `目標サイズ: ${size} 以下（収まる範囲でいちばん高い画質を探します）`,
    clearTarget: '目標サイズを外す',

    // テキスト
    stepEncoding: '文字コード',
    stepNewline: '改行',
    stepBom: 'BOM',
    keep: '元のまま',
    bomAdd: '付ける',
    bomRemove: '外す',
    bomHint: 'BOM を持てるのは UTF-8 / UTF-16 だけです。',

    // 保存
    convert: (count: number) => `${count} ファイルを変換して保存`,
    saveZipAgain: 'ZIP を保存',
    zipCancelled: 'ZIP の保存を中止しました。「ZIP を保存」から保存し直せます。',
    nothingToSave: '変換できたファイルがないため、何も保存していません。',

    // 一覧
    renamed: (name: string) => `${name} として保存`,

    // 失敗の理由（エンジンの例外は英語なので、わかるものだけ言い換える）
    errorNoAudio: '音声トラックがありません',
    errorAudioFormat: (format: string) => `このブラウザでは ${format} を書き出せません`,
    errorUnrepresentable: (count: number, encoding: string) =>
      `${encoding} で表せない文字が ${count} 個あります。文字コードを UTF-8 などに変えてください`,
  },
  en: {
    dropHere: 'Drop videos, audio, images or text files to batch convert',
    dropHint: 'Pick output settings per kind and export them all at once. Nothing is uploaded.',
    queued: (count: number) => `${count} files`,
    addFiles: 'Add',
    clearAll: 'Remove all',
    removeFile: (name: string) => `Remove ${name} from the list`,
    groupTitle: (kind: string, count: number) => `${kind} (${count})`,

    stepBitrate: 'Bitrate',
    bitrateLabel: 'kbps',
    losslessHint: 'Lossless format, so there is no bitrate to choose.',
    audioUnavailable: 'This browser cannot encode this format',

    stepMaxSize: 'Size',
    maxSizeLabel: 'Max long edge (px)',
    maxSizeHint: 'Leave empty to keep the original size. Smaller images are never enlarged.',
    imageLosslessHint: 'PNG is lossless, so there is no quality to choose.',
    imageTarget: (size: string) => `Target size: ≤ ${size} (uses the highest quality that fits)`,
    clearTarget: 'Remove target size',

    stepEncoding: 'Encoding',
    stepNewline: 'Line endings',
    stepBom: 'BOM',
    keep: 'Keep',
    bomAdd: 'Add',
    bomRemove: 'Remove',
    bomHint: 'Only UTF-8 / UTF-16 can carry a BOM.',

    convert: (count: number) => `Convert and save ${count} files`,
    saveZipAgain: 'Save ZIP',
    zipCancelled: 'Saving the ZIP was cancelled. Use “Save ZIP” to save it again.',
    nothingToSave: 'No file was converted, so nothing was saved.',

    renamed: (name: string) => `Saved as ${name}`,

    errorNoAudio: 'No audio track',
    errorAudioFormat: (format: string) => `This browser cannot encode ${format}`,
    errorUnrepresentable: (count: number, encoding: string) =>
      `${count} character(s) cannot be represented in ${encoding}. Choose UTF-8 or another encoding`,
  },
})

export type ConvertMessages = (typeof convertMessages)['ja']

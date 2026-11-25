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

    // テキスト
    stepEncoding: '文字コード',
    stepNewline: '改行',
    stepBom: 'BOM',
    keep: '元のまま',
    bomAdd: '付ける',
    bomRemove: '外す',
    bomHint: 'BOM を持てるのは UTF-8 / UTF-16 だけです。',

    // 保存先
    stepSave: '保存先',
    saveFolder: 'フォルダ',
    saveZip: 'ZIP',
    saveFolderHint: '選んだフォルダに 1 つずつ書き込みます。同じ名前のファイルは上書きします。',
    saveZipHint: '変換が終わったら 1 つの ZIP にまとめて保存します。',
    folderUnavailable: 'このブラウザではフォルダを選べないため、ZIP にまとめて保存します。',
    convert: (count: number) => `${count} ファイルを変換`,
    zipping: 'ZIP にまとめています…',
    saveZipAgain: 'ZIP を保存',
    zipSaved: (name: string) => `${name} を保存しました`,
    zipCancelled: 'ZIP の保存を中止しました。下のボタンから保存し直せます。',
    zipFailed: (message: string) => `ZIP を保存できませんでした: ${message}`,
    nothingToZip: '書き出せたファイルがないため、ZIP は作りませんでした。',

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

    stepEncoding: 'Encoding',
    stepNewline: 'Line endings',
    stepBom: 'BOM',
    keep: 'Keep',
    bomAdd: 'Add',
    bomRemove: 'Remove',
    bomHint: 'Only UTF-8 / UTF-16 can carry a BOM.',

    stepSave: 'Save to',
    saveFolder: 'Folder',
    saveZip: 'ZIP',
    saveFolderHint: 'Writes each file into the chosen folder. Files with the same name are overwritten.',
    saveZipHint: 'When conversion finishes, saves everything as one ZIP.',
    folderUnavailable: 'This browser cannot pick folders, so the files are saved as one ZIP.',
    convert: (count: number) => `Convert ${count} files`,
    zipping: 'Building ZIP…',
    saveZipAgain: 'Save ZIP',
    zipSaved: (name: string) => `Saved ${name}`,
    zipCancelled: 'Saving the ZIP was cancelled. Use the button below to save it again.',
    zipFailed: (message: string) => `Could not save the ZIP: ${message}`,
    nothingToZip: 'No file was converted, so no ZIP was created.',

    renamed: (name: string) => `Saved as ${name}`,

    errorNoAudio: 'No audio track',
    errorAudioFormat: (format: string) => `This browser cannot encode ${format}`,
    errorUnrepresentable: (count: number, encoding: string) =>
      `${count} character(s) cannot be represented in ${encoding}. Choose UTF-8 or another encoding`,
  },
})

export type ConvertMessages = (typeof convertMessages)['ja']

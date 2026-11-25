export type Lang = 'ja' | 'en'

export const LANGS: Lang[] = ['ja', 'en']

/** 日本語を正とし、英語はこの形に合わせる（欠けた文言は型エラーになる） */
const ja = {
  langLabel: { ja: '日本語', en: 'English' },

  // Steps
  stepInput: '入力',
  stepFormat: '出力形式',
  stepQuality: '画質',
  stepFps: 'フレームレート',
  stepResolution: '解像度',
  stepEdit: '編集',
  stepOutput: '出力',
  stepEstimate: '出力の見込み',

  // Input
  inputEmpty: 'ファイルをドロップするか、下のボタンから選択します。',
  selectFile: 'ファイルを選択',
  selectFiles: '複数選択',
  details: '詳細',
  factSize: 'サイズ',
  factResolution: '解像度',
  factDuration: '長さ',
  factMime: 'MIME',
  factVideoCodec: '映像',
  factAudioCodec: '音声',
  factTitle: 'タイトル',
  factArtist: '作成者',
  factModified: '更新日時',

  // Format
  formatHintMp4: 'H.264 / 汎用',
  formatHintWebm: 'VP9 / Web 向け',
  formatHintGif: 'ループ画像',

  // Quality / FPS
  qualityLabel: 'Quality',
  qualityHint: 'ビットレートの目安です。下げるとサイズが小さくなります。',
  fpsLabel: 'FPS',
  fpsHint: '下げるほど軽くなり、上げるほど滑らかになります。',

  // Resolution
  originalSize: '原寸',
  width: '幅',
  height: '高さ',
  auto: 'Auto',

  // Estimate
  estimatedSize: '推定サイズ',
  outputDuration: '長さ',
  estimating: '計算中…',
  estimateEmpty: 'ファイルを選ぶと、投稿先ごとの上限と照らし合わせます。',
  compatTitle: '投稿先チェック',
  compatExceeded: '上限超過',

  // Sidebar actions
  resetSettings: '設定を初期値に戻す',
  convert: '変換する',
  convertAgain: 'もう一度変換',
  reconvertLong: '再変換する',
  cancelWithProgress: (progress: number) => `中止（${progress}%）`,
  resetEdits: '編集をすべて取り消す',

  // Bottom bar
  play: '再生',
  pause: '一時停止',
  trimmedLength: '切り出す長さ',
  trimIn: 'IN',
  trimOut: 'OUT',
  setInToPlayhead: '⇤ 現在位置',
  setOutToPlayhead: '現在位置 ⇥',
  setInTitle: '開始位置を再生位置に合わせる',
  setOutTitle: '終了位置を再生位置に合わせる',
  wholeClip: '全体',
  wholeClipTitle: '全体を対象にする',
  trimStartHandle: '開始位置',
  trimEndHandle: '終了位置',
  before: '変換前',
  after: '変換後',
  reconvert: '再変換',
  reconvertTitle: 'もう一度変換する',
  reconvertTitleStale: '前回の変換のあとで設定が変わっています',
  cancel: '中止',

  // Drop zone
  dropHere: '動画ファイルをここにドロップ',

  // Hub
  hubTagline: 'メディアの変換と簡単な編集を、ブラウザの中だけで。',
  hubDrop: 'ファイルをここにドロップ',
  hubDropHint: '1 つなら編集画面、複数なら一括変換へ進みます。ファイルはどこにも送信されません。',
  hubPick: 'ファイルを選択',
  hubEdit: '編集',
  hubConvert: '一括変換',
  hubComingSoon: '準備中',
  kindLabel: {
    video: '動画',
    audio: '音声',
    image: '画像',
    gif: 'GIF・アニメーション',
    pdf: 'PDF',
    text: 'テキスト・コード',
    archive: '圧縮ファイル',
  },

  // Routing
  notFoundTitle: 'ページが見つかりません',
  backToHub: '入口に戻る',
  unsupportedFiles: 'このファイルの種類にはまだ対応していません',
  skippedFiles: (count: number) => `対応していない ${count} ファイルを除きました`,
  dismiss: '閉じる',

  // Errors（アプリが出すもの。エンコーダ由来の例外はそのまま表示する）
  errorCancelled: '変換を中止しました',
  errorConversionFailed: '変換に失敗しました',
  errorFolderCancelled: '保存先の選択を中止しました',
  errorFolderFailed: '保存先フォルダを選べませんでした',

  // Save（共通の操作モデル）
  saveOverwrite: '上書き保存',
  saveAs: '別名で保存',
  saveCopyToClipboard: 'クリップボードにコピー',
  saveMore: 'ほかの保存方法',
  saving: '保存中…',
  savedTo: (name: string) => `${name} に保存しました`,
  downloaded: (name: string) => `${name} をダウンロードしました`,
  copiedToClipboard: 'クリップボードにコピーしました',
  saveFailed: (message: string) => `保存できませんでした: ${message}`,
  undo: '取り消す',
  redo: 'やり直す',
  discardConfirm: '保存していない変更があります。破棄してほかのファイルを開きますか？',

  // 複数のファイルの保存
  saveManyFolder: 'フォルダに保存',
  saveManyZip: 'ZIP にまとめて保存',
  saveManyEach: (count: number): string => (count === 1 ? 'ダウンロード' : '1 つずつダウンロード'),
  savedFiles: (count: number, target: string) => `${count} ファイルを ${target} に保存しました`,
  downloadedFiles: (count: number) => `${count} ファイルをダウンロードしました`,

  // Batch
  batchEmpty: 'ファイルをドロップするか、下のボタンから選択します。',
  batchStatus: (completed: number, total: number, errors: number) =>
    `一括変換 ${completed}/${total} 完了${errors > 0 ? `、エラー ${errors}` : ''}`,
  batchColFile: 'ファイル',
  batchColStatus: '状態',
  batchColOutput: '出力',
  batchStateLabel: {
    pending: '待機中',
    converting: '変換中',
    completed: '完了',
    error: 'エラー',
  },

  // Preview
  convertedGifAlt: '変換後の GIF',
}

export type Messages = typeof ja

const en: Messages = {
  langLabel: { ja: '日本語', en: 'English' },

  stepInput: 'Input',
  stepFormat: 'Format',
  stepQuality: 'Quality',
  stepFps: 'Frame rate',
  stepResolution: 'Resolution',
  stepEdit: 'Edit',
  stepOutput: 'Output',
  stepEstimate: 'Estimate',

  inputEmpty: 'Drop a file here, or pick one with the buttons below.',
  selectFile: 'Select file',
  selectFiles: 'Select multiple',
  details: 'Details',
  factSize: 'Size',
  factResolution: 'Resolution',
  factDuration: 'Duration',
  factMime: 'MIME',
  factVideoCodec: 'Video',
  factAudioCodec: 'Audio',
  factTitle: 'Title',
  factArtist: 'Artist',
  factModified: 'Modified',

  formatHintMp4: 'H.264 / general purpose',
  formatHintWebm: 'VP9 / for the web',
  formatHintGif: 'Looping image',

  qualityLabel: 'Quality',
  qualityHint: 'Approximate bitrate. Lower it to shrink the output.',
  fpsLabel: 'FPS',
  fpsHint: 'Lower is lighter, higher is smoother.',

  originalSize: 'Original',
  width: 'Width',
  height: 'Height',
  auto: 'Auto',

  estimatedSize: 'Estimated size',
  outputDuration: 'Duration',
  estimating: 'Calculating…',
  estimateEmpty: 'Pick a file to check it against each service limit.',
  compatTitle: 'Upload targets',
  compatExceeded: 'Over limit',

  resetSettings: 'Reset settings',
  convert: 'Convert',
  convertAgain: 'Convert again',
  reconvertLong: 'Re-convert',
  cancelWithProgress: (progress: number) => `Cancel (${progress}%)`,
  resetEdits: 'Undo all edits',

  play: 'Play',
  pause: 'Pause',
  trimmedLength: 'Trimmed length',
  trimIn: 'In',
  trimOut: 'Out',
  setInToPlayhead: '⇤ Playhead',
  setOutToPlayhead: 'Playhead ⇥',
  setInTitle: 'Set trim start to the current position',
  setOutTitle: 'Set trim end to the current position',
  wholeClip: 'Whole',
  wholeClipTitle: 'Use the whole clip',
  trimStartHandle: 'Trim start',
  trimEndHandle: 'Trim end',
  before: 'Before',
  after: 'After',
  reconvert: 'Re-convert',
  reconvertTitle: 'Convert again',
  reconvertTitleStale: 'Settings changed since the last conversion',
  cancel: 'Cancel',

  dropHere: 'Drop a video file here',

  hubTagline: 'Convert and lightly edit media, entirely in your browser.',
  hubDrop: 'Drop files here',
  hubDropHint: 'One file opens the editor; several go to batch conversion. Nothing is uploaded.',
  hubPick: 'Select files',
  hubEdit: 'Edit',
  hubConvert: 'Batch convert',
  hubComingSoon: 'Coming soon',
  kindLabel: {
    video: 'Video',
    audio: 'Audio',
    image: 'Image',
    gif: 'GIF & animation',
    pdf: 'PDF',
    text: 'Text & code',
    archive: 'Archive',
  },

  notFoundTitle: 'Page not found',
  backToHub: 'Back to start',
  unsupportedFiles: 'This file type is not supported yet',
  skippedFiles: (count: number) => `Skipped ${count} unsupported files`,
  dismiss: 'Dismiss',

  errorCancelled: 'Conversion cancelled',
  errorConversionFailed: 'Conversion failed',
  errorFolderCancelled: 'Folder selection was cancelled',
  errorFolderFailed: 'Failed to select output folder',

  saveOverwrite: 'Save',
  saveAs: 'Save as…',
  saveCopyToClipboard: 'Copy to clipboard',
  saveMore: 'More ways to save',
  saving: 'Saving…',
  savedTo: (name: string) => `Saved to ${name}`,
  downloaded: (name: string) => `Downloaded ${name}`,
  copiedToClipboard: 'Copied to clipboard',
  saveFailed: (message: string) => `Could not save: ${message}`,
  undo: 'Undo',
  redo: 'Redo',
  discardConfirm: 'You have unsaved changes. Discard them and open the other file?',

  saveManyFolder: 'Save to folder…',
  saveManyZip: 'Save as one ZIP…',
  saveManyEach: (count: number) => (count === 1 ? 'Download' : 'Download one by one'),
  savedFiles: (count: number, target: string) => `Saved ${count} files to ${target}`,
  downloadedFiles: (count: number) => `Downloaded ${count} files`,

  batchEmpty: 'Drop files here, or pick them with the button below.',
  batchStatus: (completed: number, total: number, errors: number) =>
    `Batch conversion ${completed}/${total} completed${errors > 0 ? `, ${errors} errors` : ''}`,
  batchColFile: 'File',
  batchColStatus: 'Status',
  batchColOutput: 'Output',
  batchStateLabel: {
    pending: 'Waiting',
    converting: 'Converting',
    completed: 'Done',
    error: 'Error',
  },

  convertedGifAlt: 'Converted GIF',
}

export const messages: Record<Lang, Messages> = { ja, en }

export const STORAGE_KEY = 'bani.lang'
/** 改名前のキー。読むだけで、次に言語を選んだ時点で新しいキーへ移る */
const LEGACY_STORAGE_KEY = 'mediabunny-ui.lang'

/** 保存された選択 → ブラウザの言語 の順に決める */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    if (saved === 'ja' || saved === 'en') return saved
  } catch {
    // プライベートモードなどで localStorage を読めないときはブラウザの言語に従う
  }
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

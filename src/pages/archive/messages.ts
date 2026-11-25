import type { ArchiveErrorCode } from '../../media/archive'
import { defineMessages } from '../../i18n/local'

const ja = {
  // 入力
  stepActions: '展開',
  openArchive: '圧縮ファイルを開く',
  newArchive: '新しく作る',
  factFormat: '形式',
  factEntries: 'ファイル数',
  factFolders: 'フォルダ数',
  factTotal: '展開後',
  factCompressed: '圧縮後',
  factRatio: '圧縮率',
  reading: '中身を読んでいます…',
  readingProgress: (percent: number) => `中身を読んでいます… ${percent}%`,
  shiftJisNotice: 'Windows で作られた ZIP のファイル名（Shift_JIS）を読み直しました。',
  showMacJunk: (count: number) => `macOS の付随ファイル（__MACOSX など ${count} 個）も表示する`,
  encryptedNotice: (count: number) =>
    `パスワード付きのファイルが ${count} 個あります。パスワード付きのファイルは展開できません。`,

  // 展開
  extractSelected: (count: number) => (count > 0 ? `選択した ${count} 個を展開` : '選択したものを展開'),
  extractAll: 'すべて展開',
  extractHintFolder: 'えらんだフォルダの中に、元のフォルダ構造のまま書き出します。',
  extractHintDownload:
    'このブラウザではフォルダに書き出せないので、ダウンロードになります。複数のときは ZIP にまとめるか 1 つずつかを選べます。',
  seedNew: 'この中身で新しい圧縮ファイルを作る',

  // 一覧
  colName: '名前',
  colSize: 'サイズ',
  colCompressed: '圧縮後',
  colRatio: '割合',
  colModified: '更新日時',
  selectAll: 'すべて選択',
  openInBani: 'Bani で開く',
  encrypted: 'パスワード付き',
  emptyArchive: 'この圧縮ファイルには何も入っていません。',
  selectedCount: (count: number, total: number) => `${count} / ${total} 個を選択`,
  treeLabel: '圧縮ファイルの中身',
  folderSummary: (count: number) => `${count} 個`,

  // 作成
  createEmpty: 'ファイルやフォルダをここにドロップするか、下のボタンから追加します。',
  addFiles: 'ファイルを追加',
  addFolder: 'フォルダを追加',
  dropToAdd: 'ここにドロップして追加',
  nameLabel: '名前',
  formatZipHint: 'Windows・macOS でそのまま開けます。4GB を超えるファイルは入れられません。',
  formatTarGzHint: 'Mac・Linux 向け。4GB を超えるファイルも入れられます。',
  levelLabel: '圧縮レベル',
  levelValue: (level: number) => (level === 0 ? '0（無圧縮）' : level === 9 ? '9（最大）' : String(level)),
  levelHint: '高いほど小さくなりますが、時間がかかります。JPEG や MP4 など縮まない形式はそのまま入れます。',
  rename: '名前を変える',
  remove: '削除',
  moveTarget: '移動先のフォルダ（空なら一番上）',
  moveApply: '移動',
  newFolderPlaceholder: '例: photos/2024',
  addedFiles: (count: number) => `${count} 個のファイルを追加しました`,
  saveEmpty: 'ファイルを追加すると保存できます。',

  // エラー
  errors: {
    'unsupported-format': '扱えない形式です。',
    encrypted: 'パスワード付きのファイルは展開できません。',
    'unsupported-method': 'この圧縮方式（bzip2・LZMA など）には対応していません。',
    corrupt: '圧縮ファイルが壊れているか、途中で切れています。',
    'not-found': '指定したファイルが圧縮ファイルの中にありません。',
    'too-large': '4GB 以上のファイル、または 65535 個を超えるファイルは ZIP にできません。tar.gz を選んでください。',
  } satisfies Record<ArchiveErrorCode, string>,
  unsupportedNamed: (format: string) =>
    `${format} 形式にはまだ対応していません。ZIP・tar・tar.gz・gzip を開けます。`,
  failed: (message: string) => `失敗しました: ${message}`,
}

type ArchiveMessages = typeof ja

const en: ArchiveMessages = {
  stepActions: 'Extract',
  openArchive: 'Open archive',
  newArchive: 'Create new',
  factFormat: 'Format',
  factEntries: 'Files',
  factFolders: 'Folders',
  factTotal: 'Uncompressed',
  factCompressed: 'Compressed',
  factRatio: 'Ratio',
  reading: 'Reading contents…',
  readingProgress: (percent) => `Reading contents… ${percent}%`,
  shiftJisNotice: 'File names from a Windows ZIP (Shift_JIS) were decoded correctly.',
  showMacJunk: (count) => `Show macOS extras (__MACOSX etc., ${count})`,
  encryptedNotice: (count) =>
    `${count} file${count === 1 ? ' is' : 's are'} password-protected. Password-protected files can't be extracted.`,

  extractSelected: (count) => (count > 0 ? `Extract ${count} selected` : 'Extract selected'),
  extractAll: 'Extract all',
  extractHintFolder: 'Writes into the folder you choose, keeping the folder structure.',
  extractHintDownload:
    "This browser can't write to folders, so files are downloaded. For several files, choose a ZIP or one by one.",
  seedNew: 'Create a new archive from these contents',

  colName: 'Name',
  colSize: 'Size',
  colCompressed: 'Compressed',
  colRatio: 'Ratio',
  colModified: 'Modified',
  selectAll: 'Select all',
  openInBani: 'Open in Bani',
  encrypted: 'Password-protected',
  emptyArchive: 'This archive is empty.',
  selectedCount: (count, total) => `${count} of ${total} selected`,
  treeLabel: 'Archive contents',
  folderSummary: (count) => `${count} item${count === 1 ? '' : 's'}`,

  createEmpty: 'Drop files or folders here, or add them with the buttons below.',
  addFiles: 'Add files',
  addFolder: 'Add folder',
  dropToAdd: 'Drop here to add',
  nameLabel: 'Name',
  formatZipHint: "Opens as-is on Windows and macOS. Can't hold files over 4GB.",
  formatTarGzHint: 'For Mac and Linux. Can hold files over 4GB.',
  levelLabel: 'Compression level',
  levelValue: (level) => (level === 0 ? '0 (store)' : level === 9 ? '9 (max)' : String(level)),
  levelHint: 'Higher is smaller but slower. Already-compressed formats like JPEG and MP4 are stored as-is.',
  rename: 'Rename',
  remove: 'Remove',
  moveTarget: 'Destination folder (empty for top level)',
  moveApply: 'Move',
  newFolderPlaceholder: 'e.g. photos/2024',
  addedFiles: (count) => `Added ${count} file${count === 1 ? '' : 's'}`,
  saveEmpty: 'Add files to save.',

  errors: {
    'unsupported-format': 'This format is not supported.',
    encrypted: "Password-protected files can't be extracted.",
    'unsupported-method': 'This compression method (bzip2, LZMA, …) is not supported.',
    corrupt: 'The archive is damaged or truncated.',
    'not-found': 'The file is not in the archive.',
    'too-large': "Files of 4GB or more, or more than 65535 files, can't go into a ZIP. Choose tar.gz.",
  },
  unsupportedNamed: (format) => `${format} is not supported yet. ZIP, tar, tar.gz and gzip can be opened.`,
  failed: (message) => `Failed: ${message}`,
}

export const messages = defineMessages({ ja, en })
export type { ArchiveMessages }

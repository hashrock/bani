import { defineMessages } from '../../i18n/local'
import type { PageRangeError, PdfErrorCode } from '../../media/pdf'

const ja = {
  dropHere: 'PDF ファイルをここにドロップ',
  dropHint: 'ページの並べ替え・回転・削除・抽出、ほかの PDF との結合、分割ができます。',
  stepInput: '入力',
  stepEdit: '編集',
  stepSplit: '分割',
  stepOutput: '保存',
  factPages: 'ページ数',
  factSize: 'サイズ',
  factTitle: 'タイトル',
  factAuthor: '作成者',
  factSources: '結合する PDF',
  pageCount: (count: number) => `${count} ページ`,
  loading: '読み込み中…',
  selectFile: 'ファイルを選択',
  addPdf: 'PDF を追加',
  addImages: '画像を追加',
  adding: '追加中…',
  addHint: '追加したページは末尾に並びます。',
  appended: (count: number) => `${count} ページを追加しました`,
  skippedEncrypted: (name: string) => `${name} は暗号化されているため追加できません`,
  skippedInvalid: (name: string) => `${name} は PDF として読めません`,
  imagesFailed: '画像を PDF にできませんでした',

  selection: (selected: number, total: number) =>
    selected > 0 ? `${selected} / ${total} ページを選択中` : `${total} ページ`,
  selectionHint: 'クリックで選択、Shift で範囲、⌘（Ctrl）で追加。ドラッグで並べ替えます。',
  selectAll: 'すべて選択',
  clearSelection: '選択を解除',
  rotateLeft: '左に回転',
  rotateRight: '右に回転',
  moveLeft: '前へ',
  moveRight: '後ろへ',
  removeSelected: '削除',
  editNeedsSelection: 'ページを選ぶと、回転・移動・削除ができます。',
  keepRanges: '残すページ',
  keepRangesPlaceholder: '例: 1-3, 5, 8-',
  keepApply: '残す',
  keepHint: 'いまの並びでのページ番号です。範囲に入らないページを取り除きます。',

  splitMode: '分け方',
  splitByRanges: '範囲ごと',
  splitEachPage: '1 ページずつ',
  splitRanges: '範囲',
  splitRangesPlaceholder: '例: 1-3, 4-6, 7-',
  splitRun: (count: number) => `${count} ファイルに分割して保存`,
  splitRunning: '分割中…',
  splitHint:
    '編集後のページを分けます。フォルダを選べるブラウザではまとめて保存し、選べなければ 1 つずつダウンロードします。',
  splitSaved: (count: number, folder: string) => `${count} ファイルを ${folder} に保存しました`,
  splitDownloaded: (count: number) => `${count} ファイルをダウンロードしました`,
  splitFailed: (message: string) => `分割できませんでした: ${message}`,

  outputPages: (count: number) => `${count} ページの PDF を書き出します`,
  outputEmpty: 'ページがありません。取り消す（⌘Z）か、PDF を追加してください。',
  outputMerged: (count: number) => `${count} つの PDF をまとめます`,

  pageLabel: (position: number) => `${position} ページ目`,
  pageOrigin: (name: string, page: number) => `${name} の ${page} ページ`,
  pagesLabel: 'ページ一覧',
  thumbnailFailed: '表示できません',

  rangeError: (error: PageRangeError, pageCount: number): string => {
    switch (error.code) {
      case 'empty':
        return 'ページ番号を入力してください'
      case 'syntax':
        return `「${error.token}」を読めません。「1-3, 5」のように書きます`
      case 'outOfRange':
        return `「${error.token}」は 1〜${pageCount} ページの外です`
      case 'reversed':
        return `「${error.token}」は始まりが終わりより後ろです`
    }
  },
  pdfError: {
    encrypted: 'この PDF は暗号化されているため編集できません',
    invalid: 'PDF として読めません',
    empty: '出力するページがありません',
    pageOutOfRange: 'ページの指定が PDF の外を指しています',
    unsupportedImage: 'この画像は PDF に埋め込めません',
  } satisfies Record<PdfErrorCode, string>,
  encryptedTitle: 'この PDF は編集できません',
  encryptedBody:
    'パスワードなどで暗号化された PDF は、Bani では並べ替えや結合ができません。暗号化を解いた PDF を開いてください。',
  invalidTitle: 'PDF を開けませんでした',
}

type PdfMessages = typeof ja

const en: PdfMessages = {
  dropHere: 'Drop a PDF file here',
  dropHint: 'Reorder, rotate, delete and extract pages, merge with other PDFs, or split.',
  stepInput: 'Input',
  stepEdit: 'Edit',
  stepSplit: 'Split',
  stepOutput: 'Save',
  factPages: 'Pages',
  factSize: 'Size',
  factTitle: 'Title',
  factAuthor: 'Author',
  factSources: 'PDFs to merge',
  pageCount: (count) => `${count} ${count === 1 ? 'page' : 'pages'}`,
  loading: 'Loading…',
  selectFile: 'Select file',
  addPdf: 'Add PDF',
  addImages: 'Add images',
  adding: 'Adding…',
  addHint: 'Added pages go to the end.',
  appended: (count) => `Added ${count} ${count === 1 ? 'page' : 'pages'}`,
  skippedEncrypted: (name) => `${name} is encrypted and cannot be added`,
  skippedInvalid: (name) => `${name} is not a readable PDF`,
  imagesFailed: 'Could not turn the images into a PDF',

  selection: (selected, total) =>
    selected > 0 ? `${selected} of ${total} pages selected` : `${total} pages`,
  selectionHint: 'Click to select, Shift for a range, ⌘ (Ctrl) to add. Drag to reorder.',
  selectAll: 'Select all',
  clearSelection: 'Clear selection',
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
  moveLeft: 'Earlier',
  moveRight: 'Later',
  removeSelected: 'Delete',
  editNeedsSelection: 'Select pages to rotate, move or delete them.',
  keepRanges: 'Pages to keep',
  keepRangesPlaceholder: 'e.g. 1-3, 5, 8-',
  keepApply: 'Keep',
  keepHint: 'Page numbers in the current order. Pages outside the ranges are removed.',

  splitMode: 'Split by',
  splitByRanges: 'Ranges',
  splitEachPage: 'Every page',
  splitRanges: 'Ranges',
  splitRangesPlaceholder: 'e.g. 1-3, 4-6, 7-',
  splitRun: (count) => `Split into ${count} ${count === 1 ? 'file' : 'files'} and save`,
  splitRunning: 'Splitting…',
  splitHint:
    'Splits the edited pages. Saves into a folder where the browser allows it, otherwise downloads each file.',
  splitSaved: (count, folder) => `Saved ${count} ${count === 1 ? 'file' : 'files'} to ${folder}`,
  splitDownloaded: (count) => `Downloaded ${count} ${count === 1 ? 'file' : 'files'}`,
  splitFailed: (message) => `Could not split: ${message}`,

  outputPages: (count) => `Writes a PDF with ${count} ${count === 1 ? 'page' : 'pages'}`,
  outputEmpty: 'No pages left. Undo (⌘Z) or add a PDF.',
  outputMerged: (count) => `Merges ${count} PDFs`,

  pageLabel: (position) => `Page ${position}`,
  pageOrigin: (name, page) => `${name}, page ${page}`,
  pagesLabel: 'Pages',
  thumbnailFailed: 'Cannot display',

  rangeError: (error, pageCount) => {
    switch (error.code) {
      case 'empty':
        return 'Enter page numbers'
      case 'syntax':
        return `Cannot read "${error.token}". Write it like "1-3, 5"`
      case 'outOfRange':
        return `"${error.token}" is outside pages 1–${pageCount}`
      case 'reversed':
        return `"${error.token}" starts after it ends`
    }
  },
  pdfError: {
    encrypted: 'This PDF is encrypted and cannot be edited',
    invalid: 'Not a readable PDF',
    empty: 'There are no pages to write',
    pageOutOfRange: 'A page reference points outside the PDF',
    unsupportedImage: 'This image cannot be embedded in a PDF',
  },
  encryptedTitle: 'This PDF cannot be edited',
  encryptedBody:
    'Bani cannot reorder or merge PDFs that are encrypted with a password. Open a decrypted copy instead.',
  invalidTitle: 'Could not open the PDF',
}

export const messages = defineMessages({ ja, en })

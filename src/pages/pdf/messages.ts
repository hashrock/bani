import { defineMessages } from '../../i18n/local'
import type { SaveManyMethod } from '../../core/save'
import type { BlankPageKind, PageRangeError, PdfErrorCode, PdfImageFormat } from '../../media/pdf'
import type { PdfOutputKind } from './output'

const ja = {
  newTitle: '新しい PDF',
  newEmpty:
    'PDF や画像をここにドロップするか、下のボタンで足してください。白紙のページも入れられます。並べ替え・回転・削除をして保存します。',
  untitled: '無題',
  openPdf: 'PDF を開いて編集する',
  factContents: '使うファイル',
  addBlank: '白紙ページ',
  blankName: ({ paper, orientation }: BlankPageKind) =>
    `白紙 ${paper === 'a4' ? 'A4' : 'Letter'} ${orientation === 'portrait' ? '縦' : '横'}`,
  blankBadge: '白紙',
  blankFailed: '白紙のページを作れませんでした',
  stepSplit: '分割',
  factPages: 'ページ数',
  factSize: 'サイズ',
  factTitle: 'タイトル',
  factAuthor: '作成者',
  factSources: '結合する PDF',
  pageCount: (count: number) => `${count} ページ`,
  loading: '読み込み中…',
  addPdf: 'PDF を追加',
  addImages: '画像を追加',
  adding: '追加中…',
  addHint: '追加したページは末尾に、白紙のページは選んだページの後ろに並びます。',
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
  splitHint: '編集後のページを範囲ごとの PDF に分けて保存します。',
  splitFailed: (message: string) => `分割できませんでした: ${message}`,

  outputPages: (count: number) => `${count} ページの PDF を書き出します`,
  outputEmpty: 'ページがありません。取り消す（⌘Z）か、PDF を追加してください。',
  outputMerged: (count: number) => `${count} つの PDF をまとめます`,

  outputKind: '書き出すもの',
  kindPdf: 'PDF',
  kindImages: '画像',
  kindCompress: '圧縮',
  kindHint: {
    pdf: 'ページの編集をそのまま PDF にします。画質は落ちません。',
    images: 'ページを 1 枚ずつ画像ファイルにして保存します。',
    compress: 'ページを JPEG の画像に描き直して、小さな PDF に組み直します。',
  } satisfies Record<PdfOutputKind, string>,
  scopeLabel: '書き出すページ',
  scopeAll: (count: number) => `すべて（${count}）`,
  scopeSelected: (count: number) => `選んだページ（${count}）`,
  imageFormat: '形式',
  formatHint: {
    png: '劣化しません。文字や図の多いページ向けです。',
    jpeg: '写真やスキャンしたページを小さく保存できます。',
  } satisfies Record<PdfImageFormat, string>,
  qualityLabel: '画質',
  resolutionLabel: '解像度',
  resolutionDpi: 'DPI',
  resolutionLongEdge: '長い辺の px',
  dpiHint: '72 は画面で見る用、150 は資料、300 は印刷向けです。',
  longEdgeHint: 'ページの長い辺をこの長さにそろえます。',
  openInImage: 'このページを画像の画面で開く',
  openingInImage: '画像にしています…',
  openInImageHint: '1 ページだけ選ぶと、いまの形式と解像度で画像にして、画像の画面で開きます。',
  compressWarning: '文字や図形もすべて画像になります。保存した PDF では文字の選択・検索・コピーやリンクができません。',
  compressDpiHint: '低いほど小さくなり、細かい文字はつぶれます。110〜150 が目安です。',
  compressEstimateHint: '何ページかを実際に描いて見込んでいます。保存すると実際の大きさを出します。',
  compressLarger: '元より大きくなりそうです。文字や図形だけの PDF は、画像にするとかえって大きくなります。解像度か画質を下げるか、PDF のまま保存してください。',
  estimateFiles: 'ファイル',
  imageCount: (count: number) => `${count} 枚`,
  estimateImageSize: '画像の大きさ（最初のページ）',
  estimateOriginal: '元のサイズ',
  estimateCompressed: '圧縮後の見込み',
  estimateActual: '保存したサイズ',
  saveImages: (count: number, method: SaveManyMethod) =>
    method === 'folder'
      ? `${count} 枚の画像をフォルダに保存`
      : method === 'zip'
        ? `${count} 枚の画像を ZIP で保存`
        : `${count} 枚の画像をダウンロード`,
  exportingImages: '書き出し中…',
  exportFailed: (message: string) => `書き出せませんでした: ${message}`,

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
  newTitle: 'New PDF',
  newEmpty:
    'Drop PDFs or images here, or add them with the buttons below. You can also insert blank pages. Reorder, rotate and delete pages, then save.',
  untitled: 'Untitled',
  openPdf: 'Open a PDF to edit',
  factContents: 'Files used',
  addBlank: 'Blank page',
  blankName: ({ paper, orientation }) =>
    `Blank ${paper === 'a4' ? 'A4' : 'Letter'} ${orientation === 'portrait' ? 'portrait' : 'landscape'}`,
  blankBadge: 'Blank',
  blankFailed: 'Could not create a blank page',
  stepSplit: 'Split',
  factPages: 'Pages',
  factSize: 'Size',
  factTitle: 'Title',
  factAuthor: 'Author',
  factSources: 'PDFs to merge',
  pageCount: (count) => `${count} ${count === 1 ? 'page' : 'pages'}`,
  loading: 'Loading…',
  addPdf: 'Add PDF',
  addImages: 'Add images',
  adding: 'Adding…',
  addHint: 'Added pages go to the end; blank pages go after the selected page.',
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
  splitHint: 'Saves the edited pages as one PDF per range.',
  splitFailed: (message) => `Could not split: ${message}`,

  outputPages: (count) => `Writes a PDF with ${count} ${count === 1 ? 'page' : 'pages'}`,
  outputEmpty: 'No pages left. Undo (⌘Z) or add a PDF.',
  outputMerged: (count) => `Merges ${count} PDFs`,

  outputKind: 'Output',
  kindPdf: 'PDF',
  kindImages: 'Images',
  kindCompress: 'Compress',
  kindHint: {
    pdf: 'Writes the edited pages as a PDF. No quality loss.',
    images: 'Saves every page as its own image file.',
    compress: 'Redraws each page as a JPEG image and rebuilds a smaller PDF.',
  },
  scopeLabel: 'Pages to export',
  scopeAll: (count) => `All (${count})`,
  scopeSelected: (count) => `Selected (${count})`,
  imageFormat: 'Format',
  formatHint: {
    png: 'Lossless. Best for pages with text and drawings.',
    jpeg: 'Smaller files for photos and scanned pages.',
  },
  qualityLabel: 'Quality',
  resolutionLabel: 'Resolution',
  resolutionDpi: 'DPI',
  resolutionLongEdge: 'Long edge px',
  dpiHint: '72 for screens, 150 for documents, 300 for print.',
  longEdgeHint: 'Scales each page so its long edge has this length.',
  openInImage: 'Open this page in the image editor',
  openingInImage: 'Rendering…',
  openInImageHint: 'Select a single page to render it with the current format and resolution and open it in the image editor.',
  compressWarning:
    'All text and drawings become images. In the saved PDF, text cannot be selected, searched or copied, and links stop working.',
  compressDpiHint: 'Lower is smaller but small text gets blurry. 110–150 is a good start.',
  compressEstimateHint: 'Estimated by rendering a few pages. Saving shows the actual size.',
  compressLarger: 'This would be larger than the original. PDFs made of text and shapes grow when turned into images. Lower the resolution or quality, or save as a plain PDF.',
  estimateFiles: 'Files',
  imageCount: (count) => `${count} ${count === 1 ? 'image' : 'images'}`,
  estimateImageSize: 'Image size (first page)',
  estimateOriginal: 'Original size',
  estimateCompressed: 'Estimated after compression',
  estimateActual: 'Saved size',
  saveImages: (count, method) => {
    const images = `${count} ${count === 1 ? 'image' : 'images'}`
    return method === 'folder' ? `Save ${images} to folder` : method === 'zip' ? `Save ${images} as ZIP` : `Download ${images}`
  },
  exportingImages: 'Exporting…',
  exportFailed: (message) => `Could not export: ${message}`,

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

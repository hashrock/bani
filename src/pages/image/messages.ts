import { defineMessages } from '../../i18n/local'

/** 画像の編集画面の文言。共通の文言（入力・保存など）は messages.ts のものを使う */
export const imageMessages = defineMessages({
  ja: {
    dropHere: '画像ファイルをここにドロップ',
    dropHint: 'PNG・JPEG・WebP・GIF・AVIF など。SVG はテキストとして開きます。',
    loadFailed: 'この画像は読み込めませんでした',
    factFormat: '形式',
    gpsNotice: '位置情報を含みます。保存すると取り除かれます',
    metadataNotice: '撮影情報などの付帯情報を含みます。保存すると取り除かれます',
    gifNotice: 'アニメーション GIF は最初のコマだけを書き出します',

    rotateLeft: '左に 90° 回転',
    rotateRight: '右に 90° 回転',
    flipH: '左右反転',
    flipV: '上下反転',

    cropLabel: '切り抜き',
    cropStart: '範囲を選ぶ',
    cropDone: '完了',
    cropClear: '解除',
    cropFree: '自由',
    cropHint: 'プレビューの上で枠をドラッグします。枠の外をドラッグすると描き直します。',
    cropNone: 'なし',

    resizeLabel: 'サイズ変更',
    resizeHint: '縦横比を保ちます。片方を入れると、もう片方は自動で決まります。',
    resizeOriginal: '元のサイズ',

    paddingLabel: '余白',
    paddingPx: '余白（px）',
    backgroundLabel: '背景',
    backgroundNone: '透過',
    backgroundWhite: '白',
    backgroundBlack: '黒',
    backgroundCustom: '色を選ぶ',
    backgroundFlattened: '透過を持てない形式なので、透過部分は白になります。',

    formatHint: {
      png: '可逆。劣化せず、透過を残せます',
      jpeg: '写真向け。透過は残りません',
      webp: '小さく、透過も残せます',
      avif: 'さらに小さく。書き出しに時間がかかります',
    },
    qualityLabel: '画質',
    qualityLossless: 'PNG は可逆なので、画質とサイズの指定はありません。',
    targetLabel: '目標サイズ',
    targetNone: 'なし',
    targetCustom: 'KB で指定',
    targetHint: '収まる範囲でいちばん高い画質を探します（上の画質が上限）。',

    outputResolution: '出力サイズ',
    outputQuality: '使う画質',
    estimateError: '書き出せませんでした',
    targetFits: '目標サイズに収まります',
    targetTooBig: (size: string) => `画質を最低にしても ${size} を超えます。サイズ変更で小さくしてください`,

    before: '編集前',
    after: '編集後',
    copyAsPng: 'PNG でコピー',
    cropOverlay: '切り抜き範囲',
  },
  en: {
    dropHere: 'Drop an image file here',
    dropHint: 'PNG, JPEG, WebP, GIF, AVIF and more. SVG opens as text.',
    loadFailed: 'This image could not be loaded',
    factFormat: 'Format',
    gpsNotice: 'Contains location data. It is removed when you save',
    metadataNotice: 'Contains metadata such as camera details. It is removed when you save',
    gifNotice: 'Animated GIFs are saved as their first frame only',

    rotateLeft: 'Rotate 90° left',
    rotateRight: 'Rotate 90° right',
    flipH: 'Flip horizontally',
    flipV: 'Flip vertically',

    cropLabel: 'Crop',
    cropStart: 'Select area',
    cropDone: 'Done',
    cropClear: 'Clear',
    cropFree: 'Free',
    cropHint: 'Drag the frame on the preview. Drag outside it to draw a new one.',
    cropNone: 'None',

    resizeLabel: 'Resize',
    resizeHint: 'Keeps the aspect ratio. Enter one side and the other follows.',
    resizeOriginal: 'Original',

    paddingLabel: 'Padding',
    paddingPx: 'Padding (px)',
    backgroundLabel: 'Background',
    backgroundNone: 'Transparent',
    backgroundWhite: 'White',
    backgroundBlack: 'Black',
    backgroundCustom: 'Pick a color',
    backgroundFlattened: 'This format cannot keep transparency, so transparent areas become white.',

    formatHint: {
      png: 'Lossless. No degradation, keeps transparency',
      jpeg: 'For photos. No transparency',
      webp: 'Small, keeps transparency',
      avif: 'Even smaller. Slower to save',
    },
    qualityLabel: 'Quality',
    qualityLossless: 'PNG is lossless, so quality and size targets do not apply.',
    targetLabel: 'Target size',
    targetNone: 'None',
    targetCustom: 'Size in KB',
    targetHint: 'Finds the highest quality that fits (the quality above is the ceiling).',

    outputResolution: 'Output size',
    outputQuality: 'Quality used',
    estimateError: 'Could not export',
    targetFits: 'Fits the target size',
    targetTooBig: (size: string) => `Still over ${size} at the lowest quality. Resize the image to make it smaller`,

    before: 'Before',
    after: 'After',
    copyAsPng: 'Copy as PNG',
    cropOverlay: 'Crop area',
  },
})

export type ImageMessages = (typeof imageMessages)['ja']

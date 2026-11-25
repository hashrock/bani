/**
 * PDF の編集。レシピとページ範囲（recipe.ts, pageRanges.ts）は純粋な計算で pdf-lib に依存しない。
 * サムネイルとページの画像化（pdf.js, thumbnail.ts・rasterize.ts）はブラウザ専用。pdf.js 本体は初めて描くときに読み込む。
 */
export * from './errors'
export * from './pageRanges'
export * from './recipe'
export { probePdf, displayedPageSize, type PdfInfo, type PdfPageInfo } from './probe'
export { renderPdf, splitPdf } from './render'
export * from './blank'
export { imagesToPdf, placeImage, PAPER_SIZES, type ImagesToPdfSettings, type PlacedImage } from './images'
export { openPdfThumbnailer, renderPageThumbnail, type PdfThumbnailer, type RenderedPageImage } from './thumbnail'
export * from './raster'
export { createRasterPdfWriter, type RasterPdfWriter } from './rasterPdf'
export {
  compressPdf,
  createPdfRasterizer,
  estimateRasterOutput,
  renderPageToImageFile,
  renderPagesToImages,
  type PdfRasterizer,
} from './rasterize'

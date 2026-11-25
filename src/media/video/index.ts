/**
 * 動画の編集・書き出し（src/media/types.ts の約束事に沿う）。
 * 純粋な部分（recipe / output / preview）と、mediabunny・DOM に触れる部分
 * （probe / render / transcode / gif / frame / estimate）を分けてある。
 */
export type {
  VideoCropRect,
  VideoEdit,
  VideoFormat,
  VideoInfo,
  VideoOutput,
  VideoRecipe,
  VideoRotation,
  VideoSubtitleMode,
  VideoSubtitles,
} from './types'
export {
  MAX_SUBTITLE_OFFSET,
  MIN_CROP_SIZE,
  VIDEO_RECIPE_VERSION,
  applyVideoEdit,
  clampCrop,
  createVideoRecipe,
  editedSize,
  encodeTrim,
  isIdentityRecipe,
  isTransformed,
  restoreVideoRecipe,
  rotatedCrop,
  sourceRect,
} from './recipe'
export {
  MAX_VIDEO_SPEED,
  MIN_VIDEO_SPEED,
  VIDEO_SPEED_PRESETS,
  activeCues,
  clampSpeed,
  cuesForOutput,
  effectiveSubtitleMode,
  outputDuration,
  outputToSourceTime,
  sourceToOutputTime,
} from './timing'
export {
  SUBTITLE_FONT_FAMILY,
  breakLines,
  joinCues,
  layoutSubtitle,
  plainCueText,
  subtitleStyle,
} from './subtitleLayout'
export type { SubtitleStyle } from './subtitleLayout'
export { isSubtitleFile, loadSubtitleFile, mayBeSubtitle, parseSubtitleText } from './subtitleFile'
export type { LoadedSubtitles } from './subtitleFile'
export type { RotatedCrop, VideoSize } from './recipe'
export {
  DEFAULT_GIF_FPS,
  DEFAULT_VIDEO_OUTPUT,
  MAX_VIDEO_BITRATE,
  MIN_TARGET_VIDEO_BITRATE,
  TARGET_AUDIO_BITRATE,
  RESOLUTION_PRESETS,
  VIDEO_MIME_TYPES,
  applyResolutionPreset,
  bitrateForTargetSize,
  computeFrameDrawPlan,
  defaultVideoOutput,
  isResolutionPresetActive,
  resolveMaxShortSide,
  resolutionPresetsFor,
  usesTargetSize,
  videoBitrate,
  videoFilename,
  videoOutputSize,
} from './output'
export type { FrameDrawPlan } from './output'
export { previewScale, previewTransform, screenDeltaToSource, sourceDeltaToScreen } from './preview'
export { probeVideo } from './probe'
export { renderVideo } from './render'
export type { RenderVideoOptions } from './render'
export { estimateGifSize, estimateVideoSize } from './estimate'
export { captureFrame, drawFrame, frameFilename } from './frame'

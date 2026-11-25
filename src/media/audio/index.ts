/**
 * 音声の編集・書き出し（src/media/types.ts の約束事に沿う）。
 * 純粋な部分（recipe / output / dsp / peaks）と、mediabunny・WebCodecs に触れる部分
 * （probe / render / waveform / encoders）を分けてある。
 */
export type {
  AudioEdit,
  AudioFormat,
  AudioInfo,
  AudioOutput,
  AudioRecipe,
  AudioSilence,
  AudioTrim,
  TimeRange,
} from './types'
export {
  MAX_GAIN_DB,
  MIN_GAIN_DB,
  MIN_TRIM_LENGTH,
  applyAudioEdit,
  createAudioRecipe,
  isIdentityRecipe,
  trimmedLength,
} from './recipe'
export {
  AUDIO_FORMATS,
  AUDIO_FORMAT_LIST,
  audioFilename,
  changeAudioFormat,
  clampBitrate,
  createAudioOutput,
  estimateAudioSize,
  estimateRenderSize,
  resolveChannels,
  resolveSampleRate,
} from './output'
export type { AudioFormatSpec } from './output'
export {
  NORMALIZE_TARGET_DB,
  dbToGain,
  fadeEnvelope,
  floatToInt16,
  gainToDb,
  normalizeGain,
  peakOf,
  processPlanes,
  remixChannels,
} from './dsp'
export { computePeaks, createPeakAccumulator } from './peaks'
export type { PeakAccumulator } from './peaks'
export { NoAudioTrackError, probeAudio } from './probe'
export { UnsupportedAudioFormatError, renderAudio } from './render'
export { canEncodeAudioFormat, ensureAudioEncoder } from './encoders'
export { analyzeAudio, loadWaveform } from './waveform'
export type { AudioAnalysis } from './waveform'
export {
  DEFAULT_SILENCE,
  LEVEL_WINDOW,
  MAX_SILENCE_DURATION,
  MAX_SILENCE_PADDING,
  MAX_SILENCE_THRESHOLD_DB,
  MIN_SILENCE_DURATION,
  MIN_SILENCE_THRESHOLD_DB,
  SILENCE_CROSSFADE,
  createLevelAccumulator,
  detectSilence,
  keptLength,
  keptRanges,
  outputTimeAt,
  planKeptRanges,
  playableTimeFrom,
  removedRanges,
} from './silence'
export type { LevelEnvelope } from './silence'

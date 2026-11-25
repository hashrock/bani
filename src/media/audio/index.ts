/**
 * 音声の編集・書き出し（src/media/types.ts の約束事に沿う）。
 * 純粋な部分（recipe / output / dsp / peaks）と、mediabunny・WebCodecs に触れる部分
 * （probe / render / waveform / encoders）を分けてある。
 */
export type { AudioEdit, AudioFormat, AudioInfo, AudioOutput, AudioRecipe, AudioTrim } from './types'
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
export { loadWaveform } from './waveform'

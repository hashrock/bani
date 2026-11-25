import { defineMessages } from '../../i18n/local'

/** 音声の編集画面の文言。共通の文言（再生・IN/OUT・保存など）は messages.ts のものを使う */
export const audioMessages = defineMessages({
  ja: {
    dropHere: '音声ファイルをここにドロップ',
    factChannels: 'チャンネル',
    factSampleRate: 'サンプルレート',
    factCodec: 'コーデック',
    channelsLabel: (channels: number) =>
      channels === 1 ? 'モノラル' : channels === 2 ? 'ステレオ' : `${channels} ch`,
    fadeIn: 'フェードイン',
    fadeOut: 'フェードアウト',
    gain: '音量',
    gainDisabledHint: 'ノーマライズ中は音量を変えられません（割れを防ぐため）。',
    normalize: 'ノーマライズ',
    normalizeHint: '区間の最大音量を -1 dBFS に揃えます。',
    mono: 'モノラル化',
    monoAlready: '元からモノラルです。',
    silence: '無音カット',
    silenceHint: 'しきい値より静かな部分が続く所を削り、短いクロスフェードでつなぎます。',
    silenceThreshold: 'しきい値',
    silenceMinDuration: '削る無音の最短の長さ',
    silencePadding: '前後に残す長さ',
    silenceAnalyzing: '無音を探しています…（波形の読み込みが終わると反映されます）',
    silenceUnknown: '波形を読めなかったため、削る範囲は保存のときに決まります。',
    silenceSummary: (count: number, seconds: string) =>
      count === 0 ? '削る無音は見つかりませんでした。' : `${count} か所・合わせて ${seconds} を削ります。`,
    seconds: (value: number) => `${value.toFixed(1)} 秒`,
    secondsFine: (value: number) => `${value.toFixed(2)} 秒`,
    dbfs: (value: number) => `${value.toFixed(0)} dBFS`,
    decibels: (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`,
    format: '形式',
    formatUnavailable: 'このブラウザでは書き出せません',
    formatChecking: '確認中…',
    bitrate: 'ビットレート',
    sampleRate: 'サンプルレート',
    sampleRateOriginal: (label: string) => `元のまま（${label}）`,
    lossless: '可逆',
    loadingWaveform: '波形を読み込み中…',
    previewNote: 'フェード・音量・モノラル化・無音カットは試聴にもおおよそ反映されます。',
    errorNoAudio: 'このファイルには音声が含まれていません。',
    errorProbe: (message: string) => `ファイルを読み込めませんでした: ${message}`,
    errorWaveform: '波形を表示できませんでした（再生と書き出しはできます）。',
    waveformLabel: '波形。ドラッグで再生位置、両端のつまみで切り出し区間を変えられます',
  },
  en: {
    dropHere: 'Drop an audio file here',
    factChannels: 'Channels',
    factSampleRate: 'Sample rate',
    factCodec: 'Codec',
    channelsLabel: (channels: number) =>
      channels === 1 ? 'Mono' : channels === 2 ? 'Stereo' : `${channels} ch`,
    fadeIn: 'Fade in',
    fadeOut: 'Fade out',
    gain: 'Volume',
    gainDisabledHint: 'Volume is locked while normalizing (to avoid clipping).',
    normalize: 'Normalize',
    normalizeHint: 'Brings the loudest peak in the range to -1 dBFS.',
    mono: 'Mix to mono',
    monoAlready: 'The source is already mono.',
    silence: 'Remove silence',
    silenceHint: 'Cuts stretches quieter than the threshold and joins the rest with short crossfades.',
    silenceThreshold: 'Threshold',
    silenceMinDuration: 'Shortest silence to cut',
    silencePadding: 'Keep around speech',
    silenceAnalyzing: 'Looking for silence… (applied once the waveform has loaded)',
    silenceUnknown: 'The waveform could not be read, so the cut is decided when saving.',
    silenceSummary: (count: number, seconds: string) =>
      count === 0 ? 'No silence to cut was found.' : `Cuts ${count} ${count === 1 ? 'stretch' : 'stretches'}, ${seconds} in total.`,
    seconds: (value: number) => `${value.toFixed(1)} s`,
    secondsFine: (value: number) => `${value.toFixed(2)} s`,
    dbfs: (value: number) => `${value.toFixed(0)} dBFS`,
    decibels: (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`,
    format: 'Format',
    formatUnavailable: 'Not supported in this browser',
    formatChecking: 'Checking…',
    bitrate: 'Bitrate',
    sampleRate: 'Sample rate',
    sampleRateOriginal: (label: string) => `Original (${label})`,
    lossless: 'Lossless',
    loadingWaveform: 'Loading waveform…',
    previewNote: 'Fades, volume, mono and silence removal are roughly applied to playback too.',
    errorNoAudio: 'This file has no audio.',
    errorProbe: (message: string) => `Could not read the file: ${message}`,
    errorWaveform: 'Could not draw the waveform (playback and export still work).',
    waveformLabel: 'Waveform. Drag to seek; drag the edge handles to change the trim range',
  },
})

export type AudioMessages = (typeof audioMessages)['ja']

/** サンプルレートの表示（44.1 kHz など） */
export const formatSampleRate = (rate: number) => `${Number((rate / 1000).toFixed(3))} kHz`

/** ビットレートの表示（192 kbps など） */
export const formatBitrate = (bps: number) => `${Math.round(bps / 1000)} kbps`

import type { MetadataTags } from 'mediabunny'
import type { SubtitleCue } from '../text/subtitles'
import type { TrimAction } from '../../state/trim'
import type { Trim } from '../../types'

/** 元ファイルから読んだ情報。寸法は向きのメタデータを反映した見た目どおりのもの */
export interface VideoInfo {
  /** 秒 */
  duration: number
  /** 映像トラックがなければ null */
  dimensions: { width: number; height: number } | null
  videoCodec: string | null
  audioCodec: string | null
  /** タグが読めなかった場合は null */
  tags: MetadataTags | null
}

/** 切り抜き範囲。元の映像（見た目どおりの向き）の画素座標で、常に偶数の整数かつ映像の内側 */
export interface VideoCropRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type VideoRotation = 0 | 90 | 180 | 270

/**
 * 動画の非破壊編集の内容。不変オブジェクトで、applyVideoEdit を通してのみ作り替える。
 *
 * 適用の順番（renderVideo・プレビュー・静止画の書き出しはすべてこの順）:
 * 1. trim: 元ファイルの時間軸で切り出す
 * 2. crop: 元の向きの座標で切り抜く。回転・反転の前なので、回しても切り抜き範囲は変わらない
 * 3. rotation: 時計回りに 0/90/180/270 度
 * 4. flipH / flipV: 回転後の見た目に対して左右・上下を入れ替える
 * 5. muted: 音声トラックを捨てる
 * 6. speed: 区間を 1 / speed の長さにする（映像はタイムスタンプを書き換え、音声は伸縮する）
 * 7. subtitles: 元の時間軸の字幕を、区間と speed に合わせて書き出しの時間軸に直して入れる（src/media/video/timing.ts）
 * 解像度（拡大縮小）は出力設定（VideoOutput）側で、回転後の寸法に対して効く。
 * 字幕の焼き込みは拡大縮小のあとの絵に描くので、文字の大きさは出力の寸法に対して決まる。
 */
export interface VideoRecipe {
  readonly trim: Readonly<Trim>
  readonly crop: VideoCropRect | null
  readonly rotation: VideoRotation
  readonly flipH: boolean
  readonly flipV: boolean
  readonly muted: boolean
  /** 再生速度。MIN_VIDEO_SPEED〜MAX_VIDEO_SPEED（src/media/video/timing.ts） */
  readonly speed: number
  /** 速さを変えても音の高さを保つか。false なら単純に詰める（早回しの声になる） */
  readonly preservePitch: boolean
  readonly subtitles: VideoSubtitles | null
}

/** 字幕を動画に入れるやり方。embed は字幕トラックとして同梱（入りきらない形式では使えない）、burn は絵に描き込む */
export type VideoSubtitleMode = 'embed' | 'burn'

/** 動画に添える字幕。時刻は元の動画の時間軸（ミリ秒）で持ち、ずらしは offset に分けて持つ */
export interface VideoSubtitles {
  /** 読み込んだファイルの名前（表示用） */
  readonly name: string
  readonly cues: readonly SubtitleCue[]
  /** 全体をずらすミリ秒（正なら遅らせる） */
  readonly offset: number
  readonly mode: VideoSubtitleMode
}

export type VideoEdit =
  | { type: 'trim'; action: TrimAction }
  | { type: 'crop'; rect: VideoCropRect | null }
  /** 見た目の時計回りに 90 度 × turns。負なら反時計回り */
  | { type: 'rotate'; turns: number }
  /** 見た目の左右を入れ替える */
  | { type: 'flipH' }
  /** 見た目の上下を入れ替える */
  | { type: 'flipV' }
  | { type: 'mute'; muted: boolean }
  | { type: 'speed'; speed: number }
  | { type: 'preservePitch'; preserve: boolean }
  /** 字幕を入れ替える（null で外す）。ずらしは 0 に戻し、入れ方は前のものを引き継ぐ */
  | { type: 'subtitles'; subtitles: Pick<VideoSubtitles, 'name' | 'cues'> | null }
  /** 字幕のずらしを ms にする */
  | { type: 'subtitleOffset'; offset: number }
  | { type: 'subtitleMode'; mode: VideoSubtitleMode }
  | { type: 'reset' }

export type VideoFormat = 'mp4' | 'webm' | 'gif'

/**
 * 出力設定。ファイルをまたいで使い回す（レシピと違ってファイルの中身に依存しない）。
 * width / height は回転・切り抜き後の映像に対して効く。片方だけなら縦横比を保つ。
 */
export interface VideoOutput {
  format: VideoFormat
  /** 1〜100。MP4 / WebM のビットレートの目安 */
  quality: number
  width?: number
  height?: number
  /** GIF のフレームレート。未指定なら DEFAULT_GIF_FPS */
  fps?: number
  /**
   * 短い辺の上限（拡大はしない）。width / height がどちらもないときだけ効く。
   * 寸法がわからないうちに当てたプリセット（一括変換など）が使い、書き出すときに寸法へ直す
   */
  maxShortSide?: number
  /**
   * 書き出しの上限バイト数（MP4 / WebM）。区間の長さから映像のビットレートを決め、quality のビットレートより
   * 低ければそちらを使う。serviceLimits.json の maxSize をそのまま渡せる。GIF では使わない
   */
  targetSize?: number
}

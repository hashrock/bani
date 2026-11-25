import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { playableTimeFrom } from '../../media/audio/silence'
import type { TimeRange } from '../../media/audio/types'
import { hasReachedEnd, playbackStart } from '../../state/playback'

interface UseAudioPreviewOptions {
  audioRef: RefObject<HTMLAudioElement | null>
  /** 再生を閉じ込める区間（元ファイルの秒） */
  start: number
  end: number
  /** 元ファイルの時刻での試聴の倍率（フェード × 音量 × ノーマライズ） */
  gainAt: (time: number) => number
  mono: boolean
  /** 無音カットで残す範囲（昇順、start〜end の中）。削る範囲は飛ばして鳴らす */
  kept: readonly TimeRange[]
}

export interface AudioPreview {
  currentTime: number
  playing: boolean
  seek: (time: number) => void
  toggle: () => void
}

interface Graph {
  context: AudioContext
  gain: GainNode
}

/** チャンネル数を 1 に固定すると、ブラウザが (L + R) / 2 に畳む（書き出しのモノラル化と同じ式） */
function setMono(node: AudioNode, mono: boolean) {
  node.channelCountMode = mono ? 'explicit' : 'max'
  node.channelCount = mono ? 1 : 2
}

/** 倍率を追いかける速さ（秒）。急に変えるとプツッと鳴るので少しだけ滑らかにする */
const GAIN_SMOOTHING = 0.015

/**
 * 元ファイルを <audio> で鳴らし、Web Audio の GainNode を通して編集をおおよそ反映する試聴。
 * - フェード・音量・ノーマライズ: 再生位置に合わせて毎フレーム GainNode の倍率を差し替える
 * - モノラル化: GainNode のチャンネル数を 1 に固定し、ブラウザのダウンミックスに任せる
 * - 無音カット: 再生位置が削る範囲に入ったら、次に残す範囲の頭へ <audio> を飛ばす。
 *   位置は毎フレーム（約 16ms）しか読めず、シークにも少し掛かるので、削る範囲の頭がわずかに漏れたり
 *   つなぎ目に短い間が空いたりする。漏れる分は倍率を 0 にして鳴らさない（書き出しのクロスフェードは再現しない）
 * 書き出し（dsp.ts・splice.ts）と完全には一致しない。区間の終わりで頭に戻してループさせる。
 */
export function useAudioPreview({
  audioRef,
  start,
  end,
  gainAt,
  mono,
  kept,
}: UseAudioPreviewOptions): AudioPreview {
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const graphRef = useRef<Graph | null>(null)
  const gainAtRef = useRef(gainAt)
  const startRef = useRef(start)
  const keptRef = useRef(kept)
  useEffect(() => {
    gainAtRef.current = gainAt
    startRef.current = start
    keptRef.current = kept
  })

  // AudioContext は再生のたびに作らず、最初の再生（ユーザー操作の中）で 1 度だけ作る
  const ensureGraph = useCallback((): Graph | null => {
    if (graphRef.current) return graphRef.current
    const audio = audioRef.current
    if (!audio || typeof AudioContext === 'undefined') return null
    try {
      const context = new AudioContext()
      const source = context.createMediaElementSource(audio)
      const gain = context.createGain()
      source.connect(gain).connect(context.destination)
      graphRef.current = { context, gain }
      return graphRef.current
    } catch (err) {
      // Web Audio が使えなくても、加工なしで鳴らせれば試聴にはなる
      console.warn('Web Audio preview is unavailable:', err)
      return null
    }
  }, [audioRef])

  useEffect(() => {
    return () => {
      void graphRef.current?.context.close()
      graphRef.current = null
    }
  }, [])

  useEffect(() => {
    if (graphRef.current) setMono(graphRef.current.gain, mono)
  }, [mono, playing])

  const applyGain = useCallback((time: number) => {
    const graph = graphRef.current
    if (!graph) return
    graph.gain.gain.setTargetAtTime(gainAtRef.current(time), graph.context.currentTime, GAIN_SMOOTHING)
  }, [])

  // 再生中は毎フレーム位置を読む。timeupdate だけだと 4Hz 程度で、再生位置の線もフェードもカクつく
  useEffect(() => {
    if (!playing) return
    const audio = audioRef.current
    if (!audio) return
    let frame = 0
    const tick = () => {
      let time = audio.currentTime
      // 削る範囲の中なら次に残す範囲の頭へ、最後の範囲より後なら区間の頭へ戻る
      const playable = hasReachedEnd(time, end) ? null : playableTimeFrom(keptRef.current, time)
      const next = playable ?? keptRef.current[0]?.start ?? start
      if (next !== time) {
        audio.currentTime = next
        time = next
      }
      setCurrentTime(time)
      applyGain(time)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, audioRef, start, end, applyGain])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    // 区間の終わりがファイルの終わりと重なると、位置が終わりの判定に届く前に再生が止まることがある
    // （尺の読み取りと <audio> の尺がわずかにずれる）。止まったら区間の頭から続けてループさせる
    const onEnded = () => {
      audio.currentTime = startRef.current
      void audio.play().catch(() => setPlaying(false))
    }
    const onSeeked = () => {
      if (audio.paused) setCurrentTime(audio.currentTime)
    }
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('seeked', onSeeked)
    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('seeked', onSeeked)
    }
  }, [audioRef])

  const seek = useCallback(
    (time: number) => {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = time
      setCurrentTime(time)
    },
    [audioRef]
  )

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!audio.paused) {
      audio.pause()
      return
    }
    const graph = ensureGraph()
    if (graph) {
      void graph.context.resume()
      setMono(graph.gain, mono)
    }
    // 区間の外から再生し始めると意図しない場所が流れるので頭に戻す
    const inTrim = playbackStart(audio.currentTime, start, end)
    const from = playableTimeFrom(kept, inTrim) ?? kept[0]?.start ?? start
    if (from !== audio.currentTime) audio.currentTime = from
    // 鳴り始めの 1 フレームを加工前の音量で鳴らさないよう、先に倍率を合わせる
    if (graph) graph.gain.gain.setValueAtTime(gainAtRef.current(from), graph.context.currentTime)
    void audio.play().catch((err) => console.warn('Playback failed:', err))
  }, [audioRef, ensureGraph, start, end, mono, kept])

  return { currentTime, playing, seek, toggle }
}

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import { baseExtensions, createCompartments, phrasesExtension, wrapExtension } from './editor'
import type { LanguageId } from './language'
import { loadLanguage } from './languageLoader'

interface CodeEditorProps {
  /** 最初に置く本文。あとから変えても反映しない（本文はエディタが持つ） */
  initialText: string
  language: LanguageId
  wrap: boolean
  phrases: Record<string, string>
  onReady: (view: EditorView | null) => void
  onUpdate: (update: ViewUpdate) => void
  className?: string
}

/**
 * CodeMirror を React に置く薄い枠。本文と取り消しの履歴はエディタ自身が持ち、
 * React の再描画では作り直さない（上書き保存しても履歴が残るように）
 */
export function CodeEditor({ initialText, language, wrap, phrases, onReady, onUpdate, className }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<EditorView | null>(null)
  const [compartments] = useState(createCompartments)
  const callbacks = useRef({ onReady, onUpdate })
  useEffect(() => {
    callbacks.current = { onReady, onUpdate }
  })
  // 作るときの値。以後の変更は下の効果で差し替える
  const initial = useRef({ initialText, wrap, phrases })

  useEffect(() => {
    const created = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: initial.current.initialText,
        extensions: [
          baseExtensions(),
          compartments.language.of([]),
          compartments.wrap.of(wrapExtension(initial.current.wrap)),
          compartments.phrases.of(phrasesExtension(initial.current.phrases)),
          EditorView.updateListener.of((update) => callbacks.current.onUpdate(update)),
        ],
      }),
    })
    setView(created)
    callbacks.current.onReady(created)
    created.focus()
    return () => {
      callbacks.current.onReady(null)
      created.destroy()
    }
  }, [compartments])

  useEffect(() => {
    if (!view) return
    let cancelled = false
    loadLanguage(language).then(
      (extension) => {
        if (!cancelled) view.dispatch({ effects: compartments.language.reconfigure(extension) })
      },
      // 強調できなくても編集はできるので、知らせるだけにする
      (error: unknown) => console.warn('Failed to load language support:', error)
    )
    return () => {
      cancelled = true
    }
  }, [view, language, compartments])

  useEffect(() => {
    view?.dispatch({ effects: compartments.wrap.reconfigure(wrapExtension(wrap)) })
  }, [view, wrap, compartments])

  useEffect(() => {
    view?.dispatch({ effects: compartments.phrases.reconfigure(phrasesExtension(phrases)) })
  }, [view, phrases, compartments])

  return <div ref={hostRef} className={className} />
}

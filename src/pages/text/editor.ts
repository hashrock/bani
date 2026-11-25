import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'

/**
 * エディタの拡張。codemirror の basicSetup から、補完（言語ごとの候補が要る）と
 * lint（ここでは使わない）を除いたもの。Tab は字下げに奪わず、フォーカスの移動に残す
 */
export function baseExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    // 検索欄は上に出す（下はステータス行と重なって見落としやすい）
    search({ top: true }),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap]),
    EditorView.domEventHandlers({
      // ファイルのドロップはエディタに挿入させず、アプリ全体の受付（開き直し）に任せる
      drop: (event) => event.dataTransfer?.types.includes('Files') ?? false,
      dragover: (event) => event.dataTransfer?.types.includes('Files') ?? false,
    }),
    lightTheme,
  ]
}

/** 後から差し替える設定。言語は遅れて読み込むので、最初は空で作って差し替える */
export interface EditorCompartments {
  language: Compartment
  phrases: Compartment
  wrap: Compartment
}

export const createCompartments = (): EditorCompartments => ({
  language: new Compartment(),
  phrases: new Compartment(),
  wrap: new Compartment(),
})

export const wrapExtension = (wrap: boolean): Extension => (wrap ? EditorView.lineWrapping : [])

export const phrasesExtension = (phrases: Record<string, string>): Extension => EditorState.phrases.of(phrases)

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

/** アプリの無彩色に合わせた明るい配色。色を持つのは構文の強調と検索の一致だけ */
const lightTheme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--background)', color: 'var(--foreground)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: MONO, lineHeight: '1.6' },
    '.cm-content': { padding: '8px 0', caretColor: '#000' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#000', borderLeftWidth: '1.5px' },
    '.cm-gutters': {
      backgroundColor: '#fafafa',
      color: '#999',
      borderRight: '1px solid var(--border)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px' },
    '.cm-activeLine': { backgroundColor: '#f7f7f7' },
    '.cm-activeLineGutter': { backgroundColor: '#f0f0f0', color: '#000' },
    '.cm-selectionBackground': { backgroundColor: '#e4e4e4' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: '#d7e3f5' },
    '.cm-selectionMatch': { backgroundColor: '#eef3fb' },
    '.cm-searchMatch': { backgroundColor: '#fff1a8', outline: '1px solid #e6cf5c' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#ffd34d' },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: '#e8e8e8', outline: '1px solid #bbb' },
    '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: '#fde2e2' },
    '.cm-foldPlaceholder': { backgroundColor: '#f0f0f0', border: '1px solid var(--border)', color: '#666' },
    '.cm-panels': { backgroundColor: 'var(--background)', color: 'var(--foreground)' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
    '.cm-panel.cm-search': {
      padding: '6px 10px',
      fontSize: '12px',
      fontFamily: 'var(--font-sans)',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '4px 6px',
    },
    '.cm-panel.cm-search br': { flexBasis: '100%', height: 0 },
    '.cm-panel.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '12px' },
    '.cm-panel.cm-search [name=close]': { position: 'absolute', top: '4px', right: '8px', fontSize: '16px' },
    '.cm-textfield': {
      height: '26px',
      padding: '0 8px',
      fontSize: '12px',
      border: '1px solid var(--input)',
      borderRadius: '4px',
      backgroundColor: 'var(--background)',
      margin: 0,
    },
    '.cm-textfield:focus': { outline: '2px solid #00000033', borderColor: '#000' },
    '.cm-button': {
      height: '26px',
      padding: '0 10px',
      fontSize: '12px',
      backgroundImage: 'none',
      backgroundColor: 'var(--background)',
      border: '1px solid var(--input)',
      borderRadius: '4px',
      margin: 0,
      cursor: 'pointer',
    },
    '.cm-button:hover': { backgroundColor: 'var(--muted)' },
    '.cm-tooltip': { border: '1px solid var(--border)', backgroundColor: 'var(--popover)' },
  },
  { dark: false }
)

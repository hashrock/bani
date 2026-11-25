import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  HighlightStyle,
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
    syntaxHighlighting(highlightStyle, { fallback: true }),
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
    appTheme,
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

/**
 * codemirror の既定の強調の色を CSS 変数に置き換える。ライトでは変数がないので元の色のまま、
 * ダークでは index.css の .dark が --syntax-* で暗い地に読める色を与える
 */
const SYNTAX_VARS: Record<string, string> = {
  '#404740': 'meta',
  '#708': 'keyword',
  '#219': 'atom',
  '#164': 'literal',
  '#a11': 'string',
  '#e40': 'regexp',
  '#00f': 'definition',
  '#30a': 'local',
  '#085': 'type',
  '#167': 'class',
  '#256': 'special',
  '#00c': 'property',
  '#940': 'comment',
  '#f00': 'invalid',
}

const highlightStyle = HighlightStyle.define(
  defaultHighlightStyle.specs.map((spec) => {
    const name = typeof spec.color === 'string' ? SYNTAX_VARS[spec.color] : undefined
    return name ? { ...spec, color: `var(--syntax-${name}, ${spec.color})` } : spec
  })
)

/**
 * アプリの無彩色に合わせた配色。色を持つのは構文の強調と検索の一致だけ。
 * 色はすべてアプリの CSS 変数から作り（color-mix で地に重ねる）、ライトとダークの両方で同じ定義を使う
 */
const appTheme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--background)', color: 'var(--foreground)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: MONO, lineHeight: '1.6' },
    '.cm-content': { padding: '8px 0', caretColor: 'var(--foreground)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)', borderLeftWidth: '1.5px' },
    '.cm-gutters': {
      backgroundColor: 'var(--muted)',
      color: 'color-mix(in srgb, var(--foreground) 40%, transparent)',
      borderRight: '1px solid var(--border)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--foreground) 3%, transparent)' },
    '.cm-activeLineGutter': {
      backgroundColor: 'color-mix(in srgb, var(--foreground) 6%, transparent)',
      color: 'var(--foreground)',
    },
    '.cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--foreground) 12%, transparent)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--timeline) 30%, transparent)',
    },
    '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--timeline) 14%, transparent)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(255, 214, 0, 0.3)', outline: '1px solid rgba(214, 178, 0, 0.7)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(255, 196, 0, 0.6)' },
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)',
      outline: '1px solid color-mix(in srgb, var(--foreground) 30%, transparent)',
    },
    '&.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'color-mix(in srgb, var(--destructive) 20%, transparent)',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--secondary)',
      border: '1px solid var(--border)',
      color: 'var(--muted-foreground)',
    },
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
    '.cm-textfield:focus': {
      outline: '2px solid color-mix(in srgb, var(--ring) 20%, transparent)',
      borderColor: 'var(--ring)',
    },
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

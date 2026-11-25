import { undo as undoEditor, redo as redoEditor } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import type { Text } from '@codemirror/state'
import type { EditorView, ViewUpdate } from '@codemirror/view'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useReportUnsaved } from '../../app/leaveGuard'
import { SidebarHead } from '../../components/BrandMark'
import { SaveButton } from '../../components/SaveButton'
import { CheckboxField, Fact, Facts, Notice, SourceName } from '../../components/SidebarParts'
import { Step, StepHint } from '../../components/Step'
import { Button } from '@/components/ui/button'
import { pickFiles } from '../../core/opened'
import type { OpenedFile } from '../../core/opened'
import type { SaveMethod } from '../../core/save'
import { useHotkey } from '../../core/useHotkey'
import { usePersistentState } from '../../core/usePersistentState'
import { useSave } from '../../core/useSave'
import type { ResumedSession } from '../../core/session'
import { useSessionRecipe } from '../../core/useSessionRecipe'
import type { SaveRendered, WrittenMethod } from '../../core/useSave'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import type { BomSetting, NewlineCounts, NewlineSetting, TextRecipe } from '../../media/text'
import {
  DEFAULT_TEXT_RECIPE,
  TEXT_ENCODINGS,
  UnrepresentableCharactersError,
  applyTextEdit,
  findUnrepresentable,
  parseSubtitles,
  resolveTextOutput,
  supportsBom,
} from '../../media/text'
import { formatBytes } from '../../utils/format'
import { CodeEditor } from './CodeEditor'
import type { PreparedText, TextBase } from './document'
import {
  applyContentTools,
  baseAfterSave,
  encodePrepared,
  isDocModified,
  isFormatChanged,
  minimalChange,
  prepareText,
} from './document'
import { formatJson, minifyJson, validateJson } from './json'
import type { LanguageId, SubtitleKind } from './language'
import { LANGUAGES, LANGUAGE_EXTENSIONS, LANGUAGE_LABELS, detectLanguage, extensionOf } from './language'
import { ENCODING_LABELS, NEWLINE_LABELS } from './labels'
import { parseMarkdown } from './markdown'
import { MarkdownPreview } from './MarkdownPreview'
import { textMessages } from './messages'
import { Choice, Field, Segmented, ToolButton } from './parts'
import { shiftTimingLines } from './subtitle'

/** 開くときに決まっていること。EditPage がファイルを読んで作る */
export interface InitialDocument {
  base: TextBase
  text: string
  handle: FileSystemFileHandle | null
  /** 新規の文書（まだどこにも保存していない） */
  untitled: boolean
  size: number | null
  decodeErrors: boolean
  /** バイナリらしいのを承知で開いた */
  forcedBinary: boolean
  newlineCounts: NewlineCounts | null
}

/** 別のファイルを開いても残す、表示と保存の好み */
interface TextPrefs {
  wrap: boolean
  markdownPreview: boolean
  trimOnSave: boolean
  jsonIndent: '2' | '4' | 'tab'
}

const DEFAULT_PREFS: TextPrefs = { wrap: false, markdownPreview: true, trimOnSave: false, jsonIndent: '2' }

/** これより長い本文では、全文を見る処理（文字のチェック・下見）の間隔を空ける */
const LARGE_TEXT = 2_000_000

/** 保存したもの。保存できたあと、これを新しい基準にする */
interface RenderedDocument extends SaveRendered {
  prepared: PreparedText
  /** 保存した時点の本文（保存中に打った分と区別する） */
  doc: Text
  /** 表せない文字を ? にして保存した（画面の本文と保存した中身が食い違う） */
  lossy: boolean
}

interface Cursor {
  line: number
  column: number
  selected: number
  lines: number
}

interface TextEditorScreenProps {
  initial: InitialDocument
  isDragging: boolean
  onFiles: (files: OpenedFile[]) => void
  onNew: () => void
  /** 保存していない変更があるか（App が開き直す前・閉じる前に確かめる） */
  onDirtyChange: (dirty: boolean) => void
  /** 作業の保存に使う、開いたファイル（新規の文書なら null）と、再開して来たときのセッション */
  session?: { opened: OpenedFile | null; resumed: ResumedSession | null }
}

/** 残す作業の形の見本。置換の一覧は空なので、要素の形は 1 つ置いて比べる */
const SESSION_TEMPLATE = {
  text: '',
  recipe: {
    ...DEFAULT_TEXT_RECIPE,
    replacements: [{ id: '', find: '', replace: '', regex: false, caseSensitive: false }],
  },
}

/**
 * テキスト・コードの編集画面。本文と取り消しの履歴は CodeMirror が持ち、
 * この画面は「どう書くか」（文字コード・BOM・改行・字幕の形式）と保存の基準を持つ
 */
export function TextEditorScreen({ initial, isDragging, onFiles, onNew, onDirtyChange, session }: TextEditorScreenProps) {
  const m = useLocalMessages(textMessages)
  const { t } = useI18n()
  const [base, setBase] = useState(initial.base)
  const [handle, setHandle] = useState(initial.handle)
  const [untitled, setUntitled] = useState(initial.untitled)
  const [size, setSize] = useState(initial.size)
  const [language, setLanguage] = useState<LanguageId>(() => detectLanguage(initial.base))
  const [recipe, setRecipe] = useState<TextRecipe>(DEFAULT_TEXT_RECIPE)
  const [subtitleTarget, setSubtitleTarget] = useState<SubtitleKind | null>(initial.base.subtitle)
  const [replaceUnrepresentable, setReplaceUnrepresentable] = useState(false)
  const [lossySave, setLossySave] = useState(false)
  const [prefs, setPrefs] = usePersistentState<TextPrefs>('text.prefs', DEFAULT_PREFS)
  const [shiftMs, setShiftMs] = useState('0')

  const [view, setView] = useState<EditorView | null>(null)
  const savedDocRef = useRef<Text | null>(null)
  const [docModified, setDocModified] = useState(false)
  const [revision, setRevision] = useState(0)
  const [cursor, setCursor] = useState<Cursor>({ line: 1, column: 1, selected: 0, lines: 1 })
  // 全文を見る処理（文字のチェック・JSON の検証・下見）は、打つ手が止まってから最新の本文で行う
  const [snapshot, setSnapshot] = useState(initial.text)

  const updatePrefs = (patch: Partial<TextPrefs>) => setPrefs((prev) => ({ ...prev, ...patch }))

  const handleReady = useCallback((created: EditorView | null) => {
    if (created) {
      savedDocRef.current = created.state.doc
      setCursor((prev) => ({ ...prev, lines: created.state.doc.lines }))
    }
    setView(created)
  }, [])

  const handleUpdate = useCallback((update: ViewUpdate) => {
    const { state } = update
    if (update.docChanged) {
      setDocModified(savedDocRef.current ? isDocModified(state.doc, savedDocRef.current) : true)
      setRevision((r) => r + 1)
    }
    if (update.docChanged || update.selectionSet) {
      const head = state.selection.main.head
      const line = state.doc.lineAt(head)
      setCursor({
        line: line.number,
        // 列はコードポイント単位（サロゲートペアを 1 文字と数える）
        column: [...line.text.slice(0, head - line.from)].length + 1,
        selected: state.selection.ranges.reduce((sum, range) => sum + range.to - range.from, 0),
        lines: state.doc.lines,
      })
    }
  }, [])

  useEffect(() => {
    if (!view || revision === 0) return
    const delay = view.state.doc.length > LARGE_TEXT ? 1000 : 250
    const timer = setTimeout(() => setSnapshot(view.state.doc.toString()), delay)
    return () => clearTimeout(timer)
  }, [view, revision])

  const output = resolveTextOutput(recipe, base)
  const formatChanged = isFormatChanged(base, recipe, subtitleTarget)
  const modified = docModified || formatChanged || lossySave
  const converting = base.subtitle !== null && subtitleTarget !== null && subtitleTarget !== base.subtitle
  const displayName = untitled ? m.untitled : base.name
  const suggestedName = untitled ? `untitled.${LANGUAGE_EXTENSIONS[language]}` : base.name

  const unrepresentable = useMemo(
    () => findUnrepresentable(snapshot, output.encoding),
    [snapshot, output.encoding]
  )
  const jsonError = useMemo(
    () => (language === 'json' && snapshot.trim() !== '' ? validateJson(snapshot) : null),
    [language, snapshot]
  )
  const subtitles = useMemo(
    () => (base.subtitle ? parseSubtitles(snapshot, base.subtitle) : null),
    [base.subtitle, snapshot]
  )
  const showPreview = language === 'markdown' && prefs.markdownPreview
  const markdown = useMemo(() => (showPreview ? parseMarkdown(snapshot) : null), [showPreview, snapshot])

  // 編集中はタブの題名にも印を付ける（ほかのタブから見て未保存とわかるように）
  useEffect(() => {
    const previous = document.title
    document.title = `${modified ? '● ' : ''}${displayName} — Bani`
    return () => {
      document.title = previous
    }
  }, [modified, displayName])

  // 保存していない変更は App に知らせ、開き直す・閉じる前に確かめてもらう
  useReportUnsaved(modified, onDirtyChange)

  /** 本文を差し替える。変わった範囲だけを渡すので、取り消し 1 回で元に戻り、カーソルも飛ばない */
  const replaceDoc = useCallback(
    (next: string): boolean => {
      if (!view) return false
      const change = minimalChange(view.state.doc.toString(), next)
      if (!change) return false
      view.dispatch({ changes: change, userEvent: 'input.replace' })
      return true
    },
    [view]
  )

  // 本文と書き方（レシピ）を作業として残し、入口から再開できるようにする。
  // 再開した本文は読み込んだ本文への 1 回の書き換えとして当てる（取り消せばファイルの中身に戻る）
  const sessionRecipe = useMemo(() => ({ text: snapshot, recipe }), [snapshot, recipe])
  useSessionRecipe('text', sessionRecipe, {
    opened: session?.opened ?? null,
    resumed: session?.resumed,
    enabled: true,
    dirty: modified,
    version: 1,
    ready: view !== null,
    template: SESSION_TEMPLATE,
    label: displayName,
    onResume: (saved) => {
      replaceDoc(saved.text)
      setRecipe(saved.recipe)
    },
  })

  const runTool = (transform: (text: string) => string) => {
    if (!view) return
    if (!replaceDoc(transform(view.state.doc.toString()))) toast(m.noChange)
    view.focus()
  }

  const jumpTo = (offset: number) => {
    if (!view) return
    const at = Math.min(offset, view.state.doc.length)
    view.dispatch({ selection: { anchor: at }, scrollIntoView: true })
    view.focus()
  }

  const runJson = (mode: 'format' | 'minify') => {
    if (!view) return
    const text = view.state.doc.toString()
    const indent = prefs.jsonIndent === 'tab' ? '\t' : Number(prefs.jsonIndent)
    const result = mode === 'format' ? formatJson(text, indent) : minifyJson(text)
    if (!result.ok) {
      const { line, column, reason, offset } = result.error
      toast.error(m.jsonError(line, column, reason))
      jumpTo(offset)
      return
    }
    runTool(() => result.text)
  }

  const runShift = () => {
    if (!view) return
    const ms = Number(shiftMs)
    if (!Number.isFinite(ms) || Math.round(ms) === 0) return
    const result = shiftTimingLines(view.state.doc.toString(), ms)
    replaceDoc(result.text)
    toast(result.clamped > 0 ? `${m.shifted(result.shifted)}。${m.shiftClamped(result.clamped)}` : m.shifted(result.shifted))
    view.focus()
  }

  const render = useCallback(
    async (method: SaveMethod): Promise<RenderedDocument> => {
      if (!view) throw new Error('The editor is not ready')
      // 保存で行末の空白を落とすなら、エディタの本文にも当てて、画面と保存した中身をそろえる
      if (method !== 'copyToClipboard' && prefs.trimOnSave) {
        replaceDoc(applyContentTools(view.state.doc.toString(), { trimTrailingWhitespace: true }))
      }
      const doc = view.state.doc
      const prepared = prepareText(doc.toString(), { ...base, name: suggestedName }, recipe, subtitleTarget)
      // コピーは文字コードにする前の文字列を渡す（Shift_JIS の Blob を UTF-8 として読むと化ける）
      const copy = { text: prepared.editorText }
      if (method === 'copyToClipboard') {
        return { blob: new Blob([prepared.editorText], { type: 'text/plain' }), filename: prepared.filename, copy, prepared, doc, lossy: false }
      }
      const encoded = encodePrepared(prepared, { replaceUnrepresentable })
      return {
        blob: encoded.blob,
        filename: prepared.filename,
        copy,
        prepared,
        doc,
        lossy: encoded.unrepresentable.length > 0,
      }
    },
    [view, prefs.trimOnSave, replaceDoc, base, suggestedName, recipe, subtitleTarget, replaceUnrepresentable]
  )

  const handleSaved = useCallback(
    (_method: WrittenMethod, savedHandle: FileSystemFileHandle | null, rendered: RenderedDocument) => {
      if (!view) return
      // ダウンロードになったときは、ブラウザに渡した名前で保存されたものとみなす
      const target = { handle: savedHandle, name: savedHandle?.name ?? rendered.filename }
      const { prepared, doc } = rendered
      let savedDoc = doc
      // 字幕の形式を変えて保存したら、エディタも保存した形式の本文にする（保存中に打っていなければ）
      if (prepared.editorText !== doc.toString() && view.state.doc.eq(doc)) {
        replaceDoc(prepared.editorText)
        savedDoc = view.state.doc
      }
      savedDocRef.current = savedDoc
      setDocModified(isDocModified(view.state.doc, savedDoc))
      setLossySave(rendered.lossy)
      const nextBase = baseAfterSave(base, prepared, target.name)
      setBase(nextBase)
      setRecipe(DEFAULT_TEXT_RECIPE)
      setSubtitleTarget(nextBase.subtitle)
      setReplaceUnrepresentable(false)
      setSize(rendered.blob.size)
      if (target.handle) setHandle(target.handle)
      // 拡張子が変わったら（新規の文書に名前が付いたときなど）言語も選び直す
      if (extensionOf(target.name) !== extensionOf(suggestedName)) setLanguage(detectLanguage(nextBase))
      setUntitled(false)
    },
    [view, replaceDoc, base, suggestedName]
  )

  const describeError = useCallback(
    (error: unknown) =>
      error instanceof UnrepresentableCharactersError
        ? m.unrepresentableError(error.characters.length, ENCODING_LABELS[output.encoding])
        : null,
    [m, output.encoding]
  )

  // テキストは劣化しないので上書きが主。保存先（別名で選んだハンドル）はこの画面が持つ
  const save = useSave({
    opened: null,
    handle,
    lossless: true,
    sameFormat: !converting,
    canCopy: true,
    disabled: !view,
    render,
    onSaved: handleSaved,
    describeError,
  })

  // エディタの外で押した ⌘Z / ⇧⌘Z も、本文の取り消し・やり直しにする（ほかの画面と同じキー）
  useHotkey('mod+z', () => view && undoEditor(view), { enabled: !!view, repeat: true })
  useHotkey('mod+shift+z', () => view && redoEditor(view), { enabled: !!view, repeat: true })
  useHotkey('mod+y', () => view && redoEditor(view), { enabled: !!view, repeat: true })

  // 開き直しは App が変更の有無を確かめる。新規はこの画面の中で作り直すので、ここで確かめる
  const handlePick = async () => {
    const picked = await pickFiles({})
    if (picked.length > 0) onFiles(picked)
  }

  const handleNew = () => {
    if (!modified || window.confirm(t.discardConfirm)) onNew()
  }

  const editRecipe = (edit: Parameters<typeof applyTextEdit>[1]) => setRecipe((prev) => applyTextEdit(prev, edit))

  const newlineDescription = (() => {
    const detected = base.newlineDetected
    if (detected === 'none') return m.newlineNone
    if (detected !== 'mixed') return NEWLINE_LABELS[detected]
    const counts = initial.newlineCounts
    const detail = counts
      ? (['lf', 'crlf', 'cr'] as const)
          .filter((kind) => counts[kind] > 0)
          .map((kind) => `${NEWLINE_LABELS[kind]} ${counts[kind]}`)
          .join(' / ')
      : ''
    return m.newlineMixed(detail)
  })()

  const languageOptions = LANGUAGES.map((id) => ({
    value: id,
    label: id === 'plain' ? m.plainText : LANGUAGE_LABELS[id],
  }))
  const encodingOptions = [
    { value: 'keep' as const, label: m.keepEncoding(ENCODING_LABELS[base.encoding]) },
    ...TEXT_ENCODINGS.map((encoding) => ({ value: encoding, label: ENCODING_LABELS[encoding] })),
  ]
  const large = initial.text.length > LARGE_TEXT

  return (
    <div className="app">
      <aside className="sidebar">
        <SidebarHead />

        <div className="sidebar-scroll">
          <Step index={1} title={t.stepInput}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                {modified && (
                  <span className="size-2 shrink-0 rounded-full bg-foreground" title={m.modified} aria-label={m.modified} />
                )}
                <SourceName title={displayName}>{displayName}</SourceName>
              </div>
              {untitled ? (
                <StepHint>{m.newDocumentHint}</StepHint>
              ) : (
                <Facts>
                  {size !== null && <Fact label={m.factSize}>{formatBytes(size)}</Fact>}
                  <Fact label={m.factEncoding}>
                    {ENCODING_LABELS[base.encoding]}
                    {base.bom && ` · ${m.withBom}`}
                  </Fact>
                  <Fact label={m.factNewline}>{newlineDescription}</Fact>
                  <Fact label={m.factLines}>{cursor.lines.toLocaleString()}</Fact>
                </Facts>
              )}
              {initial.decodeErrors && <Notice tone="warn">{m.decodeErrors}</Notice>}
              {initial.forcedBinary && <Notice tone="warn">{m.forcedBinary}</Notice>}
              {large && <StepHint>{m.largeNotice}</StepHint>}
            </div>
            <div className="flex gap-1.5">
              <Button variant="outline" size="xs" className="h-7 px-2.5" onClick={() => void handlePick()}>
                {t.selectFile}
              </Button>
              <Button variant="outline" size="xs" className="h-7 px-2.5" onClick={handleNew}>
                {m.newDocument}
              </Button>
            </div>
          </Step>

          <Step index={2} title={m.stepView}>
            <Field label={m.language}>
              <Choice
                value={language}
                options={languageOptions}
                onChange={setLanguage}
                ariaLabel={m.language}
                className="w-40"
              />
            </Field>
            <CheckboxField checked={prefs.wrap} onChange={(wrap) => updatePrefs({ wrap })}>
              {m.wrap}
            </CheckboxField>
            {language === 'markdown' && (
              <CheckboxField checked={prefs.markdownPreview} onChange={(markdownPreview) => updatePrefs({ markdownPreview })}>
                {m.markdownPreview}
              </CheckboxField>
            )}
          </Step>

          <Step index={3} title={t.stepEdit}>
            {language === 'json' && (
              <div className="flex flex-col gap-2 rounded-md bg-muted px-3 py-2.5">
                <Field label={m.jsonIndent}>
                  <Segmented
                    className="w-36"
                    value={prefs.jsonIndent}
                    options={[
                      { value: '2', label: '2' },
                      { value: '4', label: '4' },
                      { value: 'tab', label: m.jsonIndentTab },
                    ]}
                    onChange={(jsonIndent) => updatePrefs({ jsonIndent })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-1.5">
                  <ToolButton onClick={() => runJson('format')}>{m.jsonFormat}</ToolButton>
                  <ToolButton onClick={() => runJson('minify')}>{m.jsonMinify}</ToolButton>
                </div>
                {jsonError ? (
                  <div className="flex items-start justify-between gap-2 text-[11px] text-destructive">
                    <span>{m.jsonError(jsonError.line, jsonError.column, jsonError.reason)}</span>
                    <button className="shrink-0 underline" onClick={() => jumpTo(jsonError.offset)}>
                      {m.jumpToError}
                    </button>
                  </div>
                ) : (
                  snapshot.trim() !== '' && <StepHint>{m.jsonValid}</StepHint>
                )}
              </div>
            )}

            {base.subtitle && subtitles && (
              <div className="flex flex-col gap-2 rounded-md bg-muted px-3 py-2.5">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold">{m.subtitleTools}</span>
                  <span className="text-muted-foreground">{m.subtitleCues(subtitles.cues.length)}</span>
                </div>
                {subtitles.errors.length > 0 && (
                  <div className="flex items-start justify-between gap-2 text-[11px] text-destructive">
                    <span>{m.subtitleBroken(subtitles.errors.length)}</span>
                    <button
                      className="shrink-0 underline"
                      onClick={() => {
                        if (!view) return
                        const line = Math.min(subtitles.errors[0].line, view.state.doc.lines)
                        jumpTo(view.state.doc.line(line).from)
                      }}
                    >
                      {m.jumpToError}
                    </button>
                  </div>
                )}
                <span className="text-xs text-muted-foreground">{m.shiftBy}</span>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    step={100}
                    value={shiftMs}
                    onChange={(event) => setShiftMs(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') runShift()
                    }}
                    aria-label={m.shiftBy}
                    className="h-7 flex-1 bg-background text-xs"
                  />
                  <ToolButton onClick={runShift} disabled={!Number.isFinite(Number(shiftMs)) || Number(shiftMs) === 0}>
                    {m.shiftApply}
                  </ToolButton>
                </div>
                <StepHint>{m.shiftHint}</StepHint>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <ToolButton onClick={() => view && openSearchPanel(view)}>{m.find}</ToolButton>
              <ToolButton onClick={() => runTool((text) => applyContentTools(text, { trimTrailingWhitespace: true }))}>
                {m.trimTrailing}
              </ToolButton>
              <ToolButton onClick={() => runTool((text) => applyContentTools(text, { halfwidthAscii: true }))}>
                {m.halfwidthAscii}
              </ToolButton>
              <ToolButton onClick={() => runTool((text) => applyContentTools(text, { fullwidthKana: true }))}>
                {m.fullwidthKana}
              </ToolButton>
            </div>
          </Step>

          <Step index={4} title={t.stepOutput}>
            {base.subtitle && subtitleTarget && (
              <>
                <Field label={m.subtitleFormat}>
                  <Segmented
                    className="w-32"
                    value={subtitleTarget}
                    options={[
                      { value: 'srt', label: 'SRT' },
                      { value: 'vtt', label: 'VTT' },
                    ]}
                    onChange={setSubtitleTarget}
                  />
                </Field>
                {converting && (
                  <StepHint>{m.subtitleConvertHint(base.subtitle.toUpperCase(), subtitleTarget.toUpperCase())}</StepHint>
                )}
                {converting && subtitles && subtitles.errors.length > 0 && (
                  <Notice tone="warn">{m.subtitleDropped(subtitles.errors.length)}</Notice>
                )}
              </>
            )}
            <Field label={m.encoding}>
              <Choice
                value={recipe.encoding}
                options={encodingOptions}
                onChange={(encoding) => editRecipe({ type: 'setEncoding', encoding })}
                ariaLabel={m.encoding}
                className="w-40"
              />
            </Field>
            <Field label={m.bom}>
              <Segmented<BomSetting>
                className="w-40"
                value={supportsBom(output.encoding) ? recipe.bom : 'remove'}
                disabled={!supportsBom(output.encoding)}
                options={[
                  { value: 'keep', label: m.bomKeep },
                  { value: 'add', label: m.bomAdd },
                  { value: 'remove', label: m.bomRemove },
                ]}
                onChange={(bom) => editRecipe({ type: 'setBom', bom })}
              />
            </Field>
            {!supportsBom(output.encoding) && <StepHint>{m.bomUnsupported}</StepHint>}
            <Field label={m.newline}>
              <Segmented<NewlineSetting>
                className="w-48"
                value={recipe.newline}
                options={[
                  { value: 'keep', label: m.newlineKeep, title: NEWLINE_LABELS[base.newline] },
                  { value: 'lf', label: 'LF' },
                  { value: 'crlf', label: 'CRLF' },
                  { value: 'cr', label: 'CR' },
                ]}
                onChange={(newline) => editRecipe({ type: 'setNewline', newline })}
              />
            </Field>
            {base.newlineDetected === 'mixed' && recipe.newline === 'keep' && (
              <StepHint>{m.mixedWillUnify(NEWLINE_LABELS[base.newline])}</StepHint>
            )}
            <CheckboxField checked={prefs.trimOnSave} onChange={(trimOnSave) => updatePrefs({ trimOnSave })}>
              {m.trimOnSave}
            </CheckboxField>
            {unrepresentable.length > 0 && (
              <Notice tone="warn">
                <div className="mb-1 font-semibold">
                  {m.unrepresentable(unrepresentable.length, ENCODING_LABELS[output.encoding])}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {unrepresentable.slice(0, 5).map((item) => {
                    const offset = offsetOf(snapshot, item.line, item.column)
                    return (
                      <li key={item.codePoint} className="flex items-center justify-between gap-2">
                        <span>
                          <span className="font-mono text-[12px] text-foreground">{item.char}</span>{' '}
                          U+{item.codePoint.toString(16).toUpperCase().padStart(4, '0')}
                          {item.count > 1 && ` ×${item.count}`}
                        </span>
                        <button className="shrink-0 underline" onClick={() => jumpTo(offset)}>
                          {m.unrepresentableAt(item.line, item.column)}
                        </button>
                      </li>
                    )
                  })}
                  {unrepresentable.length > 5 && <li>{m.unrepresentableMore(unrepresentable.length - 5)}</li>}
                </ul>
                <div className="mt-2 text-foreground">
                  <CheckboxField checked={replaceUnrepresentable} onChange={setReplaceUnrepresentable}>
                    {m.replaceUnrepresentable}
                  </CheckboxField>
                </div>
              </Notice>
            )}
          </Step>
        </div>

        <div className="sidebar-footer">
          {/* 手順 4 は下のほうにあって見落としやすいので、保存ボタンの上でも知らせる */}
          {unrepresentable.length > 0 && !replaceUnrepresentable && (
            <p className="text-[11px] leading-normal text-destructive">
              {m.unrepresentable(unrepresentable.length, ENCODING_LABELS[output.encoding])}
            </p>
          )}
          <SaveButton save={save} disabled={!view} />
        </div>
      </aside>

      <div className="workspace">
        <div className={cn('stage', isDragging && 'drop-target-active')}>
          <div className="flex min-h-0 flex-1">
            <CodeEditor
              className="min-w-0 flex-1 overflow-hidden bg-background"
              initialText={initial.text}
              language={language}
              wrap={prefs.wrap}
              phrases={m.editorPhrases}
              onReady={handleReady}
              onUpdate={handleUpdate}
            />
            {markdown && (
              <div className="min-w-0 flex-1 overflow-y-auto border-l bg-background">
                <MarkdownPreview blocks={markdown} />
              </div>
            )}
          </div>
          <div className="flex h-7 shrink-0 items-center gap-4 border-t bg-background px-3 text-[11px] text-muted-foreground tabular-nums">
            <span>{m.status(cursor.line, cursor.column)}</span>
            {cursor.selected > 0 && <span>{m.selected(cursor.selected)}</span>}
            <span className="ml-auto">{language === 'plain' ? m.plainText : LANGUAGE_LABELS[language]}</span>
            <span>
              {ENCODING_LABELS[output.encoding]}
              {output.bom && ' BOM'}
            </span>
            <span>{NEWLINE_LABELS[recipe.newline === 'keep' ? base.newline : recipe.newline]}</span>
            {modified && <span className="text-foreground">● {m.modified}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 行と列（列はコードポイント単位）を文字列の位置にする。
 * findUnrepresentable の位置は元の改行で数えるので、エディタの本文（改行は \n）と同じ数え方になる
 */
function offsetOf(text: string, line: number, column: number): number {
  let offset = 0
  for (let current = 1; current < line; current++) {
    const next = text.indexOf('\n', offset)
    if (next < 0) return text.length
    offset = next + 1
  }
  let remaining = column - 1
  while (remaining > 0 && offset < text.length) {
    const code = text.charCodeAt(offset)
    offset += code >= 0xd800 && code <= 0xdbff ? 2 : 1
    remaining--
  }
  return offset
}

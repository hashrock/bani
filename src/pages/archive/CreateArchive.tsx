import { Pencil, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { solidOnClass } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { useReportUnsaved } from '../../app/leaveGuard'
import { useLocalDrop } from '../../app/useLocalDrop'
import { SidebarHead } from '../../components/BrandMark'
import { SaveButton } from '../../components/SaveButton'
import {
  Fact,
  Facts,
  HistoryButtons,
  IconButton,
  LinkButton,
  SidebarFooter,
  SmallButton,
  ToolbarDivider,
} from '../../components/SidebarParts'
import { Step, StepHint } from '../../components/Step'
import { pickFiles } from '../../core/opened'
import type { OpenedFile } from '../../core/opened'
import { useHotkey } from '../../core/useHotkey'
import { usePersistentState } from '../../core/usePersistentState'
import { useRecipeHistory } from '../../core/useRecipeHistory'
import { useSave } from '../../core/useSave'
import type { ResumedSession } from '../../core/session'
import { useSessionRecipe } from '../../core/useSessionRecipe'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import {
  applyArchiveEdit,
  buildEntryTree,
  createArchiveRecipe,
  createTarGz,
  createZip,
  type ArchiveEdit,
  type ArchiveEntry,
  type ArchiveRecipe,
  type ArchiveTreeNode,
} from '../../media/archive'
import { formatBytes } from '../../utils/format'
import { EntryTree } from './EntryTree'
import { ARCHIVE_ACCEPT, type AddedFile } from './io'
import { messages } from './messages'
import { foldersUnder, planFolderRename, planMove, pruneSelection, topSelected, type MovePlan } from './treeModel'

type OutputFormat = 'zip' | 'tar.gz'

let idCounter = 0
const nextId = () => `item-${++idCounter}`

/** ドロップ・選択で受け取ったものを、圧縮ファイルの中のパスにする（フォルダごとならその構造のまま） */
const toAdded = (files: readonly OpenedFile[]): AddedFile[] =>
  files.map(({ file, path }) => ({ file, path: path ?? file.name }))

/** 移動の計画を、フォルダごとの move 編集にして順に当てる（履歴には 1 回分として積む） */
function applyPlan(recipe: ArchiveRecipe, plan: MovePlan, idOf: ReadonlyMap<string, string>): ArchiveRecipe {
  let next = recipe
  for (const [folder, paths] of plan) {
    const ids = paths.map((path) => idOf.get(path)).filter((id): id is string => id !== undefined)
    next = applyArchiveEdit(next, { type: 'move', ids, folder })
  }
  return next
}

interface CreateArchiveProps {
  /** 開いた圧縮ファイルの中身から作り始めるとき */
  seed: { name: string; files: AddedFile[] } | null
  onFiles: (files: OpenedFile[]) => void
  onDirtyChange: (dirty: boolean) => void
  /** 入口の「前回の作業を再開」から来たとき */
  resumed?: ResumedSession | null
}

/** 残す作業の形の見本。中身の一覧は空なので、要素の形は 1 つ置いて比べる */
const SESSION_TEMPLATE: ArchiveRecipe = {
  ...createArchiveRecipe(),
  items: [{ id: '', path: '', size: 0, lastModified: 0 }],
}

/** 新しい圧縮ファイルを組み立てる。中身の指定はレシピ（ArchiveRecipe）で持ち、⌘Z で戻せる */
export function CreateArchive({ seed, onFiles, onDirtyChange, resumed }: CreateArchiveProps) {
  const { t } = useI18n()
  const m = useLocalMessages(messages)
  // 元ファイルはレシピに入れず id で引く。取り消しで戻ってきたときのために消さずに持っておく
  const sources = useRef(new Map<string, File>())
  const history = useRecipeHistory<ArchiveRecipe>(() => {
    const recipe = createArchiveRecipe(seed?.name || 'archive')
    if (!seed || seed.files.length === 0) return recipe
    return applyArchiveEdit(recipe, { type: 'add', items: toItems(seed.files) })
  })
  const { recipe } = history
  const [format, setFormat] = usePersistentState<OutputFormat>('archive.format', 'zip')
  const [levelDraft, setLevelDraft] = useState<number | null>(null)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [rawSelected, setSelected] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [moveTarget, setMoveTarget] = useState('')

  function toItems(files: readonly AddedFile[]) {
    return files.map(({ file, path }) => {
      const id = nextId()
      sources.current.set(id, file)
      return { id, path, size: file.size, lastModified: file.lastModified }
    })
  }

  const edit = (next: ArchiveEdit) => history.update((current) => applyArchiveEdit(current, next))

  const { root, idOf } = useMemo(() => {
    const entries: ArchiveEntry[] = recipe.items.map((item) => ({
      path: item.path,
      size: item.size,
      compressedSize: null,
      isDirectory: false,
      modified: new Date(item.lastModified),
      encrypted: false,
      nameEncoding: 'utf-8',
    }))
    return {
      root: buildEntryTree(entries),
      idOf: new Map(recipe.items.map((item) => [item.path, item.id])),
    }
  }, [recipe.items])

  // 作成中のフォルダは開いておき、閉じたものだけを覚える（足したフォルダがすぐ見えるように）
  const allFolders = useMemo(() => foldersUnder(root), [root])
  const expanded = useMemo(() => new Set(allFolders.filter((path) => !collapsed.has(path))), [allFolders, collapsed])
  // 削除・移動・取り消しで消えたパスは選択から外す
  const selected = useMemo(() => pruneSelection(root, rawSelected), [root, rawSelected])
  const folderOptions = allFolders

  const addFiles = useCallback(
    (files: AddedFile[]) => {
      if (files.length === 0) return
      const items = toItems(files)
      history.update((current) => {
        let next = applyArchiveEdit(current, { type: 'add', items })
        // 空のところへフォルダを 1 つ入れたら、その名前を圧縮ファイルの名前にする
        const tops = new Set(files.map((file) => file.path.split('/')[0]))
        if (current.items.length === 0 && tops.size === 1 && files[0].path.includes('/') && current.name === 'archive') {
          next = applyArchiveEdit(next, { type: 'setName', name: [...tops][0] })
        }
        return next
      })
      toast(m.addedFiles(files.length))
    },
    // toItems は sources に書くだけで、描画中の値には依存しない
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.update, m]
  )

  const removeSelected = () => {
    const ids = [...selected].map((path) => idOf.get(path)).filter((id): id is string => id !== undefined)
    if (ids.length > 0) edit({ type: 'remove', ids })
  }

  const moveSelected = () => {
    if (selected.size === 0) return
    const plan = planMove(root, selected, moveTarget)
    history.update((current) => applyPlan(current, plan, idOf))
    setMoveTarget('')
  }

  const startRename = (node: ArchiveTreeNode) => {
    setRenaming(node.path)
    setRenameDraft(node.name)
  }

  const commitRename = (node: ArchiveTreeNode) => {
    setRenaming(null)
    const name = renameDraft.trim()
    if (name === '' || name === node.name) return
    if (node.isDirectory) {
      const plan = planFolderRename(node, name)
      history.update((current) => applyPlan(current, plan, idOf))
    } else {
      const id = idOf.get(node.path)
      if (id) edit({ type: 'rename', id, name })
    }
  }

  const save = useSave({
    opened: null,
    lossless: true,
    sameFormat: false,
    canCopy: false,
    disabled: recipe.items.length === 0,
    render: () => (format === 'zip' ? createZip : createTarGz)(recipe, sources.current),
    onSaved: history.markSaved,
  })
  useReportUnsaved(history.dirty, onDirtyChange)
  // 作業を残し、入口から再開できるようにする。入れるファイルはレシピの並びのまま残す
  useSessionRecipe('archive', recipe, {
    opened: null,
    resumed,
    enabled: true,
    dirty: history.dirty,
    version: 1,
    ready: true,
    template: SESSION_TEMPLATE,
    // 元ファイルは sources（ref）から引くので、書くときに集める
    extras: () =>
      recipe.items.flatMap((item) => {
        const file = sources.current.get(item.id)
        return file ? [{ file, handle: null }] : []
      }),
    label: `${recipe.name}.${format === 'zip' ? 'zip' : 'tar.gz'}`,
    onResume: (saved, session) => {
      if (saved.items.length !== session.extras.length) return
      // id はこの読み込みの中で振り直す（前回の id とぶつけない）
      const items = saved.items.map((item, index) => {
        const id = nextId()
        sources.current.set(id, session.extras[index].file)
        return { ...item, id }
      })
      history.restore({ ...saved, items })
    },
  })

  // 一覧にフォーカスがなくても、選んだものを Delete で消し、⌘A ですべて選ぶ
  useHotkey('delete', removeSelected, { enabled: selected.size > 0 })
  useHotkey('mod+a', () => setSelected(new Set(idOf.keys())), { enabled: recipe.items.length > 0 })
  useHotkey('escape', () => setSelected(new Set()), { enabled: selected.size > 0 })

  // 作成中の画面に落としたものは、開き直さずに中身へ足す（フォルダは構造ごと）
  const drop = useLocalDrop({ onDrop: (files) => addFiles(toAdded(files)) })
  const dropOver = drop.over

  const totalSize = recipe.items.reduce((sum, item) => sum + item.size, 0)
  const level = levelDraft ?? recipe.level
  const singleTop = (() => {
    const tops = topSelected(root, selected)
    return tops.length === 1 ? tops[0] : null
  })()

  const addButtons = (
    <div className="flex flex-wrap gap-1.5">
      <SmallButton onClick={async () => addFiles(toAdded(await pickFiles({ multiple: true })))}>
        {m.addFiles}
      </SmallButton>
      <SmallButton onClick={async () => addFiles(toAdded(await pickFiles({ directory: true })))}>
        {m.addFolder}
      </SmallButton>
    </div>
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <SidebarHead />
        <div className="sidebar-scroll">
          <Step index={1} title={t.stepInput}>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {m.nameLabel}
              <div className="flex items-center gap-1.5">
                <Input
                  className="h-8 text-[13px] text-foreground"
                  value={nameDraft ?? recipe.name}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => {
                    if (nameDraft !== null) edit({ type: 'setName', name: nameDraft })
                    setNameDraft(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') {
                      setNameDraft(null)
                      e.currentTarget.blur()
                    }
                  }}
                />
                <span className="shrink-0 text-foreground">.{format}</span>
              </div>
            </label>
            <Facts>
              <Fact label={m.factEntries}>{recipe.items.length}</Fact>
              <Fact label={m.factTotal}>{formatBytes(totalSize)}</Fact>
            </Facts>
            {addButtons}
            <LinkButton
              onClick={async () => {
                const [picked] = await pickFiles({ accept: ARCHIVE_ACCEPT })
                if (picked) onFiles([picked])
              }}
            >
              {m.openArchive}
            </LinkButton>
          </Step>

          <Step index={2} title={t.stepEdit}>
            <div className="flex flex-wrap gap-1">
              <HistoryButtons
                canUndo={history.canUndo}
                canRedo={history.canRedo}
                onUndo={history.undo}
                onRedo={history.redo}
              />
              <ToolbarDivider />
              <IconButton label={`${m.rename} (F2)`} disabled={!singleTop} onClick={() => singleTop && startRename(singleTop)}>
                <Pencil />
              </IconButton>
              <IconButton label={m.remove} disabled={selected.size === 0} onClick={removeSelected}>
                <Trash2 />
              </IconButton>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{m.moveTarget}</span>
              <div className="flex gap-1.5">
                <Input
                  className="h-7 text-xs"
                  list="archive-folders"
                  placeholder={m.newFolderPlaceholder}
                  value={moveTarget}
                  onChange={(e) => setMoveTarget(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') moveSelected()
                  }}
                />
                <datalist id="archive-folders">
                  {folderOptions.map((path) => (
                    <option key={path} value={path} />
                  ))}
                </datalist>
                <Button variant="outline" size="xs" className="h-7" disabled={selected.size === 0} onClick={moveSelected}>
                  {m.moveApply}
                </Button>
              </div>
            </div>
          </Step>

          <Step index={3} title={t.stepOutput}>
            <ToggleGroup
              type="single"
              variant="outline"
              spacing={0}
              className="w-full"
              value={format}
              onValueChange={(value) => {
                if (value === 'zip' || value === 'tar.gz') setFormat(value)
              }}
            >
              {(['zip', 'tar.gz'] as const).map((value) => (
                <ToggleGroupItem key={value} value={value} size="sm" className={cn('flex-1 text-xs', solidOnClass)}>
                  {value === 'zip' ? 'ZIP' : 'tar.gz'}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <StepHint>{format === 'zip' ? m.formatZipHint : m.formatTarGzHint}</StepHint>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{m.levelLabel}</span>
                <span className="font-semibold text-foreground">{m.levelValue(level)}</span>
              </div>
              <Slider
                min={0}
                max={9}
                step={1}
                value={[level]}
                onValueChange={([value]) => setLevelDraft(value)}
                // ドラッグの途中を全部履歴に積まないよう、離したときに 1 回だけ記録する
                onValueCommit={([value]) => {
                  setLevelDraft(null)
                  edit({ type: 'setLevel', level: value })
                }}
                aria-label={m.levelLabel}
              />
              <StepHint>{m.levelHint}</StepHint>
            </div>
          </Step>
        </div>

        <SidebarFooter progress={null}>
          {recipe.items.length === 0 && <StepHint>{m.saveEmpty}</StepHint>}
          <SaveButton save={save} disabled={recipe.items.length === 0} />
        </SidebarFooter>
      </aside>

      <div className="workspace">
        <div className={cn('stage', dropOver && 'drop-target-active')} {...drop.handlers}>
          {recipe.items.length === 0 ? (
            <div className={cn('preview-area', dropOver && 'drop-target-active')}>
              <div className="flex flex-col items-center gap-4">
                <p className="max-w-[360px] text-center text-sm text-muted-foreground">{m.createEmpty}</p>
                {addButtons}
              </div>
            </div>
          ) : (
            <EntryTree
              root={root}
              expanded={expanded}
              onExpandedChange={(next) => setCollapsed(new Set(allFolders.filter((path) => !next.has(path))))}
              selected={selected}
              onSelectedChange={setSelected}
              showCompression={false}
              onDelete={removeSelected}
              onRename={startRename}
              renaming={renaming}
              renderRename={(node) => (
                <Input
                  autoFocus
                  className="h-6 px-1.5 text-xs"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => commitRename(node)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') {
                      setRenameDraft(node.name)
                      setRenaming(null)
                    }
                  }}
                />
              )}
              renderActions={(node) => (
                <>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    tabIndex={-1}
                    aria-label={m.rename}
                    title={m.rename}
                    className="opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      startRename(node)
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    tabIndex={-1}
                    aria-label={m.remove}
                    title={m.remove}
                    className="opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      const paths = node.isDirectory ? [...idOf.keys()].filter((p) => p.startsWith(`${node.path}/`)) : [node.path]
                      const ids = paths.map((p) => idOf.get(p)).filter((id): id is string => id !== undefined)
                      edit({ type: 'remove', ids })
                    }}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            />
          )}
          {dropOver && recipe.items.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
              <span className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">{m.dropToAdd}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

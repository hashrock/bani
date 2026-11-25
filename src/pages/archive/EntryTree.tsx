import { ChevronRight, File as FileIcon, Folder, FolderOpen, Lock } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { ArchiveTreeNode } from '../../media/archive'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import { formatBytes } from '../../utils/format'
import { messages } from './messages'
import { checkStates, compressionRatio, filesUnder, flattenVisible, toggleNode } from './treeModel'
import type { CheckState } from './treeModel'

interface EntryTreeProps {
  root: ArchiveTreeNode
  expanded: ReadonlySet<string>
  onExpandedChange: (expanded: Set<string>) => void
  selected: ReadonlySet<string>
  onSelectedChange: (selected: Set<string>) => void
  /** 圧縮後の大きさと割合の列を出すか（作成中はまだ分からないので出さない） */
  showCompression: boolean
  /** ファイルの行で Enter・ダブルクリックしたとき */
  onActivate?: (node: ArchiveTreeNode) => void
  /** Delete / Backspace を押したとき（作成中の削除） */
  onDelete?: () => void
  /** F2 を押したとき（作成中の名前の変更） */
  onRename?: (node: ArchiveTreeNode) => void
  /** 名前を変えている行。名前の代わりに入力欄を出す */
  renaming?: string | null
  renderRename?: (node: ArchiveTreeNode) => ReactNode
  /** 行の右端に出す操作 */
  renderActions?: (node: ArchiveTreeNode) => ReactNode
}

/** 一部だけ選ばれているフォルダは indeterminate で示す（属性では書けないので DOM に直接入れる） */
function Check({ state, disabled, label, onToggle }: {
  state: CheckState
  disabled?: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <input
      type="checkbox"
      className="size-3.5 shrink-0 accent-primary"
      // 行そのものがフォーカスを持つので、チェックはタブ移動の対象から外す
      tabIndex={-1}
      aria-label={label}
      checked={state === 'all'}
      disabled={disabled}
      ref={(el) => {
        if (el) el.indeterminate = state === 'some'
      }}
      onChange={onToggle}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

// 行ごとに別の grid なので、列の幅はすべて固定にして行をまたいでそろえる
const GRID_WITH_COMPRESSION = 'grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_3.5rem_9.5rem_7.5rem]'
const GRID_PLAIN = 'grid-cols-[minmax(0,1fr)_5.5rem_9.5rem_3.5rem]'

/**
 * 圧縮ファイルの中身をフォルダの木で見せる一覧。開閉・チェックでの選択・キーボード操作を持つ。
 * 矢印で移動、→ / ← で開閉と親子の移動、Space でチェック、Enter で開く、⌘A ですべて選択。
 */
export function EntryTree({
  root,
  expanded,
  onExpandedChange,
  selected,
  onSelectedChange,
  showCompression,
  onActivate,
  onDelete,
  onRename,
  renaming,
  renderRename,
  renderActions,
}: EntryTreeProps) {
  const { lang } = useI18n()
  const m = useLocalMessages(messages)
  const rows = useMemo(() => flattenVisible(root, expanded), [root, expanded])
  const states = useMemo(() => checkStates(root, selected), [root, selected])
  const total = useMemo(() => filesUnder(root).length, [root])
  const [focused, setFocused] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' }),
    [lang]
  )

  // 消えた行（削除・移動・閉じたフォルダの中）にフォーカスが残らないよう、近い行へ寄せる
  const focusIndex = Math.max(0, rows.findIndex((row) => row.node.path === focused))
  const current = rows[focusIndex] ?? null

  const focusRow = (index: number) => {
    const row = rows[Math.min(rows.length - 1, Math.max(0, index))]
    if (!row) return
    setFocused(row.node.path)
  }

  useEffect(() => {
    // 名前の入力中は入力欄にフォーカスを渡すので、行へは戻さない
    if (renaming) return
    const list = listRef.current
    if (!list || !list.contains(document.activeElement)) return
    list.querySelector<HTMLElement>('[data-focused="true"]')?.focus()
  }, [focused, rows, renaming])

  const toggleExpanded = (path: string, open?: boolean) => {
    const next = new Set(expanded)
    const willOpen = open ?? !next.has(path)
    if (willOpen) next.add(path)
    else next.delete(path)
    onExpandedChange(next)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      onSelectedChange(states.get('') === 'all' ? new Set() : toggleNode(root, new Set()))
      return
    }
    if (!current) return
    const { node } = current
    switch (e.key) {
      case 'ArrowDown':
        focusRow(focusIndex + 1)
        break
      case 'ArrowUp':
        focusRow(focusIndex - 1)
        break
      case 'Home':
        focusRow(0)
        break
      case 'End':
        focusRow(rows.length - 1)
        break
      case 'ArrowRight':
        if (!node.isDirectory) return
        if (!expanded.has(node.path)) toggleExpanded(node.path, true)
        else if (node.children.length > 0) focusRow(focusIndex + 1)
        break
      case 'ArrowLeft':
        if (node.isDirectory && expanded.has(node.path)) toggleExpanded(node.path, false)
        else if (current.parent !== '') setFocused(current.parent)
        break
      case ' ':
        onSelectedChange(toggleNode(node, selected))
        break
      case 'Enter':
        if (node.isDirectory) toggleExpanded(node.path)
        else onActivate?.(node)
        break
      case 'Delete':
      case 'Backspace':
        if (!onDelete) return
        onDelete()
        break
      case 'F2':
        if (!onRename) return
        onRename(node)
        break
      default:
        return
    }
    e.preventDefault()
  }

  const grid = showCompression ? GRID_WITH_COMPRESSION : GRID_PLAIN
  const allState = states.get('') ?? 'none'

  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      <div
        className={cn(
          'grid items-center gap-3 border-b bg-background px-3 py-2 font-medium text-muted-foreground',
          grid
        )}
      >
        <label className="flex items-center gap-2">
          <Check
            state={allState}
            disabled={total === 0}
            label={m.selectAll}
            onToggle={() => onSelectedChange(allState === 'all' ? new Set() : toggleNode(root, new Set()))}
          />
          <span>{m.colName}</span>
          <span className="ml-1 font-normal">{m.selectedCount(selected.size, total)}</span>
        </label>
        <span className="text-right">{m.colSize}</span>
        {showCompression && <span className="text-right">{m.colCompressed}</span>}
        {showCompression && <span className="text-right">{m.colRatio}</span>}
        <span>{m.colModified}</span>
        <span />
      </div>

      <div
        ref={listRef}
        role="tree"
        aria-label={m.treeLabel}
        aria-multiselectable
        className="min-h-0 flex-1 overflow-y-auto bg-background"
        onKeyDown={handleKeyDown}
      >
        {rows.map((row, index) => {
          const { node, depth } = row
          const state = states.get(node.path) ?? 'none'
          const isOpen = node.isDirectory && expanded.has(node.path)
          const encrypted = !!node.entry?.encrypted
          const ratio = compressionRatio(node.size, node.compressedSize)
          const isFocused = index === focusIndex
          const modified = node.entry?.modified
          return (
            <div
              key={`${node.isDirectory ? 'd' : 'f'}:${node.path}`}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={node.isDirectory ? isOpen : undefined}
              aria-selected={state === 'all'}
              tabIndex={isFocused ? 0 : -1}
              data-focused={isFocused}
              className={cn(
                'group grid h-8 cursor-default items-center gap-3 border-b border-secondary px-3 outline-none',
                'hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                state === 'all' && 'bg-muted/40',
                grid
              )}
              onFocus={() => setFocused(node.path)}
              onClick={() => setFocused(node.path)}
              onDoubleClick={() => (node.isDirectory ? toggleExpanded(node.path) : onActivate?.(node))}
            >
              <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 16 }}>
                <Check
                  state={state}
                  disabled={encrypted || (node.isDirectory && node.fileCount === 0)}
                  label={node.name}
                  onToggle={() => onSelectedChange(toggleNode(node, selected))}
                />
                {node.isDirectory ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-hidden
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleExpanded(node.path)
                    }}
                  >
                    <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
                  </button>
                ) : (
                  <span className="size-4 shrink-0" />
                )}
                {node.isDirectory ? (
                  isOpen ? (
                    <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                  )
                ) : encrypted ? (
                  <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label={m.encrypted} />
                ) : (
                  <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                {renaming === node.path && renderRename ? (
                  renderRename(node)
                ) : (
                  <span className="truncate" title={node.path}>
                    {node.name}
                  </span>
                )}
                {node.isDirectory && (
                  <span className="shrink-0 text-muted-foreground">{m.folderSummary(node.fileCount)}</span>
                )}
                {encrypted && <span className="shrink-0 text-muted-foreground">{m.encrypted}</span>}
              </div>
              <span className="text-right tabular-nums">{formatBytes(node.size)}</span>
              {showCompression && (
                <span className="text-right text-muted-foreground tabular-nums">
                  {node.compressedSize === null ? '—' : formatBytes(node.compressedSize)}
                </span>
              )}
              {showCompression && (
                <span className="text-right text-muted-foreground tabular-nums">
                  {ratio === null ? '—' : `${Math.round(ratio * 100)}%`}
                </span>
              )}
              <span className="truncate text-muted-foreground tabular-nums">
                {modified ? dateFormat.format(modified) : ''}
              </span>
              <div className="flex justify-end gap-1">{renderActions?.(node)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { createHistory, pushHistory, undoHistory } from '../../core/history'
import { basename, dirname, pathKey, sanitizePath } from './names'
import { applyArchiveEdit, createArchiveRecipe, type ArchiveEdit, type ArchiveItem, type ArchiveRecipe } from './recipe'

const name = fc.constantFrom('a.txt', 'A.TXT', 'b.png', 'a (2).txt', 'x', 'dir', '写真.jpg', '../evil', 'con', '')
const folder = fc.constantFrom('', 'dir', 'DIR', 'dir/sub', 'x', 'a.txt', '../..', '写真')
const id: fc.Arbitrary<string> = fc.constantFrom('1', '2', '3', '4', '5', '6', '7', '8')

const item = fc.record({
  id,
  path: fc.tuple(folder, name).map(([f, n]) => (f ? `${f}/${n}` : n)),
  size: fc.nat({ max: 1000 }),
  lastModified: fc.constant(0),
})

const edit: fc.Arbitrary<ArchiveEdit> = fc.oneof(
  fc.record({ type: fc.constant('add' as const), items: fc.array(item, { maxLength: 4 }) }),
  fc.record({ type: fc.constant('remove' as const), ids: fc.array(id, { maxLength: 2 }) }),
  fc.record({ type: fc.constant('rename' as const), id, name }),
  fc.record({ type: fc.constant('move' as const), ids: fc.array(id, { maxLength: 3 }), folder }),
  fc.record({ type: fc.constant('setLevel' as const), level: fc.double({ min: -5, max: 20 }) }),
  fc.record({ type: fc.constant('setName' as const), name })
)

const reachable = (edits: readonly ArchiveEdit[]) => edits.reduce(applyArchiveEdit, createArchiveRecipe())

function assertValid(recipe: ArchiveRecipe) {
  const keys = recipe.items.map((entry) => pathKey(entry.path))
  expect(new Set(keys).size).toBe(keys.length)
  expect(new Set(recipe.items.map((entry) => entry.id)).size).toBe(recipe.items.length)
  const files = new Set(keys)
  for (const entry of recipe.items) {
    expect(entry.path).not.toBe('')
    expect(sanitizePath(entry.path)).toBe(entry.path)
    const parts = pathKey(entry.path).split('/')
    for (let i = 1; i < parts.length; i++) expect(files.has(parts.slice(0, i).join('/'))).toBe(false)
  }
  expect(Number.isInteger(recipe.level) && recipe.level >= 0 && recipe.level <= 9).toBe(true)
}

describe('applyArchiveEdit', () => {
  test('どんな編集の列をたどっても、パスは一意・無害で、ファイルとフォルダが名前を取り合わない', () => {
    fc.assert(
      fc.property(fc.array(edit, { maxLength: 25 }), (edits) => {
        assertValid(reachable(edits))
      })
    )
  })

  test('名前変更・移動では、対象でないファイルのパスは変わらない', () => {
    fc.assert(
      fc.property(
        fc.array(edit, { maxLength: 15 }),
        fc.oneof(
          fc.record({ type: fc.constant('rename' as const), id, name }),
          fc.record({ type: fc.constant('move' as const), ids: fc.array(id, { maxLength: 3 }), folder })
        ),
        (edits, change) => {
          const before = reachable(edits)
          const after = applyArchiveEdit(before, change)
          const targets = new Set(change.type === 'rename' ? [change.id] : change.ids)
          const untouched = (recipe: ArchiveRecipe) => recipe.items.filter((entry) => !targets.has(entry.id))
          expect(untouched(after)).toEqual(untouched(before))
          // 並び順も変えない
          expect(after.items.map((entry) => entry.id)).toEqual(before.items.map((entry) => entry.id))
        }
      )
    )
  })

  test('移動したファイルは指定したフォルダ（の表記ゆれをまとめたもの）に入り、名前は元の名前かその番号違い', () => {
    fc.assert(
      fc.property(fc.array(edit, { maxLength: 15 }), fc.array(id, { maxLength: 3 }), folder, (edits, ids, to) => {
        const before = reachable(edits)
        const after = applyArchiveEdit(before, { type: 'move', ids, folder: to })
        for (const entry of after.items) {
          if (!ids.includes(entry.id)) continue
          const original = before.items.find((candidate) => candidate.id === entry.id)!
          const target = sanitizePath(to)
          // フォルダは指定先か、ファイルとぶつかって番号をずらしたもの
          expect(pathKey(dirname(entry.path)).replace(/ \(\d+\)/g, '')).toBe(pathKey(target))
          const stem = (value: string) => value.replace(/ \(\d+\)/g, '')
          expect(pathKey(stem(basename(entry.path)))).toBe(pathKey(stem(basename(original.path))))
        }
      })
    )
  })

  test('何も変わらない編集は同じオブジェクトを返し、履歴に余計な段を積まない', () => {
    fc.assert(
      fc.property(fc.array(edit, { maxLength: 15 }), (edits) => {
        const recipe = reachable(edits)
        expect(applyArchiveEdit(recipe, { type: 'remove', ids: ['missing'] })).toBe(recipe)
        expect(applyArchiveEdit(recipe, { type: 'move', ids: [], folder: 'x' })).toBe(recipe)
        expect(applyArchiveEdit(recipe, { type: 'setLevel', level: recipe.level })).toBe(recipe)
        expect(applyArchiveEdit(recipe, { type: 'setName', name: recipe.name })).toBe(recipe)
        for (const entry of recipe.items) {
          expect(applyArchiveEdit(recipe, { type: 'rename', id: entry.id, name: basename(entry.path) })).toBe(recipe)
          expect(applyArchiveEdit(recipe, { type: 'move', ids: [entry.id], folder: dirname(entry.path) })).toBe(recipe)
          expect(applyArchiveEdit(recipe, { type: 'add', items: [entry] })).toBe(recipe)
        }
        const history = pushHistory(createHistory(recipe), applyArchiveEdit(recipe, { type: 'remove', ids: [] }))
        expect(history.past).toHaveLength(0)
      })
    )
  })

  test('同じ名前を足すと番号をずらす', () => {
    const file = (id: string, path: string): ArchiveItem => ({ id, path, size: 1, lastModified: 0 })
    const recipe = applyArchiveEdit(createArchiveRecipe(), {
      type: 'add',
      items: [file('1', 'photo.jpg'), file('2', 'photo.jpg'), file('3', 'Photo.JPG'), file('4', '../../photo.jpg')],
    })
    expect(recipe.items.map((entry) => entry.path)).toEqual([
      'photo.jpg',
      'photo (2).jpg',
      'Photo (3).JPG',
      'photo (4).jpg',
    ])
  })

  test('名前変更で重なれば番号をずらし、フォルダはそのまま', () => {
    const file = (id: string, path: string): ArchiveItem => ({ id, path, size: 1, lastModified: 0 })
    const recipe = applyArchiveEdit(createArchiveRecipe(), {
      type: 'add',
      items: [file('1', 'dir/a.txt'), file('2', 'dir/b.txt')],
    })
    const renamed = applyArchiveEdit(recipe, { type: 'rename', id: '2', name: 'a.txt' })
    expect(renamed.items.map((entry) => entry.path)).toEqual(['dir/a.txt', 'dir/a (2).txt'])
    // 名前に区切りを入れてもフォルダは作らない
    expect(applyArchiveEdit(recipe, { type: 'rename', id: '1', name: 'x/y' }).items[0].path).toBe('dir/x_y')
  })

  test('取り消せば編集前のレシピに戻る', () => {
    const file = (id: string, path: string): ArchiveItem => ({ id, path, size: 1, lastModified: 0 })
    const start = applyArchiveEdit(createArchiveRecipe(), { type: 'add', items: [file('1', 'a.txt')] })
    const moved = applyArchiveEdit(start, { type: 'move', ids: ['1'], folder: 'new/folder' })
    expect(moved.items[0].path).toBe('new/folder/a.txt')
    expect(undoHistory(pushHistory(createHistory(start), moved)).present).toBe(start)
  })

  test('圧縮レベルは 0〜9 の整数に丸める', () => {
    const recipe = createArchiveRecipe()
    expect(applyArchiveEdit(recipe, { type: 'setLevel', level: 12 }).level).toBe(9)
    expect(applyArchiveEdit(recipe, { type: 'setLevel', level: -1 }).level).toBe(0)
    expect(applyArchiveEdit(recipe, { type: 'setLevel', level: 3.4 }).level).toBe(3)
  })
})

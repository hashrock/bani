import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { applyPdfEdit, createPdfRecipe, type PdfRecipe } from '../../media/pdf/recipe'
import {
  clickSelection,
  dropSlotToMoveTarget,
  emptySelection,
  pageKeys,
  pruneSelection,
  selectAll,
  selectedIndices,
  slotFromPointer,
  stepMoveTarget,
  type Selection,
} from './pageModel'

const recipeOf = (length: number): PdfRecipe => createPdfRecipe([{ pageCount: length }])
const order = (recipe: PdfRecipe) => recipe.pages.map(({ page }) => page)
const move = (length: number, indices: number[], to: number) =>
  order(applyPdfEdit(recipeOf(length), { type: 'move', indices, to }, [{ pageCount: length }]))

/** 長さと、その中の位置の集合（昇順・重複なし） */
const listWithSelection = fc
  .integer({ min: 1, max: 12 })
  .chain((length) =>
    fc.tuple(
      fc.constant(length),
      fc.uniqueArray(fc.integer({ min: 0, max: length - 1 }), { minLength: 1, maxLength: length })
    )
  )
  .map(([length, indices]) => [length, [...indices].sort((a, b) => a - b)] as const)

describe('pageKeys', () => {
  test('同じページが何度出てきても鍵は重ならない', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ source: fc.nat({ max: 2 }), page: fc.nat({ max: 3 }) }), {
          maxLength: 20,
        }),
        (pages) => {
          const keys = pageKeys(pages)
          expect(new Set(keys).size).toBe(keys.length)
        }
      )
    )
  })

  test('並べ替えても、各ページの鍵はついていく（重複のない並び）', () => {
    fc.assert(
      fc.property(listWithSelection, fc.nat({ max: 12 }), ([length, indices], to) => {
        const before = recipeOf(length)
        const after = applyPdfEdit(before, { type: 'move', indices, to }, [{ pageCount: length }])
        const keyOf = (recipe: PdfRecipe) =>
          new Map(pageKeys(recipe.pages).map((key, index) => [recipe.pages[index].page, key]))
        expect(keyOf(after)).toEqual(keyOf(before))
      })
    )
  })

  test('回転は鍵を変えない', () => {
    const recipe = recipeOf(3)
    const rotated = applyPdfEdit(recipe, { type: 'rotate', indices: [1], by: 90 }, [
      { pageCount: 3 },
    ])
    expect(pageKeys(rotated.pages)).toEqual(pageKeys(recipe.pages))
  })
})

describe('clickSelection', () => {
  const keys = ['a', 'b', 'c', 'd', 'e']

  test('そのまま押すとそのページだけになり、起点になる', () => {
    const selection = clickSelection(selectAll(keys), keys, 2)
    expect([...selection.keys]).toEqual(['c'])
    expect(selection.anchor).toBe('c')
  })

  test('⌘ で足し引きする', () => {
    let selection = clickSelection(emptySelection, keys, 1)
    selection = clickSelection(selection, keys, 3, { toggle: true })
    expect(selectedIndices(selection, keys)).toEqual([1, 3])
    selection = clickSelection(selection, keys, 1, { toggle: true })
    expect(selectedIndices(selection, keys)).toEqual([3])
  })

  test('Shift は起点から押したページまでを選び、起点は動かさない', () => {
    let selection = clickSelection(emptySelection, keys, 3)
    selection = clickSelection(selection, keys, 1, { shift: true })
    expect(selectedIndices(selection, keys)).toEqual([1, 2, 3])
    selection = clickSelection(selection, keys, 4, { shift: true })
    expect(selectedIndices(selection, keys)).toEqual([3, 4])
  })

  test('⌘ + Shift は範囲を今の選択に足す', () => {
    let selection = clickSelection(emptySelection, keys, 0)
    selection = clickSelection(selection, keys, 3, { toggle: true })
    selection = clickSelection(selection, keys, 4, { shift: true, toggle: true })
    expect(selectedIndices(selection, keys)).toEqual([0, 3, 4])
  })

  test('起点がないときの Shift はそのページだけを選ぶ', () => {
    const selection = clickSelection(emptySelection, keys, 2, { shift: true })
    expect(selectedIndices(selection, keys)).toEqual([2])
  })

  test('どんな押し方をしても、選択は並びの中の鍵だけ', () => {
    const click = fc.record({
      index: fc.integer({ min: -1, max: 6 }),
      shift: fc.boolean(),
      toggle: fc.boolean(),
    })
    fc.assert(
      fc.property(fc.array(click, { maxLength: 12 }), (clicks) => {
        const selection = clicks.reduce<Selection>(
          (current, { index, ...modifiers }) => clickSelection(current, keys, index, modifiers),
          emptySelection
        )
        for (const key of selection.keys) expect(keys).toContain(key)
      })
    )
  })
})

describe('pruneSelection', () => {
  test('消えたページを落とし、変わらなければ同じオブジェクトを返す', () => {
    const selection: Selection = { keys: new Set(['a', 'b']), anchor: 'b' }
    expect(pruneSelection(selection, ['a', 'b', 'c'])).toBe(selection)
    const pruned = pruneSelection(selection, ['a', 'c'])
    expect([...pruned.keys]).toEqual(['a'])
    expect(pruned.anchor).toBeNull()
  })
})

describe('dropSlotToMoveTarget', () => {
  /** 期待する結果: 選んだページを抜き、元の並びでのすき間の位置へまとめて差し込む */
  const reference = (length: number, indices: readonly number[], slot: number) => {
    const all = Array.from({ length }, (_, index) => index)
    const moving = new Set(indices)
    return [
      ...all.slice(0, slot).filter((index) => !moving.has(index)),
      ...indices,
      ...all.slice(slot).filter((index) => !moving.has(index)),
    ]
  }

  test('すき間に落とした結果が、見た目どおりの位置になる', () => {
    fc.assert(
      fc.property(
        listWithSelection.chain(([length, indices]) =>
          fc.tuple(fc.constant(length), fc.constant(indices), fc.integer({ min: 0, max: length }))
        ),
        ([length, indices, slot]) => {
          expect(move(length, [...indices], dropSlotToMoveTarget(slot, indices))).toEqual(
            reference(length, indices, slot)
          )
        }
      )
    )
  })

  test('例: 3 枚目を先頭の前へ', () => {
    expect(move(4, [2], dropSlotToMoveTarget(0, [2]))).toEqual([2, 0, 1, 3])
  })

  test('例: 1 枚目を 3 枚目の後ろへ', () => {
    expect(move(4, [0], dropSlotToMoveTarget(3, [0]))).toEqual([1, 2, 0, 3])
  })
})

describe('stepMoveTarget', () => {
  test('1 枚だけなら隣と入れ替わる', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }).chain((length) =>
          fc.tuple(fc.constant(length), fc.integer({ min: 0, max: length - 1 }), fc.constantFrom(-1 as const, 1 as const))
        ),
        ([length, index, delta]) => {
          const to = stepMoveTarget([index], delta, length)
          const target = index + delta
          if (target < 0 || target >= length) {
            expect(to).toBeNull()
            return
          }
          const expected = Array.from({ length }, (_, position) => position)
          ;[expected[index], expected[target]] = [expected[target], expected[index]]
          expect(move(length, [index], to!)).toEqual(expected)
        }
      )
    )
  })

  test('ひとまとまりの選択は 1 つずれる', () => {
    expect(move(6, [2, 3], stepMoveTarget([2, 3], -1, 6)!)).toEqual([0, 2, 3, 1, 4, 5])
    expect(move(6, [2, 3], stepMoveTarget([2, 3], 1, 6)!)).toEqual([0, 1, 4, 2, 3, 5])
  })

  test('端にあるひとまとまりは動かない。離れた選択は端でも寄せられる', () => {
    expect(stepMoveTarget([0, 1], -1, 4)).toBeNull()
    expect(stepMoveTarget([2, 3], 1, 4)).toBeNull()
    expect(move(4, [0, 2], stepMoveTarget([0, 2], -1, 4)!)).toEqual([0, 2, 1, 3])
    expect(move(4, [1, 3], stepMoveTarget([1, 3], 1, 4)!)).toEqual([0, 2, 1, 3])
  })

  test('動かせるときは必ず並びが変わる', () => {
    fc.assert(
      fc.property(listWithSelection, fc.constantFrom(-1 as const, 1 as const), ([length, indices], delta) => {
        const to = stepMoveTarget(indices, delta, length)
        if (to === null) return
        expect(move(length, [...indices], to)).not.toEqual(order(recipeOf(length)))
      })
    )
  })

  test('選択がなければ null', () => {
    expect(stepMoveTarget([], 1, 3)).toBeNull()
    expect(stepMoveTarget([5], 1, 3)).toBeNull()
  })
})

describe('slotFromPointer', () => {
  test('左半分ならそのページの前、右半分なら後ろ', () => {
    expect(slotFromPointer(3, 10, 100)).toBe(3)
    expect(slotFromPointer(3, 60, 100)).toBe(4)
  })
})

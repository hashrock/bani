import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { planSave } from './save'
import type { SavePolicyInput } from './save'

const policyInput: fc.Arbitrary<SavePolicyInput> = fc.record({
  lossless: fc.boolean(),
  sameFormat: fc.boolean(),
  canOverwrite: fc.boolean(),
  canCopy: fc.boolean(),
})

describe('planSave', () => {
  it('同じ方法を二度並べない', () => {
    fc.assert(
      fc.property(policyInput, (input) => {
        const { primary, others } = planSave(input)
        const all = [primary, ...others]
        expect(new Set(all).size).toBe(all.length)
      })
    )
  })

  it('別名で保存はいつでも選べる', () => {
    fc.assert(
      fc.property(policyInput, (input) => {
        const { primary, others } = planSave(input)
        expect([primary, ...others]).toContain('saveAs')
      })
    )
  })

  it('上書きはハンドルがあるときだけ、コピーはできるときだけ出る', () => {
    fc.assert(
      fc.property(policyInput, (input) => {
        const all = (({ primary, others }) => [primary, ...others])(planSave(input))
        expect(all.includes('overwrite')).toBe(input.canOverwrite)
        expect(all.includes('copyToClipboard')).toBe(input.canCopy)
      })
    )
  })

  it('劣化せず形式も同じときだけ上書きが主になる', () => {
    fc.assert(
      fc.property(policyInput, (input) => {
        const { primary } = planSave(input)
        expect(primary === 'overwrite').toBe(
          input.canOverwrite && input.lossless && input.sameFormat
        )
      })
    )
  })

  it('非可逆の変換でも、上書きはドロップダウンから選べる', () => {
    expect(
      planSave({ lossless: false, sameFormat: true, canOverwrite: true, canCopy: false })
    ).toEqual({ primary: 'saveAs', others: ['overwrite'] })
  })
})

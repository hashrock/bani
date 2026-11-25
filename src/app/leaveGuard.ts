import { useEffect } from 'react'

/*
 * 保存していない変更の見張り。編集画面が「変更あり」を知らせ、
 * App はファイルを開き直す前・入口へ戻る前・タブを閉じる前にこれを見て確かめる。
 * 編集画面は一度に 1 つしか開かないので、アプリ全体で 1 つの値を持てば足りる。
 */
let unsaved = false

export function setUnsaved(value: boolean): void {
  unsaved = value
}

export const hasUnsaved = (): boolean => unsaved

/** 変更がなければそのまま進めてよい。あれば確かめ、捨ててよいと言われたら見張りを外す */
export function confirmDiscard(message: string): boolean {
  if (!unsaved) return true
  if (!window.confirm(message)) return false
  unsaved = false
  return true
}

/** 編集画面から「変更あり」を知らせる。画面を閉じたら（作り直したら）変更なしに戻す */
export function useReportUnsaved(dirty: boolean, report: (dirty: boolean) => void): void {
  useEffect(() => {
    report(dirty)
  }, [dirty, report])
  useEffect(() => () => report(false), [report])
}

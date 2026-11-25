import { useState } from 'react'
import type { EditPageProps } from '../types'
import { CreateArchive } from './CreateArchive'
import type { AddedFile } from './io'
import { ViewArchive } from './ViewArchive'

type Seed = { name: string; files: AddedFile[] } | null
type Mode = { name: 'view' } | { name: 'create'; seed: Seed }

/**
 * 圧縮ファイルの画面。開いて来たときは中身の一覧と展開、
 * 入口の「編集」から（ファイルなしで）来たときは新しい圧縮ファイルの作成になる。
 */
export default function EditPage({ opened, onFiles }: EditPageProps) {
  const [mode, setMode] = useState<Mode>(() => (opened ? { name: 'view' } : { name: 'create', seed: null }))

  if (mode.name === 'view' && opened) {
    return <ViewArchive opened={opened} onFiles={onFiles} onCreate={(seed) => setMode({ name: 'create', seed })} />
  }
  return <CreateArchive seed={mode.name === 'create' ? mode.seed : null} onFiles={onFiles} />
}

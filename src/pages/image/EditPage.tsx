import { ComingSoonPage } from '../ComingSoonPage'
import type { EditPageProps } from '../types'

/** 雛形。画面を作るときに中身を置き換え、meta.ts の edit を true にする */
export default function EditPage(props: EditPageProps) {
  void props
  return <ComingSoonPage kind="image" />
}

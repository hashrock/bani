import { lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'
import type { Capabilities } from '../app/intake'
import { MEDIA_KINDS } from '../app/routes'
import type { MediaKind } from '../app/routes'
import { meta as archiveMeta } from './archive/meta'
import { meta as audioMeta } from './audio/meta'
import { meta as imageMeta } from './image/meta'
import { meta as pdfMeta } from './pdf/meta'
import { meta as textMeta } from './text/meta'
import type { EditPageProps, PageMeta } from './types'
import { meta as videoMeta } from './video/meta'

/**
 * メディアごとの画面。重いライブラリ（pdf.js、エンコーダ、エディタ）は
 * その画面を開いたときだけ読み込むよう、画面ごと遅延読み込みにする。
 * 各画面は自分のフォルダ（src/pages/<kind>/）の EditPage.tsx と meta.ts だけを持つ。
 */
export const EDIT_PAGES: Record<MediaKind, LazyExoticComponent<ComponentType<EditPageProps>>> = {
  video: lazy(() => import('./video/EditPage')),
  audio: lazy(() => import('./audio/EditPage')),
  image: lazy(() => import('./image/EditPage')),
  pdf: lazy(() => import('./pdf/EditPage')),
  text: lazy(() => import('./text/EditPage')),
  archive: lazy(() => import('./archive/EditPage')),
}

export const PAGE_META: Record<MediaKind, PageMeta> = {
  video: videoMeta,
  audio: audioMeta,
  image: imageMeta,
  pdf: pdfMeta,
  text: textMeta,
  archive: archiveMeta,
}

/** いま実装済みの画面が受け付ける種類 */
export const CAPABILITIES: Capabilities = {
  edit: MEDIA_KINDS.filter((kind) => PAGE_META[kind].edit),
  convert: MEDIA_KINDS.filter((kind) => PAGE_META[kind].convert),
}

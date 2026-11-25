import { useRef } from 'react'
import type { Capabilities } from '../app/intake'
import { MEDIA_KINDS, formatRoute } from '../app/routes'
import { BrandMark, LangSwitch } from '../components/BrandMark'
import { useI18n } from '../i18n/context'

interface HubPageProps {
  capabilities: Capabilities
  isDragging: boolean
  onFiles: (files: File[]) => void
}

/** 入口。とりあえずファイルを落とせば、種類と数に合った画面へ進む */
export function HubPage({ capabilities, isDragging, onFiles }: HubPageProps) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="hub">
      <header className="hub-head">
        <BrandMark />
        <LangSwitch />
      </header>

      <main className="hub-main">
        <p className="hub-tagline">{t.hubTagline}</p>

        <button
          type="button"
          className={`hub-drop ${isDragging ? 'dragging' : ''}`}
          onClick={() => inputRef.current?.click()}
        >
          <span className="hub-drop-title">{t.hubDrop}</span>
          <span className="hub-drop-hint">{t.hubDropHint}</span>
          <span className="ghost-btn">{t.hubPick}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const selected = e.target.files
            if (selected && selected.length > 0) onFiles(Array.from(selected))
            e.target.value = ''
          }}
        />

        <ul className="hub-kinds">
          {MEDIA_KINDS.map((kind) => {
            const canEdit = capabilities.edit.includes(kind)
            const canConvert = capabilities.convert.includes(kind)
            return (
              <li key={kind} className={`hub-kind ${canEdit || canConvert ? '' : 'pending'}`}>
                <span className="hub-kind-name">{t.kindLabel[kind]}</span>
                {canEdit || canConvert ? (
                  <span className="hub-kind-links">
                    {canEdit && <a href={formatRoute({ name: 'edit', kind })}>{t.hubEdit}</a>}
                    {canConvert && <a href={formatRoute({ name: 'convert' })}>{t.hubConvert}</a>}
                  </span>
                ) : (
                  <span className="hub-kind-soon">{t.hubComingSoon}</span>
                )}
              </li>
            )
          })}
        </ul>
      </main>
    </div>
  )
}

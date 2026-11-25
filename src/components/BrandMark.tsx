import { formatRoute } from '../app/routes'
import { useI18n } from '../i18n/context'
import { LANGS } from '../i18n/messages'

/** ロゴ。押すと入口の画面へ戻る */
export function BrandMark() {
  return (
    <a className="brand" href={formatRoute({ name: 'hub' })}>
      <span className="logo">
        <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M39.6018 86.2478C2.00431 94.9039 6.19952 53.9469 23.7246 50.4125C32.6017 48.6222 14.5781 14.1139 32.1539 13.0413C46.2146 12.1833 36.3339 44.8067 48.6748 46.0905C61.0157 47.3744 46.8788 10.5945 64.7008 11.9515C82.5229 13.3084 68.4816 44.7593 76.8022 52.4154C97 71.0001 71.7956 98.756 61 86.2478C53.3734 77.4113 69 57.5 87 93" stroke="#8E6F70" strokeWidth="9" strokeLinecap="round"/>
        </svg>
      </span>
      <span className="app-name">Bani</span>
    </a>
  )
}

export function LangSwitch() {
  const { t, lang, setLang } = useI18n()
  return (
    <div className="lang-switch">
      {LANGS.map((value) => (
        <button
          key={value}
          className={`lang-btn ${lang === value ? 'active' : ''}`}
          onClick={() => setLang(value)}
          title={t.langLabel[value]}
          aria-pressed={lang === value}
        >
          {value.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

/** サイドバー上端の見出し */
export function SidebarHead() {
  return (
    <div className="sidebar-head">
      <BrandMark />
      <LangSwitch />
    </div>
  )
}

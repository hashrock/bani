import { formatRoute } from '../app/routes'
import { BrandMark, LangSwitch } from '../components/BrandMark'
import { useI18n } from '../i18n/context'

/** 準備中の画面や、見つからない画面に出す案内 */
export function MessagePage({ title, body }: { title: string; body?: string }) {
  const { t } = useI18n()
  return (
    <div className="hub">
      <header className="hub-head">
        <BrandMark />
        <LangSwitch />
      </header>
      <main className="hub-main hub-message">
        <h1>{title}</h1>
        {body && <p>{body}</p>}
        <a className="ghost-btn" href={formatRoute({ name: 'hub' })}>
          {t.backToHub}
        </a>
      </main>
    </div>
  )
}

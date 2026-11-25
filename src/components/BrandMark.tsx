import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { solidOnClass } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { confirmDiscard } from '../app/leaveGuard'
import { formatRoute } from '../app/routes'
import { useI18n } from '../i18n/context'
import { LANGS } from '../i18n/messages'

/** ロゴ。押すと入口の画面へ戻る。保存していない変更があれば先に確かめる */
export function BrandMark() {
  const { t } = useI18n()
  return (
    <a
      className="flex items-center gap-2 text-inherit no-underline"
      href={formatRoute({ name: 'hub' })}
      onClick={(event) => {
        if (!confirmDiscard(t.discardConfirm)) event.preventDefault()
      }}
    >
      <span className="flex size-7 shrink-0 items-center">
        <svg className="size-full" width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M39.6018 86.2478C2.00431 94.9039 6.19952 53.9469 23.7246 50.4125C32.6017 48.6222 14.5781 14.1139 32.1539 13.0413C46.2146 12.1833 36.3339 44.8067 48.6748 46.0905C61.0157 47.3744 46.8788 10.5945 64.7008 11.9515C82.5229 13.3084 68.4816 44.7593 76.8022 52.4154C97 71.0001 71.7956 98.756 61 86.2478C53.3734 77.4113 69 57.5 87 93" stroke="#8E6F70" strokeWidth="9" strokeLinecap="round"/>
        </svg>
      </span>
      <span className="text-sm font-semibold tracking-[0.2px]">Bani</span>
    </a>
  )
}

export function LangSwitch({ className }: { className?: string }) {
  const { t, lang, setLang } = useI18n()
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      className={className}
      value={lang}
      onValueChange={(value) => {
        // 押し直しで選択が外れないよう、どちらかの言語が来たときだけ切り替える
        const next = LANGS.find((item) => item === value)
        if (next) setLang(next)
      }}
    >
      {LANGS.map((value) => (
        <ToggleGroupItem
          key={value}
          value={value}
          title={t.langLabel[value]}
          aria-label={t.langLabel[value]}
          className={cn(
            'h-6 min-w-0 px-2 text-[10px] font-semibold tracking-[0.3px] text-muted-foreground',
            solidOnClass
          )}
        >
          {value.toUpperCase()}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/**
 * hashrock のサービス切り替え（index.html が読み込む）。どの画面でも見出しの右端に置き、
 * 作業領域の上には何も浮かせない。アプリは常にライト配色（App.css）なので light でそろえる。
 * オフラインで読み込めなければ、中身のない要素として何も表示されない
 */
export function ServiceSwitcher() {
  return <hashrock-switcher theme="light" />
}

/** サイドバー上端の見出し */
export function SidebarHead() {
  return (
    <div className="flex items-center gap-2 border-b px-4 py-3">
      <BrandMark />
      <LangSwitch className="ml-auto" />
      <ServiceSwitcher />
    </div>
  )
}

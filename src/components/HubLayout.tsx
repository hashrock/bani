import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { BrandMark, LangSwitch } from './BrandMark'

/** 入口と案内の画面に共通する枠。サイドバーを持たず、中央に 1 段で並べる */
export function HubLayout({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="flex size-full flex-col overflow-y-auto bg-muted">
      {/* 右上の角にはサービス切り替えが浮くので、言語切り替えはロゴの隣に置く */}
      <header className="flex items-center gap-4 px-5 py-4">
        <BrandMark />
        <LangSwitch />
      </header>
      <main
        className={cn('mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-6 px-5 pt-6 pb-12', className)}
      >
        {children}
      </main>
    </div>
  )
}

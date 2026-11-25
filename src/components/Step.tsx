import type { ReactNode } from 'react'

/** サイドバーに上から並べる手順のひとまとまり */
export function Step({
  index,
  title,
  children,
}: {
  index: number
  title: string
  children: ReactNode
}) {
  return (
    <section className="border-b border-secondary px-4 py-3.5">
      <h2 className="mb-2.5 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">
          {index}
        </span>
        {title}
      </h2>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  )
}

/** 手順の下に添える補足 */
export function StepHint({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-normal text-muted-foreground">{children}</p>
}

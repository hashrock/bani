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
    <section className="step">
      <h2 className="step-title">
        <span className="step-index">{index}</span>
        {title}
      </h2>
      <div className="step-body">{children}</div>
    </section>
  )
}

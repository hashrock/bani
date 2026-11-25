import type { ReactNode } from 'react'
import type { Block, Inline } from './markdown'

/**
 * parseMarkdown の木を描く。HTML 文字列を経由しないので、本文に書かれたタグやスクリプトは文字として出る。
 * 画像は読み込まず代わりの文字を出す（外部への通信をしないため）
 */
export function MarkdownPreview({ blocks }: { blocks: Block[] }) {
  return (
    <div className="mx-auto max-w-[760px] px-8 py-6 text-sm leading-relaxed text-foreground">
      <Blocks blocks={blocks} />
    </div>
  )
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((block, i) => renderBlock(block, i))}</>
}

const HEADING_CLASS = [
  'mt-6 mb-3 border-b pb-1 text-2xl font-bold first:mt-0',
  'mt-6 mb-3 border-b pb-1 text-xl font-bold first:mt-0',
  'mt-5 mb-2 text-lg font-semibold first:mt-0',
  'mt-4 mb-2 text-base font-semibold first:mt-0',
  'mt-4 mb-2 text-sm font-semibold first:mt-0',
  'mt-4 mb-2 text-sm font-semibold text-muted-foreground first:mt-0',
]

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${block.level}` as const
      return (
        <Tag key={key} className={HEADING_CLASS[block.level - 1]}>
          <Inlines nodes={block.children} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p key={key} className="my-3 first:mt-0">
          <Inlines nodes={block.children} />
        </p>
      )
    case 'code':
      return (
        <pre key={key} className="my-3 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[12.5px] leading-normal">
          <code>{block.text}</code>
        </pre>
      )
    case 'quote':
      return (
        <blockquote key={key} className="my-3 border-l-4 border-border pl-3 text-muted-foreground">
          <Blocks blocks={block.children} />
        </blockquote>
      )
    case 'list': {
      const items = block.items.map((item, i) =>
        item.checked === null ? (
          <li key={i}>
            <Blocks blocks={item.children} />
          </li>
        ) : (
          // チェックボックスと本文（段落）を同じ行に並べる
          <li key={i} className="-ml-5 flex list-none items-start gap-1.5">
            <input type="checkbox" checked={item.checked} readOnly disabled className="mt-[0.4em] shrink-0" />
            <div className="min-w-0">
              <Blocks blocks={item.children} />
            </div>
          </li>
        )
      )
      // 項目が段落 1 つだけなら余白を詰める（いわゆる tight なリスト）
      const className = 'my-3 pl-6 [&_li>p]:my-0.5'
      return block.ordered ? (
        <ol key={key} start={block.start} className={`list-decimal ${className}`}>
          {items}
        </ol>
      ) : (
        <ul key={key} className={`list-disc ${className}`}>
          {items}
        </ul>
      )
    }
    case 'hr':
      return <hr key={key} className="my-5 border-border" />
    case 'table':
      return (
        <div key={key} className="my-3 overflow-x-auto">
          <table className="border-collapse text-[13px]">
            <thead>
              <tr>
                {block.head.map((cell, c) => (
                  <th key={c} className="border px-2.5 py-1 font-semibold" style={{ textAlign: block.align[c] ?? 'left' }}>
                    <Inlines nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border px-2.5 py-1" style={{ textAlign: block.align[c] ?? undefined }}>
                      <Inlines nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return <>{nodes.map((node, i) => renderInline(node, i))}</>
}

function renderInline(node: Inline, key: number): ReactNode {
  switch (node.type) {
    case 'text':
      return node.text
    case 'code':
      return (
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {node.text}
        </code>
      )
    case 'strong':
      return (
        <strong key={key}>
          <Inlines nodes={node.children} />
        </strong>
      )
    case 'em':
      return (
        <em key={key}>
          <Inlines nodes={node.children} />
        </em>
      )
    case 'del':
      return (
        <del key={key}>
          <Inlines nodes={node.children} />
        </del>
      )
    case 'link':
      return node.href ? (
        <a key={key} href={node.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          <Inlines nodes={node.children} />
        </a>
      ) : (
        <span key={key} className="underline decoration-dotted">
          <Inlines nodes={node.children} />
        </span>
      )
    case 'image':
      return (
        <span key={key} className="rounded border border-dashed px-1 text-muted-foreground" title={node.src}>
          {node.alt || node.src}
        </span>
      )
    case 'break':
      return <br key={key} />
  }
}

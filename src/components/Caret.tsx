import { ChevronRightIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 開閉できる見出しの印。開いているときは下を向く */
export function Caret({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronRightIcon
      aria-hidden="true"
      className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90', className)}
    />
  )
}

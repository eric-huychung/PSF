import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from './cn'

export interface ModalProps {
  titleId: string
  title: ReactNode
  onClose: () => void
  children: ReactNode
  className?: string
}

/** Generic centered dialog: overlay, card, close button. Content is up to the caller. */
export function Modal({ titleId, title, onClose, children, className }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-card border border-card-border bg-card text-card-foreground shadow-popover',
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-card-border p-5">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

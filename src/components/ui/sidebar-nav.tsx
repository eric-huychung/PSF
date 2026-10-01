import type { ReactNode } from 'react'
import { cn } from './cn'

export interface SidebarNavItem<T extends string> {
  id: T
  label: string
  icon?: ReactNode
}

export interface SidebarNavProps<T extends string> {
  items: ReadonlyArray<SidebarNavItem<T>>
  activeId: T
  onSelect: (id: T) => void
  /** Brand/title slot at the top. */
  header?: ReactNode
  /** Bottom slot, e.g. account or settings. */
  footer?: ReactNode
  className?: string
}

/**
 * Left-hand app nav. App.tsx switches screens by state (no router), so this is
 * controlled: it reports the selected id and highlights `activeId`.
 */
export function SidebarNav<T extends string>({ items, activeId, onSelect, header, footer, className }: SidebarNavProps<T>) {
  return (
    <aside
      data-slot="sidebar-nav"
      className={cn(
        'flex h-full w-60 shrink-0 flex-col gap-8 border-r border-sidebar-border bg-sidebar p-5',
        className,
      )}
    >
      {header && <div className="px-2 pt-1">{header}</div>}
      <nav aria-label="Main" className="flex flex-1 flex-row gap-1 overflow-x-auto md:flex-col">
        {items.map((item) => {
          const active = item.id === activeId
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
              className={cn(
                'flex h-10 items-center gap-3 rounded-lg px-4 text-left text-sm font-medium text-sidebar-foreground transition-colors [&_svg]:size-4.5 [&_svg]:shrink-0',
                active
                  ? 'bg-sidebar-active text-sidebar-active-foreground shadow-sm'
                  : 'hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          )
        })}
      </nav>
      {footer && <div className="px-2">{footer}</div>}
    </aside>
  )
}

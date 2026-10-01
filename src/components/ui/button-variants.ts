import { cva } from 'class-variance-authority'

export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-px disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        /** The one call to action on a view. */
        primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
        /** Paired/alternative action. */
        secondary: 'border border-card-border bg-secondary text-secondary-foreground hover:bg-secondary-hover',
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        /** Errors / irreversible actions. Amber, never red (red = money out). */
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-5 text-sm',
        lg: 'h-12 px-7 text-base',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

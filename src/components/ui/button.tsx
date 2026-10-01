import type { ComponentProps } from 'react'
import { Slot } from 'radix-ui'
import type { VariantProps } from 'class-variance-authority'
import { buttonVariants } from './button-variants'
import { cn } from './cn'

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render as the child element (e.g. an <a>) instead of a <button>. */
  asChild?: boolean
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

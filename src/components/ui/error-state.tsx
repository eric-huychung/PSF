import { AlertTriangle } from 'lucide-react'
import { Button } from './button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card'

export interface ErrorStateProps {
  title: string
  message: string
  actionLabel?: string
  onAction?: () => void
}

/** A consistent, explicit failure state for local-storage and session errors. */
export function ErrorState({ title, message, actionLabel = 'Try again', onAction }: ErrorStateProps) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10" role="alert">
      <Card className="w-full max-w-lg border-destructive/40">
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="rounded-full bg-destructive/10 p-2 text-destructive" aria-hidden="true">
              <AlertTriangle className="size-5" />
            </span>
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription className="mt-1">{message}</CardDescription>
            </div>
          </div>
        </CardHeader>
        {onAction && (
          <CardContent>
            <Button type="button" variant="secondary" onClick={onAction}>{actionLabel}</Button>
          </CardContent>
        )}
      </Card>
    </main>
  )
}

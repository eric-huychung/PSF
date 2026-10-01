import { ExternalLink, ShieldAlert } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui'

export function UnsupportedBrowser() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-lg" aria-labelledby="unsupported-browser-title">
        <Card>
          <CardHeader className="flex-col items-center text-center">
            <div className="rounded-full border border-card-border bg-secondary p-4 text-destructive" aria-hidden="true">
              <ShieldAlert className="size-7" />
            </div>
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">PSF</p>
              <CardTitle id="unsupported-browser-title" className="text-2xl sm:text-3xl">
                This browser is not supported
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="items-center text-center">
            <p className="text-muted-foreground">
              PSF stores your finance data in a local folder using the File System Access API. This browser does not provide that API, so the app cannot continue safely.
            </p>
            <div className="w-full rounded-lg border border-card-border bg-secondary p-4 text-left text-sm">
              <p className="font-medium">Use a current desktop version of:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>Google Chrome</li>
                <li>Microsoft Edge</li>
              </ul>
            </div>
            <a
              className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
              href="https://www.google.com/chrome/"
              target="_blank"
              rel="noreferrer"
            >
              Get a supported browser
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
            <p className="text-xs text-muted-foreground">No data has been loaded or stored in this browser.</p>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}

export default UnsupportedBrowser

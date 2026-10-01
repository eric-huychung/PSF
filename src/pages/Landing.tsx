import { ExternalLink, FolderOpen, FileText, CheckCircle2, BarChart3 } from 'lucide-react'
import { Button, Card } from '../components/ui'

const REPO_URL = 'https://github.com/eric-huychung/PSF'

export interface LandingProps {
  /** Called when the visitor wants to move into the folder-setup flow. */
  onGetStarted: () => void
}

const steps = [
  { icon: FolderOpen, label: 'Pick a folder', description: 'Choose a folder on your computer.' },
  { icon: FileText, label: 'Upload statements', description: 'Drop in your bank PDFs.' },
  { icon: CheckCircle2, label: 'Check the AI', description: 'Fix any wrong categories.' },
  { icon: BarChart3, label: 'See your spending', description: 'Charts of where it went.' },
] as const

export function Landing({ onGetStarted }: LandingProps) {
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-6 sm:px-6">
        <span className="text-base font-semibold tracking-tight">PSF</span>
        <Button variant="ghost" size="sm" asChild>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
            <ExternalLink aria-hidden="true" />
          </a>
        </Button>
      </header>

      <section className="mx-auto max-w-2xl px-4 pb-16 pt-10 text-center sm:px-6 sm:pt-20">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Know where your money went.
        </h1>
        <p className="mx-auto mt-4 max-w-md text-lg text-muted-foreground text-balance">
          Upload your bank statement PDFs. AI sorts the spending. Everything stays on your computer.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" onClick={onGetStarted}>
            Get started
          </Button>
          <Button size="lg" variant="secondary" asChild>
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              View source
            </a>
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Free and open source. Use your own AI key.</p>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-20 sm:px-6" aria-label="How it works">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(({ icon: Icon, label, description }, index) => (
            <Card key={label} className="gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <span className="flex size-6 items-center justify-center rounded-full bg-muted" aria-hidden="true">
                  {index + 1}
                </span>
                <Icon className="size-4 text-primary" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium">{label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-3xl px-4 pb-10 text-center text-xs text-muted-foreground sm:px-6">
        PSF is open source (MIT).{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
          View the repo
        </a>
        .
      </footer>
    </main>
  )
}

export default Landing

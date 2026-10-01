import { useState } from 'react'
import { ArrowLeftRight, LayoutDashboard, ListChecks, Settings, Upload } from 'lucide-react'
import {
  CategoryTargetChart,
  SpendingByCategoryChart,
  SpendingOverTimeChart,
  categorySpendFixture,
  categoryTargetFixture,
  periodFlowFixture,
} from '../charts'
import { Amount } from './amount'
import { Button } from './button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card'
import { SegmentedControl } from './segmented-control'
import { SidebarNav } from './sidebar-nav'
import { StatTile } from './stat-tile'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'

type Screen = 'dashboard' | 'transactions' | 'upload' | 'review' | 'settings'

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard /> },
  { id: 'transactions', label: 'Transactions', icon: <ArrowLeftRight /> },
  { id: 'upload', label: 'Upload', icon: <Upload /> },
  { id: 'review', label: 'Review', icon: <ListChecks /> },
  { id: 'settings', label: 'Settings', icon: <Settings /> },
] as const

const ranges = [
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
] as const

const transactions = [
  { date: '2026-09-26', description: 'Payroll — Acme Corp', category: 'Income', amount: 2600 },
  { date: '2026-09-25', description: 'Whole Foods Market', category: 'Groceries', amount: -84.12 },
  { date: '2026-09-24', description: 'Blue Bottle Coffee', category: 'Dining out', amount: -6.5 },
  { date: '2026-09-22', description: 'Venmo from Sam', category: 'Transfers', amount: 42 },
  { date: '2026-09-21', description: 'PG&E Utilities', category: 'Utilities', amount: -96.32 },
]

/**
 * Living style guide for Track D: every base component and chart on one page.
 * Not a product screen — mount it temporarily to eyeball the theme.
 */
export function DesignPreview() {
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [range, setRange] = useState<(typeof ranges)[number]['value']>('6m')

  return (
    <div className="flex min-h-screen">
      <SidebarNav
        items={navItems}
        activeId={screen}
        onSelect={setScreen}
        header={<span className="text-lg font-semibold tracking-tight">PSF</span>}
        className="sticky top-0 h-screen"
      />

      <main className="flex flex-1 flex-col gap-6 p-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">September 2026</p>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <SegmentedControl aria-label="Time range" options={ranges} value={range} onValueChange={setRange} />
            <Button variant="secondary">Export</Button>
            <Button>
              <Upload /> Upload PDF
            </Button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <StatTile label="Money in" value={5200} delta={200} deltaLabel="vs August" />
          <StatTile label="Money out" value={3693.44} delta={-152.84} deltaLabel="vs August" />
          <StatTile label="Net" value={1506.56} delta={47.16} deltaLabel="vs August" />
        </section>

        <section className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <div>
                <CardTitle>Spending over time</CardTitle>
                <CardDescription>Total money out per month</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <SpendingOverTimeChart data={periodFlowFixture} />
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Spending by category</CardTitle>
                <CardDescription>September 2026</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <SpendingByCategoryChart data={categorySpendFixture} />
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Category targets</CardTitle>
              <CardDescription>Actual spend this month against each category's monthly target</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <CategoryTargetChart data={categoryTargetFixture} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent transactions</CardTitle>
            <Button variant="ghost" size="sm">
              View all
            </Button>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((t) => (
                <TableRow key={t.date + t.description}>
                  <TableCell className="text-muted-foreground tabular-nums">{t.date}</TableCell>
                  <TableCell className="font-medium">{t.description}</TableCell>
                  <TableCell className="text-muted-foreground">{t.category}</TableCell>
                  <TableCell className="text-right font-medium">
                    <Amount value={t.amount} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Buttons</CardTitle>
              <CardDescription>Green is never a button — it only means money in.</CardDescription>
            </div>
          </CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Primary sm</Button>
            <Button>Primary</Button>
            <Button size="lg">Primary lg</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Delete month</Button>
            <Button disabled>Disabled</Button>
            <Button variant="secondary" size="icon" aria-label="Settings">
              <Settings />
            </Button>
          </div>
        </Card>
      </main>
    </div>
  )
}

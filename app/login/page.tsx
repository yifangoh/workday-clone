import type { Metadata } from 'next'
import { Logo } from '@/components/Logo'
import { LoginForm } from './LoginForm'
import { signOut } from '@/app/actions'

export const metadata: Metadata = { title: 'Sign in' }

const DEMO = [
  ['Daniel Lee', 'daniel.lee@example.com', 'Employee · Operations'],
  ['Marcus Tan', 'marcus.tan@example.com', 'Head of Operations (approver)'],
  ['Sarah Koh', 'sarah.koh@example.com', 'Head of Sales (approver)'],
  ['Grace Lim', 'grace.lim@example.com', 'Managing Director'],
  ['Nur Aisyah', 'aisyah@example.com', 'HR Manager · admin'],
  ['Rachel Ong', 'rachel.ong@example.com', 'Office Manager'],
  ['Mei Ling Wong', 'meiling.wong@example.com', 'Finance'],
  ['Priya Nair', 'priya.nair@example.com', 'Employee · joined Jul 2026'],
] as const

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; unlinked?: string }> }) {
  const { next, unlinked } = await searchParams
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-navy p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <Logo className="h-9 w-9" />
          <span className="text-xl font-semibold tracking-tight">Workpath</span>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="text-4xl font-semibold leading-tight">Leave and claims, without the email chase.</h1>
          <p className="mt-4 text-white/75">
            Apply once. Your balance and team clashes are checked instantly, the right approver is notified,
            and approved items land in the Master Leave Record or Finance&apos;s payment queue automatically.
          </p>
        </div>
        <p className="text-xs text-white/50">Demo data · Singapore public holidays 2026–2027</p>
        <div className="pointer-events-none absolute -right-24 -bottom-24 h-96 w-96 rounded-full bg-brand-600/40 blur-3xl" />
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo />
            <span className="text-lg font-semibold">Workpath</span>
          </div>
          <h2 className="text-2xl font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Use your work email.</p>

          {unlinked && (
            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-100">
              Your sign-in isn&apos;t linked to an active employee record yet. Ask HR to add you with this email.
              <form action={signOut} className="mt-2">
                <button className="link text-sm">Sign out</button>
              </form>
            </div>
          )}

          <LoginForm next={next ?? ''} />

          <details className="mt-8 rounded-xl border border-line bg-white p-4 text-sm" open>
            <summary className="cursor-pointer font-semibold">Demo accounts</summary>
            <p className="mt-2 text-muted">
              Every demo account uses the password <code className="rounded bg-canvas px-1.5 py-0.5">Workpath2026!</code>
            </p>
            <ul className="mt-3 divide-y divide-line">
              {DEMO.map(([name, email, role]) => (
                <li key={email} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium">{name}</p>
                    <p className="text-xs text-muted">{role}</p>
                  </div>
                  <code className="text-xs text-muted">{email}</code>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </section>
    </main>
  )
}

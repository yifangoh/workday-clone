import Link from 'next/link'
import { Bell, Inbox } from 'lucide-react'
import { Logo } from './Logo'
import { Avatar } from './ui'
import { NavLinks } from './NavLinks'
import { signOut } from '@/app/actions'
import { hasRole, isPeopleLeader } from '@/lib/auth'
import type { Me } from '@/lib/types'

export function AppHeader({ me, counts }: { me: Me; counts: { inbox: number; unread: number; financeQueue: number } }) {
  const links = [
    { href: '/', label: 'Home' },
    { href: '/inbox', label: 'Inbox', count: counts.inbox },
    { href: '/time-off', label: 'Time Off' },
    { href: '/expenses', label: 'Expenses' },
    { href: '/team', label: isPeopleLeader(me) ? 'My Team' : 'Team Calendar' },
    ...(hasRole(me, 'finance', 'admin') ? [{ href: '/finance', label: 'Finance', count: counts.financeQueue }] : []),
    ...(hasRole(me, 'hr', 'office_manager', 'admin', 'director') ? [{ href: '/hr', label: 'HR' }] : []),
    { href: '/directory', label: 'Directory' },
  ]
  return (
    <header className="sticky top-0 z-30 bg-navy text-white shadow">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Logo className="h-7 w-7" />
          <span className="hidden sm:inline">Workpath</span>
        </Link>
        <NavLinks links={links} />
        <div className="ml-auto flex items-center gap-1">
          <Link href="/inbox" className="relative rounded-full p-2 hover:bg-white/10" aria-label={`Inbox, ${counts.inbox} awaiting action`}>
            <Inbox className="h-5 w-5" />
            {counts.inbox > 0 && <Dot n={counts.inbox} />}
          </Link>
          <Link href="/notifications" className="relative rounded-full p-2 hover:bg-white/10" aria-label={`Notifications, ${counts.unread} unread`}>
            <Bell className="h-5 w-5" />
            {counts.unread > 0 && <Dot n={counts.unread} />}
          </Link>
          <details className="relative ml-1">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full p-1 hover:bg-white/10">
              <Avatar name={me.full_name} size="sm" />
            </summary>
            <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl bg-white text-ink shadow-lg ring-1 ring-line">
              <div className="border-b border-line px-4 py-3">
                <p className="text-sm font-semibold">{me.full_name}</p>
                <p className="text-xs text-muted">{me.job_title} · {me.department?.name}</p>
              </div>
              <Link href={`/directory/${me.id}`} className="block px-4 py-2 text-sm hover:bg-canvas">My profile</Link>
              <Link href="/profile" className="block px-4 py-2 text-sm hover:bg-canvas">Change password</Link>
              <form action={signOut}>
                <button className="block w-full px-4 py-2 text-left text-sm hover:bg-canvas">Sign out</button>
              </form>
            </div>
          </details>
        </div>
      </div>
    </header>
  )
}

function Dot({ n }: { n: number }) {
  return (
    <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-sun px-1 text-center text-[10px] font-bold leading-[18px] text-navy">
      {n > 99 ? '99+' : n}
    </span>
  )
}

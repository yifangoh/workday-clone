'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'

export function NavLinks({ links }: { links: { href: string; label: string; count?: number }[] }) {
  const path = usePathname()
  return (
    <nav className="no-scrollbar -mx-1 flex flex-1 items-center gap-0.5 overflow-x-auto">
      {links.map((l) => {
        const active = l.href === '/' ? path === '/' : path.startsWith(l.href)
        return (
          <Link
            key={l.href}
            href={l.href}
            className={clsx(
              'whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition',
              active ? 'bg-white text-navy' : 'text-white/80 hover:bg-white/10 hover:text-white',
            )}
          >
            {l.label}
            {!!l.count && (
              <span className={clsx('ml-1.5 rounded-full px-1.5 text-[11px] font-bold', active ? 'bg-sun/90 text-navy' : 'bg-sun text-navy')}>
                {l.count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

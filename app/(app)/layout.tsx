import { AppHeader } from '@/components/AppHeader'
import { requireMe } from '@/lib/auth'
import { getCounts } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMe()
  const counts = await getCounts(me)
  return (
    <>
      <AppHeader me={me} counts={counts} />
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </>
  )
}

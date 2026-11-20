import type { Metadata } from 'next'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, Empty, PageHeader } from '@/components/ui'
import { markAllRead, openNotification } from '@/app/actions'
import { timeAgo } from '@/lib/format'
import type { Notification } from '@/lib/types'

export const metadata: Metadata = { title: 'Notifications' }

export default async function Notifications() {
  const me = await requireMe()
  const supabase = await createClient()
  const { data } = await supabase.from('notifications').select('*').eq('recipient_id', me.id).order('created_at', { ascending: false }).limit(100)
  const rows = (data ?? []) as Notification[]
  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Decisions, reminders, escalations and payments."
        actions={rows.some((r) => !r.read_at) && <form action={markAllRead}><button className="btn-secondary btn-sm">Mark all as read</button></form>}
      />
      <Card padded={false}>
        {rows.length === 0 ? (
          <div className="p-5"><Empty title="No notifications yet" /></div>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((n) => (
              <li key={n.id}>
                <form action={openNotification}>
                  <input type="hidden" name="id" value={n.id} />
                  <input type="hidden" name="link" value={n.link ?? ''} />
                  <button className={`flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-canvas ${n.read_at ? '' : 'bg-brand-50/50'}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-brand-600'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{n.title}</span>
                      {n.body && <span className="block text-sm text-muted">{n.body}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{timeAgo(n.created_at)}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

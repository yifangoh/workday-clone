import { createClient } from '@/lib/supabase/server'
import { employeeNames } from '@/lib/queries'
import { auditLabel, fmtDateTime } from '@/lib/format'
import type { AuditEntry } from '@/lib/types'

export async function AuditTrail({ entity, id }: { entity: 'leave' | 'claim'; id: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('audit_log')
    .select('*')
    .eq('entity_type', entity)
    .eq('entity_id', id)
    .order('created_at')
    .order('id')
  const rows = (data ?? []) as AuditEntry[]
  const names = await employeeNames(rows.flatMap((r) => [r.actor_id, r.detail?.to as string, r.detail?.from as string]))
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {rows.map((r) => {
        const d = r.detail ?? {}
        const extra =
          r.action === 'escalated'
            ? d.to ? `to ${names.get(d.to as string)?.full_name ?? 'next approver'}` : 'HR alerted (no higher approver)'
            : r.action === 'reminder_sent'
              ? `to ${names.get(d.to as string)?.full_name ?? 'approver'}`
              : r.action === 'paid'
                ? `ref ${d.payment_ref}`
                : (d.remark as string) || (d.reason as string) || ''
        return (
          <li key={r.id} className="relative">
            <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
            <p className="text-sm font-medium">{auditLabel[r.action] ?? r.action}</p>
            <p className="text-xs text-muted">
              {fmtDateTime(r.created_at)} · {r.actor_id ? names.get(r.actor_id)?.full_name ?? 'User' : 'System'}
              {extra && <> · <span className="text-ink">{String(extra)}</span></>}
            </p>
          </li>
        )
      })}
      {rows.length === 0 && <li className="text-sm text-muted">No history yet.</li>}
    </ol>
  )
}

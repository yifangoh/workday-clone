import type { Metadata } from 'next'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { employeeNames } from '@/lib/queries'
import { HrTabs } from '@/components/HrTabs'
import { Card, Flags, LeaveStatusBadge, PageHeader } from '@/components/ui'
import { fmtDate, fmtRange, num } from '@/lib/format'
import type { LeaveRequest } from '@/lib/types'

export const metadata: Metadata = { title: 'All leave requests' }

export default async function HrRequests({ searchParams }: { searchParams: Promise<{ status?: string; month?: string }> }) {
  await requireRole('hr', 'office_manager', 'admin', 'director')
  const sp = await searchParams
  const supabase = await createClient()
  let q = supabase.from('leave_requests').select('*').order('start_date', { ascending: false }).limit(500)
  if (sp.status) q = q.eq('status', sp.status)
  if (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) {
    const [y, m] = sp.month.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    q = q.lte('start_date', `${sp.month}-${last}`).gte('end_date', `${sp.month}-01`)
  }
  const { data } = await q
  const rows = (data ?? []) as LeaveRequest[]
  const names = await employeeNames(rows.flatMap((r) => [r.employee_id, r.approver_id]))
  const exportQs = new URLSearchParams(Object.entries({ status: sp.status, month: sp.month }).filter(([, v]) => v) as [string, string][]).toString()

  return (
    <div>
      <PageHeader
        title="HR"
        subtitle="Every request with its status, approver and flags."
        actions={
          <>
            <form className="flex items-center gap-2">
              <select name="status" defaultValue={sp.status ?? ''} className="input w-auto">
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Not approved</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <input type="month" name="month" defaultValue={sp.month ?? ''} className="input w-auto" />
              <button className="btn-secondary btn-sm">Filter</button>
            </form>
            <a className="btn-secondary btn-sm" href={`/api/export/leave-requests?${exportQs}`}><Download className="h-4 w-4" /> CSV</a>
          </>
        }
      />
      <HrTabs active="/hr/requests" />
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Ref</th><th>Employee</th><th>Type</th><th>Dates</th><th className="text-right">Days</th><th>Status</th><th>Approver</th><th>Submitted</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/time-off/${r.id}`} className="link">{r.ref}</Link></td>
                  <td>{names.get(r.employee_id)?.full_name}</td>
                  <td>{r.leave_type}</td>
                  <td>{fmtRange(r.start_date, r.end_date)}</td>
                  <td className="text-right">{num(r.days)}</td>
                  <td className="space-x-1"><LeaveStatusBadge status={r.status} /><Flags flags={r.flags} /></td>
                  <td className="text-muted">{names.get(r.approver_id ?? '')?.full_name}</td>
                  <td className="text-muted">{fmtDate(r.submitted_at)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="text-muted">No requests match.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

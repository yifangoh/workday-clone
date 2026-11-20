import type { Metadata } from 'next'
import Link from 'next/link'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { requireMe, hasRole, isPeopleLeader } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Avatar, Card, PageHeader } from '@/components/ui'
import { num, todaySG } from '@/lib/format'
import type { Department, Employee, LeaveBalance } from '@/lib/types'

export const metadata: Metadata = { title: 'Team' }

type Absence = {
  request_id: string; employee_id: string; full_name: string; leave_type: string; leave_name: string; color: string
  start_date: string; end_date: string; half_day: string; status: 'pending' | 'approved'
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ month?: string; dept?: string }> }) {
  const me = await requireMe()
  const sp = await searchParams
  const supabase = await createClient()
  const today = todaySG()
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month! : today.slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const last = new Date(y, m, 0)
  const prev = iso(new Date(y, m - 2, 1)).slice(0, 7)
  const next = iso(new Date(y, m, 1)).slice(0, 7)
  const wide = hasRole(me, 'hr', 'office_manager', 'director', 'admin')
  const deptId = sp.dept ?? (wide ? '' : me.department_id ?? '')

  const [{ data: depts }, { data: absences }, { data: holidays }] = await Promise.all([
    supabase.from('departments').select('*').order('name'),
    supabase.rpc('team_absence', { p_from: iso(first), p_to: iso(last), p_department: deptId || null }),
    supabase.from('public_holidays').select('holiday_date, name').gte('holiday_date', iso(first)).lte('holiday_date', iso(last)),
  ])
  const visibleDept = deptId || (wide ? '' : me.department_id)
  let peopleQ = supabase.from('employees').select('*').eq('is_active', true).order('full_name')
  if (visibleDept) peopleQ = peopleQ.eq('department_id', visibleDept)
  const { data: people } = await peopleQ
  const team = (people ?? []) as Employee[]

  const leader = isPeopleLeader(me)
  const reports = team.filter((e) => e.manager_id === me.id || me.isHeadOf.some((d) => d.id === e.department_id && e.id !== me.id))
  const { data: reportBalances } = leader && reports.length
    ? await supabase.from('v_leave_balances').select('*').in('employee_id', reports.map((r) => r.id)).eq('year', y).in('leave_type', ['AL', 'SL'])
    : { data: [] }

  const hol = new Map((holidays ?? []).map((h: { holiday_date: string; name: string }) => [h.holiday_date, h.name]))
  const dates: string[] = []
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) dates.push(iso(d))
  const abs = (absences ?? []) as Absence[]
  const cell = (emp: string, d: string) => abs.find((a) => a.employee_id === emp && a.start_date <= d && a.end_date >= d)
  const monthLabel = first.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })
  const qs = (o: Record<string, string>) => '?' + new URLSearchParams({ ...(deptId ? { dept: deptId } : {}), month, ...o }).toString()

  return (
    <div className="space-y-6">
      <PageHeader
        title={leader ? 'My Team' : 'Team Calendar'}
        subtitle="Approved and pending time off. Use it to spot clashes before you approve or apply."
        actions={
          (wide || me.isHeadOf.length > 0) && (
            <form className="flex items-center gap-2">
              <input type="hidden" name="month" value={month} />
              <select name="dept" defaultValue={deptId} className="input w-auto">
                {wide && <option value="">All departments</option>}
                {((depts ?? []) as Department[])
                  .filter((d) => wide || d.id === me.department_id || me.isHeadOf.some((h) => h.id === d.id))
                  .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button className="btn-secondary btn-sm">Show</button>
            </form>
          )
        }
      />

      <Card
        title={
          <span className="flex items-center gap-2">
            <Link href={qs({ month: prev })} className="rounded-full p-1 hover:bg-canvas" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Link>
            <span className="min-w-36 text-center">{monthLabel}</span>
            <Link href={qs({ month: next })} className="rounded-full p-1 hover:bg-canvas" aria-label="Next month"><ChevronRight className="h-4 w-4" /></Link>
          </span>
        }
        actions={
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-brand-500" /> Approved</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border-2 border-dashed border-brand-500" /> Pending</span>
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-amber-100" /> Public holiday</span>
          </div>
        }
        padded={false}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-44 border-b border-line bg-white px-3 py-2 text-left font-semibold text-muted">Person</th>
                {dates.map((d) => {
                  const dt = new Date(d + 'T00:00:00')
                  const wknd = dt.getDay() === 0 || dt.getDay() === 6
                  return (
                    <th key={d} title={hol.get(d)} className={clsx('min-w-7 border-b border-line px-0.5 py-1 text-center font-medium', wknd && 'bg-canvas text-slate-400', hol.has(d) && 'bg-amber-100 text-amber-900', d === today && 'text-brand-700')}>
                      <div>{dt.toLocaleDateString('en-SG', { weekday: 'narrow' })}</div>
                      <div className={clsx(d === today && 'mx-auto w-5 rounded-full bg-brand-600 text-white')}>{dt.getDate()}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {team.map((e) => (
                <tr key={e.id} className={clsx(e.id === me.id && 'bg-brand-50/40')}>
                  <td className="sticky left-0 z-10 border-b border-line bg-white px-3 py-1.5">
                    <Link href={`/directory/${e.id}`} className="flex items-center gap-2 hover:underline">
                      <Avatar name={e.full_name} size="sm" />
                      <span className="truncate text-sm">{e.full_name}</span>
                    </Link>
                  </td>
                  {dates.map((d) => {
                    const a = cell(e.id, d)
                    const dt = new Date(d + 'T00:00:00')
                    const off = dt.getDay() === 0 || dt.getDay() === 6 || hol.has(d)
                    return (
                      <td key={d} className={clsx('h-9 border-b border-line p-0.5', off && 'bg-canvas', hol.has(d) && 'bg-amber-50')}>
                        {a && !off && (
                          <div
                            title={`${a.full_name}: ${a.leave_name}${a.half_day !== 'none' ? ` (${a.half_day.toUpperCase()})` : ''} — ${a.status}`}
                            className={clsx('h-full rounded', a.status === 'pending' && 'border-2 border-dashed bg-transparent', a.half_day !== 'none' && 'h-1/2')}
                            style={a.status === 'approved' ? { background: a.color } : { borderColor: a.color }}
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {leader && reports.length > 0 && (
        <Card title={`My reports · ${y} balances`} padded={false}>
          <table className="data-table">
            <thead><tr><th>Name</th><th>Role</th><th className="text-right">Annual leave left</th><th className="text-right">Sick leave left</th></tr></thead>
            <tbody>
              {reports.map((r) => {
                const b = (t: string) => (reportBalances as LeaveBalance[]).find((x) => x.employee_id === r.id && x.leave_type === t)
                return (
                  <tr key={r.id}>
                    <td><Link href={`/directory/${r.id}`} className="link">{r.full_name}</Link></td>
                    <td className="text-muted">{r.job_title}</td>
                    <td className="text-right">{b('AL') ? `${num(b('AL')!.available)} / ${num(b('AL')!.entitled)}` : '—'}</td>
                    <td className="text-right">{b('SL') ? `${num(b('SL')!.available)} / ${num(b('SL')!.entitled)}` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

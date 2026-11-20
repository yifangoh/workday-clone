import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Avatar, Card, DL, PageHeader } from '@/components/ui'
import { fmtDate, num, todaySG } from '@/lib/format'
import type { Department, Employee, LeaveBalance } from '@/lib/types'

export default async function Profile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireMe()
  const supabase = await createClient()
  const { data } = await supabase.from('employees').select('*').eq('id', id).maybeSingle()
  if (!data) notFound()
  const e = data as Employee
  const year = Number(todaySG().slice(0, 4))
  const [{ data: dept }, { data: mgr }, { data: reports }, { data: balances }] = await Promise.all([
    e.department_id ? supabase.from('departments').select('*').eq('id', e.department_id).maybeSingle() : Promise.resolve({ data: null }),
    e.manager_id ? supabase.from('employees').select('id, full_name, job_title').eq('id', e.manager_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('employees').select('id, full_name, job_title').eq('manager_id', e.id).order('full_name'),
    // RLS only returns rows the viewer may see (self, their approver, HR)
    supabase.from('v_leave_balances').select('*').eq('employee_id', e.id).eq('year', year).order('sort_order'),
  ])
  const d = dept as Department | null
  return (
    <div className="space-y-6">
      <PageHeader back={{ href: '/directory', label: 'Directory' }} title={e.full_name} subtitle={`${e.job_title ?? ''}${d ? ` · ${d.name}` : ''}`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-5 flex items-center gap-4">
            <Avatar name={e.full_name} size="lg" />
            <div>
              <p className="text-lg font-semibold">{e.full_name}</p>
              <p className="text-sm text-muted">{e.employee_no}</p>
            </div>
          </div>
          <DL
            items={[
              ['Email', <a key="m" href={`mailto:${e.email}`} className="link">{e.email}</a>],
              ['Phone', e.phone ?? '—'],
              ['Location', e.location],
              ['Hire date', fmtDate(e.hire_date)],
              ['Supervisor', mgr ? <Link key="s" href={`/directory/${(mgr as Employee).id}`} className="link">{(mgr as Employee).full_name}</Link> : '—'],
              ['Department head', d?.head_id === e.id ? 'Yes' : 'No'],
            ]}
          />
        </Card>
        <div className="space-y-6">
          {(reports ?? []).length > 0 && (
            <Card title="Direct reports">
              <ul className="space-y-2">
                {(reports as Employee[]).map((r) => (
                  <li key={r.id}><Link href={`/directory/${r.id}`} className="link text-sm">{r.full_name}</Link> <span className="text-xs text-muted">{r.job_title}</span></li>
                ))}
              </ul>
            </Card>
          )}
          {(balances ?? []).length > 0 && (
            <Card title={`Leave balances · ${year}`}>
              <ul className="space-y-1.5 text-sm">
                {(balances as LeaveBalance[]).map((b) => (
                  <li key={b.leave_type} className="flex justify-between"><span>{b.leave_name}</span><span className="font-medium">{num(b.available)} / {num(b.entitled)}</span></li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

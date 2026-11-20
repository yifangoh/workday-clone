import type { Metadata } from 'next'
import { requireRole, hasRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { HrTabs } from '@/components/HrTabs'
import { ActionForm, SubmitButton } from '@/components/forms'
import { Badge, Card, PageHeader } from '@/components/ui'
import { addHoliday, createLogin, deleteHoliday, generateEntitlements, saveEmployee } from '@/app/actions'
import { fmtDate, num, todaySG } from '@/lib/format'
import type { Department, Employee, LeaveType } from '@/lib/types'

export const metadata: Metadata = { title: 'HR setup' }

const ROLE_OPTIONS = [
  ['manager', 'People manager'],
  ['hr', 'HR'],
  ['office_manager', 'Office Manager'],
  ['finance', 'Finance'],
  ['director', 'Director'],
  ['admin', 'Admin'],
] as const

export default async function HrSetup() {
  const me = await requireRole('hr', 'office_manager', 'admin', 'director')
  const canEdit = hasRole(me, 'hr', 'admin')
  const supabase = await createClient()
  const today = todaySG()
  const year = Number(today.slice(0, 4))
  const [{ data: emps }, { data: depts }, { data: hols }, { data: types }] = await Promise.all([
    supabase.from('employees').select('*').order('employee_no'),
    supabase.from('departments').select('*').order('name'),
    supabase.from('public_holidays').select('*').gte('holiday_date', `${year}-01-01`).order('holiday_date'),
    supabase.from('leave_types').select('*').order('sort_order'),
  ])
  const employees = (emps ?? []) as Employee[]
  const departments = (depts ?? []) as Department[]
  const deptName = new Map(departments.map((d) => [d.id, d.name]))
  const empName = new Map(employees.map((e) => [e.id, e.full_name]))

  return (
    <div>
      <PageHeader title="HR" subtitle="Staff records, sign-ins, leave policy and public holidays." />
      <HrTabs active="/hr/setup" />
      <div className="space-y-6">
        <Card title={`Staff · ${employees.length}`} padded={false}>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>No.</th><th>Name</th><th>Department</th><th>Approver</th><th>Hired</th><th>Roles</th><th>Sign-in</th></tr></thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className="text-muted">{e.employee_no}</td>
                    <td>{e.full_name}<p className="text-xs text-muted">{e.email}</p></td>
                    <td>{deptName.get(e.department_id ?? '') ?? '—'}</td>
                    <td>{empName.get(e.manager_id ?? '') ?? <span className="text-muted">Auto</span>}</td>
                    <td>{fmtDate(e.hire_date)}</td>
                    <td className="space-x-1">{e.roles.filter((r) => r !== 'employee').map((r) => <Badge key={r}>{r.replace('_', ' ')}</Badge>)}</td>
                    <td>
                      {e.auth_user_id ? (
                        <Badge color="green">Linked</Badge>
                      ) : canEdit ? (
                        <ActionForm action={createLogin} className="flex min-w-56 flex-col gap-1 space-y-0">
                          <input type="hidden" name="employee_id" value={e.id} />
                          <div className="flex gap-1">
                            <input name="password" type="text" minLength={8} required placeholder="Temp password" className="input py-1 text-xs" />
                            <SubmitButton className="btn-secondary btn-sm">Create</SubmitButton>
                          </div>
                        </ActionForm>
                      ) : (
                        <Badge color="amber">Not linked</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {canEdit && (
          <Card title="Add employee">
            <ActionForm action={saveEmployee} resetOnSuccess>
              <div className="grid gap-3 md:grid-cols-4">
                <label><span className="label">Employee no.</span><input name="employee_no" required className="input" placeholder="E013" /></label>
                <label className="md:col-span-2"><span className="label">Full name</span><input name="full_name" required className="input" /></label>
                <label><span className="label">Hire date</span><input name="hire_date" type="date" required defaultValue={today} className="input" /></label>
                <label className="md:col-span-2"><span className="label">Work email</span><input name="email" type="email" required className="input" /></label>
                <label><span className="label">Job title</span><input name="job_title" className="input" /></label>
                <label><span className="label">Phone</span><input name="phone" className="input" /></label>
                <label><span className="label">Department</span>
                  <select name="department_id" className="input"><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                </label>
                <label><span className="label">Approver (supervisor)</span>
                  <select name="manager_id" className="input"><option value="">Department head</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select>
                </label>
                <fieldset className="md:col-span-2">
                  <span className="label">Extra roles</span>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {ROLE_OPTIONS.map(([v, l]) => (
                      <label key={v} className="flex items-center gap-1.5"><input type="checkbox" name="roles" value={v} /> {l}</label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <p className="text-xs text-muted">Entitlements for {year} are created automatically and pro-rated from the hire date. Then create a sign-in above, or invite the same email from Supabase Auth — it links automatically.</p>
              <SubmitButton>Add employee</SubmitButton>
            </ActionForm>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Leave policy" padded={false}>
            <table className="data-table">
              <thead><tr><th>Type</th><th className="text-right">Days / yr</th><th>Rules</th></tr></thead>
              <tbody>
                {((types ?? []) as LeaveType[]).map((t) => (
                  <tr key={t.code}>
                    <td><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />{t.name}</td>
                    <td className="text-right">{t.tracks_balance ? num(t.default_days) : '—'}</td>
                    <td className="text-xs text-muted">
                      {[t.requires_document && `needs ${t.document_label}`, t.counts_toward && `counts toward ${t.counts_toward}`, t.requires_exhausted && `only after ${t.requires_exhausted} used`, t.min_notice_days > 0 && `flag if < ${t.min_notice_days} days' notice`, t.allow_backdate && 'can backdate', !t.is_paid && 'unpaid'].filter(Boolean).join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canEdit && (
              <div className="border-t border-line p-4">
                <ActionForm action={generateEntitlements} className="flex flex-wrap items-end gap-2 space-y-0">
                  <label><span className="label">Generate entitlements for</span>
                    <select name="year" defaultValue={year + 1} className="input w-auto">{[year, year + 1].map((y) => <option key={y}>{y}</option>)}</select>
                  </label>
                  <SubmitButton className="btn-secondary">Generate</SubmitButton>
                </ActionForm>
                <p className="mt-2 text-xs text-muted">Creates missing rows from the defaults above; existing entitlements are left alone.</p>
              </div>
            )}
          </Card>

          <Card title={`Public holidays · from ${year}`} padded={false}>
            <ul className="max-h-96 divide-y divide-line overflow-y-auto text-sm">
              {(hols ?? []).map((h: { holiday_date: string; name: string; is_in_lieu: boolean }) => (
                <li key={h.holiday_date} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span>{h.name} {h.is_in_lieu && <Badge>in lieu</Badge>}</span>
                  <span className="flex items-center gap-3 text-muted">
                    {fmtDate(h.holiday_date, { weekday: 'short' })}
                    {canEdit && (
                      <form action={deleteHoliday}>
                        <input type="hidden" name="holiday_date" value={h.holiday_date} />
                        <button className="text-xs text-red-700 hover:underline">Remove</button>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="border-t border-line p-4">
                <ActionForm action={addHoliday} resetOnSuccess>
                  <div className="grid grid-cols-3 gap-2">
                    <input type="date" name="holiday_date" required className="input" />
                    <input name="name" required placeholder="Holiday name" className="input col-span-2" />
                  </div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_in_lieu" /> Day in lieu</label>
                  <SubmitButton className="btn-secondary btn-sm">Add holiday</SubmitButton>
                </ActionForm>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

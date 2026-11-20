import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from './supabase/server'
import type { AppRole, Department, Employee, Me } from './types'

export const getMe = cache(async (): Promise<Me | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: emp } = await supabase
    .from('employees')
    .select('*')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle<Employee>()
  if (!emp) return null

  const [{ data: departments }, { data: manager }, { count }] = await Promise.all([
    supabase.from('departments').select('*'),
    emp.manager_id
      ? supabase.from('employees').select('id, full_name, job_title').eq('id', emp.manager_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('employees').select('id', { count: 'exact', head: true }).eq('manager_id', emp.id),
  ])
  const depts = (departments ?? []) as Department[]
  return {
    ...emp,
    department: depts.find((d) => d.id === emp.department_id) ?? null,
    manager: (manager as Me['manager']) ?? null,
    isHeadOf: depts.filter((d) => d.head_id === emp.id),
    directReportCount: count ?? 0,
  }
})

export async function requireMe(): Promise<Me> {
  const me = await getMe()
  if (!me) redirect('/login?unlinked=1')
  return me
}

export function hasRole(me: Pick<Employee, 'roles'>, ...roles: AppRole[]) {
  return me.roles.some((r) => roles.includes(r))
}

export function isPeopleLeader(me: Me) {
  return me.directReportCount > 0 || me.isHeadOf.length > 0 || hasRole(me, 'manager', 'director')
}

export async function requireRole(...roles: AppRole[]) {
  const me = await requireMe()
  if (!hasRole(me, ...roles)) redirect('/?denied=1')
  return me
}

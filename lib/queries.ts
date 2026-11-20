import 'server-only'
import { createClient } from './supabase/server'
import type { Me } from './types'

export async function getCounts(me: Me) {
  const supabase = await createClient()
  const mine = `approver_id.eq.${me.id},original_approver_id.eq.${me.id}`
  const [leave, claims, unread, finance] = await Promise.all([
    supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').or(mine).neq('employee_id', me.id),
    supabase.from('claims').select('id', { count: 'exact', head: true }).eq('status', 'pending').or(mine).neq('employee_id', me.id),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', me.id).is('read_at', null),
    me.roles.includes('finance') || me.roles.includes('admin')
      ? supabase.from('claims').select('id', { count: 'exact', head: true }).eq('status', 'submitted_to_finance')
      : Promise.resolve({ count: 0 }),
  ])
  return {
    inbox: (leave.count ?? 0) + (claims.count ?? 0),
    unread: unread.count ?? 0,
    financeQueue: finance.count ?? 0,
  }
}

export async function employeeNames(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter(Boolean))] as string[]
  if (!unique.length) return new Map<string, { full_name: string; job_title: string | null }>()
  const supabase = await createClient()
  const { data } = await supabase.from('employees').select('id, full_name, job_title').in('id', unique)
  return new Map((data ?? []).map((e) => [e.id as string, { full_name: e.full_name as string, job_title: e.job_title as string | null }]))
}

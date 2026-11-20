'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/types'

function str(fd: FormData, key: string) {
  const v = fd.get(key)
  return typeof v === 'string' ? v.trim() : ''
}

function friendly(message: string) {
  // Postgres raises our business-rule messages verbatim; strip transport noise.
  return message.replace(/^(ERROR:\s*)/i, '').replace(/ • /g, '\n')
}

// ---------- Auth ----------
export async function signIn(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: str(fd, 'email').toLowerCase(),
    password: String(fd.get('password') ?? ''),
  })
  if (error)
    return {
      error:
        error.message === 'Invalid login credentials'
          ? 'Email or password is incorrect.'
          : /fetch failed|network/i.test(error.message)
            ? 'Cannot reach the sign-in service. Check the Supabase URL and key settings.'
            : error.message,
    }
  const next = str(fd, 'next')
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function changePassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const pw = String(fd.get('password') ?? '')
  if (pw.length < 8) return { error: 'Use at least 8 characters.' }
  if (pw !== String(fd.get('confirm') ?? '')) return { error: 'The two passwords do not match.' }
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: pw })
  if (error) return { error: error.message }
  return { ok: 'Password updated.' }
}

// ---------- Leave ----------
export async function submitLeave(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const start = str(fd, 'start_date')
  const end = str(fd, 'end_date') || start
  const { data, error } = await supabase.rpc('submit_leave_request', {
    p_type: str(fd, 'leave_type'),
    p_start: start || null,
    p_end: end || null,
    p_half: start === end ? str(fd, 'half_day') || 'none' : 'none',
    p_reason: str(fd, 'reason') || null,
    p_document: str(fd, 'document_ref') || null,
  })
  if (error) return { error: friendly(error.message) }
  revalidatePath('/', 'layout')
  return { ok: `Submitted ${data.ref} for approval.`, id: data.id }
}

export async function decideLeave(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const decision = str(fd, 'decision')
  const { data, error } = await supabase.rpc('decide_leave_request', {
    p_id: str(fd, 'id'),
    p_decision: decision,
    p_remark: str(fd, 'remark') || null,
  })
  if (error) return { error: friendly(error.message) }
  revalidatePath('/', 'layout')
  return { ok: `${data.ref} ${decision === 'approve' ? 'approved and recorded' : 'returned to the employee'}.` }
}

export async function cancelLeave(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_leave_request', {
    p_id: str(fd, 'id'),
    p_reason: str(fd, 'reason') || null,
  })
  if (error) return { error: friendly(error.message) }
  revalidatePath('/', 'layout')
  return { ok: 'Request cancelled.' }
}

// ---------- Claims ----------
export async function submitClaim(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  let lines: unknown
  try {
    lines = JSON.parse(String(fd.get('lines') ?? '[]'))
  } catch {
    return { error: 'Could not read the expense lines. Please try again.' }
  }
  const { data, error } = await supabase.rpc('submit_claim', {
    p_title: str(fd, 'title'),
    p_lines: lines,
    p_declaration: fd.get('declaration') === 'on',
  })
  if (error) return { error: friendly(error.message) }
  revalidatePath('/', 'layout')
  redirect(`/expenses/${data.id}?submitted=1`)
}

export async function decideClaim(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const decision = str(fd, 'decision')
  const { data, error } = await supabase.rpc('decide_claim', {
    p_id: str(fd, 'id'),
    p_decision: decision,
    p_remark: str(fd, 'remark') || null,
  })
  if (error) return { error: friendly(error.message) }
  revalidatePath('/', 'layout')
  return { ok: `${data.ref} ${decision === 'approve' ? 'approved and sent to Finance' : 'returned to the employee'}.` }
}

export async function cancelClaim(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_claim', { p_id: str(fd, 'id') })
  if (error) return { error: friendly(error.message) }
  revalidatePath('/', 'layout')
  return { ok: 'Claim withdrawn.' }
}

export async function payClaim(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('finance_pay_claim', {
    p_id: str(fd, 'id'),
    p_payment_ref: str(fd, 'payment_ref'),
    p_paid_on: str(fd, 'paid_on') || null,
  })
  if (error) return { error: friendly(error.message) }
  revalidatePath('/', 'layout')
  return { ok: 'Marked as paid. The employee has been notified.' }
}

export async function returnClaim(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('finance_return_claim', {
    p_id: str(fd, 'id'),
    p_remark: str(fd, 'remark'),
  })
  if (error) return { error: friendly(error.message) }
  revalidatePath('/', 'layout')
  return { ok: 'Returned to the employee with your remark.' }
}

// ---------- Notifications ----------
export async function markAllRead() {
  const supabase = await createClient()
  const { data: me } = await supabase.rpc('current_employee_id')
  if (me) {
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', me)
      .is('read_at', null)
  }
  revalidatePath('/', 'layout')
}

export async function openNotification(fd: FormData) {
  const supabase = await createClient()
  const id = str(fd, 'id')
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null)
  const link = str(fd, 'link')
  revalidatePath('/', 'layout')
  redirect(link.startsWith('/') ? link : '/notifications')
}

// ---------- HR ----------
export async function setEntitlement(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('hr_set_entitlement', {
    p_emp: str(fd, 'employee_id'),
    p_type: str(fd, 'leave_type'),
    p_year: Number(str(fd, 'year')),
    p_days: Number(str(fd, 'days')),
    p_note: str(fd, 'note') || null,
  })
  if (error) return { error: friendly(error.message) }
  revalidatePath('/hr', 'layout')
  return { ok: 'Entitlement saved.' }
}

export async function adjustBalance(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('hr_adjust_balance', {
    p_emp: str(fd, 'employee_id'),
    p_type: str(fd, 'leave_type'),
    p_year: Number(str(fd, 'year')),
    p_days: Number(str(fd, 'days')),
    p_note: str(fd, 'note'),
  })
  if (error) return { error: friendly(error.message) }
  revalidatePath('/hr', 'layout')
  return { ok: 'Adjustment posted to the Master Leave Record.' }
}

export async function generateEntitlements(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('hr_generate_entitlements', { p_year: Number(str(fd, 'year')) })
  if (error) return { error: friendly(error.message) }
  revalidatePath('/hr', 'layout')
  return { ok: data === 0 ? 'Everyone already has entitlements for that year.' : `Created ${data} entitlement rows.` }
}

export async function runReminders(_: ActionState): Promise<ActionState> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('run_reminders_now')
  if (error) return { error: friendly(error.message) }
  revalidatePath('/', 'layout')
  return { ok: `Sent ${data.reminders} reminder(s) and ${data.escalations} escalation(s).` }
}

export async function addHoliday(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase.from('public_holidays').insert({
    holiday_date: str(fd, 'holiday_date'),
    name: str(fd, 'name'),
    is_in_lieu: fd.get('is_in_lieu') === 'on',
  })
  if (error) return { error: error.code === '23505' ? 'That date is already a public holiday.' : error.message }
  revalidatePath('/hr', 'layout')
  return { ok: 'Holiday added. Working-day counts now exclude it.' }
}

export async function deleteHoliday(fd: FormData) {
  const supabase = await createClient()
  await supabase.from('public_holidays').delete().eq('holiday_date', str(fd, 'holiday_date'))
  revalidatePath('/hr', 'layout')
}

export async function saveEmployee(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const id = str(fd, 'id')
  const roles = ['employee', ...fd.getAll('roles').map(String).filter((r) => r !== 'employee')]
  const row = {
    employee_no: str(fd, 'employee_no'),
    full_name: str(fd, 'full_name'),
    email: str(fd, 'email').toLowerCase(),
    job_title: str(fd, 'job_title') || null,
    department_id: str(fd, 'department_id') || null,
    manager_id: str(fd, 'manager_id') || null,
    hire_date: str(fd, 'hire_date'),
    phone: str(fd, 'phone') || null,
    roles,
  }
  if (!row.employee_no || !row.full_name || !row.email || !row.hire_date)
    return { error: 'Employee no., name, email and hire date are required.' }
  const q = id
    ? supabase.from('employees').update(row).eq('id', id).select('id').single()
    : supabase.from('employees').insert(row).select('id').single()
  const { data, error } = await q
  if (error) return { error: error.code === '23505' ? 'That employee no. or email is already in use.' : error.message }
  if (!id) {
    const year = Number(new Date().getFullYear())
    await supabase.rpc('hr_generate_entitlements', { p_year: year })
  }
  revalidatePath('/', 'layout')
  return { ok: id ? 'Employee updated.' : 'Employee added with pro-rated entitlements.', id: data.id }
}

export async function createLogin(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('hr_create_login', {
    p_emp: str(fd, 'employee_id'),
    p_password: String(fd.get('password') ?? ''),
  })
  if (error) return { error: friendly(error.message) }
  revalidatePath('/', 'layout')
  return { ok: 'Sign-in created. Share the temporary password securely and ask them to change it under Profile.' }
}

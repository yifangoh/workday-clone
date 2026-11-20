import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function csv(rows: (string | number | null | undefined)[][]) {
  return rows
    .map((r) => r.map((v) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(','))
    .join('\r\n')
}

function monthRange(month: string | null) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return null
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const sp = req.nextUrl.searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { data: emps } = await supabase.from('employees').select('id, employee_no, full_name, department_id, departments!employees_department_id_fkey(name)')
  const emp = new Map((emps ?? []).map((e: any) => [e.id, e]))
  const range = monthRange(sp.get('month'))
  let rows: (string | number | null)[][] = []
  let name = kind

  if (kind === 'master-leave-record') {
    const year = Number(sp.get('year')) || new Date().getFullYear()
    let q = supabase.from('v_leave_balances').select('*').eq('year', year).order('full_name').order('sort_order')
    if (sp.get('dept')) q = q.eq('department_id', sp.get('dept')!)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    rows = [['Employee no', 'Name', 'Department', 'Year', 'Leave type', 'Entitlement', 'Adjustments', 'Taken', 'Pending', 'Balance', 'Available', 'Note'],
      ...(data ?? []).map((b: any) => [b.employee_no, b.full_name, b.department_name, b.year, b.leave_name, b.entitled, b.adjustments, b.taken, b.pending, b.balance, b.available, b.note])]
    name = `master-leave-record-${year}`
  } else if (kind === 'leave-requests') {
    let q = supabase.from('leave_requests').select('*').order('start_date')
    if (sp.get('status')) q = q.eq('status', sp.get('status')!)
    if (range) q = q.lte('start_date', range.to).gte('end_date', range.from)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    rows = [['Ref', 'Employee no', 'Name', 'Department', 'Type', 'Start', 'End', 'Half day', 'Working days', 'Status', 'Flags', 'Submitted', 'Decided', 'Decided by', 'Remark'],
      ...(data ?? []).map((r: any) => [r.ref, emp.get(r.employee_id)?.employee_no, emp.get(r.employee_id)?.full_name, emp.get(r.employee_id)?.departments?.name,
        r.leave_type, r.start_date, r.end_date, r.half_day === 'none' ? '' : r.half_day, r.days, r.status, (r.flags ?? []).join('; '),
        r.submitted_at, r.decided_at, emp.get(r.decided_by)?.full_name, r.decision_remark])]
    name = `leave-requests${range ? '-' + sp.get('month') : ''}`
  } else if (kind === 'claims') {
    let q = supabase.from('claims').select('*, claim_lines(*)').order('submitted_at')
    if (sp.get('status')) q = q.eq('status', sp.get('status')!)
    if (range) q = sp.get('status') === 'paid' ? q.gte('paid_on', range.from).lte('paid_on', range.to) : q.gte('submitted_at', range.from).lte('submitted_at', range.to + 'T23:59:59+08:00')
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    rows = [['Claim ref', 'Employee no', 'Name', 'Department', 'Status', 'Line', 'Expense date', 'Type', 'Description', 'Receipt no', 'Amount (SGD)', 'Claim total', 'Approved by', 'Payment ref', 'Paid on'],
      ...(data ?? []).flatMap((c: any) => (c.claim_lines ?? []).sort((a: any, b: any) => a.line_no - b.line_no).map((l: any) => [
        c.ref, emp.get(c.employee_id)?.employee_no, emp.get(c.employee_id)?.full_name, emp.get(c.employee_id)?.departments?.name, c.status,
        l.line_no, l.expense_date, l.claim_type, l.description, l.receipt_no, l.amount, c.total_amount, emp.get(c.decided_by)?.full_name, c.payment_ref, c.paid_on]))]
    name = `claims${sp.get('status') ? '-' + sp.get('status') : ''}${range ? '-' + sp.get('month') : ''}`
  } else {
    return NextResponse.json({ error: 'Unknown export' }, { status: 404 })
  }

  return new NextResponse('﻿' + csv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

export type AppRole = 'employee' | 'manager' | 'hr' | 'office_manager' | 'finance' | 'director' | 'admin'
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type ClaimStatus = 'pending' | 'submitted_to_finance' | 'rejected' | 'paid' | 'returned' | 'cancelled'
export type HalfDay = 'none' | 'am' | 'pm'

export interface Department {
  id: string
  code: string
  name: string
  head_id: string | null
}

export interface Employee {
  id: string
  auth_user_id: string | null
  employee_no: string
  full_name: string
  email: string
  job_title: string | null
  department_id: string | null
  manager_id: string | null
  hire_date: string
  roles: AppRole[]
  is_active: boolean
  phone: string | null
  location: string
}

export interface Me extends Employee {
  department: Department | null
  manager: Pick<Employee, 'id' | 'full_name' | 'job_title'> | null
  isHeadOf: Department[]
  directReportCount: number
}

export interface LeaveType {
  code: string
  name: string
  default_days: number
  is_paid: boolean
  tracks_balance: boolean
  requires_document: boolean
  document_label: string | null
  allow_backdate: boolean
  min_notice_days: number
  counts_toward: string | null
  requires_exhausted: string | null
  allow_half_day: boolean
  color: string
  sort_order: number
}

export interface LeaveBalance {
  employee_id: string
  full_name: string
  employee_no: string
  department_id: string | null
  department_name: string | null
  leave_type: string
  leave_name: string
  color: string
  sort_order: number
  year: number
  entitled: number
  taken: number
  adjustments: number
  pending: number
  balance: number
  available: number
  note: string | null
}

export interface Clash {
  ref: string
  name: string
  start_date: string
  end_date: string
  status: LeaveStatus
  leave_type: string
}

export interface LeaveRequest {
  id: string
  ref: string
  employee_id: string
  leave_type: string
  start_date: string
  end_date: string
  half_day: HalfDay
  days: number
  reason: string | null
  document_ref: string | null
  status: LeaveStatus
  approver_id: string | null
  original_approver_id: string | null
  flags: string[]
  clash_with: Clash[]
  balance_before: number | null
  balance_after: number | null
  submitted_at: string
  decided_by: string | null
  decided_at: string | null
  decision_remark: string | null
  reminder_sent_at: string | null
  escalated_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
}

export interface ClaimType {
  code: string
  name: string
  per_line_limit: number | null
  receipt_required: boolean
  sort_order: number
}

export interface ClaimLine {
  id: string
  claim_id: string
  line_no: number
  expense_date: string
  claim_type: string
  description: string
  amount: number
  receipt_no: string | null
  attachment_path: string | null
}

export interface Claim {
  id: string
  ref: string
  employee_id: string
  title: string
  total_amount: number
  currency: string
  status: ClaimStatus
  declaration: boolean
  flags: string[]
  approver_id: string | null
  original_approver_id: string | null
  submitted_at: string
  decided_by: string | null
  decided_at: string | null
  decision_remark: string | null
  finance_by: string | null
  finance_at: string | null
  finance_remark: string | null
  paid_on: string | null
  payment_ref: string | null
  reminder_sent_at: string | null
  escalated_at: string | null
}

export interface Notification {
  id: string
  kind: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

export interface AuditEntry {
  id: number
  entity_type: string
  entity_id: string | null
  action: string
  actor_id: string | null
  detail: Record<string, unknown>
  created_at: string
}

export interface LeavePreview {
  errors: string[]
  flags: string[]
  days: number
  year?: number
  balance_before?: number | null
  balance_after?: number | null
  tracks_balance?: boolean
  clashes: Clash[]
  approver_id?: string | null
}

export type ActionState = { error?: string; ok?: string; id?: string } | undefined

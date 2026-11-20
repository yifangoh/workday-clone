-- =====================================================================
-- Workpath (Workday-style HR portal) — core schema
-- Covers Activity 1.1 / 1.2: leave application, approval & tracking
-- (Master Leave Record) and staff expense claims through to Finance payment.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Enums ----------
create type public.app_role as enum
  ('employee', 'manager', 'hr', 'office_manager', 'finance', 'director', 'admin');

create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create type public.half_day as enum ('none', 'am', 'pm');

-- pending -> (approved by Dept Head) submitted_to_finance -> paid | returned
-- pending -> rejected | cancelled
create type public.claim_status as enum
  ('pending', 'submitted_to_finance', 'rejected', 'paid', 'returned', 'cancelled');

-- ---------- Organisation ----------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  head_id     uuid,
  created_at  timestamptz not null default now()
);

create table public.employees (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users (id) on delete set null,
  employee_no   text not null unique,
  full_name     text not null,
  email         text not null unique,
  job_title     text,
  department_id uuid references public.departments (id),
  manager_id    uuid references public.employees (id),   -- supervisor / approver
  hire_date     date not null,
  end_date      date,
  roles         public.app_role[] not null default '{employee}',
  is_active     boolean not null default true,
  phone         text,
  location      text not null default 'Singapore',
  created_at    timestamptz not null default now(),
  constraint employees_not_own_manager check (manager_id is null or manager_id <> id)
);
create index employees_department_idx on public.employees (department_id);
create index employees_manager_idx on public.employees (manager_id);

alter table public.departments
  add constraint departments_head_fk foreign key (head_id) references public.employees (id);

-- ---------- Calendar ----------
create table public.public_holidays (
  holiday_date date primary key,
  name         text not null,
  country      text not null default 'SG',
  is_in_lieu   boolean not null default false
);

-- ---------- Leave policy ----------
create table public.leave_types (
  code                text primary key,
  name                text not null,
  default_days        numeric(5,1) not null default 0,   -- contract entitlement per year
  is_paid             boolean not null default true,
  tracks_balance      boolean not null default true,     -- false = unlimited (e.g. unpaid)
  requires_document   boolean not null default false,
  document_label      text,                              -- e.g. 'MC number'
  prorate_for_joiners boolean not null default true,
  allow_backdate      boolean not null default false,    -- sick leave can be applied after the fact
  min_notice_days     int not null default 0,            -- below this = "Short notice" flag
  counts_toward       text references public.leave_types (code),  -- SL counts toward HL cap
  requires_exhausted  text references public.leave_types (code),  -- UL only once AL is used up
  allow_half_day      boolean not null default true,
  color               text not null default '#0875e1',
  sort_order          int not null default 0,
  is_active           boolean not null default true
);

-- Contract entitlement per employee per year (pro-rated for joiners)
create table public.leave_entitlements (
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type  text not null references public.leave_types (code),
  year        int  not null,
  days        numeric(5,1) not null check (days >= 0),
  note        text,
  updated_at  timestamptz not null default now(),
  primary key (employee_id, leave_type, year)
);

create sequence public.leave_ref_seq;

create table public.leave_requests (
  id                   uuid primary key default gen_random_uuid(),
  ref                  text not null unique,                       -- LV-2026-0001
  employee_id          uuid not null references public.employees (id),
  leave_type           text not null references public.leave_types (code),
  start_date           date not null,
  end_date             date not null,
  half_day             public.half_day not null default 'none',
  days                 numeric(5,1) not null check (days > 0),     -- working days
  reason               text,
  document_ref         text,                                       -- MC number etc.
  status               public.leave_status not null default 'pending',
  approver_id          uuid references public.employees (id),      -- current approver
  original_approver_id uuid references public.employees (id),      -- set when escalated
  flags                text[] not null default '{}',               -- Short notice, Team clash
  clash_with           jsonb not null default '[]',
  balance_before       numeric(5,1),
  balance_after        numeric(5,1),
  submitted_at         timestamptz not null default now(),
  decided_by           uuid references public.employees (id),
  decided_at           timestamptz,
  decision_remark      text,
  reminder_sent_at     timestamptz,
  escalated_at         timestamptz,
  cancelled_at         timestamptz,
  cancel_reason        text,
  constraint leave_dates_ok check (end_date >= start_date),
  constraint leave_same_year check (extract(year from start_date) = extract(year from end_date))
);
create index leave_requests_employee_idx on public.leave_requests (employee_id, start_date);
create index leave_requests_approver_idx on public.leave_requests (approver_id) where status = 'pending';
create index leave_requests_dates_idx on public.leave_requests (start_date, end_date);

-- Master Leave Record: every posting against a balance.
-- balance = contract entitlement + sum(ledger.days)   (taken days are negative)
create table public.leave_ledger (
  id          bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type  text not null references public.leave_types (code),
  year        int  not null,
  days        numeric(5,1) not null,
  entry_type  text not null check (entry_type in ('approved', 'reversal', 'adjustment')),
  request_id  uuid references public.leave_requests (id),
  note        text,
  created_by  uuid references public.employees (id),
  created_at  timestamptz not null default now()
);
create index leave_ledger_balance_idx on public.leave_ledger (employee_id, leave_type, year);
create index leave_ledger_request_idx on public.leave_ledger (request_id);

-- ---------- Claims ----------
create table public.claim_types (
  code             text primary key,
  name             text not null,
  per_line_limit   numeric(10,2),          -- above this = "Over limit" flag
  receipt_required boolean not null default true,
  sort_order       int not null default 0,
  is_active        boolean not null default true
);

create sequence public.claim_ref_seq;

create table public.claims (
  id                   uuid primary key default gen_random_uuid(),
  ref                  text not null unique,                       -- CL-2026-0001
  employee_id          uuid not null references public.employees (id),
  title                text not null,
  total_amount         numeric(12,2) not null default 0,
  currency             text not null default 'SGD',
  status               public.claim_status not null default 'pending',
  declaration          boolean not null default false,
  flags                text[] not null default '{}',
  approver_id          uuid references public.employees (id),
  original_approver_id uuid references public.employees (id),
  submitted_at         timestamptz not null default now(),
  decided_by           uuid references public.employees (id),
  decided_at           timestamptz,
  decision_remark      text,
  finance_by           uuid references public.employees (id),
  finance_at           timestamptz,
  finance_remark       text,
  paid_on              date,
  payment_ref          text,
  reminder_sent_at     timestamptz,
  escalated_at         timestamptz,
  cancelled_at         timestamptz
);
create index claims_employee_idx on public.claims (employee_id, submitted_at desc);
create index claims_approver_idx on public.claims (approver_id) where status = 'pending';
create index claims_status_idx on public.claims (status);

create table public.claim_lines (
  id              uuid primary key default gen_random_uuid(),
  claim_id        uuid not null references public.claims (id) on delete cascade,
  line_no         int not null,
  expense_date    date not null,
  claim_type      text not null references public.claim_types (code),
  description     text not null,
  amount          numeric(10,2) not null check (amount > 0),
  receipt_no      text,
  attachment_path text,
  unique (claim_id, line_no)
);
create index claim_lines_receipt_idx on public.claim_lines (receipt_no);

-- ---------- Notifications & audit ----------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.employees (id) on delete cascade,
  kind         text not null,
  title        text not null,
  body         text,
  link         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

create table public.audit_log (
  id          bigint generated always as identity primary key,
  entity_type text not null,       -- leave | claim | entitlement | employee | holiday | system
  entity_id   uuid,
  action      text not null,
  actor_id    uuid references public.employees (id),
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at);

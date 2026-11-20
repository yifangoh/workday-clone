-- Hardening after advisor review.

-- 1) Balance helpers take any employee id, so they must not be callable from the API.
--    The Master Leave Record view now computes pending days itself.
create or replace view public.v_leave_balances with (security_invoker = true) as
with posted as (
  select employee_id, leave_type, year,
         coalesce(-sum(days) filter (where entry_type in ('approved', 'reversal')), 0) as taken,
         coalesce(sum(days) filter (where entry_type = 'adjustment'), 0) as adjustments,
         coalesce(sum(days), 0) as net
  from public.leave_ledger group by employee_id, leave_type, year
),
pend as (
  select employee_id, leave_type, extract(year from start_date)::int as year, sum(days) as pending
  from public.leave_requests where status = 'pending'
  group by employee_id, leave_type, extract(year from start_date)
)
select
  en.employee_id, e.full_name, e.employee_no, e.department_id, d.name as department_name,
  en.leave_type, t.name as leave_name, t.color, t.sort_order, en.year,
  en.days as entitled,
  coalesce(p.taken, 0) as taken,
  coalesce(p.adjustments, 0) as adjustments,
  coalesce(q.pending, 0) as pending,
  en.days + coalesce(p.net, 0) as balance,
  en.days + coalesce(p.net, 0) - coalesce(q.pending, 0) as available,
  en.note
from public.leave_entitlements en
join public.employees e on e.id = en.employee_id
left join public.departments d on d.id = e.department_id
join public.leave_types t on t.code = en.leave_type
left join posted p on p.employee_id = en.employee_id and p.leave_type = en.leave_type and p.year = en.year
left join pend q on q.employee_id = en.employee_id and q.leave_type = en.leave_type and q.year = en.year;

revoke execute on function public.leave_balance(uuid, text, int) from authenticated;
revoke execute on function public.leave_pending(uuid, text, int, uuid) from authenticated;
revoke execute on function public.leave_used(uuid, text, int) from authenticated;
revoke execute on function public.resolve_approver(uuid) from authenticated;

-- 2) One permissive SELECT policy per table (split FOR ALL write policies).
drop policy "hr writes departments" on public.departments;
create policy "hr inserts departments" on public.departments for insert to authenticated
  with check (public.has_any_role(array['hr','admin']::public.app_role[]));
create policy "hr updates departments" on public.departments for update to authenticated
  using (public.has_any_role(array['hr','admin']::public.app_role[]))
  with check (public.has_any_role(array['hr','admin']::public.app_role[]));

drop policy "hr writes holidays" on public.public_holidays;
create policy "hr inserts holidays" on public.public_holidays for insert to authenticated
  with check (public.has_any_role(array['hr','admin']::public.app_role[]));
create policy "hr updates holidays" on public.public_holidays for update to authenticated
  using (public.has_any_role(array['hr','admin']::public.app_role[]))
  with check (public.has_any_role(array['hr','admin']::public.app_role[]));
create policy "hr deletes holidays" on public.public_holidays for delete to authenticated
  using (public.has_any_role(array['hr','admin']::public.app_role[]));

drop policy "hr writes leave types" on public.leave_types;
create policy "hr inserts leave types" on public.leave_types for insert to authenticated
  with check (public.has_any_role(array['hr','admin']::public.app_role[]));
create policy "hr updates leave types" on public.leave_types for update to authenticated
  using (public.has_any_role(array['hr','admin']::public.app_role[]))
  with check (public.has_any_role(array['hr','admin']::public.app_role[]));

drop policy "finance writes claim types" on public.claim_types;
create policy "finance inserts claim types" on public.claim_types for insert to authenticated
  with check (public.has_any_role(array['finance','hr','admin']::public.app_role[]));
create policy "finance updates claim types" on public.claim_types for update to authenticated
  using (public.has_any_role(array['finance','hr','admin']::public.app_role[]))
  with check (public.has_any_role(array['finance','hr','admin']::public.app_role[]));

-- 3) Covering indexes for foreign keys.
create index if not exists audit_log_actor_idx            on public.audit_log (actor_id);
create index if not exists claim_lines_type_idx           on public.claim_lines (claim_type);
create index if not exists claims_decided_by_idx          on public.claims (decided_by);
create index if not exists claims_finance_by_idx          on public.claims (finance_by);
create index if not exists claims_original_approver_idx   on public.claims (original_approver_id);
create index if not exists departments_head_idx           on public.departments (head_id);
create index if not exists leave_entitlements_type_idx    on public.leave_entitlements (leave_type);
create index if not exists leave_ledger_created_by_idx    on public.leave_ledger (created_by);
create index if not exists leave_ledger_type_idx          on public.leave_ledger (leave_type);
create index if not exists leave_requests_decided_by_idx  on public.leave_requests (decided_by);
create index if not exists leave_requests_type_idx        on public.leave_requests (leave_type);
create index if not exists leave_requests_orig_appr_idx   on public.leave_requests (original_approver_id);
create index if not exists leave_types_counts_toward_idx  on public.leave_types (counts_toward);
create index if not exists leave_types_requires_exh_idx   on public.leave_types (requires_exhausted);

-- 4) Wording: "requires an MC number".
update public.leave_types set document_label = 'an MC number' where code = 'SL';
update public.leave_types set document_label = 'a hospital MC number' where code = 'HL';

do $$
begin
  execute replace(pg_get_functiondef('public._validate_leave(uuid,text,date,date,public.half_day,text,uuid)'::regprocedure),
    $q$format('%s requires a %s.', lt.name, coalesce(lt.document_label, 'supporting document'))$q$,
    $q$format('%s requires %s.', lt.name, coalesce(lt.document_label, 'a supporting document'))$q$);
end $$;

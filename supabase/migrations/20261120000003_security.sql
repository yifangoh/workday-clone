-- =====================================================================
-- Row Level Security. Reads are filtered by role; all writes to leave and
-- claims go through the security-definer RPCs in the previous migration.
-- =====================================================================

alter table public.departments        enable row level security;
alter table public.employees          enable row level security;
alter table public.public_holidays    enable row level security;
alter table public.leave_types        enable row level security;
alter table public.leave_entitlements enable row level security;
alter table public.leave_requests     enable row level security;
alter table public.leave_ledger       enable row level security;
alter table public.claim_types        enable row level security;
alter table public.claims             enable row level security;
alter table public.claim_lines        enable row level security;
alter table public.notifications      enable row level security;
alter table public.audit_log          enable row level security;

-- Reference data: everyone signed in can read; HR/admin maintain.
create policy "read departments" on public.departments for select to authenticated using (true);
create policy "hr writes departments" on public.departments for all to authenticated
  using (public.has_any_role(array['hr','admin']::public.app_role[]))
  with check (public.has_any_role(array['hr','admin']::public.app_role[]));

create policy "read directory" on public.employees for select to authenticated using (true);
create policy "hr inserts employees" on public.employees for insert to authenticated
  with check (public.has_any_role(array['hr','admin']::public.app_role[]));
create policy "hr updates employees" on public.employees for update to authenticated
  using (public.has_any_role(array['hr','admin']::public.app_role[]))
  with check (public.has_any_role(array['hr','admin']::public.app_role[]));

create policy "read holidays" on public.public_holidays for select to authenticated using (true);
create policy "hr writes holidays" on public.public_holidays for all to authenticated
  using (public.has_any_role(array['hr','admin']::public.app_role[]))
  with check (public.has_any_role(array['hr','admin']::public.app_role[]));

create policy "read leave types" on public.leave_types for select to authenticated using (true);
create policy "hr writes leave types" on public.leave_types for all to authenticated
  using (public.has_any_role(array['hr','admin']::public.app_role[]))
  with check (public.has_any_role(array['hr','admin']::public.app_role[]));

create policy "read claim types" on public.claim_types for select to authenticated using (true);
create policy "finance writes claim types" on public.claim_types for all to authenticated
  using (public.has_any_role(array['finance','hr','admin']::public.app_role[]))
  with check (public.has_any_role(array['finance','hr','admin']::public.app_role[]));

-- Personal leave data: self, supervisor, department head, HR / Office Manager / Director.
create policy "view entitlements" on public.leave_entitlements for select to authenticated
  using (public.can_view_employee(employee_id));

create policy "view ledger" on public.leave_ledger for select to authenticated
  using (public.can_view_employee(employee_id));

create policy "view leave requests" on public.leave_requests for select to authenticated
  using (
    public.can_view_employee(employee_id)
    or approver_id = public.current_employee_id()
    or original_approver_id = public.current_employee_id()
  );

-- Claims: self, approver, supervisor/head, Finance and HR.
create policy "view claims" on public.claims for select to authenticated
  using (
    public.can_view_employee(employee_id)
    or approver_id = public.current_employee_id()
    or original_approver_id = public.current_employee_id()
    or public.has_any_role(array['finance']::public.app_role[])
  );

create policy "view claim lines" on public.claim_lines for select to authenticated
  using (exists (select 1 from public.claims c where c.id = claim_id));

-- Notifications: own only; may mark as read.
create policy "own notifications" on public.notifications for select to authenticated
  using (recipient_id = public.current_employee_id());
create policy "mark own notifications read" on public.notifications for update to authenticated
  using (recipient_id = public.current_employee_id())
  with check (recipient_id = public.current_employee_id());

-- Audit trail: visible to whoever can see the underlying record.
create policy "view audit trail" on public.audit_log for select to authenticated
  using (
    public.has_any_role(array['hr','admin']::public.app_role[])
    or (entity_type = 'leave' and exists (select 1 from public.leave_requests r where r.id = entity_id))
    or (entity_type = 'claim' and exists (select 1 from public.claims c where c.id = entity_id))
  );

-- ---------- Function privileges ----------
-- Internal functions (explicit actor) must never be callable from the API.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like '\_%' or p.proname in ('process_pending_reminders', 'link_auth_user_to_employee'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- Public RPCs: signed-in users only.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname not like '\_%'
      and p.proname not in ('process_pending_reminders', 'link_auth_user_to_employee')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- Anonymous visitors get nothing from these tables.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ---------- Receipt attachments (private bucket) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "upload own receipts" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "read receipts on visible claims" on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.claim_lines cl where cl.attachment_path = name)
    )
  );

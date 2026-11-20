-- =====================================================================
-- Business rules. All writes to leave/claims go through these functions so
-- validation, routing, balance posting, notification and audit happen in one
-- transaction (no re-keying, no partial saves).
--   _internal functions take an explicit actor (used by seed/tests/cron).
--   public wrappers resolve the actor from the signed-in user.
-- =====================================================================

-- ---------- Helpers ----------
create or replace function public.sg_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Singapore')::date
$$;

create or replace function public.current_employee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.employees where auth_user_id = auth.uid() and is_active
$$;

create or replace function public.has_any_role(p_roles public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees
    where auth_user_id = auth.uid() and is_active and roles && p_roles
  )
$$;

-- True when the signed-in user may see this employee's HR records:
-- self, their supervisor, their department head, or HR / Office Manager / Director / Admin.
create or replace function public.can_view_employee(p_emp uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.employees me
    join public.employees e on e.id = p_emp
    left join public.departments d on d.id = e.department_id
    where me.auth_user_id = auth.uid() and me.is_active
      and (
        e.id = me.id
        or e.manager_id = me.id
        or d.head_id = me.id
        or me.roles && array['hr','office_manager','director','admin']::public.app_role[]
      )
  )
$$;

-- Working days between two dates (inclusive), excluding weekends and public holidays.
create or replace function public.working_days(p_start date, p_end date, p_half public.half_day default 'none')
returns numeric language sql stable set search_path = public as $$
  select case
    when p_start is null or p_end is null or p_end < p_start then 0
    when p_half <> 'none' and p_start = p_end then
      case when extract(isodow from p_start) < 6
            and not exists (select 1 from public.public_holidays h where h.holiday_date = p_start)
           then 0.5 else 0 end
    else (
      select count(*)::numeric
      from generate_series(p_start, p_end, interval '1 day') g(d)
      where extract(isodow from g.d) < 6
        and not exists (select 1 from public.public_holidays h where h.holiday_date = g.d::date)
    )
  end
$$;

-- Contract entitlement + all postings. NULL when no entitlement row exists.
create or replace function public.leave_balance(p_emp uuid, p_type text, p_year int)
returns numeric language sql stable security definer set search_path = public as $$
  select e.days + coalesce((
    select sum(l.days) from public.leave_ledger l
    where l.employee_id = p_emp and l.leave_type = p_type and l.year = p_year), 0)
  from public.leave_entitlements e
  where e.employee_id = p_emp and e.leave_type = p_type and e.year = p_year
$$;

create or replace function public.leave_pending(p_emp uuid, p_type text, p_year int, p_exclude uuid default null)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(days), 0) from public.leave_requests
  where employee_id = p_emp and leave_type = p_type and status = 'pending'
    and extract(year from start_date) = p_year
    and (p_exclude is null or id <> p_exclude)
$$;

-- Days approved (net of reversals) for a type in a year.
create or replace function public.leave_used(p_emp uuid, p_type text, p_year int)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(-sum(days), 0) from public.leave_ledger
  where employee_id = p_emp and leave_type = p_type and year = p_year
    and entry_type in ('approved', 'reversal')
$$;

-- Who approves for this person: supervisor -> department head -> a director -> HR.
create or replace function public.resolve_approver(p_emp uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees;
  v uuid;
begin
  select * into e from public.employees where id = p_emp;
  if not found then return null; end if;

  select m.id into v from public.employees m
  where m.id = e.manager_id and m.is_active and m.id <> p_emp;
  if v is not null then return v; end if;

  select d.head_id into v from public.departments d
  join public.employees h on h.id = d.head_id and h.is_active
  where d.id = e.department_id and d.head_id <> p_emp;
  if v is not null then return v; end if;

  select id into v from public.employees
  where is_active and id <> p_emp and 'director' = any(roles) order by hire_date limit 1;
  if v is not null then return v; end if;

  select id into v from public.employees
  where is_active and id <> p_emp and roles && array['hr','admin']::public.app_role[]
  order by hire_date limit 1;
  return v;
end $$;

create or replace function public._notify(p_to uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (recipient_id, kind, title, body, link)
  select p_to, p_kind, p_title, p_body, p_link where p_to is not null
$$;

create or replace function public._notify_role(p_role public.app_role, p_kind text, p_title text, p_body text, p_link text, p_except uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (recipient_id, kind, title, body, link)
  select id, p_kind, p_title, p_body, p_link from public.employees
  where is_active and p_role = any(roles) and (p_except is null or id <> p_except)
$$;

create or replace function public._audit(p_type text, p_id uuid, p_action text, p_actor uuid, p_detail jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (entity_type, entity_id, action, actor_id, detail)
  values (p_type, p_id, p_action, p_actor, coalesce(p_detail, '{}'::jsonb))
$$;

create or replace function public._fmt_range(p_start date, p_end date)
returns text language sql immutable set search_path = public as $$
  select case when p_start = p_end then to_char(p_start, 'DD Mon YYYY')
              else to_char(p_start, 'DD Mon') || ' – ' || to_char(p_end, 'DD Mon YYYY') end
$$;

-- ---------- Entitlements ----------
-- Pro-rated contract entitlement: joiners in the year get (months remaining / 12),
-- rounded to the nearest half day. E.g. July joiner, AL 14 -> 7.
create or replace function public.prorated_days(p_default numeric, p_hire date, p_year int, p_prorate boolean)
returns numeric language sql immutable set search_path = public as $$
  select case
    when not p_prorate or p_hire is null or extract(year from p_hire) < p_year then p_default
    when extract(year from p_hire) > p_year then 0
    else round(p_default * (13 - extract(month from p_hire)) / 12 * 2) / 2
  end
$$;

create or replace function public._generate_entitlements(p_year int, p_actor uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.leave_entitlements (employee_id, leave_type, year, days, note)
  select e.id, t.code, p_year,
         public.prorated_days(t.default_days, e.hire_date, p_year, t.prorate_for_joiners),
         case when extract(year from e.hire_date) = p_year and t.prorate_for_joiners
              then 'Pro-rated from hire date ' || to_char(e.hire_date, 'DD Mon YYYY') end
  from public.employees e cross join public.leave_types t
  where e.is_active and t.is_active and t.tracks_balance
    and extract(year from e.hire_date) <= p_year
  on conflict do nothing;
  get diagnostics n = row_count;
  perform public._audit('entitlement', null, 'generated', p_actor, jsonb_build_object('year', p_year, 'rows', n));
  return n;
end $$;

-- ---------- Leave validation (shared by preview, submit and approve) ----------
create or replace function public._validate_leave(
  p_emp uuid, p_type text, p_start date, p_end date,
  p_half public.half_day default 'none', p_document text default null, p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e  public.employees;
  lt public.leave_types;
  v_errors  text[] := '{}';
  v_flags   text[] := '{}';
  v_days    numeric := 0;
  v_year    int;
  v_bal     numeric;
  v_avail   numeric;
  v_cap     text;
  v_cap_ent numeric;
  v_cap_use numeric;
  v_ex      numeric;
  v_overlap text;
  v_clashes jsonb := '[]';
  v_today   date := public.sg_today();
begin
  select * into e from public.employees where id = p_emp;
  if not found then
    return jsonb_build_object('errors', jsonb_build_array('Your sign-in is not linked to an employee record.'),
                              'flags', '[]'::jsonb, 'days', 0, 'clashes', '[]'::jsonb);
  end if;

  select * into lt from public.leave_types where code = p_type and is_active;
  if not found then v_errors := array_append(v_errors, 'Choose a valid leave type.'); end if;

  if p_start is null or p_end is null then
    v_errors := array_append(v_errors, 'Start and end dates are required.');
  elsif p_end < p_start then
    v_errors := array_append(v_errors, 'End date must be on or after the start date.');
  end if;

  if array_length(v_errors, 1) > 0 and (p_start is null or p_end is null or p_end < p_start) then
    return jsonb_build_object('errors', to_jsonb(v_errors), 'flags', '[]'::jsonb, 'days', 0, 'clashes', '[]'::jsonb);
  end if;

  if extract(year from p_start) <> extract(year from p_end) then
    v_errors := array_append(v_errors, 'Leave cannot span two calendar years. Submit one request per year.');
  end if;
  v_year := extract(year from p_start)::int;

  if p_half <> 'none' and p_start <> p_end then
    v_errors := array_append(v_errors, 'Half-day leave must start and end on the same day.');
  end if;
  if p_half <> 'none' and lt.code is not null and not lt.allow_half_day then
    v_errors := array_append(v_errors, format('%s cannot be taken as a half day.', lt.name));
  end if;

  v_days := public.working_days(p_start, p_end, case when p_start = p_end then p_half else 'none' end);
  if v_days = 0 then
    v_errors := array_append(v_errors, 'The selected dates fall only on weekends or public holidays, so no leave is needed.');
  end if;

  if p_start < e.hire_date then
    v_errors := array_append(v_errors, 'Leave cannot start before your hire date.');
  end if;

  if lt.code is not null then
    if not lt.allow_backdate and p_start < v_today then
      v_errors := array_append(v_errors, format('%s cannot start in the past.', lt.name));
    end if;
    if lt.requires_document and coalesce(btrim(p_document), '') = '' then
      v_errors := array_append(v_errors, format('%s requires %s.', lt.name, coalesce(lt.document_label, 'a supporting document')));
    end if;
  end if;

  -- Own overlapping requests
  select string_agg(r.ref, ', ' order by r.start_date) into v_overlap
  from public.leave_requests r
  where r.employee_id = p_emp and r.status in ('pending', 'approved')
    and (p_exclude is null or r.id <> p_exclude)
    and r.start_date <= p_end and r.end_date >= p_start;
  if v_overlap is not null then
    v_errors := array_append(v_errors, format('These dates overlap your existing request %s.', v_overlap));
  end if;

  if lt.code is not null then
    -- Balance (entitlement - approved - other pending)
    if lt.tracks_balance then
      v_bal := public.leave_balance(p_emp, lt.code, v_year);
      if v_bal is null then
        v_errors := array_append(v_errors, format('No %s entitlement is set up for %s. Please contact HR.', lt.name, v_year));
      else
        v_avail := v_bal - public.leave_pending(p_emp, lt.code, v_year, p_exclude);
        if v_days > v_avail then
          v_errors := array_append(v_errors, format('Insufficient %s balance: %s day(s) requested, %s available.', lt.name, v_days, v_avail));
        end if;
      end if;
    end if;

    -- Shared cap (sick leave counts toward the hospitalisation cap)
    v_cap := coalesce(lt.counts_toward,
                      case when exists (select 1 from public.leave_types x where x.counts_toward = lt.code) then lt.code end);
    if v_cap is not null then
      select days into v_cap_ent from public.leave_entitlements
      where employee_id = p_emp and leave_type = v_cap and year = v_year;
      if v_cap_ent is not null then
        select coalesce(sum(public.leave_used(p_emp, t.code, v_year) + public.leave_pending(p_emp, t.code, v_year, p_exclude)), 0)
          into v_cap_use
        from public.leave_types t where t.code = v_cap or t.counts_toward = v_cap;
        if v_cap_use + v_days > v_cap_ent then
          v_errors := array_append(v_errors, format(
            'Sick and hospitalisation leave share a %s-day cap; only %s day(s) remain.',
            v_cap_ent, greatest(v_cap_ent - v_cap_use, 0)));
        end if;
      end if;
    end if;

    -- Unpaid leave only after annual leave is used up
    if lt.requires_exhausted is not null then
      v_ex := coalesce(public.leave_balance(p_emp, lt.requires_exhausted, v_year), 0)
              - public.leave_pending(p_emp, lt.requires_exhausted, v_year, p_exclude);
      if v_ex > 0 then
        v_errors := array_append(v_errors, format('Use your remaining %s day(s) of %s before applying for %s.',
          v_ex, (select name from public.leave_types where code = lt.requires_exhausted), lt.name));
      end if;
    end if;

    -- Flags (shown to the approver, never block)
    if lt.min_notice_days > 0 and p_start >= v_today and (p_start - v_today) < lt.min_notice_days then
      v_flags := array_append(v_flags, 'Short notice');
    end if;
  end if;

  -- Team clash: department colleagues away on overlapping dates
  select coalesce(jsonb_agg(jsonb_build_object(
           'ref', r.ref, 'name', x.full_name, 'start_date', r.start_date, 'end_date', r.end_date,
           'status', r.status, 'leave_type', r.leave_type) order by r.start_date), '[]'::jsonb)
    into v_clashes
  from public.leave_requests r
  join public.employees x on x.id = r.employee_id
  where x.department_id = e.department_id and x.id <> p_emp
    and r.status in ('pending', 'approved')
    and (p_exclude is null or r.id <> p_exclude)
    and r.start_date <= p_end and r.end_date >= p_start;
  if jsonb_array_length(v_clashes) > 0 then
    v_flags := array_append(v_flags, 'Team clash');
  end if;

  return jsonb_build_object(
    'errors', to_jsonb(v_errors),
    'flags', to_jsonb(v_flags),
    'days', v_days,
    'year', v_year,
    'balance_before', v_avail,
    'balance_after', case when v_avail is null then null else v_avail - v_days end,
    'tracks_balance', coalesce(lt.tracks_balance, false),
    'clashes', v_clashes,
    'approver_id', public.resolve_approver(p_emp));
end $$;

-- ---------- Leave lifecycle ----------
create or replace function public._submit_leave(
  p_emp uuid, p_type text, p_start date, p_end date, p_half public.half_day,
  p_reason text, p_document text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  v_id uuid;
  v_ref text;
  v_approver uuid;
  v_name text;
  v_type text;
begin
  -- serialise submissions per employee so two tabs can't double-book a balance
  perform 1 from public.employees where id = p_emp for update;

  v := public._validate_leave(p_emp, p_type, p_start, p_end, coalesce(p_half, 'none'), p_document, null);
  if jsonb_array_length(v->'errors') > 0 then
    raise exception using errcode = 'P0001',
      message = (select string_agg(x, ' • ') from jsonb_array_elements_text(v->'errors') x);
  end if;

  v_approver := (v->>'approver_id')::uuid;
  if v_approver is null then
    raise exception 'No approver could be found for you. Please ask HR to set your supervisor.';
  end if;

  v_ref := 'LV-' || extract(year from public.sg_today())::int || '-' || lpad(nextval('public.leave_ref_seq')::text, 4, '0');

  insert into public.leave_requests (ref, employee_id, leave_type, start_date, end_date, half_day, days,
    reason, document_ref, approver_id, flags, clash_with, balance_before, balance_after)
  values (v_ref, p_emp, p_type, p_start, p_end,
    case when p_start = p_end then coalesce(p_half, 'none') else 'none' end,
    (v->>'days')::numeric, nullif(btrim(p_reason), ''), nullif(btrim(p_document), ''), v_approver,
    array(select jsonb_array_elements_text(v->'flags')), v->'clashes',
    (v->>'balance_before')::numeric, (v->>'balance_after')::numeric)
  returning id into v_id;

  select full_name into v_name from public.employees where id = p_emp;
  select name into v_type from public.leave_types where code = p_type;

  perform public._audit('leave', v_id, 'submitted', p_emp,
    jsonb_build_object('ref', v_ref, 'days', v->'days', 'flags', v->'flags', 'approver_id', v_approver));
  perform public._notify(v_approver, 'approval_request',
    format('%s requests %s', v_name, v_type),
    format('%s · %s day(s) · %s%s', v_ref, v->>'days', public._fmt_range(p_start, p_end),
      case when jsonb_array_length(v->'flags') > 0
           then ' · ⚑ ' || (select string_agg(x, ', ') from jsonb_array_elements_text(v->'flags') x) else '' end),
    '/inbox');

  return jsonb_build_object('id', v_id, 'ref', v_ref, 'days', v->'days', 'flags', v->'flags');
end $$;

create or replace function public._decide_leave(p_actor uuid, p_id uuid, p_decision text, p_remark text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.leave_requests;
  v jsonb;
  v_actor public.employees;
  v_emp_name text;
  v_type text;
begin
  select * into v_actor from public.employees where id = p_actor and is_active;
  if not found then raise exception 'Your sign-in is not linked to an employee record.'; end if;

  select * into r from public.leave_requests where id = p_id for update;
  if not found then raise exception 'Leave request not found.'; end if;
  if r.status <> 'pending' then raise exception 'This request has already been %.', r.status; end if;
  if r.employee_id = p_actor then raise exception 'You cannot approve or reject your own request.'; end if;
  if p_actor is distinct from r.approver_id and p_actor is distinct from r.original_approver_id
     and not ('admin' = any(v_actor.roles)) then
    raise exception 'Only the assigned approver can decide this request.';
  end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Decision must be approve or reject.'; end if;
  if p_decision = 'reject' and coalesce(btrim(p_remark), '') = '' then
    raise exception 'A remark is required when rejecting, so the employee knows what to change.';
  end if;

  select full_name into v_emp_name from public.employees where id = r.employee_id;
  select name into v_type from public.leave_types where code = r.leave_type;

  if p_decision = 'approve' then
    -- Re-check against the latest balance (another request may have been approved meanwhile)
    perform 1 from public.employees where id = r.employee_id for update;
    v := public._validate_leave(r.employee_id, r.leave_type, r.start_date, r.end_date, r.half_day, r.document_ref, r.id);
    -- past-start is fine at approval time (request was valid when submitted)
    if exists (select 1 from jsonb_array_elements_text(v->'errors') x
               where x not like '%cannot start in the past%') then
      raise exception using message = 'Cannot approve: ' ||
        (select string_agg(x, ' • ') from jsonb_array_elements_text(v->'errors') x
         where x not like '%cannot start in the past%');
    end if;

    update public.leave_requests
      set status = 'approved', decided_by = p_actor, decided_at = now(),
          decision_remark = nullif(btrim(p_remark), '')
      where id = r.id;

    insert into public.leave_ledger (employee_id, leave_type, year, days, entry_type, request_id, note, created_by)
    values (r.employee_id, r.leave_type, extract(year from r.start_date)::int, -r.days, 'approved', r.id,
            r.ref || ' ' || public._fmt_range(r.start_date, r.end_date), p_actor);

    perform public._audit('leave', r.id, 'approved', p_actor, jsonb_build_object('remark', p_remark,
      'balance_after', public.leave_balance(r.employee_id, r.leave_type, extract(year from r.start_date)::int)));
    perform public._audit('leave', r.id, 'recorded_in_master_leave_record', null,
      jsonb_build_object('days', -r.days, 'leave_type', r.leave_type));

    perform public._notify(r.employee_id, 'decision', format('Your %s was approved', v_type),
      format('%s · %s · approved by %s', r.ref, public._fmt_range(r.start_date, r.end_date), v_actor.full_name),
      '/time-off/' || r.id);
    perform public._notify_role('office_manager', 'leave_recorded', format('Leave approved: %s', v_emp_name),
      format('%s · %s · %s day(s) %s — posted to Master Leave Record', r.ref, public._fmt_range(r.start_date, r.end_date), r.days, v_type),
      '/hr/master-leave-record', r.employee_id);
    perform public._notify_role('hr', 'leave_recorded', format('Leave approved: %s', v_emp_name),
      format('%s · %s · %s day(s) %s', r.ref, public._fmt_range(r.start_date, r.end_date), r.days, v_type),
      '/hr/master-leave-record', r.employee_id);
  else
    update public.leave_requests
      set status = 'rejected', decided_by = p_actor, decided_at = now(), decision_remark = btrim(p_remark)
      where id = r.id;
    perform public._audit('leave', r.id, 'rejected', p_actor, jsonb_build_object('remark', p_remark));
    perform public._notify(r.employee_id, 'decision', format('Your %s was not approved', v_type),
      format('%s · %s · "%s" — %s', r.ref, public._fmt_range(r.start_date, r.end_date), btrim(p_remark), v_actor.full_name),
      '/time-off/' || r.id);
  end if;

  return jsonb_build_object('id', r.id, 'ref', r.ref, 'status', case when p_decision = 'approve' then 'approved' else 'rejected' end);
end $$;

create or replace function public._cancel_leave(p_actor uuid, p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.leave_requests;
  v_is_hr boolean;
begin
  select * into r from public.leave_requests where id = p_id for update;
  if not found then raise exception 'Leave request not found.'; end if;
  select roles && array['hr','admin']::public.app_role[] into v_is_hr from public.employees where id = p_actor;
  if r.employee_id <> p_actor and not coalesce(v_is_hr, false) then
    raise exception 'You can only cancel your own leave.';
  end if;

  if r.status = 'pending' then
    null;
  elsif r.status = 'approved' then
    if r.start_date <= public.sg_today() and not coalesce(v_is_hr, false) then
      raise exception 'Leave that has already started cannot be cancelled here. Please contact HR.';
    end if;
    insert into public.leave_ledger (employee_id, leave_type, year, days, entry_type, request_id, note, created_by)
    values (r.employee_id, r.leave_type, extract(year from r.start_date)::int, r.days, 'reversal', r.id,
            r.ref || ' cancelled', p_actor);
  else
    raise exception 'Only pending or approved leave can be cancelled (this one is %).', r.status;
  end if;

  update public.leave_requests
    set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(btrim(p_reason), '')
    where id = r.id;

  perform public._audit('leave', r.id, 'cancelled', p_actor,
    jsonb_build_object('was', r.status, 'reason', p_reason, 'reversed_days', case when r.status = 'approved' then r.days end));
  perform public._notify(coalesce(r.decided_by, r.approver_id), 'cancelled',
    format('%s was cancelled', r.ref),
    format('%s · %s', (select full_name from public.employees where id = r.employee_id), public._fmt_range(r.start_date, r.end_date)),
    '/time-off/' || r.id);
  if r.status = 'approved' then
    perform public._notify_role('office_manager', 'leave_recorded', format('Approved leave cancelled: %s', r.ref),
      format('%s day(s) returned to balance', r.days), '/hr/master-leave-record', r.employee_id);
  end if;
  return jsonb_build_object('id', r.id, 'status', 'cancelled');
end $$;

-- ---------- Claims lifecycle ----------
create or replace function public._validate_claim(p_emp uuid, p_title text, p_lines jsonb, p_declaration boolean, p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_errors text[] := '{}';
  v_flags  text[] := '{}';
  v_total  numeric := 0;
  l jsonb;
  i int := 0;
  ct public.claim_types;
  v_amt numeric;
  v_date date;
  v_dup text;
begin
  if coalesce(btrim(p_title), '') = '' then
    v_errors := array_append(v_errors, 'Give the claim a short title (e.g. "Client visit – Nov").');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    v_errors := array_append(v_errors, 'Add at least one expense line.');
  else
    for l in select * from jsonb_array_elements(p_lines) loop
      i := i + 1;
      select * into ct from public.claim_types where code = l->>'claim_type' and is_active;
      if not found then
        v_errors := array_append(v_errors, format('Line %s: choose an expense type.', i));
      end if;
      begin
        v_date := (l->>'expense_date')::date;
      exception when others then v_date := null; end;
      if v_date is null then
        v_errors := array_append(v_errors, format('Line %s: expense date is required.', i));
      elsif v_date > public.sg_today() then
        v_errors := array_append(v_errors, format('Line %s: expense date cannot be in the future.', i));
      elsif v_date < public.sg_today() - 60 and not ('Late submission' = any(v_flags)) then
        v_flags := array_append(v_flags, 'Late submission');
      end if;
      if coalesce(btrim(l->>'description'), '') = '' then
        v_errors := array_append(v_errors, format('Line %s: description is required.', i));
      end if;
      begin
        v_amt := (l->>'amount')::numeric;
      exception when others then v_amt := null; end;
      if v_amt is null or v_amt <= 0 then
        v_errors := array_append(v_errors, format('Line %s: amount must be more than 0.', i));
      else
        v_total := v_total + round(v_amt, 2);
        if ct.code is not null and ct.per_line_limit is not null and v_amt > ct.per_line_limit
           and not ('Over limit' = any(v_flags)) then
          v_flags := array_append(v_flags, 'Over limit');
        end if;
      end if;
      if ct.code is not null and ct.receipt_required and coalesce(btrim(l->>'receipt_no'), '') = '' then
        v_errors := array_append(v_errors, format('Line %s: receipt number is required for %s.', i, ct.name));
      end if;
      if coalesce(btrim(l->>'receipt_no'), '') <> '' then
        select c.ref into v_dup from public.claim_lines cl join public.claims c on c.id = cl.claim_id
        where c.employee_id = p_emp and lower(btrim(cl.receipt_no)) = lower(btrim(l->>'receipt_no'))
          and c.status not in ('rejected', 'cancelled', 'returned')
          and (p_exclude is null or c.id <> p_exclude)
        limit 1;
        if v_dup is not null then
          v_errors := array_append(v_errors, format('Line %s: receipt %s was already claimed in %s.', i, l->>'receipt_no', v_dup));
        end if;
      end if;
    end loop;
  end if;
  if not coalesce(p_declaration, false) then
    v_errors := array_append(v_errors, 'Tick the declaration to confirm the expenses are genuine and business-related.');
  end if;
  return jsonb_build_object('errors', to_jsonb(v_errors), 'flags', to_jsonb(v_flags), 'total', v_total,
                            'approver_id', public.resolve_approver(p_emp));
end $$;

create or replace function public._submit_claim(p_emp uuid, p_title text, p_lines jsonb, p_declaration boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  v_id uuid;
  v_ref text;
  v_approver uuid;
  l jsonb;
  i int := 0;
begin
  v := public._validate_claim(p_emp, p_title, p_lines, p_declaration);
  if jsonb_array_length(v->'errors') > 0 then
    raise exception using errcode = 'P0001',
      message = (select string_agg(x, ' • ') from jsonb_array_elements_text(v->'errors') x);
  end if;
  v_approver := (v->>'approver_id')::uuid;
  if v_approver is null then raise exception 'No approver could be found for you. Please ask HR to set your supervisor.'; end if;

  v_ref := 'CL-' || extract(year from public.sg_today())::int || '-' || lpad(nextval('public.claim_ref_seq')::text, 4, '0');
  insert into public.claims (ref, employee_id, title, total_amount, declaration, flags, approver_id)
  values (v_ref, p_emp, btrim(p_title), (v->>'total')::numeric, true,
          array(select jsonb_array_elements_text(v->'flags')), v_approver)
  returning id into v_id;

  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into public.claim_lines (claim_id, line_no, expense_date, claim_type, description, amount, receipt_no, attachment_path)
    values (v_id, i, (l->>'expense_date')::date, l->>'claim_type', btrim(l->>'description'),
            round((l->>'amount')::numeric, 2), nullif(btrim(l->>'receipt_no'), ''), nullif(l->>'attachment_path', ''));
  end loop;

  perform public._audit('claim', v_id, 'submitted', p_emp, jsonb_build_object('ref', v_ref, 'total', v->'total', 'flags', v->'flags'));
  perform public._notify(v_approver, 'approval_request',
    format('%s submitted an expense claim', (select full_name from public.employees where id = p_emp)),
    format('%s · %s · SGD %s%s', v_ref, btrim(p_title), to_char((v->>'total')::numeric, 'FM999,990.00'),
      case when jsonb_array_length(v->'flags') > 0
           then ' · ⚑ ' || (select string_agg(x, ', ') from jsonb_array_elements_text(v->'flags') x) else '' end),
    '/inbox');
  return jsonb_build_object('id', v_id, 'ref', v_ref, 'total', v->'total');
end $$;

create or replace function public._decide_claim(p_actor uuid, p_id uuid, p_decision text, p_remark text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.claims;
  v_actor public.employees;
begin
  select * into v_actor from public.employees where id = p_actor and is_active;
  if not found then raise exception 'Your sign-in is not linked to an employee record.'; end if;
  select * into c from public.claims where id = p_id for update;
  if not found then raise exception 'Claim not found.'; end if;
  if c.status <> 'pending' then raise exception 'This claim is no longer pending (status: %).', replace(c.status::text, '_', ' '); end if;
  if c.employee_id = p_actor then raise exception 'You cannot approve or reject your own claim.'; end if;
  if p_actor is distinct from c.approver_id and p_actor is distinct from c.original_approver_id
     and not ('admin' = any(v_actor.roles)) then
    raise exception 'Only the assigned approver can decide this claim.';
  end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Decision must be approve or reject.'; end if;
  if p_decision = 'reject' and coalesce(btrim(p_remark), '') = '' then
    raise exception 'A remark is required when rejecting a claim.';
  end if;

  update public.claims set
    status = case when p_decision = 'approve' then 'submitted_to_finance'::public.claim_status else 'rejected' end,
    decided_by = p_actor, decided_at = now(), decision_remark = nullif(btrim(p_remark), '')
  where id = c.id;

  perform public._audit('claim', c.id, case when p_decision = 'approve' then 'approved' else 'rejected' end, p_actor,
    jsonb_build_object('remark', p_remark));
  if p_decision = 'approve' then
    perform public._audit('claim', c.id, 'submitted_to_finance', null, jsonb_build_object('total', c.total_amount));
    perform public._notify(c.employee_id, 'decision', 'Your claim was approved',
      format('%s · SGD %s — sent to Finance for payment', c.ref, to_char(c.total_amount, 'FM999,990.00')), '/expenses/' || c.id);
    perform public._notify_role('finance', 'payment_queue', format('Claim ready to pay: %s', c.ref),
      format('%s · SGD %s', (select full_name from public.employees where id = c.employee_id), to_char(c.total_amount, 'FM999,990.00')),
      '/finance', c.employee_id);
  else
    perform public._notify(c.employee_id, 'decision', 'Your claim was not approved',
      format('%s · "%s" — %s', c.ref, btrim(p_remark), v_actor.full_name), '/expenses/' || c.id);
  end if;
  return jsonb_build_object('id', c.id, 'ref', c.ref);
end $$;

create or replace function public._finance_pay_claim(p_actor uuid, p_id uuid, p_payment_ref text, p_paid_on date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.claims;
begin
  if not exists (select 1 from public.employees where id = p_actor and is_active and roles && array['finance','admin']::public.app_role[]) then
    raise exception 'Only Finance can mark claims as paid.';
  end if;
  select * into c from public.claims where id = p_id for update;
  if not found then raise exception 'Claim not found.'; end if;
  if c.status <> 'submitted_to_finance' then raise exception 'Only approved claims waiting for Finance can be paid.'; end if;
  if c.employee_id = p_actor then raise exception 'You cannot pay your own claim.'; end if;
  if coalesce(btrim(p_payment_ref), '') = '' then
    raise exception 'A payment reference is required (e.g. PAYROLL-%).', to_char(public.sg_today(), 'YYYY-MM');
  end if;
  update public.claims set status = 'paid', finance_by = p_actor, finance_at = now(),
    paid_on = coalesce(p_paid_on, public.sg_today()), payment_ref = btrim(p_payment_ref)
  where id = c.id;
  perform public._audit('claim', c.id, 'paid', p_actor, jsonb_build_object('payment_ref', btrim(p_payment_ref), 'paid_on', coalesce(p_paid_on, public.sg_today())));
  perform public._notify(c.employee_id, 'paid', 'Your claim has been paid',
    format('%s · SGD %s · ref %s', c.ref, to_char(c.total_amount, 'FM999,990.00'), btrim(p_payment_ref)), '/expenses/' || c.id);
  return jsonb_build_object('id', c.id, 'status', 'paid');
end $$;

create or replace function public._finance_return_claim(p_actor uuid, p_id uuid, p_remark text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.claims;
begin
  if not exists (select 1 from public.employees where id = p_actor and is_active and roles && array['finance','admin']::public.app_role[]) then
    raise exception 'Only Finance can return claims.';
  end if;
  select * into c from public.claims where id = p_id for update;
  if not found then raise exception 'Claim not found.'; end if;
  if c.status <> 'submitted_to_finance' then raise exception 'Only claims waiting for Finance can be returned.'; end if;
  if coalesce(btrim(p_remark), '') = '' then raise exception 'Say why the claim is being returned (e.g. receipt unreadable).'; end if;
  update public.claims set status = 'returned', finance_by = p_actor, finance_at = now(), finance_remark = btrim(p_remark)
  where id = c.id;
  perform public._audit('claim', c.id, 'returned', p_actor, jsonb_build_object('remark', btrim(p_remark)));
  perform public._notify(c.employee_id, 'returned', 'Finance returned your claim',
    format('%s · "%s" — please fix and resubmit', c.ref, btrim(p_remark)), '/expenses/' || c.id);
  perform public._notify(c.decided_by, 'returned', format('Finance returned %s', c.ref), btrim(p_remark), '/expenses/' || c.id);
  return jsonb_build_object('id', c.id, 'status', 'returned');
end $$;

create or replace function public._cancel_claim(p_actor uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.claims;
begin
  select * into c from public.claims where id = p_id for update;
  if not found then raise exception 'Claim not found.'; end if;
  if c.employee_id <> p_actor then raise exception 'You can only withdraw your own claim.'; end if;
  if c.status <> 'pending' then raise exception 'Only pending claims can be withdrawn.'; end if;
  update public.claims set status = 'cancelled', cancelled_at = now() where id = c.id;
  perform public._audit('claim', c.id, 'withdrawn', p_actor, '{}');
  perform public._notify(c.approver_id, 'cancelled', format('%s was withdrawn', c.ref), c.title, '/inbox');
  return jsonb_build_object('id', c.id, 'status', 'cancelled');
end $$;

-- ---------- Reminders & escalation (runs hourly via pg_cron) ----------
-- Remind approver after 1 working day; escalate to the approver's own approver after 2.
create or replace function public.process_pending_reminders()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_elapsed numeric;
  v_new uuid;
  n_rem int := 0;
  n_esc int := 0;
begin
  for r in
    select 'leave' as kind, id, ref, employee_id, approver_id, submitted_at, reminder_sent_at, escalated_at
      from public.leave_requests where status = 'pending'
    union all
    select 'claim', id, ref, employee_id, approver_id, submitted_at, reminder_sent_at, escalated_at
      from public.claims where status = 'pending'
  loop
    v_elapsed := public.working_days(((r.submitted_at at time zone 'Asia/Singapore')::date + 1), public.sg_today());

    if v_elapsed >= 2 and r.escalated_at is null then
      v_new := public.resolve_approver(r.approver_id);
      if v_new is null or v_new = r.employee_id or v_new = r.approver_id then
        perform public._notify_role('hr', 'escalation', format('%s is overdue for a decision', r.ref),
          'Pending for 2+ working days and no higher approver is available.', '/hr');
        v_new := null;
      else
        perform public._notify(v_new, 'escalation', format('Escalated to you: %s', r.ref),
          'Pending for 2+ working days with the original approver. You can now decide it.', '/inbox');
        perform public._notify(r.approver_id, 'escalation', format('%s was escalated', r.ref),
          'It was pending with you for 2+ working days. You can still decide it.', '/inbox');
      end if;
      if r.kind = 'leave' then
        update public.leave_requests set escalated_at = now(),
          original_approver_id = case when v_new is not null then coalesce(original_approver_id, approver_id) else original_approver_id end,
          approver_id = coalesce(v_new, approver_id)
        where id = r.id;
      else
        update public.claims set escalated_at = now(),
          original_approver_id = case when v_new is not null then coalesce(original_approver_id, approver_id) else original_approver_id end,
          approver_id = coalesce(v_new, approver_id)
        where id = r.id;
      end if;
      perform public._audit(r.kind, r.id, 'escalated', null, jsonb_build_object('from', r.approver_id, 'to', v_new, 'working_days_pending', v_elapsed));
      n_esc := n_esc + 1;
    elsif v_elapsed >= 1 and r.reminder_sent_at is null then
      perform public._notify(r.approver_id, 'reminder', format('Reminder: %s is waiting for you', r.ref),
        'Pending for 1 working day. It will be escalated after 2.', '/inbox');
      if r.kind = 'leave' then
        update public.leave_requests set reminder_sent_at = now() where id = r.id;
      else
        update public.claims set reminder_sent_at = now() where id = r.id;
      end if;
      perform public._audit(r.kind, r.id, 'reminder_sent', null, jsonb_build_object('to', r.approver_id));
      n_rem := n_rem + 1;
    end if;
  end loop;
  return jsonb_build_object('reminders', n_rem, 'escalations', n_esc, 'ran_at', now());
end $$;

-- ---------- HR tools ----------
create or replace function public._hr_set_entitlement(p_actor uuid, p_emp uuid, p_type text, p_year int, p_days numeric, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old numeric;
begin
  if not exists (select 1 from public.employees where id = p_actor and is_active and roles && array['hr','admin']::public.app_role[]) then
    raise exception 'Only HR can change entitlements.';
  end if;
  if p_days is null or p_days < 0 then raise exception 'Entitlement must be 0 or more days.'; end if;
  select days into v_old from public.leave_entitlements where employee_id = p_emp and leave_type = p_type and year = p_year;
  insert into public.leave_entitlements (employee_id, leave_type, year, days, note, updated_at)
  values (p_emp, p_type, p_year, p_days, nullif(btrim(p_note), ''), now())
  on conflict (employee_id, leave_type, year) do update set days = excluded.days, note = excluded.note, updated_at = now();
  perform public._audit('entitlement', p_emp, 'entitlement_set', p_actor,
    jsonb_build_object('leave_type', p_type, 'year', p_year, 'from', v_old, 'to', p_days, 'note', p_note));
end $$;

create or replace function public._hr_adjust_balance(p_actor uuid, p_emp uuid, p_type text, p_year int, p_days numeric, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.employees where id = p_actor and is_active and roles && array['hr','admin']::public.app_role[]) then
    raise exception 'Only HR can adjust balances.';
  end if;
  if p_days is null or p_days = 0 then raise exception 'Adjustment must be a non-zero number of days.'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'A note is required for every manual adjustment.'; end if;
  insert into public.leave_ledger (employee_id, leave_type, year, days, entry_type, note, created_by)
  values (p_emp, p_type, p_year, p_days, 'adjustment', btrim(p_note), p_actor);
  perform public._audit('entitlement', p_emp, 'balance_adjusted', p_actor,
    jsonb_build_object('leave_type', p_type, 'year', p_year, 'days', p_days, 'note', p_note));
end $$;

-- Create a sign-in for an employee record (no service-role key needed).
create or replace function public._hr_create_login(p_actor uuid, p_emp uuid, p_password text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  e public.employees;
  v_uid uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.employees where id = p_actor and is_active and roles && array['hr','admin']::public.app_role[]) then
    raise exception 'Only HR can create sign-ins.';
  end if;
  select * into e from public.employees where id = p_emp;
  if not found then raise exception 'Employee not found.'; end if;
  if e.auth_user_id is not null then raise exception '% already has a sign-in.', e.full_name; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Temporary password must be at least 8 characters.'; end if;
  if exists (select 1 from auth.users where lower(email) = lower(e.email)) then
    raise exception 'A sign-in already exists for %.', e.email;
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', lower(e.email),
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', e.full_name), now(), now(),
    '', '', '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid, v_uid::text,
    jsonb_build_object('sub', v_uid::text, 'email', lower(e.email), 'email_verified', true), 'email', now(), now(), now());

  update public.employees set auth_user_id = v_uid where id = p_emp;
  perform public._audit('employee', p_emp, 'login_created', p_actor, jsonb_build_object('email', e.email));
  return v_uid;
end $$;

-- Link sign-ups to staff records by email (covers dashboard-invited users too).
create or replace function public.link_auth_user_to_employee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.employees set auth_user_id = new.id
  where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end $$;

create trigger on_auth_user_created_link_employee
  after insert on auth.users
  for each row execute function public.link_auth_user_to_employee();

-- ---------- Public RPC wrappers (resolve actor from the session) ----------
create or replace function public._me()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  v := public.current_employee_id();
  if v is null then raise exception 'Your sign-in is not linked to an active employee record. Please contact HR.'; end if;
  return v;
end $$;

create or replace function public.preview_leave(p_type text, p_start date, p_end date, p_half public.half_day default 'none', p_document text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select public._validate_leave(public._me(), p_type, p_start, p_end, coalesce(p_half, 'none'), p_document, null)
$$;

create or replace function public.submit_leave_request(p_type text, p_start date, p_end date, p_half public.half_day default 'none', p_reason text default null, p_document text default null)
returns jsonb language sql security definer set search_path = public as $$
  select public._submit_leave(public._me(), p_type, p_start, p_end, p_half, p_reason, p_document)
$$;

create or replace function public.decide_leave_request(p_id uuid, p_decision text, p_remark text default null)
returns jsonb language sql security definer set search_path = public as $$
  select public._decide_leave(public._me(), p_id, p_decision, p_remark)
$$;

create or replace function public.cancel_leave_request(p_id uuid, p_reason text default null)
returns jsonb language sql security definer set search_path = public as $$
  select public._cancel_leave(public._me(), p_id, p_reason)
$$;

create or replace function public.preview_claim(p_title text, p_lines jsonb, p_declaration boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select public._validate_claim(public._me(), p_title, p_lines, p_declaration)
$$;

create or replace function public.submit_claim(p_title text, p_lines jsonb, p_declaration boolean)
returns jsonb language sql security definer set search_path = public as $$
  select public._submit_claim(public._me(), p_title, p_lines, p_declaration)
$$;

create or replace function public.decide_claim(p_id uuid, p_decision text, p_remark text default null)
returns jsonb language sql security definer set search_path = public as $$
  select public._decide_claim(public._me(), p_id, p_decision, p_remark)
$$;

create or replace function public.finance_pay_claim(p_id uuid, p_payment_ref text, p_paid_on date default null)
returns jsonb language sql security definer set search_path = public as $$
  select public._finance_pay_claim(public._me(), p_id, p_payment_ref, p_paid_on)
$$;

create or replace function public.finance_return_claim(p_id uuid, p_remark text)
returns jsonb language sql security definer set search_path = public as $$
  select public._finance_return_claim(public._me(), p_id, p_remark)
$$;

create or replace function public.cancel_claim(p_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select public._cancel_claim(public._me(), p_id)
$$;

create or replace function public.hr_set_entitlement(p_emp uuid, p_type text, p_year int, p_days numeric, p_note text default null)
returns void language sql security definer set search_path = public as $$
  select public._hr_set_entitlement(public._me(), p_emp, p_type, p_year, p_days, p_note)
$$;

create or replace function public.hr_adjust_balance(p_emp uuid, p_type text, p_year int, p_days numeric, p_note text)
returns void language sql security definer set search_path = public as $$
  select public._hr_adjust_balance(public._me(), p_emp, p_type, p_year, p_days, p_note)
$$;

create or replace function public.hr_generate_entitlements(p_year int)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_role(array['hr','admin']::public.app_role[]) then raise exception 'Only HR can generate entitlements.'; end if;
  return public._generate_entitlements(p_year, public._me());
end $$;

create or replace function public.hr_create_login(p_emp uuid, p_password text)
returns uuid language sql security definer set search_path = public as $$
  select public._hr_create_login(public._me(), p_emp, p_password)
$$;

create or replace function public.run_reminders_now()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_role(array['hr','admin','office_manager']::public.app_role[]) then
    raise exception 'Only HR or the Office Manager can run reminders manually.';
  end if;
  return public.process_pending_reminders();
end $$;

-- Team absence calendar: limited columns only (no reasons / MC numbers).
create or replace function public.team_absence(p_from date, p_to date, p_department uuid default null)
returns table (request_id uuid, employee_id uuid, full_name text, department_id uuid, leave_type text,
               leave_name text, color text, start_date date, end_date date, half_day public.half_day,
               days numeric, status public.leave_status)
language sql stable security definer set search_path = public as $$
  with me as (select * from public.employees where id = public._me())
  select r.id, e.id, e.full_name, e.department_id, r.leave_type, t.name, t.color,
         r.start_date, r.end_date, r.half_day, r.days, r.status
  from public.leave_requests r
  join public.employees e on e.id = r.employee_id
  join public.leave_types t on t.code = r.leave_type
  cross join me
  where r.status in ('pending', 'approved')
    and r.start_date <= p_to and r.end_date >= p_from
    and (
      case when p_department is not null
             and (me.roles && array['hr','office_manager','director','admin']::public.app_role[]
                  or exists (select 1 from public.departments d where d.id = p_department and d.head_id = me.id))
           then e.department_id = p_department
           when p_department is null
             and me.roles && array['hr','office_manager','director','admin']::public.app_role[]
           then true
           else e.department_id = me.department_id
      end)
  order by r.start_date, e.full_name
$$;

-- ---------- HR monthly report & success-criteria KPIs ----------
create or replace function public.hr_leave_report(p_year int, p_month int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_from date := make_date(p_year, p_month, 1);
  v_to   date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v jsonb;
begin
  if not public.has_any_role(array['hr','admin','office_manager','director','finance']::public.app_role[]) then
    raise exception 'Reports are available to HR, the Office Manager, Finance and Directors.';
  end if;

  with
  approved as (
    select r.*, e.full_name, e.department_id, d.name as dept_name, t.name as type_name
    from public.leave_requests r
    join public.employees e on e.id = r.employee_id
    left join public.departments d on d.id = e.department_id
    join public.leave_types t on t.code = r.leave_type
    where r.status = 'approved' and r.start_date <= v_to and r.end_date >= v_from
  ),
  submitted as (
    select r.*, public.working_days((r.submitted_at at time zone 'Asia/Singapore')::date + 1,
                                    (r.decided_at at time zone 'Asia/Singapore')::date) as wd_to_decide
    from public.leave_requests r
    where (r.submitted_at at time zone 'Asia/Singapore')::date between v_from and v_to
  ),
  ledger_check as (
    select r.id, r.days, coalesce(-sum(l.days) filter (where l.entry_type in ('approved','reversal')), 0) as posted, r.status
    from public.leave_requests r
    left join public.leave_ledger l on l.request_id = r.id
    where r.status in ('approved', 'cancelled', 'rejected', 'pending')
    group by r.id, r.days, r.status
  ),
  sick_pattern as (
    select e.full_name, count(*) as occurrences
    from public.leave_requests r join public.employees e on e.id = r.employee_id
    where r.status = 'approved' and r.leave_type = 'SL'
      and r.start_date >= v_to - 90 and r.start_date <= v_to
      and (extract(isodow from r.start_date) in (1, 5) or extract(isodow from r.end_date) in (1, 5)
           or exists (select 1 from public.public_holidays h
                      where h.holiday_date in (r.start_date - 1, r.end_date + 1)))
    group by e.full_name having count(*) >= 2
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'by_type', coalesce((select jsonb_agg(x order by x->>'type') from (
        select jsonb_build_object('type', type_name, 'code', leave_type, 'requests', count(*), 'days', sum(days)) x
        from approved group by type_name, leave_type) s), '[]'),
    'by_department', coalesce((select jsonb_agg(x order by x->>'department') from (
        select jsonb_build_object('department', coalesce(dept_name, '—'), 'requests', count(*), 'days', sum(days)) x
        from approved group by dept_name) s), '[]'),
    'top_takers', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('name', full_name, 'days', sum(days), 'requests', count(*)) x
        from approved group by full_name order by sum(days) desc limit 5) s), '[]'),
    'kpis', jsonb_build_object(
      'submitted', (select count(*) from submitted),
      'decided', (select count(*) from submitted where decided_at is not null),
      'decided_within_1_wd', (select count(*) from submitted where decided_at is not null and wd_to_decide <= 1),
      'pct_within_1_wd', (select case when count(*) filter (where decided_at is not null) = 0 then null
                           else round(100.0 * count(*) filter (where decided_at is not null and wd_to_decide <= 1)
                                      / count(*) filter (where decided_at is not null), 0) end from submitted),
      'pending_now', (select count(*) from public.leave_requests where status = 'pending'),
      'escalated', (select count(*) from submitted where escalated_at is not null),
      'ledger_mismatches', (select count(*) from ledger_check
                            where (status = 'approved' and posted <> days) or (status <> 'approved' and posted <> 0)),
      'requests_without_audit', (select count(*) from public.leave_requests r
                                 where not exists (select 1 from public.audit_log a where a.entity_type = 'leave' and a.entity_id = r.id and a.action = 'submitted'))
    ),
    'claims', jsonb_build_object(
      'submitted', (select count(*) from public.claims where (submitted_at at time zone 'Asia/Singapore')::date between v_from and v_to),
      'awaiting_finance', (select count(*) from public.claims where status = 'submitted_to_finance'),
      'awaiting_finance_amount', (select coalesce(sum(total_amount), 0) from public.claims where status = 'submitted_to_finance'),
      'paid_amount', (select coalesce(sum(total_amount), 0) from public.claims where status = 'paid' and paid_on between v_from and v_to),
      'returned', (select count(*) from public.claims where status = 'returned' and (finance_at at time zone 'Asia/Singapore')::date between v_from and v_to)
    ),
    'patterns', jsonb_build_object(
      'sick_leave_next_to_weekends_or_holidays', coalesce((select jsonb_agg(jsonb_build_object('name', full_name, 'occurrences', occurrences)) from sick_pattern), '[]'),
      'short_notice_requests', (select count(*) from submitted where 'Short notice' = any(flags)),
      'team_clash_requests', (select count(*) from submitted where 'Team clash' = any(flags))
    )
  ) into v;
  return v;
end $$;

-- ---------- Views ----------
-- Master Leave Record: entitlement, taken, pending and balance per employee/type/year.
create or replace view public.v_leave_balances with (security_invoker = true) as
select
  en.employee_id,
  e.full_name,
  e.employee_no,
  e.department_id,
  d.name as department_name,
  en.leave_type,
  t.name as leave_name,
  t.color,
  t.sort_order,
  en.year,
  en.days as entitled,
  coalesce(-sum(l.days) filter (where l.entry_type in ('approved', 'reversal')), 0) as taken,
  coalesce(sum(l.days) filter (where l.entry_type = 'adjustment'), 0) as adjustments,
  public.leave_pending(en.employee_id, en.leave_type, en.year) as pending,
  en.days + coalesce(sum(l.days), 0) as balance,
  en.days + coalesce(sum(l.days), 0) - public.leave_pending(en.employee_id, en.leave_type, en.year) as available,
  en.note
from public.leave_entitlements en
join public.employees e on e.id = en.employee_id
left join public.departments d on d.id = e.department_id
join public.leave_types t on t.code = en.leave_type
left join public.leave_ledger l
  on l.employee_id = en.employee_id and l.leave_type = en.leave_type and l.year = en.year
group by en.employee_id, e.full_name, e.employee_no, e.department_id, d.name, en.leave_type, t.name, t.color, t.sort_order, en.year, en.days, en.note;

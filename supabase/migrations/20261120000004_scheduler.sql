-- Hourly reminder / escalation sweep (Activity 1.1 step 4:
-- remind after 1 working day, escalate after 2).
create extension if not exists pg_cron;

select cron.schedule(
  'workpath-approval-reminders',
  '0 * * * *',
  $$select public.process_pending_reminders()$$
);

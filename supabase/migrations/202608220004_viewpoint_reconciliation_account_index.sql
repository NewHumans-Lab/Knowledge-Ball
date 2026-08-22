-- Module 5 hosted-advisor follow-up only.
-- Cover the account_id foreign key used by historical reconciliation audit rows.
-- No settlement, balance, validation, visibility, or protocol behavior changes.

create index if not exists knowledge_reconciliation_account
  on private.knowledge_reconciliation_position_deltas(account_id);

create or replace function public.knowledge_ball_schema_version() returns text
language sql stable security definer set search_path=public,pg_temp
as $$ select '202608220004'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;

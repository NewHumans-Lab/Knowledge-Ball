-- Read-only quote for the next human ORIGINAL_DESIGN_V1 revalidation round.
-- The server remains the authority for the topic-wide stage and stake ladder;
-- UI clients use this only to show the exact stake before the user confirms.

create or replace function public.get_knowledge_revalidation_quote(target_node_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  actor uuid := auth.uid();
  member private.knowledge_lineage_members%rowtype;
  next_stage integer;
  policy record;
begin
  if actor is null then
    raise exception 'authentication required' using errcode='42501';
  end if;
  if nullif(trim(target_node_id),'') is null then
    raise exception 'node id required' using errcode='22023';
  end if;

  select * into member
  from private.knowledge_lineage_members
  where node_id=target_node_id;

  if not found or member.role not in ('history','opposition') or member.revalidating then
    raise exception 'only stable history/opposition knowledge can be quoted for revalidation' using errcode='22023';
  end if;

  if exists(
    select 1
    from private.knowledge_revalidation_rounds
    where topic_id=member.topic_id and verdict='PENDING'
  ) then
    raise exception 'topic already has an active revalidation round' using errcode='KB409';
  end if;

  select coalesce(p.next_stage,0)
    into next_stage
  from private.knowledge_revalidation_progress p
  where p.topic_id=member.topic_id;
  if next_stage is null then next_stage := 0; end if;

  select * into policy
  from private.knowledge_revalidation_policy(next_stage);

  return jsonb_build_object(
    'node_id',target_node_id,
    'topic_id',member.topic_id,
    'stage',next_stage,
    'stake',policy.stake::text,
    'scope',policy.scope,
    'accuracy_gate',policy.accuracy_gate,
    'local_hop_limit',policy.local_hop_limit,
    'policy_version','ORIGINAL_DESIGN_V1'
  );
end $$;

revoke all on function public.get_knowledge_revalidation_quote(text) from public, anon;
grant execute on function public.get_knowledge_revalidation_quote(text) to authenticated;

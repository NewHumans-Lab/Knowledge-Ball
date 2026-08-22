-- Knowledge Lineage V3 / module 6 (part 2): current-version cascade.
--
-- Reuses the existing KnowledgeStatusChanged(disputed, causeNodeId) event rather
-- than adding another lifecycle type. Automatic cascade has no human initiator,
-- no stake and no vote. It only marks affected CURRENT dependents for the
-- validation layer to re-evaluate.

create or replace function private.emit_downstream_revalidation(
  old_current_id text,
  new_current_id text,
  triggering_event_id text,
  triggering_actor uuid
) returns integer
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  target_id text;
  emitted integer := 0;
  event_envelope jsonb;
begin
  if nullif(old_current_id, '') is null
     or nullif(new_current_id, '') is null
     or nullif(triggering_event_id, '') is null then
    return 0;
  end if;

  -- Traverse premise -> conclusion only. Both seed and recursive steps require
  -- the conclusion to be the CURRENT member of its topic, so gray/red lineage
  -- nodes can neither be emitted nor act as bridges through the cascade.
  for target_id in
    with recursive downstream(node_id) as (
      select e.conclusion_node_id
      from private.knowledge_dependency_edges e
      join private.knowledge_lineage_members lm
        on lm.node_id = e.conclusion_node_id and lm.role = 'current'
      where e.premise_node_id = old_current_id

      union

      select e.conclusion_node_id
      from private.knowledge_dependency_edges e
      join downstream d on e.premise_node_id = d.node_id
      join private.knowledge_lineage_members lm
        on lm.node_id = e.conclusion_node_id and lm.role = 'current'
    )
    select node_id
    from downstream
    where node_id <> new_current_id
    order by node_id
  loop
    event_envelope := jsonb_build_object(
      'id', 'cascade-revalidation:' || triggering_event_id || ':' || target_id,
      'type', 'KnowledgeStatusChanged',
      'scope', 'public',
      'schemaVersion', 1,
      'timestamp', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
      'payload', jsonb_build_object(
        'edit', jsonb_build_object(
          'kind', 'status',
          'nodeId', target_id,
          'status', 'disputed',
          'causeNodeId', old_current_id
        )
      )
    );

    insert into public.public_knowledge_events(
      event_id, schema_version, event_type, envelope, actor_id
    ) values (
      event_envelope ->> 'id', 1, 'KnowledgeStatusChanged', event_envelope, triggering_actor
    )
    on conflict(event_id) do nothing;

    if found then emitted := emitted + 1; end if;
  end loop;

  -- Dependency projection represents EFFECTIVE current-version dependencies.
  -- Immutable ball payloads are untouched; only the projection follows the new
  -- current premise so a later A2 -> A3 change can still reach the same B/C/D.
  perform private.repoint_dependency_sources(array[old_current_id], new_current_id);

  return emitted;
end $$;

revoke all on function private.emit_downstream_revalidation(text, text, text, uuid)
from public, anon, authenticated;

create or replace function private.cascade_on_current_version_change() returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  changed_node_id text;
  old_current_id text;
  proposal_kind text;
  round_id uuid;
  role_at_start_value text;
begin
  -- A successful optimization or opposition candidate has already been promoted
  -- by project_knowledge_lineage_event when this trigger runs. target_id is the
  -- previous current immutable ball.
  if new.event_type = 'KnowledgeVerdictFinalized'
     and new.envelope #>> '{payload,verdict}' = 'CORRECT' then
    changed_node_id := new.envelope #>> '{payload,nodeId}';

    select proposal, target_id
    into proposal_kind, old_current_id
    from private.knowledge_lineage_members
    where node_id = changed_node_id and role = 'current';

    if proposal_kind in ('optimization', 'opposition') and old_current_id is not null then
      perform private.emit_downstream_revalidation(
        old_current_id,
        changed_node_id,
        new.event_id,
        new.actor_id
      );
    end if;
    return new;
  end if;

  -- Reactivating an existing gray/red immutable ball also changes the topic's
  -- effective current version. Module 4 records role_at_start authoritatively.
  if new.event_type = 'KnowledgeRevalidationFinalized'
     and new.envelope #>> '{payload,verdict}' = 'CORRECT' then
    changed_node_id := new.envelope #>> '{payload,nodeId}';
    round_id := (new.envelope #>> '{payload,roundId}')::uuid;

    select role_at_start
    into role_at_start_value
    from private.knowledge_revalidation_rounds
    where id = round_id;

    if role_at_start_value = 'history' then
      select node_id into old_current_id
      from private.knowledge_lineage_members
      where topic_id = new.envelope #>> '{payload,topicId}'
        and role = 'history' and rank = 1;
    elsif role_at_start_value = 'opposition' then
      select node_id into old_current_id
      from private.knowledge_lineage_members
      where topic_id = new.envelope #>> '{payload,topicId}'
        and role = 'opposition' and rank = 1;
    end if;

    if old_current_id is not null then
      perform private.emit_downstream_revalidation(
        old_current_id,
        changed_node_id,
        new.event_id,
        new.actor_id
      );
    end if;
    return new;
  end if;

  return new;
end $$;

revoke all on function private.cascade_on_current_version_change()
from public, anon, authenticated;

-- PostgreSQL orders same-time triggers by name. Module 4's
-- project_knowledge_lineage_event therefore establishes final lineage roles
-- before this zy_ trigger reads them. Module 5's zz_ reconciliation remains
-- independent and runs afterwards.
drop trigger if exists zy_cascade_on_current_version_change on public.public_knowledge_events;
create trigger zy_cascade_on_current_version_change
after insert on public.public_knowledge_events
for each row execute function private.cascade_on_current_version_change();

create or replace function public.knowledge_ball_schema_version() returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select '202608220006'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public, anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;

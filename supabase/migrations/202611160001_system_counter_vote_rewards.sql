-- System counter-position for every newly settled voting round.
--
-- The system is a real 1E position on the losing side, assigned only after the
-- human verdict is final. It never enters vote counts or threshold calculations.
-- The 1E is added to the same human losing pool using largest-remainder atoms;
-- creator/system claim rewards remain a separate economic channel.
--
-- Historical closed rounds keep a zero counter-position. Pending rounds and all
-- rounds settled after this migration receive the new position automatically.
-- All adjustments use the existing settlement transaction and append-only ledger.

alter table public.knowledge_pending_vote_rounds
  add column if not exists system_counter_stake numeric(30,6) not null default 0.000000,
  add column if not exists system_counter_side text;

alter table private.knowledge_revalidation_rounds
  add column if not exists system_counter_stake numeric(30,6) not null default 0.000000,
  add column if not exists system_counter_side text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.knowledge_pending_vote_rounds'::regclass
      and conname='knowledge_pending_vote_rounds_system_counter_check'
  ) then
    alter table public.knowledge_pending_vote_rounds
      add constraint knowledge_pending_vote_rounds_system_counter_check
      check (
        (system_counter_stake=0.000000 and system_counter_side is null)
        or (system_counter_stake=1.000000 and system_counter_side in ('AGREE','DISAGREE'))
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='private.knowledge_revalidation_rounds'::regclass
      and conname='knowledge_revalidation_rounds_system_counter_check'
  ) then
    alter table private.knowledge_revalidation_rounds
      add constraint knowledge_revalidation_rounds_system_counter_check
      check (
        (system_counter_stake=0.000000 and system_counter_side is null)
        or (system_counter_stake=1.000000 and system_counter_side in ('AGREE','DISAGREE'))
      );
  end if;
end $$;

-- Append the system's 1E losing-side contribution to the same settlement
-- transaction. The original settlement has already split the human losing stakes.
-- This trigger adds only the exact difference between that split and the split
-- of (human losing stakes + system 1E), so largest-remainder rounding is identical
-- to settling one combined pool rather than two separately rounded pools.
create or replace function private.apply_system_counter_vote_position()
returns trigger
language plpgsql
security definer
set search_path=private,public,pg_temp
as $$
declare
  v_operation text:=new.metadata->>'operation';
  v_round_id uuid;
  v_winning_side text;
  v_counter_side text;
  v_existing_stake numeric(30,6);
  v_existing_side text;
  v_human_winner_count bigint;
  v_human_losing_atoms bigint;
  v_old_share_atoms bigint;
  v_old_remainder_atoms bigint;
  v_combined_share_atoms bigint;
  v_combined_remainder_atoms bigint;
  v_position_index bigint:=0;
  v_old_position_share bigint;
  v_combined_position_share bigint;
  v_delta_atoms bigint;
  v_paid_atoms bigint:=0;
  v_position record;
  v_initiator_id uuid;
  v_stake_atoms bigint;
  v_account_id uuid;
  v_system_account constant uuid:='00000000-0000-0000-0000-000000000001';
begin
  if new.transaction_type='VOTE_SETTLEMENT'
     and v_operation in ('PENDING_VOTE_SETTLEMENT','CASCADE_REVALIDATION_SETTLEMENT') then
    v_round_id:=nullif(new.metadata->>'round_id','')::uuid;
    v_winning_side:=case new.metadata->>'verdict'
      when 'CORRECT' then 'AGREE'
      when 'INCORRECT' then 'DISAGREE'
      else null
    end;
    if v_round_id is null or v_winning_side is null then
      raise exception 'system counter vote requires a valid pending-round settlement'
        using errcode='22023';
    end if;
    v_counter_side:=case when v_winning_side='AGREE' then 'DISAGREE' else 'AGREE' end;

    select system_counter_stake,system_counter_side
      into v_existing_stake,v_existing_side
    from public.knowledge_pending_vote_rounds
    where id=v_round_id
    for update;
    if not found then raise exception 'system counter vote round not found' using errcode='XX000'; end if;
    if v_existing_stake<>0.000000 or v_existing_side is not null then
      raise exception 'system counter vote position already assigned' using errcode='23505';
    end if;

    update public.knowledge_pending_vote_rounds
    set system_counter_stake=1.000000,system_counter_side=v_counter_side
    where id=v_round_id;

    select
      count(*) filter(where side=v_winning_side)::bigint,
      count(*) filter(where side<>v_winning_side)::bigint*1000000
    into v_human_winner_count,v_human_losing_atoms
    from public.knowledge_pending_votes
    where round_id=v_round_id and settlement_status='ACTIVE';

    -- An insufficient-support timeout can have no human winner. The counter
    -- position is still persisted for a later reversal, but no payout is made.
    if v_human_winner_count=0 then return new; end if;

    -- Acquire USER locks deterministically, then SYSTEM. The existing finalizer
    -- uses the same position ordering when it writes the original user payouts.
    perform 1
    from public.energy_accounts a
    join public.knowledge_pending_votes v on v.voter_id=a.user_id
    where v.round_id=v_round_id
      and v.side=v_winning_side
      and v.settlement_status='ACTIVE'
    order by a.user_id
    for update of a;
    perform 1 from public.energy_accounts a where a.id=v_system_account for update;

    v_old_share_atoms:=v_human_losing_atoms/v_human_winner_count;
    v_old_remainder_atoms:=v_human_losing_atoms%v_human_winner_count;
    v_combined_share_atoms:=(v_human_losing_atoms+1000000)/v_human_winner_count;
    v_combined_remainder_atoms:=(v_human_losing_atoms+1000000)%v_human_winner_count;

    for v_position in
      select 'vote:'||v.id::text as position_key,a.id as account_id
      from public.knowledge_pending_votes v
      join public.energy_accounts a on a.user_id=v.voter_id
      where v.round_id=v_round_id
        and v.side=v_winning_side
        and v.settlement_status='ACTIVE'
      order by position_key
    loop
      v_position_index:=v_position_index+1;
      v_old_position_share:=v_old_share_atoms
        +case when v_position_index<=v_old_remainder_atoms then 1 else 0 end;
      v_combined_position_share:=v_combined_share_atoms
        +case when v_position_index<=v_combined_remainder_atoms then 1 else 0 end;
      v_delta_atoms:=v_combined_position_share-v_old_position_share;

      if v_delta_atoms<0 then
        raise exception 'system counter vote allocation produced a negative bonus atom'
          using errcode='XX000';
      end if;
      if v_delta_atoms>0 then
        update public.energy_accounts
        set balance=balance+(v_delta_atoms::numeric/1000000)
        where id=v_position.account_id;
        insert into public.energy_ledger_entries(transaction_id,account_id,amount)
        values(new.id,v_position.account_id,(v_delta_atoms::numeric/1000000));
        v_paid_atoms:=v_paid_atoms+v_delta_atoms;
      end if;
    end loop;

    if v_paid_atoms<>1000000 then
      raise exception 'system counter vote bonus must distribute exactly 1E (got % atoms)',v_paid_atoms
        using errcode='XX000';
    end if;
    update public.energy_accounts set balance=balance-1.000000 where id=v_system_account;
    insert into public.energy_ledger_entries(transaction_id,account_id,amount)
    values(new.id,v_system_account,-1.000000);
    return new;
  end if;

  if new.transaction_type='CHALLENGE_SETTLEMENT'
     and v_operation='KNOWLEDGE_REVALIDATION_SETTLEMENT' then
    v_round_id:=nullif(new.metadata->>'round_id','')::uuid;
    v_winning_side:=case new.metadata->>'verdict'
      when 'CORRECT' then 'AGREE'
      when 'INCORRECT' then 'DISAGREE'
      else null
    end;
    if v_round_id is null or v_winning_side is null then
      raise exception 'system counter vote requires a valid revalidation settlement'
        using errcode='22023';
    end if;
    v_counter_side:=case when v_winning_side='AGREE' then 'DISAGREE' else 'AGREE' end;

    select system_counter_stake,system_counter_side,initiator_id,(stake*1000000)::bigint
      into v_existing_stake,v_existing_side,v_initiator_id,v_stake_atoms
    from private.knowledge_revalidation_rounds
    where id=v_round_id
    for update;
    if not found then raise exception 'system counter revalidation round not found' using errcode='XX000'; end if;
    if v_existing_stake<>0.000000 or v_existing_side is not null then
      raise exception 'system counter revalidation position already assigned' using errcode='23505';
    end if;

    update private.knowledge_revalidation_rounds
    set system_counter_stake=1.000000,system_counter_side=v_counter_side
    where id=v_round_id;

    select
      (case when v_winning_side='AGREE' then 1 else 0 end)
        +count(*) filter(where side=v_winning_side)::bigint,
      (
        (case when v_winning_side='DISAGREE' then 1 else 0 end)
        +count(*) filter(where side<>v_winning_side)::bigint
      )*v_stake_atoms
    into v_human_winner_count,v_human_losing_atoms
    from private.knowledge_revalidation_votes
    where round_id=v_round_id;

    if v_human_winner_count=0 then return new; end if;

    -- The initiator and all winning voters are locked in stable account order.
    perform 1
    from public.energy_accounts a
    where (
      (v_winning_side='AGREE' and a.user_id=v_initiator_id)
      or exists (
        select 1 from private.knowledge_revalidation_votes v
        where v.round_id=v_round_id and v.side=v_winning_side and v.voter_id=a.user_id
      )
    )
    order by a.user_id
    for update of a;
    perform 1 from public.energy_accounts a where a.id=v_system_account for update;

    v_old_share_atoms:=v_human_losing_atoms/v_human_winner_count;
    v_old_remainder_atoms:=v_human_losing_atoms%v_human_winner_count;
    v_combined_share_atoms:=(v_human_losing_atoms+1000000)/v_human_winner_count;
    v_combined_remainder_atoms:=(v_human_losing_atoms+1000000)%v_human_winner_count;

    for v_position in
      select position_key,account_id
      from (
        select 'initiator:'||v_initiator_id::text as position_key,a.id as account_id
        from public.energy_accounts a
        where v_winning_side='AGREE' and a.user_id=v_initiator_id
        union all
        select 'vote:'||v.id::text,a.id
        from private.knowledge_revalidation_votes v
        join public.energy_accounts a on a.user_id=v.voter_id
        where v.round_id=v_round_id and v.side=v_winning_side
      ) winners
      order by position_key
    loop
      v_position_index:=v_position_index+1;
      v_old_position_share:=v_old_share_atoms
        +case when v_position_index<=v_old_remainder_atoms then 1 else 0 end;
      v_combined_position_share:=v_combined_share_atoms
        +case when v_position_index<=v_combined_remainder_atoms then 1 else 0 end;
      v_delta_atoms:=v_combined_position_share-v_old_position_share;

      if v_delta_atoms<0 then
        raise exception 'system counter revalidation allocation produced a negative bonus atom'
          using errcode='XX000';
      end if;
      if v_delta_atoms>0 then
        update public.energy_accounts
        set balance=balance+(v_delta_atoms::numeric/1000000)
        where id=v_position.account_id;
        insert into public.energy_ledger_entries(transaction_id,account_id,amount)
        values(new.id,v_position.account_id,(v_delta_atoms::numeric/1000000));
        v_paid_atoms:=v_paid_atoms+v_delta_atoms;
      end if;
    end loop;

    if v_paid_atoms<>1000000 then
      raise exception 'system counter revalidation bonus must distribute exactly 1E (got % atoms)',v_paid_atoms
        using errcode='XX000';
    end if;
    update public.energy_accounts set balance=balance-1.000000 where id=v_system_account;
    insert into public.energy_ledger_entries(transaction_id,account_id,amount)
    values(new.id,v_system_account,-1.000000);
    return new;
  end if;

  return new;
end $$;

revoke all on function private.apply_system_counter_vote_position()
from public,anon,authenticated;

drop trigger if exists apply_system_counter_vote_position on public.energy_transactions;
create trigger apply_system_counter_vote_position
after insert on public.energy_transactions
for each row
when (new.transaction_type in ('VOTE_SETTLEMENT','CHALLENGE_SETTLEMENT'))
execute function private.apply_system_counter_vote_position();

-- Historical INITIAL/CASCADE entitlement replay. The synthetic system position
-- participates in the side's winner count or losing pool according to its
-- immutable original counter side, but is not returned as a USER entitlement.
-- The reconciliation function's existing SYSTEM balancing entry accounts for
-- its resulting payout and therefore must remain the sole SYSTEM-side writer.
create or replace function private.initial_round_position_entitlements(
  p_round_id uuid,
  p_desired_verdict text
) returns table(position_key text,account_id uuid,payout numeric(30,6))
language sql
stable
security definer
set search_path=private,public,pg_temp
as $$
  with r as (
    select pr.*
    from public.knowledge_pending_vote_rounds pr
    where pr.id=p_round_id
      and p_desired_verdict in ('CORRECT','INCORRECT')
  ), user_positions as (
    select
      v.id,
      v.side,
      a.id as account_id,
      'initial:'||v.round_id::text||':vote:'||v.id::text as position_key,
      1000000::bigint as stake_atoms
    from public.knowledge_pending_votes v
    join public.energy_accounts a on a.user_id=v.voter_id
    where v.round_id=p_round_id
      and v.settlement_status='ACTIVE'
  ), positions as (
    select position_key,account_id,side,stake_atoms from user_positions
    union all
    select
      'initial:'||r.id::text||':system:counter',
      null::uuid,
      r.system_counter_side,
      (r.system_counter_stake*1000000)::bigint
    from r
    where r.system_counter_stake>0 and r.system_counter_side is not null
  ), params as (
    select
      case when p_desired_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end as winning_side,
      coalesce(sum(stake_atoms) filter(where side<>case when p_desired_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end),0)::bigint as losing_atoms,
      count(*) filter(where side=case when p_desired_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end)::bigint as winner_count
    from positions
  ), winner_ranks as (
    select
      p.position_key,
      row_number() over(order by p.position_key)::bigint-1 as winner_index
    from positions p
    cross join params x
    where p.side=x.winning_side
  ), vote_entitlements as (
    select
      v.position_key,
      v.account_id,
      case when v.side=p.winning_side and p.winner_count>0 then
        (
          1000000::bigint
          +p.losing_atoms/p.winner_count
          +case when wr.winner_index<p.losing_atoms%p.winner_count then 1 else 0 end
        )::numeric/1000000
      else 0::numeric end::numeric(30,6) as payout
    from user_positions v
    cross join params p
    left join winner_ranks wr on wr.position_key=v.position_key
  ), creator_entitlement as (
    select
      'initial:'||r.id::text||':creator:'||r.initiator_id::text as position_key,
      a.id as account_id,
      case when p_desired_verdict='CORRECT' then 2.000000 else 0.000000 end::numeric(30,6) as payout
    from r
    join public.energy_accounts a on a.user_id=r.initiator_id
    where not r.legacy_unfunded
      and r.creator_stake_transaction_id is not null
  )
  select * from creator_entitlement
  union all
  select * from vote_entitlements
  order by position_key
$$;

-- Historical V1 challenge entitlement replay. The initiator and ordinary votes
-- retain their original stake; the system counter-position is always exactly 1E.
create or replace function private.revalidation_round_position_entitlements(
  p_round_id uuid,
  p_desired_verdict text
) returns table(position_key text,account_id uuid,payout numeric(30,6))
language sql
stable
security definer
set search_path=private,public,pg_temp
as $$
  with r as (
    select rr.id,rr.initiator_id,rr.stake,
      rr.system_counter_stake,rr.system_counter_side
    from private.knowledge_revalidation_rounds rr
    where rr.id=p_round_id
      and p_desired_verdict in ('CORRECT','INCORRECT')
  ), user_positions as (
    select
      'revalidation:'||r.id::text||':initiator:'||r.initiator_id::text as position_key,
      a.id as account_id,
      'AGREE'::text as side,
      (r.stake*1000000)::bigint as stake_atoms
    from r
    join public.energy_accounts a on a.user_id=r.initiator_id
    union all
    select
      'revalidation:'||v.round_id::text||':vote:'||v.id::text,
      a.id,
      v.side,
      (v.stake*1000000)::bigint
    from private.knowledge_revalidation_votes v
    join public.energy_accounts a on a.user_id=v.voter_id
    where v.round_id=p_round_id
  ), positions as (
    select position_key,account_id,side,stake_atoms from user_positions
    union all
    select
      'revalidation:'||r.id::text||':system:counter',
      null::uuid,
      r.system_counter_side,
      (r.system_counter_stake*1000000)::bigint
    from r
    where r.system_counter_stake>0 and r.system_counter_side is not null
  ), params as (
    select
      case when p_desired_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end as winning_side,
      coalesce(sum(stake_atoms) filter(where side<>case when p_desired_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end),0)::bigint as losing_atoms,
      count(*) filter(where side=case when p_desired_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end)::bigint as winner_count
    from positions
  ), winner_ranks as (
    select
      p.position_key,
      row_number() over(order by p.position_key)::bigint-1 as winner_index
    from positions p
    cross join params x
    where p.side=x.winning_side
  )
  select
    v.position_key,
    v.account_id,
    case when v.side=p.winning_side and p.winner_count>0 then
      (
        v.stake_atoms
        +p.losing_atoms/p.winner_count
        +case when wr.winner_index<p.losing_atoms%p.winner_count then 1 else 0 end
      )::numeric/1000000
    else 0::numeric end::numeric(30,6) as payout
  from user_positions v
  cross join params p
  left join winner_ranks wr on wr.position_key=v.position_key
  order by v.position_key
$$;

revoke all on function private.initial_round_position_entitlements(uuid,text),
  private.revalidation_round_position_entitlements(uuid,text)
from public,anon,authenticated;

create or replace function public.knowledge_ball_schema_version()
returns text
language sql
security definer
stable
set search_path=public,pg_temp
as $$ select '202611160001'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;

comment on function private.apply_system_counter_vote_position() is
  'Assigns a non-counting 1E system position to each newly settled voting round on its losing side; its 1E is included in the same reversible, conserved settlement pool.';

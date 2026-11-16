\set ON_ERROR_STOP on

create schema if not exists private;

create table public.energy_accounts (
  id uuid primary key,
  user_id uuid unique,
  balance numeric(30,6) not null
);
insert into public.energy_accounts(id,user_id,balance) values
  ('00000000-0000-0000-0000-000000000001',null,0),
  ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',0),
  ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',0),
  ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003',0),
  ('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004',0),
  ('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005',0);

create table public.energy_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null,
  metadata jsonb not null
);
create table public.energy_ledger_entries (
  transaction_id uuid not null,
  account_id uuid not null,
  amount numeric(30,6) not null
);

create table public.knowledge_pending_vote_rounds (
  id uuid primary key,
  initiator_id uuid,
  creator_stake_transaction_id uuid,
  legacy_unfunded boolean not null default true
);
create table public.knowledge_pending_votes (
  id uuid primary key,
  round_id uuid not null,
  voter_id uuid not null,
  side text not null,
  stake numeric(30,6) not null,
  settlement_status text not null
);

create table private.knowledge_revalidation_rounds (
  id uuid primary key,
  initiator_id uuid not null,
  stake numeric(30,6) not null
);
create table private.knowledge_revalidation_votes (
  id uuid primary key,
  round_id uuid not null,
  voter_id uuid not null,
  side text not null,
  stake numeric(30,6) not null
);

\ir ../supabase/migrations/202611160001_system_counter_vote_rewards.sql

-- Initial vote: one real winner, one real loser, plus the system's losing-side
-- position. The new position must be assigned only after the verdict is fixed.
insert into public.knowledge_pending_vote_rounds(id)
values ('20000000-0000-4000-8000-000000000001');
insert into public.knowledge_pending_votes(id,round_id,voter_id,side,stake,settlement_status) values
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001','AGREE',1,'ACTIVE'),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000002','DISAGREE',1,'ACTIVE');

insert into public.energy_transactions(transaction_type,metadata)
values ('VOTE_SETTLEMENT',jsonb_build_object(
  'operation','PENDING_VOTE_SETTLEMENT',
  'round_id','20000000-0000-4000-8000-000000000001',
  'verdict','CORRECT'
));

do $$
declare
  stake numeric(30,6);
  side text;
  alice_payout numeric(30,6);
  bob_payout numeric(30,6);
  ledger_total numeric(30,6);
begin
  select system_counter_stake,system_counter_side into stake,side
  from public.knowledge_pending_vote_rounds
  where id='20000000-0000-4000-8000-000000000001';
  if stake<>1.000000 or side<>'DISAGREE' then
    raise exception 'initial round did not persist the 1E counter-position on the real losing side';
  end if;

  select payout into alice_payout
  from private.initial_round_position_entitlements(
    '20000000-0000-4000-8000-000000000001','CORRECT'
  )
  where position_key like '%:vote:30000000-0000-4000-8000-000000000001';
  select payout into bob_payout
  from private.initial_round_position_entitlements(
    '20000000-0000-4000-8000-000000000001','CORRECT'
  )
  where position_key like '%:vote:30000000-0000-4000-8000-000000000002';
  if alice_payout<>3.000000 or bob_payout<>0.000000 then
    raise exception 'initial settlement entitlement incorrect: Alice %, Bob %',alice_payout,bob_payout;
  end if;

  select payout into alice_payout
  from private.initial_round_position_entitlements(
    '20000000-0000-4000-8000-000000000001','INCORRECT'
  )
  where position_key like '%:vote:30000000-0000-4000-8000-000000000001';
  select payout into bob_payout
  from private.initial_round_position_entitlements(
    '20000000-0000-4000-8000-000000000001','INCORRECT'
  )
  where position_key like '%:vote:30000000-0000-4000-8000-000000000002';
  if alice_payout<>0.000000 or bob_payout<>1.500000 then
    raise exception 'initial reversal entitlement incorrect: Alice %, Bob %',alice_payout,bob_payout;
  end if;

  select sum(amount) into ledger_total from public.energy_ledger_entries;
  if ledger_total<>0.000000 then
    raise exception 'initial system counter transaction does not conserve ledger energy: %',ledger_total;
  end if;
  if (select balance from public.energy_accounts where id='00000000-0000-0000-0000-000000000001')<>-1.000000 then
    raise exception 'system account did not fund the initial 1E counter-position';
  end if;
end $$;

-- A repeated settlement for the same round must not create a second system stake.
do $$
begin
  begin
    insert into public.energy_transactions(transaction_type,metadata)
    values ('VOTE_SETTLEMENT',jsonb_build_object(
      'operation','PENDING_VOTE_SETTLEMENT',
      'round_id','20000000-0000-4000-8000-000000000001',
      'verdict','CORRECT'
    ));
    raise exception 'duplicate settlement unexpectedly succeeded';
  exception when unique_violation then
    null;
  end;
end $$;

-- Revalidation round: the initiator and one voter support the accepted verdict;
-- the opposite voter loses. The system's 1E must be included before splitting.
insert into private.knowledge_revalidation_rounds(id,initiator_id,stake)
values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  10
);
insert into private.knowledge_revalidation_votes(id,round_id,voter_id,side,stake) values
  ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000004','AGREE',10),
  ('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000005','DISAGREE',10);

insert into public.energy_transactions(transaction_type,metadata)
values ('CHALLENGE_SETTLEMENT',jsonb_build_object(
  'operation','KNOWLEDGE_REVALIDATION_SETTLEMENT',
  'round_id','40000000-0000-4000-8000-000000000001',
  'verdict','CORRECT'
));

do $$
declare
  stake numeric(30,6);
  side text;
  initiator_payout numeric(30,6);
  agree_payout numeric(30,6);
  disagree_payout numeric(30,6);
  ledger_total numeric(30,6);
begin
  select system_counter_stake,system_counter_side into stake,side
  from private.knowledge_revalidation_rounds
  where id='40000000-0000-4000-8000-000000000001';
  if stake<>1.000000 or side<>'DISAGREE' then
    raise exception 'revalidation round did not persist the 1E counter-position';
  end if;

  select payout into initiator_payout
  from private.revalidation_round_position_entitlements(
    '40000000-0000-4000-8000-000000000001','CORRECT'
  )
  where position_key like '%:initiator:10000000-0000-4000-8000-000000000003';
  select payout into agree_payout
  from private.revalidation_round_position_entitlements(
    '40000000-0000-4000-8000-000000000001','CORRECT'
  )
  where position_key like '%:vote:50000000-0000-4000-8000-000000000001';
  select payout into disagree_payout
  from private.revalidation_round_position_entitlements(
    '40000000-0000-4000-8000-000000000001','CORRECT'
  )
  where position_key like '%:vote:50000000-0000-4000-8000-000000000002';
  if initiator_payout<>15.500000 or agree_payout<>15.500000 or disagree_payout<>0.000000 then
    raise exception 'revalidation settlement entitlement incorrect: initiator %, agree %, disagree %',
      initiator_payout,agree_payout,disagree_payout;
  end if;

  select payout into disagree_payout
  from private.revalidation_round_position_entitlements(
    '40000000-0000-4000-8000-000000000001','INCORRECT'
  )
  where position_key like '%:vote:50000000-0000-4000-8000-000000000002';
  if disagree_payout<>21.000000 then
    raise exception 'revalidation reversal entitlement incorrect: expected 21E, got %',disagree_payout;
  end if;

  select sum(amount) into ledger_total from public.energy_ledger_entries;
  if ledger_total<>0.000000 then
    raise exception 'revalidation system counter transaction does not conserve ledger energy: %',ledger_total;
  end if;
end $$;

select 'system counter-vote PostgreSQL migration, settlement, reversal and conservation tests passed' as result;

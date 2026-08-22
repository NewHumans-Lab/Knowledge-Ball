-- Hosted regression for 202608220010_lineage_v3_final_hardening.sql.
-- Run after migration 010 is present. Every fixture/write is rolled back.

begin;

do $$
declare
  permanent_user uuid;
  anonymous_user uuid;
  test_node text:='hardening-vote-'||gen_random_uuid()::text;
  anon_node text:='hardening-anon-'||gen_random_uuid()::text;
  target_node text:='hardening-target-'||gen_random_uuid()::text;
  duplicate_node text:='hardening-duplicate-'||gen_random_uuid()::text;
  topic text:='hardening-topic-'||gen_random_uuid()::text;
  candidate_id text:='hardening-candidate-'||gen_random_uuid()::text;
  unicode_candidate_id text:='hardening-unicode-candidate-'||gen_random_uuid()::text;
  target_event_id text:='hardening-target-event-'||gen_random_uuid()::text;
  duplicate_event_id text:='hardening-duplicate-event-'||gen_random_uuid()::text;
  r1 uuid;
  r2 uuid;
  ra uuid;
  opened timestamptz:=clock_timestamp();
  result jsonb;
  tx_count integer;
  vote_count integer;
  eligible_count bigint;
  required_count integer;
  cascade_policy text;
begin
  select p.user_id into permanent_user
  from public.knowledge_ball_profiles p
  join auth.users u on u.id=p.user_id
  where p.active and p.password_login_enabled and u.is_anonymous is false
  limit 1;

  select p.user_id into anonymous_user
  from public.knowledge_ball_profiles p
  join auth.users u on u.id=p.user_id
  where p.active and u.is_anonymous is true
  limit 1;

  if permanent_user is null or anonymous_user is null then
    raise exception 'fixture requires one permanent and one anonymous account';
  end if;
  if not private.is_eligible_public_voter(permanent_user) then
    raise exception 'permanent account unexpectedly ineligible';
  end if;
  if private.is_eligible_public_voter(anonymous_user) then
    raise exception 'anonymous account unexpectedly eligible';
  end if;
  if private.canonical_knowledge_title('ＡＢＣ')<>private.canonical_knowledge_title('ABC') then
    raise exception 'NFKC canonicalization mismatch';
  end if;

  -- A closed CASCADE round must not be bypassable with an ordinary public status event.
  begin
    perform public.validate_public_knowledge_event(jsonb_build_object(
      'id','status-test','type','KnowledgeStatusChanged','scope','public','schemaVersion',1,
      'payload',jsonb_build_object('edit',jsonb_build_object(
        'kind','status','nodeId','x','status','verified'
      ))
    ));
    raise exception 'ordinary public status write was accepted';
  exception when sqlstate '42501' then
    if position('server-only' in sqlerrm)=0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub',permanent_user::text,true);

  -- Same permanent account: INITIAL vote, close round, then vote in later CASCADE.
  insert into public.knowledge_pending_vote_rounds(
    node_id,round_no,policy_version,initiator_id,initiator_side,
    eligible_user_snapshot,required_votes,opened_at,deadline,legacy_unfunded,round_kind
  ) values(
    test_node,1,'ORIGINAL_DESIGN_V2',null,null,999,999,
    opened,opened+interval '720 hours',false,'INITIAL'
  ) returning id into r1;

  select eligible_user_snapshot,required_votes
  into eligible_count,required_count
  from public.knowledge_pending_vote_rounds where id=r1;
  if eligible_count<>private.eligible_public_voter_count(opened)
     or eligible_count>=(
       select count(*) from public.knowledge_ball_profiles where active
     ) then
    raise exception 'INITIAL eligible snapshot includes anonymous profiles';
  end if;

  -- Prevent threshold finalization so the test can inspect stake rows directly.
  update public.knowledge_pending_vote_rounds set required_votes=required_count+1 where id=r1;
  result:=public.cast_pending_knowledge_vote(
    test_node,'AGREE','hardening-initial-'||gen_random_uuid()::text
  );
  if result->>'round_id'<>r1::text then raise exception 'INITIAL vote returned wrong round'; end if;

  update public.knowledge_pending_vote_rounds
  set verdict='CORRECT',close_reason='THRESHOLD',closed_at=clock_timestamp(),
      final_agree_count=1,final_disagree_count=0
  where id=r1;

  insert into public.knowledge_pending_vote_rounds(
    node_id,round_no,policy_version,initiator_id,initiator_side,
    eligible_user_snapshot,required_votes,opened_at,deadline,legacy_unfunded,
    round_kind,source_node_id
  ) values(
    test_node,2,'ORIGINAL_DESIGN_V1',null,null,999,999,
    opened+interval '1 second',opened+interval '720 hours 1 second',false,
    'CASCADE',test_node
  ) returning id into r2;

  select eligible_user_snapshot,required_votes,policy_version
  into eligible_count,required_count,cascade_policy
  from public.knowledge_pending_vote_rounds where id=r2;
  if cascade_policy<>'KNOWLEDGE_LINEAGE_V3_CASCADE' then
    raise exception 'CASCADE still borrows ORIGINAL_DESIGN_V1 identity';
  end if;

  update public.knowledge_pending_vote_rounds set required_votes=required_count+1 where id=r2;
  result:=public.cast_pending_knowledge_vote(
    test_node,'DISAGREE','hardening-cascade-'||gen_random_uuid()::text
  );
  if result->>'round_id'<>r2::text then raise exception 'CASCADE vote returned wrong round'; end if;

  select count(*) into vote_count
  from public.knowledge_pending_votes
  where round_id in (r1,r2) and voter_id=permanent_user;
  if vote_count<>2 then
    raise exception 'same user must be able to vote once in each round';
  end if;

  select count(*) into tx_count
  from public.energy_transactions
  where actor_id=permanent_user
    and transaction_type='VOTE_STAKE'
    and metadata->>'node_id'=test_node;
  if tx_count<>2 then
    raise exception 'INITIAL and CASCADE stake transactions must be independent';
  end if;

  -- Still exactly once per round.
  begin
    perform public.cast_pending_knowledge_vote(
      test_node,'AGREE','hardening-cascade-duplicate-'||gen_random_uuid()::text
    );
    raise exception 'duplicate vote in same round was accepted';
  exception when sqlstate '23505' then null;
  end;

  -- Anonymous account cannot vote, and no anonymous ballot survives the rejected RPC.
  insert into public.knowledge_pending_vote_rounds(
    node_id,round_no,policy_version,initiator_id,initiator_side,
    eligible_user_snapshot,required_votes,opened_at,deadline,legacy_unfunded,round_kind
  ) values(
    anon_node,1,'ORIGINAL_DESIGN_V2',null,null,999,999,
    opened,opened+interval '720 hours',false,'INITIAL'
  ) returning id into ra;
  update public.knowledge_pending_vote_rounds set required_votes=required_votes+1 where id=ra;
  perform set_config('request.jwt.claim.sub',anonymous_user::text,true);
  begin
    perform public.cast_pending_knowledge_vote(
      anon_node,'AGREE','hardening-anon-'||gen_random_uuid()::text
    );
    raise exception 'anonymous public truth vote was accepted';
  exception when sqlstate '42501' then
    if position('参与公共知识投票' in sqlerrm)=0 then raise; end if;
  end;
  if exists(
    select 1 from public.knowledge_pending_votes
    where round_id=ra and voter_id=anonymous_user
  ) then
    raise exception 'anonymous ballot persisted';
  end if;

  -- Server rejects a forged logicRuleId even when type/topic/current-head checks pass.
  perform set_config('request.jwt.claim.sub',permanent_user::text,true);
  insert into public.public_knowledge_events(
    event_id,schema_version,event_type,envelope,actor_id
  ) values(
    target_event_id,1,'KnowledgeAdded',jsonb_build_object(
      'id',target_event_id,'type','KnowledgeAdded','scope','public','schemaVersion',1,
      'payload',jsonb_build_object(
        'edit',jsonb_build_object(
          'kind','add','mode','atomic','node',jsonb_build_object(
            'id',target_node,'title','Hardening Target','type','theorem',
            'reasoning','fixture','logicRuleId','modus-ponens'
          )
        ),
        'declaredLayers',jsonb_build_object(target_node,'middle')
      )
    ),permanent_user
  );
  insert into private.knowledge_lineage_members(
    node_id,topic_id,proposal,target_id,role,rank,revalidating
  ) values(target_node,topic,'new',null,'current',0,false);

  begin
    perform public.validate_public_knowledge_event(jsonb_build_object(
      'id','forged-rule-event','type','KnowledgeAdded','scope','public','schemaVersion',1,
      'payload',jsonb_build_object(
        'edit',jsonb_build_object(
          'kind','add','mode','atomic','node',jsonb_build_object(
            'id',candidate_id,'title','Hardening Candidate','type','theorem',
            'reasoning','candidate','logicRuleId','forged-rule'
          )
        ),
        'declaredLayers',jsonb_build_object(candidate_id,'middle'),
        'optimization',jsonb_build_object('targetId',target_node,'topicId',topic)
      )
    ));
    raise exception 'forged logicRuleId was accepted';
  exception when sqlstate '22023' then
    if position('logic-rule identity' in sqlerrm)=0 then raise; end if;
  end;

  -- Unicode compatibility-equivalent global title is rejected server-side.
  insert into public.public_knowledge_events(
    event_id,schema_version,event_type,envelope,actor_id
  ) values(
    duplicate_event_id,1,'KnowledgeAdded',jsonb_build_object(
      'id',duplicate_event_id,'type','KnowledgeAdded','scope','public','schemaVersion',1,
      'payload',jsonb_build_object(
        'edit',jsonb_build_object(
          'kind','add','mode','atomic','node',jsonb_build_object(
            'id',duplicate_node,'title','ＡＢＣ','type','theorem',
            'reasoning','fixture','logicRuleId','modus-ponens'
          )
        ),
        'declaredLayers',jsonb_build_object(duplicate_node,'middle')
      )
    ),permanent_user
  );

  begin
    perform public.validate_public_knowledge_event(jsonb_build_object(
      'id','unicode-duplicate-event','type','KnowledgeAdded','scope','public','schemaVersion',1,
      'payload',jsonb_build_object(
        'edit',jsonb_build_object(
          'kind','add','mode','atomic','node',jsonb_build_object(
            'id',unicode_candidate_id,'title','ABC','type','theorem',
            'reasoning','opposition','logicRuleId','modus-ponens'
          )
        ),
        'declaredLayers',jsonb_build_object(unicode_candidate_id,'middle'),
        'opposition',jsonb_build_object('targetId',target_node,'topicId',topic)
      )
    ));
    raise exception 'NFKC-equivalent duplicate title was accepted';
  exception when unique_violation then
    if position('title already exists' in sqlerrm)=0 then raise; end if;
  end;
end $$;

rollback;

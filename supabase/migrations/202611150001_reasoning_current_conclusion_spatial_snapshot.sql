-- The reasoning conclusion resolver now follows the topic's Current ball.
-- Existing snapshots contain positions anchored to historical conclusions, so
-- force a cache miss and allow the replacement geometry to be published.
do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.publish_public_spatial_snapshot(bigint,text,text,jsonb)'::regprocedure
  ) into function_definition;

  if position('deterministic-5r-isg-v1' in function_definition) = 0 then
    raise exception 'expected spatial snapshot publisher v1 guard was not found';
  end if;

  function_definition := replace(
    function_definition,
    'deterministic-5r-isg-v1',
    'deterministic-5r-isg-v2'
  );
  execute function_definition;
end
$migration$;

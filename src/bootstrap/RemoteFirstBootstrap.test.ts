import assert from 'node:assert/strict';
import { bootstrapRemoteFirst } from './RemoteFirstBootstrap';

const calls:string[]=[];
let remoteHasKnowledge=false;
const hosted=await bootstrapRemoteFirst({hosted:true,hydrateRemote:async()=>{calls.push('pull');remoteHasKnowledge=true;},hasKnowledge:()=>remoteHasKnowledge,seedDemo:async()=>{calls.push('seed');}});
assert.deepEqual(calls,['pull'],'remote hydration must finish without seeding a new browser');
assert.equal(hosted.seeded,false);

let localHasKnowledge=false;let localSeeds=0;
const localOptions={hosted:false,hydrateRemote:async()=>{throw new Error('local mode must not pull');},hasKnowledge:()=>localHasKnowledge,seedDemo:async()=>{localSeeds++;localHasKnowledge=true;}};
assert.equal((await bootstrapRemoteFirst(localOptions)).seeded,true);
assert.equal((await bootstrapRemoteFirst(localOptions)).seeded,false);
assert.equal(localSeeds,1,'demo initialization must be idempotent');
console.log('Remote-first bootstrap regression tests passed');

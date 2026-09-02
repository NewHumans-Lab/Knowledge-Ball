import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProjectionRenderScheduler } from './ProjectionRenderScheduler';
import {
  LIVEKIT_CLIENT_CDN,
  parseVoiceRoomStatusPayload,
  roomNameForNode,
} from './voice/VoiceRoomRuntime';

const queued: Array<() => void> = [];
let renders = 0;
const scheduler = new ProjectionRenderScheduler(
  () => { renders += 1; },
  callback => { queued.push(callback); },
);

for (let i = 0; i < 343; i += 1) scheduler.request();
assert.equal(queued.length, 1, '343 synchronous graph events must schedule one derived render');
assert.equal(renders, 0, 'derived render must wait for the scheduling boundary');
assert.equal(scheduler.isScheduled(), true);
queued.shift()!();
assert.equal(renders, 1, 'the burst must flush exactly once');
assert.equal(scheduler.flushCount(), 1);

scheduler.request();
assert.equal(queued.length, 1);
scheduler.flushNow();
assert.equal(renders, 2, 'flushNow must materialize a pending render once');
assert.equal(scheduler.isScheduled(), false);
queued.shift()!();
assert.equal(renders, 2, 'a stale scheduled callback must not double-render after flushNow');

scheduler.request();
queued.shift()!();
assert.equal(renders, 3, 'the scheduler must accept later independent bursts');
assert.equal(scheduler.flushCount(), 3);

assert.equal(roomNameForNode('n-voice-test'), 'knowledge:n-voice-test', 'node id must deterministically own one LiveKit room name');
assert.throws(() => roomNameForNode('bad room'), /Invalid voice-room node id/);
assert.deepEqual(parseVoiceRoomStatusPayload({ rooms: [
  { nodeId: 'n1', participants: 3, speaking: true },
  { nodeId: 'n2', participants: 0, speaking: true },
  { nodeId: 'bad room', participants: 2, speaking: true },
] }), [{ nodeId: 'n1', participants: 3, speaking: true }], 'only active, valid node rooms may become scene markers');
assert.match(LIVEKIT_CLIENT_CDN, /livekit-client@2\.22\.1/, 'browser SDK must be version-pinned');

const runtime = readFileSync('src/ui/voice/VoiceRoomRuntime.ts', 'utf8');
assert.doesNotMatch(runtime, /if \(Capacitor\.isNativePlatform\(\)\) return/, 'voice runtime must not be disabled on Android/iOS shells');
assert.match(runtime, /dataset\.voiceRoomNative/, 'native shells must initialize the same voice runtime instead of a separate fork');
assert.match(runtime, /pendingRoom/, 'join attempts must track an in-flight room so superseded connects can be disconnected');
assert.match(runtime, /joinSerial/, 'join attempts must be serialized and stale completions ignored');
assert.match(runtime, /micActionSerial/, 'microphone toggles must ignore completions from stale rooms');
assert.match(runtime, /voice-room-audio-start/, 'blocked autoplay must expose a user-gesture retry control');
assert.match(runtime, /SPEAKING_REPEAT_MS/, 'continuous local speech must keep sending bounded speaking heartbeats');
assert.match(runtime, /nextRoom\.connect\(response\.url, response\.token, \{ autoSubscribe: true \}\)/, 'join credentials must connect to LiveKit before controls are exposed');
assert.match(runtime, /nextRoom\.localParticipant\.setMicrophoneEnabled\(true\)/, 'joining must request microphone publication after LiveKit connects');
assert.match(runtime, /events\.TrackSubscribed/, 'remote audio tracks must be subscribed and attached');
assert.match(runtime, /events\.ActiveSpeakersChanged/, 'LiveKit active-speaker state must drive speaking feedback');
assert.match(runtime, /action: 'speaking'/, 'local speaking must heartbeat through the authenticated voice endpoint');
assert.match(runtime, /leaveButton\.addEventListener\('click', \(\) => \{ void leaveRoom\(\); \}\)/, 'leave control must disconnect the tracked room');
assert.match(runtime, /window\.addEventListener\('pageshow', resumeRuntime\)/, 'bfcache restores must resume voice status/render scheduling');
assert.match(runtime, /if \(wanted\.size > 0\) renderRaf = window\.requestAnimationFrame\(renderMarkers\)/, 'voice DOM rendering must sleep when there are no markers');
assert.match(runtime, /STATUS_BACKOFF_MAX_MS/, 'unavailable voice backends must use bounded polling backoff');
assert.match(runtime, /dataset\.livekitFailed/, 'failed CDN loads must be reset so a later join can retry');
assert.match(runtime, /min-width:44px;height:44px/, 'touch hit target must remain at least 44 CSS pixels on mobile');

const androidManifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
assert.match(androidManifest, /android\.permission\.RECORD_AUDIO/, 'Android package must declare microphone capture permission');
assert.match(androidManifest, /android\.permission\.MODIFY_AUDIO_SETTINGS/, 'Android package must allow WebRTC audio routing changes');
assert.match(androidManifest, /android\.hardware\.microphone[^>]+required="false"/, 'microphone hardware must remain optional for listener-only installs');

const iosInfoPlist = readFileSync('ios/App/App/Info.plist', 'utf8');
assert.match(iosInfoPlist, /NSMicrophoneUsageDescription/, 'iOS package must provide the system microphone privacy prompt description');
assert.match(iosInfoPlist, /knowledge node voice room/i, 'iOS microphone prompt must explain the voice-room purpose');

const edgeFunction = readFileSync('supabase/functions/livekit-voice/index.ts', 'utf8');
assert.match(edgeFunction, /livekit-server-sdk@2\.18\.0/, 'server SDK must be version-pinned');
assert.match(edgeFunction, /TrackSource\s*}\s*from\s*'npm:livekit-server-sdk@2\.18\.0'/, 'server SDK must expose the protocol TrackSource enum used by grants');
assert.match(edgeFunction, /canPublishSources:\s*\[TrackSource\.MICROPHONE\]/, 'join token must authorize only the protocol microphone source');
assert.doesNotMatch(edgeFunction, /canPublishSources:\s*\['microphone'\]/, 'join token must never pass string track-source values that crash JWT serialization');
assert.match(edgeFunction, /canPublishData:\s*false/, 'voice participants must not gain a data-publish side channel');
assert.match(edgeFunction, /roomService\.listRooms\(\)/, 'participant counts must come from active LiveKit rooms');
assert.match(edgeFunction, /roomService\.getParticipant\(targetRoom, participantIdentity\)/, 'speaking heartbeat must verify the caller is currently in the room');
assert.match(edgeFunction, /roomService\.updateRoomMetadata/, 'speaking state must stay ephemeral in LiveKit room metadata');
assert.match(edgeFunction, /requireDeclaredNode\(nodeId, accessToken\)/, 'join tokens must only be minted for node IDs present in the authoritative public event stream');
assert.match(edgeFunction, /public_knowledge_events/, 'node existence validation must use the authoritative public knowledge stream');
assert.match(edgeFunction, /NODE_CACHE_TTL_MS/, 'node declaration lookup must be cached rather than rescanning on every join');
assert.doesNotMatch(edgeFunction, /declaredNodeIds\(accessToken,\s*true\)/, 'negative node lookups must honor the cache TTL instead of forcing a full event-stream rescan');
assert.doesNotMatch(edgeFunction, /createRoom\(/, 'rooms must remain lazy and auto-create only when somebody joins');
assert.doesNotMatch(edgeFunction, /camera|screen_share/, 'voice join grants must not authorize camera or screen sharing');

console.log('Projection render scheduler + end-to-end node voice-room regression tests passed');

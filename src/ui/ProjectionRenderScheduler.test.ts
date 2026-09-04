import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProjectionRenderScheduler } from './ProjectionRenderScheduler';
import {
  CORE_ONBOARDING_OWNER_KEY,
  CORE_ONBOARDING_STEP_IDS,
  CORE_ONBOARDING_STORAGE_KEY,
  persistCoreOnboardingStatus,
  shouldOfferCoreOnboarding,
} from './onboarding/CoreOnboardingRuntime';
import {
  LIVEKIT_CLIENT_CDN,
  SUPABASE_REALTIME_CDN,
  VOICE_ROOM_STATUS_TOPIC,
  parseVoiceRoomStatusPayload,
  roomNameForNode,
} from './voice/VoiceRoomRuntime';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

assert.deepEqual([...CORE_ONBOARDING_STEP_IDS], ['zoom', 'rotate', 'longpress', 'tap', 'voice'], 'newcomer guide must contain only the five requested core controls in the requested order');
assert.equal(CORE_ONBOARDING_STORAGE_KEY, 'knowledge-ball.core-onboarding.v1');
assert.equal(CORE_ONBOARDING_OWNER_KEY, 'knowledge-ball.core-onboarding-owner.v1');
const freshStorage = new MemoryStorage();
assert.equal(shouldOfferCoreOnboarding(freshStorage), true, 'a genuinely fresh browser may receive onboarding');
const localeOnlyStorage = new MemoryStorage();
localeOnlyStorage.setItem('knowledge-ball.locale.v1', 'en');
assert.equal(shouldOfferCoreOnboarding(localeOnlyStorage), true, 'choosing a locale alone must not make a newcomer look experienced');
const returningStorage = new MemoryStorage();
returningStorage.setItem('knowledge-ball.supabase-guest-session.v1', '{}');
assert.equal(shouldOfferCoreOnboarding(returningStorage), false, 'existing Knowledge Ball usage must suppress rollout onboarding for returning users');
const skippedStorage = new MemoryStorage();
assert.equal(persistCoreOnboardingStatus(skippedStorage, 'skipped', 'user-a'), true);
assert.equal(skippedStorage.getItem(CORE_ONBOARDING_OWNER_KEY), 'user-a', 'local final state must remember which identity owns it');
assert.equal(shouldOfferCoreOnboarding(skippedStorage), false, 'skip must permanently suppress automatic onboarding');
const completedStorage = new MemoryStorage();
assert.equal(persistCoreOnboardingStatus(completedStorage, 'completed', 'user-b'), true);
assert.equal(completedStorage.getItem(CORE_ONBOARDING_OWNER_KEY), 'user-b', 'completion must remain account-scoped locally');
assert.equal(shouldOfferCoreOnboarding(completedStorage), false, 'completion must permanently suppress automatic onboarding');
assert.equal(shouldOfferCoreOnboarding(null), false, 'when durable browser storage is unavailable onboarding must fail closed rather than repeat');

const onboardingRuntime = readFileSync('src/ui/onboarding/CoreOnboardingRuntime.ts', 'utf8');
assert.match(onboardingRuntime, /AUTO_START_ELIGIBLE = shouldOfferCoreOnboarding\(safeLocalStorage\(\)\)/, 'newcomer eligibility must be captured before current startup can create session/sync storage');
assert.match(onboardingRuntime, /reconcileCoreOnboardingAccount\(AUTO_START_ELIGIBLE\)/, 'automatic onboarding must reconcile the account before it opens');
assert.match(onboardingRuntime, /set_core_onboarding_status/, 'final onboarding state must be written through the dedicated authenticated account RPC');
assert.match(onboardingRuntime, /ensure_anonymous_profile/, 'account sync must reuse and ensure the current immutable profile rather than create a second identity model');
assert.match(onboardingRuntime, /localOwner !== identity\.userId/, 'one browser must not upload one account onboarding state into another account after login switching');
assert.match(onboardingRuntime, /form\.id !== 'kbAuthForm'/, 'username/password identity changes must trigger a fresh account-state reconciliation');
assert.match(onboardingRuntime, /#nodeDetailOverlay\.open \.voice-detail-mic/, 'voice step must target the real node-detail microphone control when it is visible');
assert.match(onboardingRuntime, /min-height:44px/, 'onboarding controls must remain at least 44 CSS pixels high for mobile touch');
assert.match(onboardingRuntime, /prefers-reduced-motion:reduce/, 'onboarding spotlight motion must respect reduced-motion preference');
assert.doesNotMatch(onboardingRuntime, /from '@capacitor\/core'/, 'onboarding must remain one shared Web runtime instead of platform-specific forks');

const onboardingMigration = readFileSync('supabase/migrations/202609040001_core_onboarding_account_status.sql', 'utf8');
assert.match(onboardingMigration, /add column if not exists core_onboarding_status text/i, 'account profile must persist the final onboarding state');
assert.match(onboardingMigration, /core_onboarding_status in \('completed', 'skipped'\)/i, 'database must reject non-final onboarding states');
assert.match(onboardingMigration, /and core_onboarding_status is null/i, 'account onboarding state must be first-write-only and impossible to reset through the RPC');
assert.match(onboardingMigration, /where user_id = actor/i, 'onboarding RPC must only mutate the current auth.uid profile');
assert.match(onboardingMigration, /revoke all on function public\.set_core_onboarding_status\(text\) from public, anon/i, 'anonymous/public roles must not bypass authenticated RPC ownership');
assert.match(onboardingMigration, /grant execute on function public\.set_core_onboarding_status\(text\) to authenticated/i, 'the current Supabase identity may persist its own final state');
assert.match(onboardingMigration, /'core_onboarding_status', p\.core_onboarding_status/i, 'get_my_account must return the cross-device onboarding state');
assert.match(onboardingMigration, /202609040001/, 'schema version must advance with account onboarding persistence');

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
assert.match(SUPABASE_REALTIME_CDN, /supabase-js@2\.109\.0/, 'Realtime browser SDK must be version-pinned');
assert.equal(VOICE_ROOM_STATUS_TOPIC, 'voice-room-status', 'all clients must share exactly one voice status Broadcast topic');

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
assert.match(runtime, /window\.addEventListener\('pageshow', resumeRuntime\)/, 'bfcache restores must resume voice rendering');
assert.match(runtime, /if \(wanted\.size > 0\) renderRaf = window\.requestAnimationFrame\(renderMarkers\)/, 'voice DOM rendering must sleep when there are no markers');
assert.doesNotMatch(runtime, /STATUS_INTERVAL_MS|STATUS_BACKOFF_MAX_MS|scheduleStatus|statusTimer/, 'voice room counts must never return to timer polling');
assert.match(runtime, /await refreshStatus\(\);[\s\S]*await connectStatusRealtime\(\);/, 'client must take one initial snapshot before establishing Realtime');
assert.match(runtime, /channel\(VOICE_ROOM_STATUS_TOPIC, \{ config: \{ private: true \} \}\)/, 'voice count updates must use one private Broadcast channel');
assert.match(runtime, /\.on\('broadcast', \{ event: 'voice_room_status_changed' \}/, 'voice count changes must arrive through Broadcast');
assert.match(runtime, /client\.realtime\.setAuth\(session\.access_token\)/, 'private Realtime must authenticate with the existing Supabase session');
assert.match(runtime, /accessToken: async \(\) => \(await statusAuthClient\.session\(\)\)\.access_token/, 'the same Realtime connection must refresh its JWT without status polling');
assert.doesNotMatch(runtime, /ParticipantConnected[^\n]+refreshStatus|ParticipantDisconnected[^\n]+refreshStatus/, 'LiveKit participant events must not trigger client status queries');
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
assert.match(edgeFunction, /roomService\.listRooms\(\)/, 'the one-time opening snapshot must come from active LiveKit rooms');
assert.match(edgeFunction, /roomService\.getParticipant\(targetRoom, participantIdentity\)/, 'speaking heartbeat must verify the caller is currently in the room');
assert.match(edgeFunction, /roomService\.updateRoomMetadata/, 'speaking state must stay ephemeral in LiveKit room metadata');
assert.match(edgeFunction, /requireDeclaredNode\(nodeId, accessToken\)/, 'join tokens must only be minted for node IDs present in the authoritative public event stream');
assert.match(edgeFunction, /public_knowledge_events/, 'node existence validation must use the authoritative public knowledge stream');
assert.match(edgeFunction, /NODE_CACHE_TTL_MS/, 'node declaration lookup must be cached rather than rescanning on every join');
assert.doesNotMatch(edgeFunction, /declaredNodeIds\(accessToken,\s*true\)/, 'negative node lookups must honor the cache TTL instead of forcing a full event-stream rescan');
assert.doesNotMatch(edgeFunction, /createRoom\(/, 'rooms must remain lazy and auto-create only when somebody joins');
assert.doesNotMatch(edgeFunction, /camera|screen_share/, 'voice join grants must not authorize camera or screen sharing');

const webhookFunction = readFileSync('supabase/functions/livekit-webhook/index.ts', 'utf8');
assert.match(webhookFunction, /WebhookReceiver/, 'LiveKit webhooks must be cryptographically verified');
assert.match(webhookFunction, /participant_joined/, 'join webhooks must update voice room status');
assert.match(webhookFunction, /participant_left/, 'leave webhooks must update voice room status');
assert.match(webhookFunction, /roomService\.listParticipants\(roomName\)/, 'each webhook must resolve the current room participant count once');
assert.match(webhookFunction, /voice_room_status/, 'webhook status must be persisted in voice_room_status');
assert.match(webhookFunction, /on_conflict=node_id/, 'room status writes must upsert one row per knowledge node');

const voiceMigration = readFileSync('supabase/migrations/202609030003_voice_room_status_realtime.sql', 'utf8');
assert.match(voiceMigration, /create table if not exists public\.voice_room_status/i, 'migration must create the voice room snapshot table');
assert.match(voiceMigration, /realtime\.send\(/, 'database status changes must use Realtime Broadcast');
assert.match(voiceMigration, /'voice-room-status'/, 'database Broadcast topic must match the client topic');
assert.match(voiceMigration, /'voice_room_status_changed'/, 'database Broadcast event must match the client listener');
assert.match(voiceMigration, /on realtime\.messages/i, 'private Broadcast must be protected by Realtime Authorization');

const supabaseConfig = readFileSync('supabase/config.toml', 'utf8');
assert.match(supabaseConfig, /\[functions\.livekit-webhook\][\s\S]*verify_jwt\s*=\s*false/, 'external LiveKit webhook must bypass Supabase JWT verification and use LiveKit signature verification');

console.log('Projection render scheduler + account-scoped newcomer onboarding + end-to-end node voice-room regression tests passed');

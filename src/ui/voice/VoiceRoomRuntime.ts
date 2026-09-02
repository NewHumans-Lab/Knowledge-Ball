import { Capacitor } from '@capacitor/core';
import { createProductionAuthClient } from '../../auth/AuthClient';

export const LIVEKIT_CLIENT_CDN = 'https://cdn.jsdelivr.net/npm/livekit-client@2.22.1/dist/livekit-client.umd.min.js';
export const VOICE_ROOM_PREFIX = 'knowledge:';
const STATUS_INTERVAL_MS = 2500;
const STATUS_BACKOFF_MAX_MS = 60_000;
const SPEAKING_HEARTBEAT_MS = 900;
const SPEAKING_REPEAT_MS = 1500;

export interface VoiceRoomStatus {
  nodeId: string;
  participants: number;
  speaking: boolean;
}

export function roomNameForNode(nodeId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(nodeId)) throw new Error('Invalid voice-room node id');
  return `${VOICE_ROOM_PREFIX}${nodeId}`;
}

export function parseVoiceRoomStatusPayload(value: unknown): VoiceRoomStatus[] {
  const body = value as { rooms?: unknown };
  if (!Array.isArray(body?.rooms)) throw new Error('Invalid voice room status payload');
  const rooms: VoiceRoomStatus[] = [];
  for (const raw of body.rooms) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const nodeId = typeof item.nodeId === 'string' ? item.nodeId : '';
    const participants = Number(item.participants);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(nodeId)) continue;
    if (!Number.isSafeInteger(participants) || participants < 1) continue;
    rooms.push({ nodeId, participants, speaking: item.speaking === true });
  }
  return rooms;
}

type DebugScene = {
  screenPositionForNode: (id: string) => { x: number; y: number } | null;
};
type DebugNode = { id: string; title?: string };
type VoiceDebug = { scene?: DebugScene; renderNodes?: DebugNode[] };
type RemoteTrack = {
  kind?: string;
  attach?: () => HTMLElement;
  detach?: () => HTMLElement[];
};
type LiveKitParticipant = { identity?: string };
type LiveKitLocalParticipant = LiveKitParticipant & {
  setMicrophoneEnabled: (enabled: boolean) => Promise<unknown>;
};
type LiveKitRoom = {
  localParticipant: LiveKitLocalParticipant;
  connect: (url: string, token: string, options?: Record<string, unknown>) => Promise<void>;
  disconnect: () => Promise<void> | void;
  startAudio?: () => Promise<void>;
  on: (event: string, listener: (...args: unknown[]) => void) => LiveKitRoom;
};
type LiveKitGlobal = {
  Room: new (options?: Record<string, unknown>) => LiveKitRoom;
  RoomEvent: Record<string, string>;
  isBrowserSupported?: () => boolean;
};

type JoinResponse = {
  url: string;
  token: string;
  participantIdentity: string;
  nodeId: string;
};

class VoiceServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function getDebug(): VoiceDebug | undefined {
  return (window as unknown as { __debug?: VoiceDebug }).__debug;
}

function isChinese(): boolean {
  return document.documentElement.lang.toLowerCase().startsWith('zh');
}

function text(zh: string, en: string): string {
  return isChinese() ? zh : en;
}

function installStyles(): void {
  if (document.getElementById('voice-room-runtime-style')) return;
  const style = document.createElement('style');
  style.id = 'voice-room-runtime-style';
  style.textContent = `
    .voice-room-layer{position:absolute;inset:0;z-index:12;pointer-events:none;overflow:hidden}
    .voice-node-marker{position:absolute;display:block;transform:translate(-50%,-50%);pointer-events:none;
      min-width:44px;height:44px;padding:0;border:0;background:transparent;color:var(--accent-primary,#55ECFF)}
    .voice-node-marker[hidden]{display:none}
    .voice-node-visual{position:relative;display:block;width:44px;height:44px;pointer-events:none}
    .voice-node-count{position:absolute;left:24px;top:50%;transform:translateY(-50%);min-width:14px;padding:2px 4px;border-radius:8px;
      background:rgba(8,13,32,.72);color:var(--ink-dim,#B6C7DE);font:600 10px/1 Inter,'Noto Sans SC',sans-serif;text-align:center;white-space:nowrap;
      box-shadow:0 0 0 1px rgba(85,236,255,.18);backdrop-filter:blur(4px)}
    .voice-ripple{position:absolute;left:50%;top:50%;width:1px;height:1px;display:none;pointer-events:none}
    .voice-node-marker.speaking .voice-ripple{display:block}
    .voice-ripple i{position:absolute;left:0;top:0;width:18px;height:18px;border:1px solid rgba(85,236,255,.62);border-radius:50%;
      transform:translate(-50%,-50%) scale(.22);opacity:0;box-shadow:0 0 8px rgba(85,236,255,.12);
      animation:voice-water-ripple 1.65s cubic-bezier(.16,.72,.26,1) infinite;will-change:transform,opacity}
    .voice-ripple i:nth-child(2){animation-delay:.48s}.voice-ripple i:nth-child(3){animation-delay:.96s}
    @keyframes voice-water-ripple{
      0%{transform:translate(-50%,-50%) scale(.22);opacity:.72}
      34%{opacity:.44}
      100%{transform:translate(-50%,-50%) scale(3.45);opacity:0}
    }
    .voice-detail-mic{position:absolute;left:50%;top:4px;z-index:4;transform:translateX(-50%);width:52px;height:52px;padding:0;
      display:flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid rgba(85,236,255,.42);background:rgba(8,13,32,.88);
      color:#DFF7FF;font:500 24px/1 'Inter','Noto Sans SC',sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.26);backdrop-filter:blur(6px)}
    .voice-detail-mic ~ .node-detail-title{margin-top:28px}
    .voice-detail-mic:hover,.voice-detail-mic:focus-visible{border-color:rgba(85,236,255,.78);background:rgba(85,236,255,.10);outline:none}
    .voice-detail-mic.active{border-color:var(--accent-primary,#55ECFF);color:var(--accent-primary,#55ECFF);box-shadow:0 0 0 2px rgba(85,236,255,.10),0 8px 24px rgba(0,0,0,.26)}
    .voice-room-panel{position:absolute;left:50%;bottom:72px;z-index:48;transform:translateX(-50%);display:none;align-items:center;gap:8px;
      max-width:min(92vw,560px);padding:8px 10px;border:1px solid var(--panel-border,rgba(120,190,255,.2));border-radius:14px;background:rgba(8,13,32,.94);
      box-shadow:0 12px 36px rgba(0,0,0,.38);color:var(--ink,#F3F8FF);font:500 11px/1.25 Inter,'Noto Sans SC',sans-serif}
    .voice-room-panel.open{display:flex}.voice-room-title{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
    .voice-room-count{color:var(--ink-faint,#71829D);white-space:nowrap}.voice-room-action{min-height:34px;border:1px solid var(--panel-border,rgba(120,190,255,.2));background:transparent;
      color:var(--ink,#F3F8FF);border-radius:10px;padding:6px 9px;font:600 11px/1 Inter,'Noto Sans SC',sans-serif;cursor:pointer}
    .voice-room-action:hover{border-color:var(--accent-primary,#55ECFF)}.voice-room-action.muted{color:var(--ink-faint,#71829D)}
    .voice-room-action[hidden]{display:none}
    .voice-room-toast{position:absolute;left:50%;bottom:118px;z-index:80;transform:translateX(-50%) translateY(8px);opacity:0;pointer-events:none;
      max-width:min(88vw,440px);padding:8px 12px;border:1px solid rgba(85,236,255,.35);border-radius:9px;background:rgba(8,13,32,.95);color:var(--ink,#F3F8FF);
      font:500 11px/1.4 Inter,'Noto Sans SC',sans-serif;transition:opacity .18s,transform .18s;text-align:center}
    .voice-room-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
    .voice-room-audio{display:none}
    @media(max-width:640px){
      .voice-node-count{left:22px;font-size:9px}
      .voice-detail-mic{top:2px;width:52px;height:52px;font-size:24px}
      .voice-detail-mic ~ .node-detail-title{margin-top:28px}
      .voice-room-panel{bottom:70px;max-width:94vw}.voice-room-title{max-width:120px}
    }
  `;
  document.head.appendChild(style);
}

function createMarker(nodeId: string): HTMLDivElement {
  const marker = document.createElement('div');
  marker.className = 'voice-node-marker';
  marker.dataset.voiceNodeId = nodeId;
  marker.setAttribute('aria-hidden', 'true');
  marker.innerHTML = '<span class="voice-node-visual"><span class="voice-node-count">0</span><span class="voice-ripple"><i></i><i></i><i></i></span></span>';
  return marker;
}

let liveKitLoadPromise: Promise<LiveKitGlobal> | null = null;

function loadLiveKit(): Promise<LiveKitGlobal> {
  const current = (window as unknown as { LivekitClient?: LiveKitGlobal }).LivekitClient;
  if (current) return Promise.resolve(current);
  if (liveKitLoadPromise) return liveKitLoadPromise;

  liveKitLoadPromise = new Promise((resolve, reject) => {
    let existing = document.querySelector<HTMLScriptElement>('script[data-knowledge-ball-livekit]');
    if (existing?.dataset.livekitFailed === '1' || existing?.dataset.livekitLoaded === '1') {
      existing.remove();
      existing = null;
    }
    const script = existing ?? document.createElement('script');
    const cleanupFailure = () => {
      script.dataset.livekitFailed = '1';
      script.remove();
      liveKitLoadPromise = null;
      reject(new Error('LiveKit SDK failed to load'));
    };
    const finish = () => {
      const sdk = (window as unknown as { LivekitClient?: LiveKitGlobal }).LivekitClient;
      if (!sdk) {
        cleanupFailure();
        return;
      }
      script.dataset.livekitLoaded = '1';
      resolve(sdk);
    };
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', cleanupFailure, { once: true });
    if (!existing) {
      script.src = LIVEKIT_CLIENT_CDN;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.knowledgeBallLivekit = '1';
      document.head.appendChild(script);
    }
  });

  return liveKitLoadPromise;
}

export function installVoiceRoomRuntime(): void {
  if (Capacitor.isNativePlatform()) return;
  if (document.documentElement.dataset.voiceRoomRuntime === '1') return;
  const main = document.querySelector<HTMLElement>('.main');
  if (!main) return;
  document.documentElement.dataset.voiceRoomRuntime = '1';
  installStyles();

  const layer = document.createElement('div');
  layer.className = 'voice-room-layer';
  layer.setAttribute('aria-label', 'Knowledge node voice rooms');
  main.appendChild(layer);

  const panel = document.createElement('div');
  panel.className = 'voice-room-panel';
  panel.innerHTML = '<span class="voice-room-title"></span><span class="voice-room-count"></span><button type="button" class="voice-room-action voice-room-audio-start" hidden></button><button type="button" class="voice-room-action voice-room-mic"></button><button type="button" class="voice-room-action voice-room-leave"></button>';
  main.appendChild(panel);
  const panelTitle = panel.querySelector<HTMLElement>('.voice-room-title')!;
  const panelCount = panel.querySelector<HTMLElement>('.voice-room-count')!;
  const audioButton = panel.querySelector<HTMLButtonElement>('.voice-room-audio-start')!;
  const micButton = panel.querySelector<HTMLButtonElement>('.voice-room-mic')!;
  const leaveButton = panel.querySelector<HTMLButtonElement>('.voice-room-leave')!;

  const toast = document.createElement('div');
  toast.className = 'voice-room-toast';
  main.appendChild(toast);
  let toastTimer: number | null = null;
  const showToast = (message: string) => {
    toast.textContent = message;
    toast.classList.add('show');
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
  };

  const audioMount = document.createElement('div');
  audioMount.className = 'voice-room-audio';
  audioMount.setAttribute('aria-hidden', 'true');
  main.appendChild(audioMount);

  const authClient = createProductionAuthClient();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '') ?? '';
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  const statuses = new Map<string, VoiceRoomStatus>();
  const markers = new Map<string, HTMLDivElement>();

  let room: LiveKitRoom | null = null;
  let pendingRoom: LiveKitRoom | null = null;
  let livekit: LiveKitGlobal | null = null;
  let currentNodeId: string | null = null;
  let participantIdentity = '';
  let micEnabled = false;
  let audioBlocked = false;
  let localSpeaking = false;
  let lastSpeakingHeartbeat = 0;
  let speakingTimer: number | null = null;
  let statusTimer: number | null = null;
  let statusFailures = 0;
  let renderRaf = 0;
  let stopped = false;
  let joinSerial = 0;
  let micActionSerial = 0;

  const voiceRequest = async (payload: Record<string, unknown>): Promise<unknown> => {
    if (!authClient || !supabaseUrl || !publishableKey) {
      throw new VoiceServiceError(text('语音服务尚未配置', 'Voice service is not configured'), 503);
    }
    const session = await authClient.session();
    const response = await fetch(`${supabaseUrl}/functions/v1/livekit-voice`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof body.error === 'string' ? body.error : text('语音服务请求失败', 'Voice service request failed');
      throw new VoiceServiceError(message, response.status);
    }
    return body;
  };

  const wantedMarkerIds = () => {
    const detailId = document.querySelector<HTMLElement>('#nodeDetailOverlay.open[data-node-id]')?.dataset.nodeId ?? null;
    const wanted = new Set(statuses.keys());
    if (detailId) wanted.add(detailId);
    if (currentNodeId) wanted.add(currentNodeId);
    return wanted;
  };

  const ensureRenderLoop = () => {
    if (stopped || renderRaf !== 0) return;
    renderRaf = window.requestAnimationFrame(renderMarkers);
  };

  const scheduleStatus = (delay: number) => {
    if (stopped) return;
    if (statusTimer !== null) window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      statusTimer = null;
      void refreshStatus();
    }, delay);
  };

  const refreshStatus = async () => {
    if (stopped) return;
    try {
      const next = parseVoiceRoomStatusPayload(await voiceRequest({ action: 'status' }));
      statuses.clear();
      for (const item of next) statuses.set(item.nodeId, item);
      statusFailures = 0;
      ensureRenderLoop();
      scheduleStatus(document.hidden ? 15_000 : STATUS_INTERVAL_MS);
    } catch (error) {
      statusFailures += 1;
      if (import.meta.env.DEV) console.debug('[Knowledge-Ball voice] status unavailable', error);
      const permanentConfigurationError = error instanceof VoiceServiceError && error.status === 503;
      const exponential = Math.min(STATUS_BACKOFF_MAX_MS, STATUS_INTERVAL_MS * (2 ** Math.min(statusFailures, 5)));
      const delay = document.hidden ? STATUS_BACKOFF_MAX_MS : permanentConfigurationError ? STATUS_BACKOFF_MAX_MS : exponential;
      scheduleStatus(delay);
    }
  };

  const remoteTrackSubscribed = (trackValue: unknown) => {
    const track = trackValue as RemoteTrack;
    if (track.kind !== 'audio' || typeof track.attach !== 'function') return;
    const element = track.attach();
    element.setAttribute('data-voice-room-audio', '1');
    audioMount.appendChild(element);
  };

  const remoteTrackUnsubscribed = (trackValue: unknown) => {
    const track = trackValue as RemoteTrack;
    if (typeof track.detach !== 'function') return;
    for (const element of track.detach()) element.remove();
  };

  const clearSpeakingLoop = () => {
    localSpeaking = false;
    if (speakingTimer !== null) {
      window.clearInterval(speakingTimer);
      speakingTimer = null;
    }
  };

  const sendSpeakingHeartbeat = () => {
    if (!currentNodeId || !participantIdentity || !micEnabled || !localSpeaking) return;
    const now = Date.now();
    if (now - lastSpeakingHeartbeat < SPEAKING_HEARTBEAT_MS) return;
    lastSpeakingHeartbeat = now;
    void voiceRequest({ action: 'speaking', nodeId: currentNodeId, participantIdentity }).catch(() => undefined);
  };

  const setLocalSpeaking = (speaking: boolean) => {
    localSpeaking = speaking && micEnabled;
    if (!localSpeaking) {
      if (speakingTimer !== null) {
        window.clearInterval(speakingTimer);
        speakingTimer = null;
      }
      return;
    }
    sendSpeakingHeartbeat();
    if (speakingTimer === null) speakingTimer = window.setInterval(sendSpeakingHeartbeat, SPEAKING_REPEAT_MS);
  };

  const updatePanel = () => {
    if (!currentNodeId) {
      panel.classList.remove('open');
      return;
    }
    const node = getDebug()?.renderNodes?.find(item => item.id === currentNodeId);
    panelTitle.textContent = node?.title || currentNodeId;
    panelCount.textContent = text(`${statuses.get(currentNodeId)?.participants ?? 1} 人`, `${statuses.get(currentNodeId)?.participants ?? 1} people`);
    audioButton.textContent = text('播放声音', 'Enable audio');
    audioButton.hidden = !audioBlocked;
    micButton.textContent = micEnabled ? text('静音', 'Mute') : text('开麦', 'Unmute');
    micButton.classList.toggle('muted', !micEnabled);
    leaveButton.textContent = text('离开', 'Leave');
    panel.classList.add('open');
  };

  const resetSessionUi = () => {
    currentNodeId = null;
    participantIdentity = '';
    micEnabled = false;
    audioBlocked = false;
    micActionSerial += 1;
    clearSpeakingLoop();
    for (const element of audioMount.querySelectorAll('[data-voice-room-audio]')) element.remove();
    panel.classList.remove('open');
  };

  const disconnectTrackedRooms = async () => {
    const active = room;
    const pending = pendingRoom;
    room = null;
    pendingRoom = null;
    resetSessionUi();
    const targets = new Set<LiveKitRoom>();
    if (active) targets.add(active);
    if (pending) targets.add(pending);
    await Promise.all([...targets].map(target => Promise.resolve(target.disconnect()).catch(() => undefined)));
  };

  const leaveRoom = async () => {
    joinSerial += 1;
    await disconnectTrackedRooms();
    ensureRenderLoop();
    void refreshStatus();
  };

  const joinRoom = async (nodeId: string) => {
    roomNameForNode(nodeId);
    if (currentNodeId === nodeId && room) return;

    const attempt = ++joinSerial;
    const stale = () => stopped || attempt !== joinSerial;

    try {
      await disconnectTrackedRooms();
      if (stale()) return;

      livekit = livekit ?? await loadLiveKit();
      if (stale()) return;
      if (livekit.isBrowserSupported && !livekit.isBrowserSupported()) {
        throw new Error(text('当前浏览器不支持实时语音', 'This browser does not support realtime voice'));
      }

      const response = await voiceRequest({ action: 'join', nodeId }) as Partial<JoinResponse>;
      if (stale()) return;
      if (
        response.nodeId !== nodeId
        || typeof response.url !== 'string'
        || typeof response.token !== 'string'
        || typeof response.participantIdentity !== 'string'
      ) {
        throw new Error(text('语音房凭证无效', 'Invalid voice-room credentials'));
      }

      const nextParticipantIdentity = response.participantIdentity;
      const nextRoom = new livekit.Room({ adaptiveStream: false, dynacast: false });
      pendingRoom = nextRoom;
      const events = livekit.RoomEvent;

      nextRoom.on(events.TrackSubscribed, remoteTrackSubscribed);
      nextRoom.on(events.TrackUnsubscribed, remoteTrackUnsubscribed);
      nextRoom.on(events.ParticipantConnected, () => { if (room === nextRoom) void refreshStatus(); });
      nextRoom.on(events.ParticipantDisconnected, () => { if (room === nextRoom) void refreshStatus(); });
      nextRoom.on(events.ActiveSpeakersChanged, (speakersValue: unknown) => {
        if (room !== nextRoom || !Array.isArray(speakersValue)) return;
        const speakingLocally = speakersValue.some(value => (value as LiveKitParticipant)?.identity === nextParticipantIdentity);
        setLocalSpeaking(speakingLocally);
      });
      if (events.AudioPlaybackStatusChanged) {
        nextRoom.on(events.AudioPlaybackStatusChanged, (canPlayValue: unknown) => {
          if (room !== nextRoom) return;
          const canPlay = canPlayValue === true;
          audioBlocked = !canPlay;
          updatePanel();
        });
      }
      nextRoom.on(events.Disconnected, () => {
        if (room !== nextRoom && pendingRoom !== nextRoom) return;
        if (pendingRoom === nextRoom) pendingRoom = null;
        if (room === nextRoom) room = null;
        if (currentNodeId === nodeId) resetSessionUi();
        ensureRenderLoop();
        void refreshStatus();
      });

      await nextRoom.connect(response.url, response.token, { autoSubscribe: true });
      if (stale()) {
        if (pendingRoom === nextRoom) pendingRoom = null;
        await Promise.resolve(nextRoom.disconnect()).catch(() => undefined);
        return;
      }

      pendingRoom = null;
      room = nextRoom;
      currentNodeId = nodeId;
      participantIdentity = nextParticipantIdentity;

      if (typeof nextRoom.startAudio === 'function') {
        try {
          await nextRoom.startAudio();
          if (!stale() && room === nextRoom) audioBlocked = false;
        } catch {
          if (!stale() && room === nextRoom) {
            audioBlocked = true;
            showToast(text('浏览器阻止了自动播放，请点“播放声音”', 'Audio playback is blocked; tap “Enable audio”'));
          }
        }
      }

      try {
        await nextRoom.localParticipant.setMicrophoneEnabled(true);
        if (!stale() && room === nextRoom) micEnabled = true;
      } catch {
        if (!stale() && room === nextRoom) {
          micEnabled = false;
          showToast(text('已进入语音房；麦克风未授权，可作为听众', 'Joined as listener; microphone permission was not granted'));
        }
      }

      if (stale() || room !== nextRoom) {
        await Promise.resolve(nextRoom.disconnect()).catch(() => undefined);
        return;
      }
      updatePanel();
      ensureRenderLoop();
      await refreshStatus();
    } catch (error) {
      if (stale()) return;
      await disconnectTrackedRooms();
      showToast(error instanceof Error ? error.message : text('无法进入语音房', 'Unable to join voice room'));
    }
  };

  const syncDetailVoiceButton = () => {
    const detail = document.querySelector<HTMLElement>('#nodeDetailOverlay.open[data-node-id]');
    if (!detail?.dataset.nodeId) return;
    let button = detail.querySelector<HTMLButtonElement>(':scope > .voice-detail-mic');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'voice-detail-mic';
      button.textContent = '🎙';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const nodeId = button?.dataset.voiceNodeId;
        if (nodeId) void joinRoom(nodeId);
      });
      detail.prepend(button);
    }
    const nodeId = detail.dataset.nodeId;
    button.dataset.voiceNodeId = nodeId;
    button.classList.toggle('active', currentNodeId === nodeId && room !== null);
    button.title = text('进入这个知识节点的语音房', 'Join this knowledge node voice room');
    button.setAttribute('aria-label', button.title);
  };

  audioButton.addEventListener('click', () => {
    const targetRoom = room;
    if (!targetRoom || typeof targetRoom.startAudio !== 'function') return;
    void targetRoom.startAudio().then(() => {
      if (room !== targetRoom) return;
      audioBlocked = false;
      updatePanel();
    }).catch(error => {
      if (room !== targetRoom) return;
      showToast(error instanceof Error ? error.message : text('声音播放仍被浏览器阻止', 'Audio playback is still blocked'));
    });
  });

  micButton.addEventListener('click', () => {
    const targetRoom = room;
    const targetNodeId = currentNodeId;
    if (!targetRoom || !targetNodeId) return;
    const next = !micEnabled;
    const operation = ++micActionSerial;
    void targetRoom.localParticipant.setMicrophoneEnabled(next).then(() => {
      if (room !== targetRoom || currentNodeId !== targetNodeId || operation !== micActionSerial) return;
      micEnabled = next;
      if (!next) setLocalSpeaking(false);
      updatePanel();
    }).catch(error => {
      if (room !== targetRoom || currentNodeId !== targetNodeId || operation !== micActionSerial) return;
      showToast(error instanceof Error ? error.message : text('麦克风操作失败', 'Microphone operation failed'));
    });
  });

  leaveButton.addEventListener('click', () => { void leaveRoom(); });

  function renderMarkers() {
    renderRaf = 0;
    if (stopped) return;
    const debug = getDebug();
    const wanted = wantedMarkerIds();
    syncDetailVoiceButton();

    for (const id of wanted) {
      let marker = markers.get(id);
      if (!marker) {
        marker = createMarker(id);
        markers.set(id, marker);
        layer.appendChild(marker);
      }
      const status = statuses.get(id);
      const participants = status?.participants ?? (currentNodeId === id ? 1 : 0);
      marker.querySelector<HTMLElement>('.voice-node-count')!.textContent = String(participants);
      marker.classList.toggle('speaking', status?.speaking === true || (currentNodeId === id && localSpeaking));
      const point = debug?.scene?.screenPositionForNode(id) ?? null;
      marker.hidden = !point || participants < 1;
      if (point) {
        marker.style.left = `${point.x}px`;
        marker.style.top = `${point.y}px`;
      }
    }

    for (const [id, marker] of markers) {
      if (wanted.has(id)) continue;
      marker.remove();
      markers.delete(id);
    }

    updatePanel();
    if (wanted.size > 0) renderRaf = window.requestAnimationFrame(renderMarkers);
  }

  const detailRoot = document.getElementById('nodeDetailOverlay');
  const detailObserver = detailRoot ? new MutationObserver(() => ensureRenderLoop()) : null;
  if (detailObserver && detailRoot) detailObserver.observe(detailRoot, { attributes: true, attributeFilter: ['class', 'data-node-id'] });

  const wakeForInteraction = () => queueMicrotask(ensureRenderLoop);
  document.addEventListener('click', wakeForInteraction, true);

  const suspendRuntime = () => {
    if (stopped) return;
    stopped = true;
    joinSerial += 1;
    if (statusTimer !== null) {
      window.clearTimeout(statusTimer);
      statusTimer = null;
    }
    if (renderRaf !== 0) {
      window.cancelAnimationFrame(renderRaf);
      renderRaf = 0;
    }
    void disconnectTrackedRooms();
  };

  const resumeRuntime = () => {
    if (!stopped) return;
    stopped = false;
    statusFailures = 0;
    scheduleStatus(0);
    ensureRenderLoop();
  };

  window.addEventListener('pagehide', suspendRuntime);
  window.addEventListener('pageshow', resumeRuntime);
  document.addEventListener('visibilitychange', () => {
    if (stopped) return;
    if (document.hidden) {
      scheduleStatus(STATUS_BACKOFF_MAX_MS);
    } else {
      statusFailures = 0;
      scheduleStatus(0);
      ensureRenderLoop();
    }
  });

  scheduleStatus(0);
  ensureRenderLoop();
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => installVoiceRoomRuntime(), { once: true });
  } else {
    queueMicrotask(() => installVoiceRoomRuntime());
  }
}

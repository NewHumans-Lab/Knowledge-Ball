import { createProductionAuthClient } from '../../auth/AuthClient';

export const LIVEKIT_CLIENT_CDN = 'https://cdn.jsdelivr.net/npm/livekit-client@2.22.1/dist/livekit-client.umd.min.js';
export const VOICE_ROOM_PREFIX = 'knowledge:';
const STATUS_INTERVAL_MS = 2500;
const SPEAKING_HEARTBEAT_MS = 900;

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
    .voice-node-marker{position:absolute;display:flex;align-items:center;gap:4px;transform:translate(16px,-50%);pointer-events:auto;
      min-width:26px;height:20px;padding:0 6px;border:1px solid rgba(85,236,255,.28);border-radius:10px;background:rgba(8,13,32,.78);
      color:var(--ink-dim,#B6C7DE);font:600 10px/1 Inter,'Noto Sans SC',sans-serif;cursor:pointer;backdrop-filter:blur(5px);white-space:nowrap}
    .voice-node-marker:hover,.voice-node-marker.active{border-color:var(--accent-primary,#55ECFF);color:var(--accent-primary,#55ECFF)}
    .voice-node-marker[hidden]{display:none}
    .voice-node-mic{font-size:10px;line-height:1}
    .voice-wave{display:none;width:13px;height:14px;align-items:center;justify-content:flex-start;gap:1px}
    .voice-node-marker.speaking .voice-wave{display:flex}
    .voice-wave i{display:block;width:2px;border-radius:2px;background:currentColor;animation:voice-wave-pulse .72s ease-in-out infinite alternate}
    .voice-wave i:nth-child(1){height:4px}.voice-wave i:nth-child(2){height:9px;animation-delay:.12s}.voice-wave i:nth-child(3){height:6px;animation-delay:.24s}
    @keyframes voice-wave-pulse{from{transform:scaleY(.45);opacity:.45}to{transform:scaleY(1);opacity:1}}
    .voice-room-panel{position:absolute;left:50%;bottom:72px;z-index:48;transform:translateX(-50%);display:none;align-items:center;gap:8px;
      max-width:min(92vw,520px);padding:8px 10px;border:1px solid var(--panel-border,rgba(120,190,255,.2));border-radius:14px;background:rgba(8,13,32,.94);
      box-shadow:0 12px 36px rgba(0,0,0,.38);color:var(--ink,#F3F8FF);font:500 11px/1.25 Inter,'Noto Sans SC',sans-serif}
    .voice-room-panel.open{display:flex}.voice-room-title{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
    .voice-room-count{color:var(--ink-faint,#71829D);white-space:nowrap}.voice-room-action{border:1px solid var(--panel-border,rgba(120,190,255,.2));background:transparent;
      color:var(--ink,#F3F8FF);border-radius:10px;padding:6px 9px;font:600 11px/1 Inter,'Noto Sans SC',sans-serif;cursor:pointer}
    .voice-room-action:hover{border-color:var(--accent-primary,#55ECFF)}.voice-room-action.muted{color:var(--ink-faint,#71829D)}
    .voice-room-toast{position:absolute;left:50%;bottom:118px;z-index:80;transform:translateX(-50%) translateY(8px);opacity:0;pointer-events:none;
      max-width:min(88vw,440px);padding:8px 12px;border:1px solid rgba(85,236,255,.35);border-radius:9px;background:rgba(8,13,32,.95);color:var(--ink,#F3F8FF);
      font:500 11px/1.4 Inter,'Noto Sans SC',sans-serif;transition:opacity .18s,transform .18s;text-align:center}
    .voice-room-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
    .voice-room-audio{display:none}
    @media(max-width:640px){.voice-node-marker{transform:translate(13px,-50%);height:18px;padding:0 5px;font-size:9px}.voice-room-panel{bottom:70px;max-width:94vw}.voice-room-title{max-width:130px}}
  `;
  document.head.appendChild(style);
}

function createMarker(nodeId: string, onJoin: (id: string) => void): HTMLButtonElement {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = 'voice-node-marker';
  marker.dataset.voiceNodeId = nodeId;
  marker.innerHTML = '<span class="voice-node-mic" aria-hidden="true">🎙</span><span class="voice-node-count">0</span><span class="voice-wave" aria-hidden="true"><i></i><i></i><i></i></span>';
  marker.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    onJoin(nodeId);
  });
  return marker;
}

function loadLiveKit(): Promise<LiveKitGlobal> {
  const current = (window as unknown as { LivekitClient?: LiveKitGlobal }).LivekitClient;
  if (current) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-knowledge-ball-livekit]');
    const script = existing ?? document.createElement('script');
    const finish = () => {
      const sdk = (window as unknown as { LivekitClient?: LiveKitGlobal }).LivekitClient;
      if (sdk) resolve(sdk); else reject(new Error('LiveKit SDK failed to load'));
    };
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('LiveKit SDK failed to load')), { once: true });
    if (!existing) {
      script.src = LIVEKIT_CLIENT_CDN;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.knowledgeBallLivekit = '1';
      document.head.appendChild(script);
    } else if ((window as unknown as { LivekitClient?: LiveKitGlobal }).LivekitClient) {
      finish();
    }
  });
}

export function installVoiceRoomRuntime(): void {
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
  panel.innerHTML = '<span class="voice-room-title"></span><span class="voice-room-count"></span><button type="button" class="voice-room-action voice-room-mic"></button><button type="button" class="voice-room-action voice-room-leave"></button>';
  main.appendChild(panel);
  const panelTitle = panel.querySelector<HTMLElement>('.voice-room-title')!;
  const panelCount = panel.querySelector<HTMLElement>('.voice-room-count')!;
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
  const markers = new Map<string, HTMLButtonElement>();
  let room: LiveKitRoom | null = null;
  let livekit: LiveKitGlobal | null = null;
  let currentNodeId: string | null = null;
  let participantIdentity = '';
  let micEnabled = false;
  let lastSpeakingHeartbeat = 0;
  let statusTimer: number | null = null;
  let renderRaf = 0;
  let stopped = false;

  const voiceRequest = async (payload: Record<string, unknown>): Promise<unknown> => {
    if (!authClient || !supabaseUrl || !publishableKey) throw new Error(text('语音服务尚未配置', 'Voice service is not configured'));
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
      throw new Error(message);
    }
    return body;
  };

  const refreshStatus = async () => {
    try {
      const next = parseVoiceRoomStatusPayload(await voiceRequest({ action: 'status' }));
      statuses.clear();
      for (const item of next) statuses.set(item.nodeId, item);
    } catch (error) {
      // A missing/un-deployed voice backend must not disturb the existing knowledge scene.
      if (import.meta.env.DEV) console.debug('[Knowledge-Ball voice] status unavailable', error);
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

  const updatePanel = () => {
    if (!currentNodeId) {
      panel.classList.remove('open');
      return;
    }
    const node = getDebug()?.renderNodes?.find(item => item.id === currentNodeId);
    panelTitle.textContent = node?.title || currentNodeId;
    panelCount.textContent = text(`${statuses.get(currentNodeId)?.participants ?? 1} 人`, `${statuses.get(currentNodeId)?.participants ?? 1} people`);
    micButton.textContent = micEnabled ? text('静音', 'Mute') : text('开麦', 'Unmute');
    micButton.classList.toggle('muted', !micEnabled);
    leaveButton.textContent = text('离开', 'Leave');
    panel.classList.add('open');
  };

  const leaveRoom = async () => {
    const leaving = room;
    room = null;
    currentNodeId = null;
    participantIdentity = '';
    micEnabled = false;
    for (const element of audioMount.querySelectorAll('[data-voice-room-audio]')) element.remove();
    panel.classList.remove('open');
    if (leaving) await Promise.resolve(leaving.disconnect()).catch(() => undefined);
    void refreshStatus();
  };

  const sendSpeakingHeartbeat = () => {
    if (!currentNodeId || !participantIdentity || !micEnabled) return;
    const now = Date.now();
    if (now - lastSpeakingHeartbeat < SPEAKING_HEARTBEAT_MS) return;
    lastSpeakingHeartbeat = now;
    void voiceRequest({ action: 'speaking', nodeId: currentNodeId, participantIdentity }).catch(() => undefined);
  };

  const joinRoom = async (nodeId: string) => {
    try {
      roomNameForNode(nodeId);
      if (currentNodeId === nodeId && room) return;
      if (room) await leaveRoom();
      livekit = livekit ?? await loadLiveKit();
      if (livekit.isBrowserSupported && !livekit.isBrowserSupported()) throw new Error(text('当前浏览器不支持实时语音', 'This browser does not support realtime voice'));
      const response = await voiceRequest({ action: 'join', nodeId }) as Partial<JoinResponse>;
      if (typeof response.url !== 'string' || typeof response.token !== 'string' || typeof response.participantIdentity !== 'string') {
        throw new Error(text('语音房凭证无效', 'Invalid voice-room credentials'));
      }
      participantIdentity = response.participantIdentity;
      const nextRoom = new livekit.Room({ adaptiveStream: false, dynacast: false });
      const events = livekit.RoomEvent;
      nextRoom.on(events.TrackSubscribed, remoteTrackSubscribed);
      nextRoom.on(events.TrackUnsubscribed, remoteTrackUnsubscribed);
      nextRoom.on(events.ParticipantConnected, () => { void refreshStatus(); });
      nextRoom.on(events.ParticipantDisconnected, () => { void refreshStatus(); });
      nextRoom.on(events.ActiveSpeakersChanged, (speakersValue: unknown) => {
        if (!Array.isArray(speakersValue)) return;
        const speakingLocally = speakersValue.some(value => (value as LiveKitParticipant)?.identity === participantIdentity);
        if (speakingLocally) sendSpeakingHeartbeat();
      });
      nextRoom.on(events.Disconnected, () => {
        if (room !== nextRoom) return;
        room = null;
        currentNodeId = null;
        participantIdentity = '';
        micEnabled = false;
        panel.classList.remove('open');
        void refreshStatus();
      });
      await nextRoom.connect(response.url, response.token, { autoSubscribe: true });
      room = nextRoom;
      currentNodeId = nodeId;
      if (typeof nextRoom.startAudio === 'function') await nextRoom.startAudio().catch(() => undefined);
      try {
        await nextRoom.localParticipant.setMicrophoneEnabled(true);
        micEnabled = true;
      } catch {
        micEnabled = false;
        showToast(text('已进入语音房；麦克风未授权，可作为听众', 'Joined as listener; microphone permission was not granted'));
      }
      updatePanel();
      await refreshStatus();
    } catch (error) {
      await leaveRoom();
      showToast(error instanceof Error ? error.message : text('无法进入语音房', 'Unable to join voice room'));
    }
  };

  micButton.addEventListener('click', () => {
    if (!room) return;
    const next = !micEnabled;
    void room.localParticipant.setMicrophoneEnabled(next).then(() => {
      micEnabled = next;
      updatePanel();
    }).catch(error => showToast(error instanceof Error ? error.message : text('麦克风操作失败', 'Microphone operation failed')));
  });
  leaveButton.addEventListener('click', () => { void leaveRoom(); });

  const renderMarkers = () => {
    if (stopped) return;
    const debug = getDebug();
    const detailId = document.querySelector<HTMLElement>('#nodeDetailOverlay.open[data-node-id]')?.dataset.nodeId ?? null;
    const wanted = new Set(statuses.keys());
    if (detailId) wanted.add(detailId);
    if (currentNodeId) wanted.add(currentNodeId);

    for (const id of wanted) {
      let marker = markers.get(id);
      if (!marker) {
        marker = createMarker(id, joinRoom);
        markers.set(id, marker);
        layer.appendChild(marker);
      }
      const status = statuses.get(id);
      marker.querySelector<HTMLElement>('.voice-node-count')!.textContent = String(status?.participants ?? (currentNodeId === id ? 1 : 0));
      marker.classList.toggle('speaking', status?.speaking === true);
      marker.classList.toggle('active', currentNodeId === id);
      marker.title = text('进入这个知识节点的语音房', 'Join this knowledge node voice room');
      const point = debug?.scene?.screenPositionForNode(id) ?? null;
      marker.hidden = !point;
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
    renderRaf = window.requestAnimationFrame(renderMarkers);
  };

  void refreshStatus();
  statusTimer = window.setInterval(() => { void refreshStatus(); }, STATUS_INTERVAL_MS);
  renderRaf = window.requestAnimationFrame(renderMarkers);

  window.addEventListener('pagehide', () => {
    stopped = true;
    if (statusTimer !== null) window.clearInterval(statusTimer);
    window.cancelAnimationFrame(renderRaf);
    void leaveRoom();
  }, { once: true });
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => installVoiceRoomRuntime(), { once: true });
  } else {
    queueMicrotask(() => installVoiceRoomRuntime());
  }
}

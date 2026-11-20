/**
 * Workout Together: the client side of a shared workout room.
 *
 * - Owns the camera + microphone stream while a shared workout is open. The
 *   existing workout controller borrows the same stream for MediaPipe (each
 *   device tracks only its own person) and the peer connection sends it to the
 *   partner. Nothing is recorded.
 * - Talks to the server over the realtime socket: join, ready, synchronized
 *   start, progress, cheers, WebRTC signalling, rounds and leaving.
 * - Never penalises a person for a network hiccup: it rejoins after reconnects
 *   and shows the partner's reconnect grace period.
 */
import { createPeer } from './rtc-peer.js';

const PROGRESS_INTERVAL_MS = 250;
const CHEER_TTL_MS = 4000;

export const CHEERS = {
  clap: '👏', fire: '🔥', strong: '💪', go: 'Let’s go!', almost: 'Almost there!', heart: '❤️',
};

function workoutStatusToProgress(status) {
  switch (status) {
    case 'loading': return 'positioning';
    case 'running': return 'running';
    case 'paused': return 'paused';
    case 'completed': return 'finished';
    case 'error': return 'waiting';
    default: return 'waiting';
  }
}

export function createSharedWorkout({
  realtime,
  buddiesApi,
  getUser,
  workout,
  onChange = () => {},
  navigate = () => {},
  view = globalThis,
  mediaDevices = globalThis.navigator?.mediaDevices,
  createPeerImpl = createPeer,
  now = () => Date.now(),
  timers = globalThis,
}) {
  let peer = null;
  let stream = null;
  let remoteVideo = null;
  let lastSent = '';
  let lastSentAt = 0;
  let countdownTimer = null;
  let savedVoice = null;
  let joinSeq = 0;
  let clockTimer = null;

  // Re-render once a second while a room is open so clocks and grace timers tick.
  function startClock() {
    timers.clearInterval(clockTimer);
    clockTimer = timers.setInterval(() => {
      if (state.active) changed();
    }, 1000);
  }

  const initial = () => ({
    active: false,
    sessionId: null,
    session: null,
    phase: 'idle', // idle | joining | waiting | countdown | active | summary | error
    error: '',
    members: {},
    media: { status: 'idle', cam: true, mic: true, micAvailable: true, error: '' },
    ready: false,
    startsAt: null,
    countdown: 0,
    startedAtMs: null,
    connection: 'new',
    relay: 'none',
    myFinished: false,
    summary: null,
    roundProposal: null,
    cheers: [],
    announceCounts: true,
    remoteAudioBlocked: false,
    saveError: '',
  });
  let state = initial();

  function changed() {
    onChange();
  }

  const me = () => getUser()?.id;
  const partnerId = () => {
    const users = state.session ? [state.session.partner?.id] : [];
    return users[0] ?? Object.keys(state.members).find((id) => id !== me());
  };
  const partnerMember = () => state.members[partnerId()] ?? null;

  // ------------------------------------------------------------ media
  /**
   * Development-only stand-in camera (animated canvas + quiet tone) so two test
   * browsers on one computer can join a room. Never available in production builds.
   */
  function fakeMediaWanted() {
    if (!import.meta.env?.DEV) return false;
    try {
      return /[?&]fakemedia=1(?:&|$)/i.test(view?.location?.hash ?? '')
        || view?.localStorage?.getItem?.('sabibody-fake-media') === '1';
    } catch {
      return false;
    }
  }

  function createFakeStream() {
    const doc = view.document;
    const canvas = doc.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const label = getUser()?.full_name ?? 'Test camera';
    let frame = 0;
    const draw = () => {
      frame += 1;
      ctx.fillStyle = '#1f5a4c';
      ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = '#d9ec8b';
      ctx.beginPath();
      ctx.arc(320 + Math.sin(frame / 15) * 180, 240, 50, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText(`${label} (test camera)`, 24, 48);
      ctx.fillText(new Date().toLocaleTimeString(), 24, 452);
    };
    draw();
    timers.setInterval(draw, 1000 / 24);
    const fake = canvas.captureStream(24);
    try {
      const audio = new view.AudioContext();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      gain.gain.value = 0.02;
      osc.frequency.value = 330;
      const dest = audio.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      osc.start();
      for (const track of dest.stream.getAudioTracks()) fake.addTrack(track);
    } catch {
      /* video-only test stream */
    }
    return fake;
  }

  async function acquireMedia() {
    if (stream) return stream;
    if (fakeMediaWanted()) {
      stream = createFakeStream();
      state.media = { ...state.media, status: 'ready', micAvailable: stream.getAudioTracks().length > 0, mic: true,
        error: '', fake: true };
      changed();
      return stream;
    }
    if (!mediaDevices?.getUserMedia) {
      state.media = { ...state.media, status: 'error', error: 'This browser can’t use a camera here. Try Chrome, Safari or Edge on a secure (https) page.' };
      changed();
      return null;
    }
    state.media.status = 'requesting';
    changed();
    const video = { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } };
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    try {
      stream = await mediaDevices.getUserMedia({ video, audio });
      state.media = { ...state.media, status: 'ready', micAvailable: true, mic: true, error: '' };
    } catch (error) {
      if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError'
        || error?.name === 'NotReadableError') {
        // Maybe only the microphone is unavailable or denied: try the camera alone.
        try {
          stream = await mediaDevices.getUserMedia({ video, audio: false });
          state.media = { ...state.media, status: 'ready', micAvailable: false, mic: false,
            error: 'Microphone is off or blocked — your friend can see you but not hear you.' };
        } catch (videoError) {
          const denied = videoError?.name === 'NotAllowedError' || videoError?.name === 'SecurityError';
          state.media = { ...state.media, status: denied ? 'denied' : 'error',
            error: denied
              ? 'Camera permission was denied. SabiBody needs your camera to count your reps. Allow camera access in your browser settings, then try again.'
              : 'Your camera couldn’t start. Close other apps that use it and try again.' };
        }
      } else {
        state.media = { ...state.media, status: 'error', error: 'Your camera couldn’t start. Please try again.' };
      }
    }
    changed();
    return stream;
  }

  function stopMedia() {
    for (const track of stream?.getTracks?.() ?? []) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
    stream = null;
  }

  function ensureRemoteVideo() {
    if (!remoteVideo && view?.document?.createElement) {
      remoteVideo = view.document.createElement('video');
      remoteVideo.autoplay = true;
      remoteVideo.playsInline = true;
      remoteVideo.setAttribute?.('playsinline', '');
      remoteVideo.className = 'duo-video duo-video--remote';
      remoteVideo.setAttribute?.('aria-label', 'Your workout partner’s camera');
    }
    return remoteVideo;
  }

  function playRemote({ withSound = true } = {}) {
    const video = ensureRemoteVideo();
    if (!video?.srcObject) return;
    if (withSound) video.muted = false;
    const attempt = video.play?.();
    if (attempt?.catch) {
      attempt.then(() => {
        if (withSound && state.remoteAudioBlocked) {
          state.remoteAudioBlocked = false;
          changed();
        }
      }).catch(() => {
        // Autoplay with sound was blocked (no tap on this page yet): show the
        // video muted straight away and offer an "Enable sound" button.
        state.remoteAudioBlocked = true;
        video.muted = true;
        void video.play?.()?.catch?.(() => {});
        changed();
      });
    }
  }

  // ------------------------------------------------------------ peer
  async function iceServers() {
    try {
      const result = await buddiesApi.iceServers();
      state.relay = result.relay;
      return result.ice_servers;
    } catch {
      return [{ urls: ['stun:stun.l.google.com:19302'] }];
    }
  }

  let peerPromise = null;
  function ensurePeer({ fresh = false } = {}) {
    if (fresh && peer) {
      peer.close();
      peer = null;
      peerPromise = null;
    }
    if (peer) return Promise.resolve(peer);
    if (peerPromise) return peerPromise;
    peerPromise = (async () => {
      const servers = await iceServers();
      if (!state.active) return null;
      const partner = partnerId();
      peer = createPeerImpl({
        polite: String(me()) > String(partner),
        iceServers: servers,
        localStream: stream,
        signal: (payload) => realtime.send('rtc.signal', { session_id: state.sessionId, ...payload }),
        onRemoteStream: (remote) => {
          const video = ensureRemoteVideo();
          if (video) {
            video.srcObject = remote;
            playRemote();
          }
          changed();
        },
        onState: ({ connection }) => {
          state.connection = connection;
          changed();
        },
      });
      if (!state.media.cam) {
        void peer.replaceTrack('video', null);
      }
      return peer;
    })().finally(() => {
      peerPromise = null;
    });
    return peerPromise;
  }

  function closePeer() {
    peer?.close();
    peer = null;
    state.connection = 'new';
    if (remoteVideo) remoteVideo.srcObject = null;
  }

  // ------------------------------------------------------------ room protocol
  function applyRoomState(room) {
    if (!room || room.session_id !== state.sessionId) return;
    state.members = room.members ?? {};
    for (const member of Object.values(state.members)) {
      member.reconnectDeadline = member.reconnect_seconds_left != null
        ? now() + member.reconnect_seconds_left * 1000 : null;
    }
    state.roundProposal = room.round_proposal ?? null;
    if (room.phase === 'summary') {
      state.phase = 'summary';
    } else if (room.phase === 'active' && state.phase !== 'summary') {
      if (!['countdown', 'active'].includes(state.phase)) {
        state.phase = 'active';
        state.startedAtMs = state.startedAtMs ?? (room.starts_at ? Date.parse(room.starts_at) : now());
      }
    } else if (room.phase === 'waiting' && !['countdown', 'active', 'summary'].includes(state.phase)) {
      state.phase = 'waiting';
    }
    const mine = state.members[me()];
    if (mine) state.ready = Boolean(mine.ready) || state.ready;
  }

  async function join() {
    const seq = ++joinSeq;
    try {
      const result = await realtime.request('room.join', { session_id: state.sessionId });
      if (seq !== joinSeq || !state.active) return;
      state.session = result.session;
      applyRoomState(result.state);
      if (state.phase === 'joining') state.phase = 'waiting';
      if (state.phase === 'summary' && !state.summary) void loadSummary();
      const partner = partnerMember();
      if (partner?.connected && stream && peer?.connectionState !== 'connected') {
        void ensurePeer();
      }
      changed();
    } catch (error) {
      if (seq !== joinSeq) return;
      state.phase = 'error';
      state.error = error?.message || 'We couldn’t open the workout room.';
      changed();
    }
  }

  async function loadSummary() {
    try {
      state.summary = await buddiesApi.sessionSummary(state.sessionId);
      changed();
    } catch {
      /* the room still works; the summary arrives by socket too */
    }
  }

  function startCountdown(startsAtIso) {
    state.startsAt = startsAtIso;
    state.phase = 'countdown';
    timers.clearInterval(countdownTimer);
    const tick = () => {
      const left = Math.ceil((Date.parse(startsAtIso) - now()) / 1000);
      state.countdown = Math.max(0, left);
      if (left <= 0) {
        timers.clearInterval(countdownTimer);
        countdownTimer = null;
        state.phase = 'active';
        state.startedAtMs = now();
        changed();
        void workout.start();
        return;
      }
      changed();
    };
    tick();
    countdownTimer = timers.setInterval(tick, 250);
  }

  function ours(data) {
    return state.active && data?.session_id === state.sessionId;
  }

  realtime.on('room.state', (data) => {
    if (!ours(data)) return;
    applyRoomState(data);
    changed();
  });
  realtime.on('room.peer', (data) => {
    if (!ours(data) || data.user_id === me()) return;
    if (data.connected && stream && peer?.connectionState !== 'connected') {
      void ensurePeer({ fresh: Boolean(peer) });
    }
    if (!data.connected && data.left) {
      closePeer();
    }
    changed();
  });
  realtime.on('room.start', (data) => {
    if (!ours(data)) return;
    startCountdown(data.starts_at);
  });
  realtime.on('room.progress', (data) => {
    if (!ours(data)) return;
    const member = state.members[data.user_id];
    if (member) {
      member.progress = data.progress;
      if (data.progress?.status === 'finished') member.finished = true;
    }
    changed();
  });
  realtime.on('room.media', (data) => {
    if (!ours(data)) return;
    const member = state.members[data.user_id];
    if (member) member.media = data.media;
    changed();
  });
  realtime.on('room.cheer', (data) => {
    if (!ours(data)) return;
    const entry = { from: data.user_id, cheer: data.cheer, at: now() };
    state.cheers = [...state.cheers.slice(-4), entry];
    changed();
    timers.setTimeout(() => {
      state.cheers = state.cheers.filter((c) => c !== entry);
      changed();
    }, CHEER_TTL_MS);
  });
  realtime.on('rtc.signal', async (data) => {
    if (!ours(data) || data.from === me()) return;
    const p = await ensurePeer();
    await p?.handleSignal({ description: data.description, candidate: data.candidate });
  });
  realtime.on('room.summary', (data) => {
    if (!state.active || data.session_id !== state.sessionId) return;
    state.summary = data;
    state.phase = 'summary';
    changed();
  });
  realtime.on('room.round', (data) => {
    if (!ours(data)) return;
    void switchRound(data.new_session_id);
  });
  realtime.on('ready', () => {
    // The socket reconnected (network blip, server restart): rejoin the room.
    if (state.active && state.sessionId && state.phase !== 'error') {
      void join();
    }
  });

  // ------------------------------------------------------------ voice
  function quietCoach() {
    if (savedVoice) return;
    const ws = workout.getState();
    savedVoice = { personality: ws.personality, voiceEnabled: ws.voiceEnabled };
    if (ws.personality !== 'quiet') workout.setPersonality('quiet');
  }

  function restoreVoice() {
    if (!savedVoice) return;
    const ws = workout.getState();
    if (ws.personality !== savedVoice.personality) workout.setPersonality(savedVoice.personality);
    if (ws.voiceEnabled !== savedVoice.voiceEnabled) workout.setVoiceEnabled(savedVoice.voiceEnabled);
    savedVoice = null;
  }

  function setupWorkout(session) {
    workout.selectExercise(session.exercise_id);
    workout.setGoal(String(session.target));
  }

  async function switchRound(newSessionId) {
    const old = state.sessionId;
    if (!newSessionId || newSessionId === old) return;
    realtime.send('room.leave', { session_id: old });
    Object.assign(state, {
      sessionId: newSessionId, session: null, phase: 'joining', members: {}, ready: false, startsAt: null,
      countdown: 0, startedAtMs: null, myFinished: false, summary: null, roundProposal: null, saveError: '',
    });
    lastSent = '';
    view?.history?.replaceState?.(view.history.state, '', `#/together?session=${encodeURIComponent(newSessionId)}`);
    changed();
    try {
      const { session } = await buddiesApi.session(newSessionId);
      state.session = session;
      setupWorkout(session);
    } catch (error) {
      state.phase = 'error';
      state.error = error?.message || 'We couldn’t start the next round.';
      changed();
      return;
    }
    await join();
  }

  // ------------------------------------------------------------ public API
  return {
    isActive: () => state.active,
    getState: () => state,
    sessionId: () => state.sessionId,
    remoteVideo: () => ensureRemoteVideo(),
    stream: () => stream,

    async enter(sessionId) {
      if (state.active && state.sessionId === sessionId) return;
      if (state.active) await this.leave({ navigateAway: false });
      state = { ...initial(), active: true, sessionId, phase: 'joining' };
      changed();
      let session;
      try {
        ({ session } = await buddiesApi.session(sessionId));
      } catch (error) {
        state.phase = 'error';
        state.error = error?.message || 'We couldn’t find this workout.';
        changed();
        return;
      }
      if (!state.active || state.sessionId !== sessionId) return;
      state.session = session;
      if (!session.can_join && !['completed', 'incomplete'].includes(session.status)) {
        state.phase = 'error';
        state.error = session.status === 'proposed'
          ? `${session.partner?.first_name ?? 'Your friend'} hasn’t accepted this workout yet.`
          : session.mode === 'scheduled' && session.status === 'accepted'
            ? 'The workout room opens 15 minutes before the start time.'
            : 'This workout is no longer available.';
        changed();
        return;
      }
      setupWorkout(session);
      quietCoach();
      startClock();
      await acquireMedia();
      if (!state.active) {
        stopMedia();
        return;
      }
      await join();
    },

    async retryMedia() {
      stopMedia();
      await acquireMedia();
      if (stream && partnerMember()?.connected) void ensurePeer({ fresh: true });
      changed();
    },

    setReady(ready = true) {
      if (!stream) return;
      state.ready = ready;
      realtime.send('room.ready', { session_id: state.sessionId, ready });
      changed();
    },

    toggleMic() {
      const track = stream?.getAudioTracks?.()[0];
      if (!track) return;
      track.enabled = !track.enabled;
      state.media.mic = track.enabled;
      realtime.send('room.media', { session_id: state.sessionId, cam: state.media.cam, mic: state.media.mic });
      changed();
    },

    /** Camera "off" stops sending video to the partner; tracking on this device keeps working. */
    toggleCam() {
      state.media.cam = !state.media.cam;
      const track = stream?.getVideoTracks?.()[0] ?? null;
      void peer?.replaceTrack('video', state.media.cam ? track : null);
      realtime.send('room.media', { session_id: state.sessionId, cam: state.media.cam, mic: state.media.mic });
      changed();
    },

    toggleCounts() {
      state.announceCounts = !state.announceCounts;
      workout.setVoiceEnabled(state.announceCounts);
      changed();
    },

    cheer(cheer) {
      if (!CHEERS[cheer]) return;
      realtime.send('room.cheer', { session_id: state.sessionId, cheer });
    },

    proposeRound(exerciseId, target) {
      realtime.send('room.round.propose', { session_id: state.sessionId, exercise_id: exerciseId, target: Number(target) });
    },

    respondRound(accept) {
      realtime.send('room.round.respond', { session_id: state.sessionId, accept: Boolean(accept) });
    },

    enableRemoteAudio() {
      playRemote({ withSound: true });
    },

    /** Start (or restart) my own counting, e.g. after rejoining a workout already underway. */
    startCounting() {
      if (!stream) return;
      state.phase = 'active';
      state.startedAtMs = state.startedAtMs ?? now();
      changed();
      void workout.start();
    },

    /** Called on every workout controller state change while shared mode is active. */
    onLocalState(ws) {
      if (!state.active || !state.sessionId) return;
      const status = workoutStatusToProgress(ws.workoutStatus);
      const progress = {
        count: ws.count ?? 0,
        elapsed_ms: Math.round(ws.elapsedMs ?? 0),
        target: ws.target,
        status,
      };
      if (status === 'finished' && !state.myFinished) {
        state.myFinished = true;
        changed();
      }
      const key = `${progress.count}|${Math.floor(progress.elapsed_ms / 1000)}|${status}`;
      const t = now();
      if (key === lastSent || (t - lastSentAt < PROGRESS_INTERVAL_MS && status !== 'finished')) return;
      lastSent = key;
      lastSentAt = t;
      const mine = state.members[me()];
      if (mine) mine.progress = progress;
      realtime.send('room.progress', { session_id: state.sessionId, ...progress });
    },

    attachLocalVideo(videoElement) {
      if (videoElement && stream && videoElement.srcObject !== stream) {
        videoElement.srcObject = stream;
        videoElement.muted = true;
        void videoElement.play?.()?.catch?.(() => {});
      }
    },

    onSaveFailed(message) {
      state.saveError = message;
      changed();
    },

    async leave({ navigateAway = true } = {}) {
      if (!state.active) return;
      const sessionId = state.sessionId;
      timers.clearInterval(countdownTimer);
      timers.clearInterval(clockTimer);
      const ws = workout.getState();
      if (['loading', 'running', 'paused'].includes(ws.workoutStatus)) {
        await workout.end();
      }
      realtime.send('room.leave', { session_id: sessionId });
      closePeer();
      stopMedia();
      restoreVoice();
      state = initial();
      workout.goHome();
      changed();
      if (navigateAway) navigate('calendar', { session: sessionId });
    },
  };
}

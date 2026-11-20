/**
 * One WebRTC peer connection to the workout partner, using the "perfect
 * negotiation" pattern so either side can (re)connect without offer glare.
 *
 * Only the camera + microphone stream travels peer-to-peer (or via TURN).
 * Pose tracking never uses the remote stream.
 */

const MAX_VIDEO_BITRATE = 600_000;

export function createPeer({
  polite,
  iceServers = [],
  localStream = null,
  signal,
  onRemoteStream = () => {},
  onState = () => {},
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
} = {}) {
  if (typeof RTCPeerConnectionImpl !== 'function') {
    throw new Error('This browser does not support video calls (WebRTC).');
  }
  const pc = new RTCPeerConnectionImpl({ iceServers });
  let makingOffer = false;
  let ignoreOffer = false;
  let closed = false;
  let remoteStream = null;
  let restartTimer = null;

  function report() {
    onState({ connection: pc.connectionState ?? pc.iceConnectionState ?? 'new', ice: pc.iceConnectionState ?? 'new' });
  }

  for (const track of localStream?.getTracks?.() ?? []) {
    pc.addTrack(track, localStream);
  }

  pc.ontrack = (event) => {
    const stream = event.streams?.[0] ?? remoteStream ?? (typeof MediaStream === 'function' ? new MediaStream() : null);
    if (stream && !event.streams?.[0] && event.track) {
      stream.addTrack?.(event.track);
    }
    if (stream !== remoteStream) {
      remoteStream = stream;
      onRemoteStream(remoteStream);
    }
  };

  pc.onicecandidate = (event) => {
    if (!closed && event.candidate) {
      signal({ candidate: event.candidate.toJSON?.() ?? event.candidate });
    }
  };

  pc.onnegotiationneeded = async () => {
    try {
      makingOffer = true;
      await pc.setLocalDescription();
      signal({ description: pc.localDescription?.toJSON?.() ?? pc.localDescription });
    } catch (error) {
      globalThis.console?.warn?.('Negotiation failed', error);
    } finally {
      makingOffer = false;
    }
  };

  pc.oniceconnectionstatechange = () => {
    report();
    if (pc.iceConnectionState === 'failed') {
      pc.restartIce?.();
    } else if (pc.iceConnectionState === 'disconnected') {
      // Give the network a few seconds to recover before restarting ICE.
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (!closed && pc.iceConnectionState === 'disconnected') pc.restartIce?.();
      }, 4000);
    }
  };
  pc.onconnectionstatechange = report;

  async function limitBitrate() {
    for (const sender of pc.getSenders?.() ?? []) {
      if (sender.track?.kind !== 'video' || typeof sender.getParameters !== 'function') continue;
      try {
        const params = sender.getParameters();
        params.encodings = params.encodings?.length ? params.encodings : [{}];
        params.encodings[0].maxBitrate = MAX_VIDEO_BITRATE;
        await sender.setParameters(params);
      } catch {
        /* not supported everywhere; the browser default is fine */
      }
    }
  }

  async function handleSignal({ description, candidate }) {
    if (closed) return;
    try {
      if (description) {
        const offerCollision = description.type === 'offer'
          && (makingOffer || pc.signalingState !== 'stable');
        ignoreOffer = !polite && offerCollision;
        if (ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          signal({ description: pc.localDescription?.toJSON?.() ?? pc.localDescription });
        }
        void limitBitrate();
      } else if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (error) {
          if (!ignoreOffer) throw error;
        }
      }
    } catch (error) {
      globalThis.console?.warn?.('Signal handling failed', error);
    }
  }

  return {
    handleSignal,
    /** Replace (or remove) the outgoing audio/video tracks, e.g. after a camera restart. */
    async replaceTrack(kind, track) {
      const sender = pc.getSenders?.().find((s) => s.track?.kind === kind);
      if (sender) await sender.replaceTrack(track);
    },
    close() {
      closed = true;
      clearTimeout(restartTimer);
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    },
    get connectionState() {
      return pc.connectionState ?? pc.iceConnectionState ?? 'new';
    },
    get remoteStream() {
      return remoteStream;
    },
  };
}

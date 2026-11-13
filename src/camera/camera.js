const stoppedTracks = new WeakSet();

function describeCameraError(error, phase) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    const cameraError = new Error(
      'Camera permission was denied. Allow camera access in your browser settings and try again.',
      { cause: error },
    );
    cameraError.cameraStatus = 'Camera Blocked';
    return cameraError;
  }

  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    const cameraError = new Error(
      'No camera was found. Connect or enable a camera and try again.',
      { cause: error },
    );
    cameraError.cameraStatus = 'No Camera Found';
    return cameraError;
  }

  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
    const cameraError = new Error(
      'The camera could not start. Close other apps using it and try again.',
      { cause: error },
    );
    cameraError.cameraStatus = 'Camera Error';
    return cameraError;
  }

  const detail = error instanceof Error ? `: ${error.message}` : '';
  const cameraError = new Error(`Unable to start camera ${phase}${detail}`, { cause: error });
  cameraError.cameraStatus = 'Camera Error';
  return cameraError;
}

function waitForVideoReady(videoElement, timeoutMs = 10000) {
  const readyStateThreshold = videoElement.HAVE_CURRENT_DATA ?? 2;
  if (
    videoElement.readyState === undefined ||
    (videoElement.readyState >= readyStateThreshold && videoElement.videoWidth > 0 && videoElement.videoHeight > 0)
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let timeout;
    const cleanUp = () => {
      clearTimeout(timeout);
      videoElement.removeEventListener?.('loadedmetadata', checkReady);
      videoElement.removeEventListener?.('loadeddata', checkReady);
      videoElement.removeEventListener?.('error', handleError);
    };
    const checkReady = () => {
      if (
        videoElement.readyState >= readyStateThreshold &&
        videoElement.videoWidth > 0 &&
        videoElement.videoHeight > 0
      ) {
        cleanUp();
        resolve();
      }
    };
    const handleError = () => {
      cleanUp();
      reject(new Error('The camera video could not be decoded. Check the camera and try again.'));
    };

    videoElement.addEventListener?.('loadedmetadata', checkReady);
    videoElement.addEventListener?.('loadeddata', checkReady);
    videoElement.addEventListener?.('error', handleError);
    timeout = setTimeout(() => {
      cleanUp();
      reject(new Error('The camera is connected, but no video frame arrived. Reposition or reconnect the camera, then retry.'));
    }, timeoutMs);
    checkReady();
  });
}

export async function startCamera(videoElement) {
  if (!videoElement) {
    throw new Error('Cannot start the camera: a video element is required.');
  }

  if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
    throw new Error(
      'Camera access is unavailable. Use a supported browser on a secure connection (HTTPS).',
    );
  }

  let stream;

  try {
    const getUserMedia = globalThis.navigator.mediaDevices.getUserMedia.bind(
      globalThis.navigator.mediaDevices,
    );
    try {
      stream = await getUserMedia({
        video: { facingMode: { ideal: 'user' } },
        audio: false,
      });
    } catch (error) {
      if (!['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(error?.name)) {
        throw error;
      }
      stream = await getUserMedia({ video: true, audio: false });
    }

    videoElement.autoplay = true;
    videoElement.playsInline = true;
    videoElement.muted = true;
    videoElement.srcObject = stream;
    await videoElement.play();
    await waitForVideoReady(videoElement);
    return stream;
  } catch (error) {
    if (stream) {
      stopCamera(stream, videoElement);
    }
    throw describeCameraError(error, 'access or preview startup');
  }
}

export async function listCameras() {
  const devices = await globalThis.navigator?.mediaDevices?.enumerateDevices?.();
  return (devices ?? [])
    .filter(({ kind }) => kind === 'videoinput')
    .map(({ deviceId, label }) => ({ deviceId, label: label || 'Camera' }));
}

export function stopCamera(stream, videoElement) {
  for (const track of stream?.getTracks?.() ?? []) {
    if (stoppedTracks.has(track)) {
      continue;
    }

    stoppedTracks.add(track);
    try {
      track.stop();
    } catch {
      // Continue stopping remaining tracks even if one browser track fails.
    }
  }

  if (videoElement) {
    videoElement.srcObject = null;
  }
}

const stoppedTracks = new WeakSet();

function describeCameraError(error, phase) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return new Error(
      'Camera permission was denied. Allow camera access in your browser settings and try again.',
      { cause: error },
    );
  }

  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return new Error(
      'No camera was found. Connect or enable a camera and try again.',
      { cause: error },
    );
  }

  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
    return new Error(
      'The camera could not start. Close other apps using it and try again.',
      { cause: error },
    );
  }

  const detail = error instanceof Error ? `: ${error.message}` : '';
  return new Error(`Unable to start camera ${phase}${detail}`, { cause: error });
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
    stream = await globalThis.navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    });
  } catch (error) {
    throw describeCameraError(error, 'access');
  }

  try {
    videoElement.srcObject = stream;
    await videoElement.play();
    return stream;
  } catch (error) {
    stopCamera(stream, videoElement);
    throw describeCameraError(error, 'preview playback');
  }
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

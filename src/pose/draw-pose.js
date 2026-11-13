import { DrawingUtils, PoseLandmarker } from '@mediapipe/tasks-vision';
import { isVisible } from '../exercises/geometry.js';

export function drawPose(canvas, landmarks, videoElement, poseStatus = {}) {
  if (!canvas || !videoElement) {
    return;
  }

  const width = videoElement.videoWidth;
  const height = videoElement.videoHeight;
  if (!width || !height) {
    return;
  }

  const pixelRatio = Math.max(1, globalThis.devicePixelRatio || 1);
  const backingWidth = Math.round(width * pixelRatio);
  const backingHeight = Math.round(height * pixelRatio);
  if (canvas.width !== backingWidth) {
    canvas.width = backingWidth;
  }
  if (canvas.height !== backingHeight) {
    canvas.height = backingHeight;
  }

  canvas.style.width = `${videoElement.clientWidth || width}px`;
  canvas.style.height = `${videoElement.clientHeight || height}px`;

  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, backingWidth, backingHeight);

  const visible = landmarks.map((landmark) => isVisible(landmark));
  const poseConnections = Array.isArray(PoseLandmarker.POSE_CONNECTIONS)
    ? PoseLandmarker.POSE_CONNECTIONS
    : [];
  const connections = poseConnections.filter(
    ({ start, end }) => visible[start] && visible[end],
  );
  const lineWidth = Math.max(2, Math.min(width, height) * 0.004);
  const pointRadius = Math.max(3, Math.min(width, height) * 0.008);
  const poseColor = poseStatus.formValid
    ? '#61d095'
    : poseStatus.readinessReady
      ? '#e77b67'
      : '#f0b44b';

  try {
    const drawingUtils = new DrawingUtils(context);
    drawingUtils.drawConnectors(landmarks, connections, {
      color: poseColor,
      lineWidth,
    });

    for (let index = 0; index < landmarks.length; index += 1) {
      if (visible[index]) {
        drawingUtils.drawLandmarks([landmarks[index]], {
          color: poseColor,
          fillColor: poseColor,
          radius: pointRadius,
        });
      }
    }
  } catch {
    // Rendering is optional for tracking analysis. Keep the pose callback alive
    // when a browser or test environment does not expose the full canvas API.
  }
}

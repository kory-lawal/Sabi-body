import { PoseLandmarker } from '@mediapipe/tasks-vision';
import { isVisible } from '../exercises/geometry.js';

export function drawPose(canvas, landmarks, videoElement) {
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

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const visible = landmarks.map((landmark) => isVisible(landmark));
  const connections = PoseLandmarker.POSE_CONNECTIONS;
  const lineWidth = Math.max(2, Math.min(width, height) * 0.004);
  const pointRadius = Math.max(3, Math.min(width, height) * 0.008);

  context.save();
  context.translate(width, 0);
  context.scale(-1, 1);
  context.strokeStyle = '#f0b44b';
  context.lineWidth = lineWidth;
  context.beginPath();

  for (const { start, end } of connections) {
    if (visible[start] && visible[end]) {
      context.moveTo(landmarks[start].x * width, landmarks[start].y * height);
      context.lineTo(landmarks[end].x * width, landmarks[end].y * height);
    }
  }

  context.stroke();
  context.fillStyle = '#f0b44b';

  for (let index = 0; index < landmarks.length; index += 1) {
    if (!visible[index]) {
      continue;
    }

    const landmark = landmarks[index];
    context.beginPath();
    context.arc(
      landmark.x * width,
      landmark.y * height,
      pointRadius,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  context.restore();
}

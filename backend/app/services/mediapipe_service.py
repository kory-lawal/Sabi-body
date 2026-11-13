import base64
import json
import time
from pathlib import Path

import cv2
import numpy as np

try:
    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision
except ImportError as exc:  # pragma: no cover - runtime installation scenario
    raise RuntimeError("MediaPipe is not installed. Install the Python requirements first.") from exc

from app.config import settings
from app.utils.pose_utils import normalize_landmarks


class PoseDetectorService:
    """MediaPipe pose detection service for browser-captured frames."""

    def __init__(self, model_path: str | None = None):
        self.model_path = str(model_path or settings.POSE_MODEL_PATH)
        self._ensure_model_exists()
        self._landmarker = None
        self._initialize_landmarker()

    def _ensure_model_exists(self) -> None:
        if not Path(self.model_path).exists():
            raise FileNotFoundError(f"Pose model file not found at {self.model_path}")

    def _initialize_landmarker(self) -> None:
        if self._landmarker is not None:
            return

        options = vision.PoseLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=self.model_path),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._landmarker = vision.PoseLandmarker.create_from_options(options)

    def process_frame(self, frame_bytes: bytes) -> dict:
        if self._landmarker is None:
            self._initialize_landmarker()

        encoded = np.frombuffer(frame_bytes, dtype=np.uint8)
        image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Invalid image data could not be decoded as a JPEG or PNG frame.")

        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._landmarker.detect_for_video(mp_image, int(time.time() * 1000))
        landmarks = result.landmarks[0] if result and result.landmarks else []
        normalized = normalize_landmarks(landmarks)

        confidence = 0.0
        if normalized:
            confidence = max(float(point.get("visibility", 0.0)) for point in normalized)

        return {
            "status": "body_detected" if normalized else "body_not_detected",
            "body_detected": bool(normalized),
            "confidence": round(float(confidence), 4),
            "landmarks": normalized,
        }

    @staticmethod
    def decode_frame_packet(payload: str | bytes) -> bytes:
        if isinstance(payload, bytes):
            return payload
        if isinstance(payload, str):
            try:
                message = json.loads(payload)
            except json.JSONDecodeError:
                return base64.b64decode(payload)
            if isinstance(message, dict):
                frame_data = message.get("image") or message.get("frame") or message.get("frame_data")
                if isinstance(frame_data, str):
                    return base64.b64decode(frame_data)
        raise ValueError("The frame payload did not include valid image bytes.")

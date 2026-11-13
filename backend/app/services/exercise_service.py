from __future__ import annotations


class ExerciseService:
    """Small exercise helper layer for the Python backend."""

    @staticmethod
    def evaluate_pose(landmarks: list[dict] | None) -> dict:
        if not landmarks:
            return {"status": "not_detected", "body_detected": False, "confidence": 0.0}
        confidence = max((float(point.get("visibility", 0.0)) for point in landmarks), default=0.0)
        return {"status": "detected", "body_detected": True, "confidence": round(confidence, 4)}

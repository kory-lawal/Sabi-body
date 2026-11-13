from __future__ import annotations


def normalize_landmarks(landmarks: list | None) -> list[dict]:
    if not landmarks:
        return []

    normalized: list[dict] = []
    for landmark in landmarks:
        normalized.append(
            {
                "x": float(getattr(landmark, "x", 0.0)),
                "y": float(getattr(landmark, "y", 0.0)),
                "z": float(getattr(landmark, "z", 0.0)),
                "visibility": float(getattr(landmark, "visibility", 0.0) or 0.0),
                "presence": float(getattr(landmark, "presence", 0.0) or 0.0),
            }
        )
    return normalized

from __future__ import annotations


def detect_mime_type(payload: bytes) -> str:
    if not payload:
        raise ValueError("Audio payload must not be empty.")
    if payload.startswith(b"RIFF"):
        return "audio/wav"
    if payload.startswith(b"ID3") or payload.startswith(b"\xFF\xFB"):
        return "audio/mpeg"
    return "audio/mpeg"

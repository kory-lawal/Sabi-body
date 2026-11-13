from __future__ import annotations

from io import BytesIO


def audio_to_bytes(audio_obj) -> bytes:
    if hasattr(audio_obj, "save"):
        buffer = BytesIO()
        audio_obj.save(buffer)
        return buffer.getvalue()
    if isinstance(audio_obj, (bytes, bytearray)):
        return bytes(audio_obj)
    raise TypeError("Unsupported audio object type for backend conversion.")

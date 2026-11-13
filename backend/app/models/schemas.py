from typing import Optional

from pydantic import BaseModel, Field


class SpeechRequest(BaseModel):
    language: str = Field(..., min_length=2, max_length=3)
    text: str = Field(..., min_length=1)


class SpeechGenerateRequest(BaseModel):
    language: str = Field(..., min_length=2, max_length=3)
    text: str = Field(..., min_length=1)
    voice: Optional[str] = None


class PoseFrameResponse(BaseModel):
    body_detected: bool
    confidence: float
    landmarks: list[dict]
    status: str = "ready"

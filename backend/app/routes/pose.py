import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.mediapipe_service import PoseDetectorService

router = APIRouter()
pose_service = PoseDetectorService()


@router.websocket("/ws/pose")
async def pose_websocket(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive()
            frame_bytes = None

            if "bytes" in payload:
                frame_bytes = payload["bytes"]
            elif "text" in payload:
                text_payload = payload["text"]
                if not text_payload:
                    continue
                try:
                    frame_bytes = PoseDetectorService.decode_frame_packet(text_payload)
                except ValueError:
                    continue

            if frame_bytes is None:
                continue

            result = pose_service.process_frame(frame_bytes)
            await websocket.send_json(result)
    except WebSocketDisconnect:
        return
    except Exception as exc:  # pragma: no cover - runtime integration failure
        await websocket.send_json({"status": "error", "error": str(exc)})
        await websocket.close(code=1011)

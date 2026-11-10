# SabiBody YOLOv8-Pose Migration Design

**Date:** 2026-11-10

**Status:** Approved in chat; awaiting written-spec review

## Goal

Replace MediaPipe as SabiBody's active pose detector with a locally hosted
Ultralytics YOLOv8-Pose service. Keep the existing vanilla-JavaScript
application, browser camera, workout-selection flow, exercise-specific
analyzers, multilingual coaching, and YarnGPT voice integration. Do not
recreate or redesign the application.

The existing application runs MediaPipe in the browser. FastAPI already has a
pose WebSocket and a separate MediaPipe service, but the browser does not use
that socket. The existing readiness and exercise analyzers consume
MediaPipe-style indices from a 33-landmark array. The migration must explicitly
address both mismatches.

## Decisions

- YOLOv8-Pose is the only active detector. There is no automatic or manual
  MediaPipe fallback. If the YOLO service is unavailable or cannot load its
  model, workout detection reports a clear error and remains unavailable.
- Preserve `getUserMedia()` in the browser. Capture compressed frames from its
  live video stream and send them only to the local FastAPI backend.
- Use `yolov8n-pose.pt` by default. Allow model, device, image size, and
  confidence threshold configuration through environment variables. Benchmark
  `yolov8s-pose.pt` separately on the available hardware; do not assume CUDA.
- Load one configured model during FastAPI startup, report its actual device,
  and reuse it. Do not load models per frame or load both model sizes at once.
- Use the model's 17 COCO keypoints consistently in Python, JavaScript,
  diagnostics, rendering, and synthetic fixtures.
- Keep workout analysis in the existing exercise-specific JavaScript state
  machines. Do not move rep counting or valid plank-time accumulation into the
  detector.
- Preserve YarnGPT and voice playback behavior. Pose frames and inference
  results are not sent to YarnGPT.
- Interpret “Do not rebuild the application” as “do not recreate/rewrite the
  application”; the existing frontend build remains part of final validation
  as explicitly requested.

## Architecture

### Browser capture and transport

The existing browser camera remains responsible for permission, preview, and
stream cleanup. The frontend captures JPEG frames from the live video at an
initial 640x480 target and sends binary payloads over the existing
`/ws/pose` WebSocket. Vite development configuration proxies WebSocket traffic
to FastAPI; production configuration must use the same local-service contract.

The sender permits at most one frame in flight and keeps only the newest
pending frame. It skips superseded frames rather than queuing work, and adapts
the send interval to measured inference throughput. A disconnected socket,
invalid result, or unavailable model is surfaced as a pose-service error; it
does not silently fall back to another detector.

### Backend inference lifecycle

FastAPI startup loads the selected Ultralytics pose model once. Configuration
includes model path/name, device (`auto` supported), image size (640 default),
and confidence threshold (0.25 default). The actual selected model and device
are exposed through health/diagnostic data. A configured model that cannot
load must prevent pose inference from being reported as healthy.

The WebSocket decodes JPEG bytes with the existing OpenCV/NumPy dependencies,
then executes inference in a worker thread so the event loop remains responsive.
Model access is serialized to avoid concurrent calls into one model instance.
Disconnects cancel or discard outstanding responses and release connection
resources. No camera device is opened by Python.

### Pose result contract

Every result includes a request/frame identifier, processing status, inference
latency, source image dimensions, detected person count, and detections. Each
detection includes a person bounding box and 17 ordered keypoints with
normalized `x`/`y` coordinates and model confidence. Missing or low-confidence
keypoints remain missing/unreliable; they are never substituted with valid
coordinates. The frontend calculates current FPS from timestamps/results.

COCO keypoint indices are:

| Index | Keypoint |
|---:|---|
| 0 | Nose |
| 1 | Left eye |
| 2 | Right eye |
| 3 | Left ear |
| 4 | Right ear |
| 5 | Left shoulder |
| 6 | Right shoulder |
| 7 | Left elbow |
| 8 | Right elbow |
| 9 | Left wrist |
| 10 | Right wrist |
| 11 | Left hip |
| 12 | Right hip |
| 13 | Left knee |
| 14 | Right knee |
| 15 | Left ankle |
| 16 | Right ankle |

Use named indices/constants rather than retaining MediaPipe's 33-point array
convention. YOLO does not provide MediaPipe world landmarks; 3D/world-coordinate
assumptions are removed rather than fabricated. Mirror the overlay in the same
coordinate space as the displayed camera preview.

## Readiness and exercise analysis

The readiness gate requires one detected person, sufficient confidence for the
exercise's required points, safe framing, and a valid starting position.
Multiple detections produce an explicit “one person” correction state.
Bounding-box coverage and keypoint geometry distinguish out-of-frame, too-far,
too-close, and missing-landmark cases. Camera angle is estimated only from
2D landmark geometry. Ambiguous cases remain “orientation uncertain”; a
monocular uncalibrated image cannot guarantee physical camera orientation.

Existing exercise state machines remain responsible for:

- **Squats:** stable standing, descent to configured depth, and return to
  standing before counting. Shallow movement, unreliable points, and
  incomplete cycles do not count.
- **Jumping jacks:** both arms and both feet must reach the configured open
  position and return to closed before counting.
- **Planks:** shoulder/hip/ankle and support landmarks must satisfy alignment
  thresholds. Invalid form or missing points pause accumulation while
  preserving previous valid time; stable corrected form resumes it.

Move confidence, smoothing, orientation, framing, and exercise thresholds into a
central JavaScript exercise configuration module. Use confidence-aware
temporal smoothing and state stability/hysteresis. If required points are
unreliable, suspend validation and clear smoothing history as appropriate.

## Diagnostics, coaching, and privacy

Keep the developer diagnostics hidden from normal users. Extend them with
configured model, actual device, latency, FPS, person count/box, all 17
keypoints and confidence, missing points, selected exercise/phase, readiness,
joint angles, form validity, rejection reason, and current coaching event.
Render COCO skeleton connections over the live preview, distinguishing
unreliable points from valid points.

Continue using existing event-based multilingual coaching and YarnGPT
playback/queue/cooldown behavior. Emit coaching events on state changes or
cooldown boundaries, not on every inference result. Add or adapt only messages
needed for detector/readiness conditions, preserving English, Yoruba, Igbo,
Hausa, and Nigerian Pidgin.

Frames travel from the browser to the local backend for inference. They are
processed in memory, not persisted, uploaded to a remote service, or sent to
YarnGPT. Update user-facing privacy copy to accurately say that pose analysis
uses the local backend rather than implying frames never leave the browser.

## Dependencies, assets, and licensing

Add compatible Ultralytics/PyTorch dependencies while retaining one
headless-OpenCV distribution and the existing FastAPI/NumPy stack. Keep the
selected pretrained `.pt` weights in an ignored local model directory; do not
commit large weights. After integration checks pass, remove MediaPipe imports,
dependencies, and unused local MediaPipe model/WASM assets without deleting
unrelated files or other uncommitted work.

Document Ultralytics AGPL-3.0 implications and the need to review an Enterprise
license before commercial or proprietary deployment. Do not purchase a license
or accept terms on the user's behalf.

## Validation and limitations

Add backend tests for configuration, model lifecycle, output normalization,
confidence/missing-keypoint handling, WebSocket cleanup, and non-blocking
inference behavior. Add frontend tests for the shared COCO index contract,
readiness states, detector response handling, overlay, and synthetic exercise
sequences including rejected/incomplete movements and plank pause/resume.
Retain and run existing workout, voice, and language tests.

Run backend and frontend test suites and the existing frontend production build.
When the local model and sample media are available, verify model loading,
frame-to-result integration, keypoint shape/confidence, and benchmark the
configured model/device and the Small alternative without loading both at once.
Report measured FPS and inference latency. Synthetic tests validate state
machine logic only; they do not prove real-world pose or exercise accuracy.
Without suitable local media and physical camera testing, explicitly report
those checks as outstanding. The user must physically test the exercises
before relying on rep/form accuracy.

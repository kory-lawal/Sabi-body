# SabiBody YOLOv8-Pose Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace active MediaPipe pose detection with a local YOLOv8-Pose service while preserving SabiBody's existing browser camera, workouts, exercise state machines, multilingual coaching, and YarnGPT integration.

**Architecture:** Keep browser camera capture and send bounded JPEG frames over the existing `/ws/pose` WebSocket to FastAPI. Load one configured Ultralytics model at service startup and return a normalized 17-point COCO result; adapt the frontend's readiness, exercise, and rendering code to that contract without moving workout analysis to Python.

**Tech Stack:** Vanilla JavaScript, Vite, Node.js built-in test runner, FastAPI, Python 3.10, Ultralytics, PyTorch, OpenCV, NumPy, WebSockets.

**Spec:** [docs/superpowers/specs/2026-11-10-yolov8-pose-migration-design.md](../specs/2026-11-10-yolov8-pose-migration-design.md)

## Global Constraints

- YOLOv8-Pose is the only active detector. There is no automatic or manual MediaPipe fallback.
- Use `yolov8n-pose.pt` by default. Allow model, device, image size, and confidence threshold configuration through environment variables. Benchmark `yolov8s-pose.pt` separately on the available hardware; do not assume CUDA.
- The initial performance goal is 8–15 pose updates per second. Measure actual throughput and latency on the available hardware; if the target is not met, adjust image size or send interval and report the resulting trade-off rather than claiming the target was achieved.
- Load one configured model during FastAPI startup, report its actual device, and reuse it. Do not load models per frame or load both model sizes at once.
- Use the model's 17 COCO keypoints consistently in Python, JavaScript, diagnostics, rendering, and synthetic fixtures.
- Keep workout analysis in the existing exercise-specific JavaScript state machines. Do not move rep counting or valid plank-time accumulation into the detector.
- Preserve YarnGPT and voice playback behavior. Pose frames and inference results are not sent to YarnGPT.
- Frames travel from the browser to the local backend for inference. They are processed in memory, not persisted, uploaded to a remote service, or sent to YarnGPT.
- Add compatible Ultralytics/PyTorch dependencies while retaining exactly one OpenCV distribution (`opencv-python`) and the existing FastAPI/NumPy stack.
- Document Ultralytics AGPL-3.0 implications and the need to review an Enterprise license before commercial or proprietary deployment. Do not purchase a license or accept terms on the user's behalf.
- Interpret “Do not rebuild the application” as “do not recreate/rewrite the application”; the existing frontend build remains part of final validation as explicitly requested.
- Continue in the current dirty checkout. Preserve every pre-existing change. Do not stage a whole pre-dirty file or include unrelated staged changes in a commit.

## File Map

| File | Responsibility |
|---|---|
| `backend/app/config.py` | Parse and validate YOLO model/device/image-size/confidence environment settings. |
| `backend/app/models/schemas.py` | Define the backend COCO keypoint-name order and pose WebSocket ready/result response contract. |
| `backend/app/services/yolo_pose_service.py` | Own one Ultralytics model, decode frames, serialize inference, and normalize YOLO results. |
| `backend/app/services/mediapipe_service.py` | Remove after the YOLO route and regression tests pass. |
| `backend/app/utils/pose_utils.py` | Remove after the YOLO route and reference search confirm it is MediaPipe-only. |
| `backend/app/main.py` | Load the pose service once during FastAPI lifespan and expose it to routes. |
| `backend/app/routes/pose.py` | Accept local WebSocket frames, run inference off the event loop, and clean up on disconnect. |
| `backend/app/routes/health.py` | Report model load status, selected model, and actual inference device. |
| `backend/requirements.txt` | Add compatible YOLO/PyTorch dependencies and use exactly one OpenCV distribution. |
| `backend/tests/test_yolo_pose_service.py` | Test config, model lifecycle, result normalization, and confidence handling with a fake model. |
| `backend/tests/test_pose_route.py` | Test WebSocket handshake, frame response, errors, and disconnect behavior without downloading weights. |
| `backend/scripts/pose_smoke.py` | Run inference and measure throughput on an explicitly supplied local image/video file, never a camera device. |
| `src/pose/keypoints.js` | Define the frontend's named COCO keypoint indices and skeleton edges. |
| `src/pose/pose-tracker.js` | Capture frames from the existing browser video and exchange results over WebSocket. |
| `src/pose/draw-pose.js` | Draw the COCO skeleton and confidence states over the mirrored camera preview. |
| `src/exercises/geometry.js` | Read YOLO keypoint confidence and use the 17-point COCO layout. |
| `src/exercises/pose-config.js` | Centralize confidence, smoothing, framing, orientation, and exercise thresholds. |
| `src/exercises/readiness.js` | Validate one detection, framing, confidence, exercise orientation, and start pose. |
| `src/exercises/squat.js` | Apply the COCO mapping to existing squat state-machine logic. |
| `src/exercises/jumping-jacks.js` | Apply the COCO mapping to existing closed/open cycle logic. |
| `src/exercises/plank.js` | Apply the COCO mapping to alignment and valid-time accumulation. |
| `src/ui/app.js` | Connect YOLO results to existing readiness/analyzer/coaching state, errors, and diagnostics. |
| `vite.config.js` | Proxy `/ws/pose` to the local FastAPI WebSocket in development. |
| `api/src/shared/coaching-messages.js` | Add only missing detector/readiness event translations, retaining all five languages. |
| `test/helpers/pose-fixtures.js` | Supply shared synthetic 17-point COCO test poses. |
| `test/camera-pose.test.js` | Replace MediaPipe-specific tracker/drawing tests with WebSocket and COCO overlay tests. |
| `test/exercises.test.js`, `test/exercise-readiness.test.js`, `test/app.test.js` | Update fixtures and assertions to 17-point results and preserve workout behavior. |
| `README.md` | Document local backend startup, inference configuration, privacy, licensing, validation, and physical-test limits. |
| `backend/.env.example` | List non-secret YOLO configuration defaults alongside existing backend settings. |
| `.gitignore` | Ignore downloaded YOLO pose weights without broadening ignore rules for unrelated assets. |

## Execution Rules

- Work task-by-task in order; run each task's focused tests before continuing.
- Before installing dependencies, update the relevant manifest. Use an environment compatible with the repository's Python 3.10 API command.
- Use injected fake models for ordinary unit tests; do not download weights in the unit-test path.
- Do not remove MediaPipe assets/dependencies until YOLO service, WebSocket, app flow, and regression checks pass.
- The checkout already has uncommitted changes in `README.md`, `package.json`, `package-lock.json`, `src/ui/app.js`, exercise modules, tests, and other files. Do not use blanket `git add`, `git checkout`, or reset commands. Before any commit, inspect `git diff --cached`; if a file's existing user changes cannot be excluded from the staged patch safely, leave it unstaged and ask before committing.
- Do not claim real-world accuracy from synthetic tests. Report unavailable hardware, missing sample media, or unperformed physical checks explicitly.

---

### Task 1: Configure YOLO Runtime and Dependencies

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/requirements.txt`
- Modify: `backend/.env.example`
- Test: `backend/tests/test_yolo_pose_service.py`

**Interfaces:**
- Produces `Settings.YOLO_POSE_MODEL`, `Settings.YOLO_DEVICE`, `Settings.YOLO_IMAGE_SIZE`, and `Settings.YOLO_CONFIDENCE`.
- Defaults are `yolov8n-pose.pt`, `auto`, `640`, and `0.25`; invalid image sizes, confidence values, or device strings fail with a useful configuration error.
- The dependency set installs only `opencv-python`, not `opencv-python-headless`.

- [ ] **Step 1: Add failing settings tests** for all defaults, environment overrides, and rejected values.

```python
def test_pose_settings_read_environment_and_validate_values():
    settings = Settings.from_env({
        "YOLO_POSE_MODEL": "yolov8s-pose.pt",
        "YOLO_DEVICE": "cpu",
        "YOLO_IMAGE_SIZE": "512",
        "YOLO_CONFIDENCE": "0.4",
    })
    assert settings.YOLO_POSE_MODEL == "yolov8s-pose.pt"
    assert settings.YOLO_DEVICE == "cpu"
    assert settings.YOLO_IMAGE_SIZE == 512
    assert settings.YOLO_CONFIDENCE == 0.4
```

- [ ] **Step 2: Run the focused backend test and confirm it fails** because the YOLO settings factory is missing.

Run from the repository root:

```powershell
Push-Location backend
py -3.10 -m unittest discover -s tests -p test_yolo_pose_service.py -v
Pop-Location
```

Expected: FAIL because `Settings.from_env` and the YOLO fields are not defined.

- [ ] **Step 3: Add validated settings and dependency declarations.** Implement `Settings.from_env(environ)` with `os.environ` as the default input; add the four documented environment keys to `backend/.env.example`; replace the headless OpenCV package with `opencv-python`; add resolver-compatible `ultralytics>=8.3,<9`, `torch>=2.2`, and `torchvision>=0.17,<1` requirements for the selected Python 3.10 environment. Keep the existing FastAPI, Uvicorn, NumPy, Pydantic, and dotenv dependencies.

```python
YOLO_POSE_MODEL = "yolov8n-pose.pt"
YOLO_DEVICE = "auto"
YOLO_IMAGE_SIZE = 640
YOLO_CONFIDENCE = 0.25
```

- [ ] **Step 3a: Record a single OpenCV package in the requirements file.**

```text
ultralytics>=8.3,<9
torch>=2.2
torchvision>=0.17,<1
opencv-python>=4.10,<5
```

- [ ] **Step 4: Install from the changed requirements and run the focused settings test.**

Run:

```powershell
Push-Location backend
py -3.10 -m pip uninstall -y opencv-python-headless
py -3.10 -m pip install -r requirements.txt
py -3.10 -m unittest discover -s tests -p test_yolo_pose_service.py -v
Pop-Location
```

Expected: PASS; `py -3.10 -m pip show opencv-python` succeeds and `py -3.10 -m pip show opencv-python-headless` reports it is not installed.

---

### Task 2: Implement the Single-Instance YOLO Pose Service

**Files:**
- Create: `backend/app/services/yolo_pose_service.py`
- Modify: `backend/app/models/schemas.py`
- Modify: `backend/app/config.py`
- Test: `backend/tests/test_yolo_pose_service.py`

**Interfaces:**
- `YoloPoseService(settings, model_factory=None)` accepts settings and an injectable model constructor for tests.
- `PoseModelLoadError(RuntimeError)` represents a model import/load failure; `load() -> dict` loads one model and returns its model name and actual device, or records unavailable state and raises `PoseModelLoadError`.
- `ready` is true only after successful model load; `health() -> dict` exposes readiness and actual device without filesystem paths or secrets.
- `process_frame(frame_bytes: bytes, frame_id: int) -> dict` decodes one image and returns a JSON-ready pose response. If the selected named weight is missing, use Ultralytics' official asset downloader to place that one requested pose weight in `backend/models`; a custom path is loaded as provided.
- The response contains `type`, `frame_id`, `status`, `inference_ms`, image dimensions, `person_count`, and `detections`. Each detection contains a normalized bounding box and exactly 17 ordered keypoints with `x`, `y`, and `confidence`; points absent from the model result are `null`.
- Keypoints use the approved COCO order, with raw model confidence retained so the frontend can identify low-confidence points.
- `backend/app/models/schemas.py` exports `COCO_KEYPOINT_NAMES` in the same 17-point order as `src/pose/keypoints.js`.
- The inference service loads `yolov8n-pose.pt` from the backend model directory unless `YOLO_POSE_MODEL` selects another supported YOLOv8 pose weight.

- [ ] **Step 1: Add failing fake-model tests** for load-once behavior, invalid frame bytes, two detected people, normalized boxes/keypoints, confidence values, absent points, and inference timing.

```python
assert COCO_KEYPOINT_NAMES == (
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
)
result = service.process_frame(jpeg_bytes, frame_id=7)
assert result["frame_id"] == 7
assert result["person_count"] == 1
assert len(result["detections"][0]["keypoints"]) == 17
assert result["detections"][0]["keypoints"][5]["confidence"] == 0.91
```

- [ ] **Step 2: Run `py -3.10 -m unittest discover -s tests -p test_yolo_pose_service.py -v` from `backend`** and confirm the new service tests fail.

- [ ] **Step 3: Implement the service and typed response schema.** Resolve `YOLO_DEVICE=auto` to CUDA only when PyTorch reports CUDA available; otherwise pass `cpu`. Pass the configured image size and confidence to `model.predict`, read actual `boxes.xyxy`, `boxes.conf`, `keypoints.xy`, and `keypoints.conf`, move tensors to CPU before JSON conversion, normalize pixel coordinates by source width/height, and report `str(model.device)` rather than claiming the requested device.

```python
model = self._model_factory(self.settings.YOLO_POSE_MODEL)
results = model.predict(
    image,
    imgsz=self.settings.YOLO_IMAGE_SIZE,
    conf=self.settings.YOLO_CONFIDENCE,
    device=self._resolved_device,
    verbose=False,
)
```

- [ ] **Step 4: Run the focused service tests and verify no test loads or downloads a real model.**

- [ ] **Step 5: Inspect the service diff** to confirm one model instance, a serialized inference lock, no `VideoCapture`, and no disk writes of camera frames.

---

### Task 3: Load the Model in FastAPI Lifespan and Report Health

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/app/routes/health.py`
- Modify: `backend/app/config.py`
- Test: `backend/tests/test_pose_route.py`

**Interfaces:**
- FastAPI lifespan constructs and loads one `YoloPoseService`, then stores it as `app.state.pose_service`.
- `GET /api/health` reports pose model readiness, model name, and actual device; a failed model load is not reported as healthy.
- A YOLO load failure leaves FastAPI and its speech/YarnGPT routes running with pose health degraded; only workout pose tracking is unavailable.
- Existing speech routes and health behavior remain intact.

- [ ] **Step 1: Add failing lifespan/health tests** with an injected fake service for successful load and model-load failure.

```python
assert health["pose"]["status"] == "ready"
assert health["pose"]["model"] == "yolov8n-pose.pt"
assert health["pose"]["device"] == "cpu"
```

- [ ] **Step 2: Run `py -3.10 -m unittest discover -s tests -p test_pose_route.py -v` from `backend`** and confirm the health/lifespan assertions fail before implementation.

- [ ] **Step 3: Replace import-time model construction with FastAPI lifespan initialization.** Do not instantiate YOLO at module import or inside a WebSocket handler. Define `logger = logging.getLogger(__name__)`; catch only `PoseModelLoadError`, log it, retain the unavailable state, and continue app startup so the existing speech/YarnGPT routes stay available. Make health serialize pose state without exposing filesystem paths or secrets.

```python
@asynccontextmanager
async def lifespan(app):
    pose_service = YoloPoseService(settings)
    app.state.pose_service = pose_service
    try:
        pose_service.load()
    except PoseModelLoadError:
        logger.exception("YOLO pose model could not be loaded")
    yield
```

- [ ] **Step 4: Run pose-route and existing YarnGPT service tests.**

Run from `backend`:

```powershell
py -3.10 -m unittest discover -s tests -v
```

Expected: all tests pass, including the unchanged speech tests.

---

### Task 4: Wire a Safe FastAPI Pose WebSocket

**Files:**
- Modify: `backend/app/routes/pose.py`
- Modify: `backend/app/models/schemas.py`
- Test: `backend/tests/test_pose_route.py`

**Interfaces:**
- `/ws/pose` sends a JSON `ready` handshake after accepting a connection; it includes selected model and actual device.
- If the lifespan recorded a model load error, `/ws/pose` sends a structured `error` handshake and closes; it does not start frame processing.
- Each binary JPEG frame receives one JSON pose result with its monotonically increasing connection-local `frame_id`.
- The route invokes `YoloPoseService.process_frame` via `starlette.concurrency.run_in_threadpool`.
- Invalid frames receive an explicit error result; WebSocket disconnects do not emit a second error or leak background work.

- [ ] **Step 1: Add failing WebSocket handler tests** for binary frame response, readiness handshake, invalid JPEG, model failure, and disconnect.

- [ ] **Step 2: Run `py -3.10 -m unittest discover -s tests -p test_pose_route.py -v` from `backend`** and confirm those cases fail.

- [ ] **Step 3: Implement the protocol.** Keep one inference in flight per connection, use the service lock for cross-connection model safety, and return a structured error rather than suppressing invalid payloads.

```python
pose_service = websocket.app.state.pose_service
if not pose_service.ready:
    await websocket.send_json({"type": "error", "status": "unavailable"})
    await websocket.close(code=1011)
    return
result = await run_in_threadpool(
    pose_service.process_frame,
    frame_bytes,
    frame_id,
)
await websocket.send_json(result)
```

- [ ] **Step 4: Run the focused pose WebSocket tests and complete backend suite.**

---

### Task 5: Define the COCO Contract in JavaScript and Migrate Geometry

**Files:**
- Create: `src/pose/keypoints.js`
- Create: `src/exercises/pose-config.js`
- Modify: `src/exercises/geometry.js`
- Create: `test/helpers/pose-fixtures.js`
- Modify: `test/exercises.test.js`
- Modify: `test/exercise-readiness.test.js`

**Interfaces:**
- `COCO_KEYPOINT` exports frozen named indices: `nose: 0`, `leftShoulder: 5`, `rightShoulder: 6`, `leftElbow: 7`, `rightElbow: 8`, `leftWrist: 9`, `rightWrist: 10`, `leftHip: 11`, `rightHip: 12`, `leftKnee: 13`, `rightKnee: 14`, `leftAnkle: 15`, `rightAnkle: 16`; eyes and ears occupy indices 1–4.
- `COCO_KEYPOINT_NAMES` has exactly 17 names in model order.
- `getLandmarkConfidence(point)` reads YOLO `confidence`; missing confidence is not treated as visible.
- `pose-config.js` exports the shared detector and exercise thresholds.
- Test fixtures return arrays of exactly 17 keypoints.

- [ ] **Step 1: Add failing mapping and confidence tests.**

```js
assert.equal(COCO_KEYPOINT.leftShoulder, 5);
assert.equal(COCO_KEYPOINT.rightAnkle, 16);
assert.equal(COCO_KEYPOINT_NAMES.length, 17);
assert.equal(isVisible({ x: 0.5, y: 0.5, confidence: 0.7 }), true);
assert.equal(isVisible({ x: 0.5, y: 0.5 }), false);
```

- [ ] **Step 2: Run `npm test -- test/exercises.test.js test/exercise-readiness.test.js`** and confirm the new schema assertions fail.

- [ ] **Step 3: Implement the named map, thresholds module, and confidence helper.** Update synthetic fixtures to allocate 17 slots and preserve `null` for missing points.

```js
export const COCO_KEYPOINT = Object.freeze({
  nose: 0,
  leftEye: 1, rightEye: 2, leftEar: 3, rightEar: 4,
  leftShoulder: 5, rightShoulder: 6,
  leftElbow: 7, rightElbow: 8,
  leftWrist: 9, rightWrist: 10,
  leftHip: 11, rightHip: 12,
  leftKnee: 13, rightKnee: 14,
  leftAnkle: 15, rightAnkle: 16,
});
```

`backend/app/models/schemas.py` defines the same names in a frozen ordered tuple and tests assert the complete Python and JavaScript sequences.

- [ ] **Step 4: Run the focused Node tests and confirm all fixtures now use the COCO layout.**

---

### Task 6: Migrate Exercise State Machines to 17 COCO Points

**Files:**
- Modify: `src/exercises/geometry.js`
- Modify: `src/exercises/squat.js`
- Modify: `src/exercises/jumping-jacks.js`
- Modify: `src/exercises/plank.js`
- Modify: `src/exercises/pose-config.js`
- Modify: `test/exercises.test.js`
- Modify: `test/helpers/pose-fixtures.js`

**Interfaces:**
- Existing `createSquatAnalyzer`, `createJumpingJackAnalyzer`, and `createPlankAnalyzer` retain their external `update(landmarks, timestamp)`/`reset()` behavior.
- `landmarks` is an array of 17 COCO entries; no module indexes a MediaPipe 33-point layout.
- Squats count only a full stable standing → depth → standing cycle; jumping jacks require both arms and both feet open and a stable closed return; plank elapsed time advances only while alignment is valid.

- [ ] **Step 1: Add failing COCO synthetic-sequence tests** for full squat, shallow squat, descent without return, full jack, one-arm-only jack, feet-only jack, invalid plank posture, missing landmarks, and corrected plank resumption. Add both forearm-plank and high-plank support-arm test sequences when their required points are available.

- [ ] **Step 2: Run `npm test -- test/exercises.test.js`** and confirm the exercise fixtures fail against old landmark indices.

- [ ] **Step 3: Replace numeric MediaPipe references with `COCO_KEYPOINT` names** and move thresholds into `pose-config.js`. Keep current state-transition stability, grace intervals, and capped plank timing.

```js
const { leftHip, leftKnee, leftAnkle } = COCO_KEYPOINT;
const kneeAngle = angleAt(
  landmarks[leftHip],
  landmarks[leftKnee],
  landmarks[leftAnkle],
);
```

- [ ] **Step 4: Run `npm test -- test/exercises.test.js`** and verify all positive and negative sequences.

- [ ] **Step 5: Run `rg -n 'landmarks\\[(1[1-6]|2[3-8])\\]' src\\exercises`** and inspect every remaining match; there must be no legacy indices in exercise code.

---

### Task 7: Adapt Readiness to Detections, Framing, and Confidence

**Files:**
- Modify: `src/exercises/readiness.js`
- Modify: `src/exercises/geometry.js`
- Modify: `src/exercises/pose-config.js`
- Modify: `test/exercise-readiness.test.js`
- Modify: `test/helpers/pose-fixtures.js`

**Interfaces:**
- `classifyExerciseReadiness(exerciseId, detection, config?)` accepts one normalized detection with `{ bbox, keypoints }`.
- `detection === null` yields `no-pose`; more than one detection is handled by the app as `multiple-people` and never passed as a valid single-person pose.
- Readiness result includes state/reason, required COCO indices/confidences, bounding box, and orientation/framing metrics.
- Orientation can be `front`, `side`, or `uncertain`; uncertain never counts as a valid orientation.

- [ ] **Step 1: Add failing tests** for no person, missing/low-confidence required points, partial framing, too-far, too-close, front/side view, and uncertain orientation. Test multiple-person handling in `test/app.test.js`, where detections are available as a list.

- [ ] **Step 2: Run `npm test -- test/exercise-readiness.test.js`** and verify failures identify the old 33-point assumptions.

- [ ] **Step 3: Implement readiness around a single COCO detection.** Use bbox coverage and normalized keypoint ratios for framing/orientation; keep uncertain camera-angle classification explicit.

```js
function classifyExerciseReadiness(exerciseId, detection, config = POSE_THRESHOLDS.readiness) {
  if (!detection) return result('no-pose', [], []);
  const { bbox, keypoints } = detection;
  const requiredIndices = REQUIRED_BY_EXERCISE[exerciseId];
  if (!areVisible(requiredIndices, keypoints, config.confidence)) {
    return result('missing-landmarks', requiredIndices, keypoints);
  }
  const framing = measureFraming(bbox, keypoints, config);
  const orientation = measureOrientation(exerciseId, keypoints, config);
  if (!framing.valid) return result(framing.reasonId, requiredIndices, keypoints, framing.metrics);
  if (orientation === 'uncertain') return result('orientation-uncertain', requiredIndices, keypoints);
  return classifyStartPose(exerciseId, requiredIndices, keypoints, config, framing.metrics);
}
```

`drawMirroredSegment` maps the normalized video point through the video element's rendered crop and mirrors its x-coordinate once to match the existing `scaleX(-1)` layer.

`measureFraming`, `measureOrientation`, and `classifyStartPose` are private helpers in `readiness.js`; keep the current file's existing `result`/visibility patterns.

- [ ] **Step 4: Run readiness and exercise tests; confirm the existing three-consecutive-frame gate still prevents unstable startup.**

---

### Task 8: Replace Browser MediaPipe Tracking with Latest-Only WebSocket Capture

**Files:**
- Modify: `src/pose/pose-tracker.js`
- Modify: `src/pose/keypoints.js`
- Modify: `vite.config.js`
- Modify: `test/camera-pose.test.js`

**Interfaces:**
- `createPoseTracker({ onPose, onError, createSocket?, createCaptureCanvas? })` retains `start(video, overlayCanvas)`, `pause()`, `resume()`, and `stop()`.
- `start` opens same-origin `/ws/pose`, waits for the `ready` handshake, and only then schedules captures.
- Pose callbacks receive `(detections, timestamp, frameMetadata)`.
- The tracker sends binary JPEG frames from a private capture canvas, keeps one frame in flight plus only the newest pending frame, and skips stale frames.
- `stop()` closes the socket, cancels capture, drops pending data, and clears no browser camera stream; camera ownership remains in `camera.js`.

- [ ] **Step 1: Replace MediaPipe-specific tracker tests with failing fake-WebSocket tests** for handshake, 17-point results, frame sequencing, pause/resume, backend unavailable, and socket cleanup.

- [ ] **Step 2: Run `npm test -- test/camera-pose.test.js`** and confirm it fails because the tracker still imports MediaPipe.

- [ ] **Step 3: Implement a browser-safe socket URL and latest-only capture loop.** Use `ws:` for an `http:` page and `wss:` for an `https:` page; resize captured frames proportionally to a maximum 640x480, encode JPEG with `toBlob`, and close/discard pending work on pause or stop.

```js
if (socket.readyState === WebSocket.OPEN && !frameInFlight) {
  frameInFlight = true;
  socket.send(jpegBlob);
} else {
  newestPendingFrame = jpegBlob;
}
```

On each result, clear `frameInFlight`, deliver the result to `onPose`, and send only the most recent pending Blob if capture is still active.

- [ ] **Step 4: Configure Vite `/ws/pose` proxy with `ws: true`** targeting the existing local FastAPI server.

- [ ] **Step 5: Run camera/tracker tests and `npm run dev:all`; confirm the frontend WebSocket reaches FastAPI without changing `getUserMedia()` behavior.**

---

### Task 9: Draw COCO Skeleton and Confidence States

**Files:**
- Modify: `src/pose/draw-pose.js`
- Modify: `src/pose/keypoints.js`
- Modify: `src/styles.css`
- Modify: `test/camera-pose.test.js`

**Interfaces:**
- `drawPose(canvas, detection, videoElement, poseStatus)` draws COCO connections only when both endpoint points meet the configured confidence and bounds checks.
- Valid, low-confidence, missing, and invalid-form states use separate visual treatments.
- Canvas coordinates align with the existing `scaleX(-1)` video/canvas presentation; no stretched camera frame is introduced.

- [ ] **Step 1: Add failing canvas-harness tests** for all COCO connections, confidence filtering, no-person clearing, and mirrored placement.

- [ ] **Step 2: Run `npm test -- test/camera-pose.test.js`** and confirm the old MediaPipe `DrawingUtils` import prevents the COCO tests from passing.

- [ ] **Step 3: Implement canvas drawing from `COCO_KEYPOINT_NAMES` and the shared edge list.** Keep canvas rendering optional so drawing errors do not stop pose analysis.

```js
for (const [start, end] of COCO_POSE_EDGES) {
  if (isVisible(keypoints[start]) && isVisible(keypoints[end])) {
    drawMirroredSegment(context, keypoints[start], keypoints[end], poseStatus);
  }
}
```

- [ ] **Step 4: Run the focused tests and visually inspect the live mirrored overlay with one local camera session when available.**

---

### Task 10: Integrate Results, Status, Coaching, and Diagnostics

**Files:**
- Modify: `src/ui/app.js`
- Modify: `src/exercises/readiness.js`
- Modify: `api/src/shared/coaching-messages.js`
- Modify: `test/app.test.js`
- Modify: `test/feedback.test.js`

**Interfaces:**
- The controller consumes detector messages and passes only a single detection's 17 keypoints to readiness/analyzers.
- Backend unavailable, no-person, multiple-person, partial-frame, uncertain orientation, and ready conditions map to explicit status and existing event-based coaching behavior.
- The developer-only diagnostic payload adds model, actual device, FPS, latency, bbox, keypoints/confidences, missing points, readiness, phase, exercise metrics, rejection reason, and coaching event.
- YarnGPT voice client, queue, cooldowns, cancellation, and playback APIs remain unchanged.

- [ ] **Step 1: Add failing controller tests** for clear backend-offline state, multiple-person rejection, successful single-person readiness, frame metadata diagnostics, and unchanged voice calls.

- [ ] **Step 2: Run `npm test -- test/app.test.js test/feedback.test.js`** and confirm controller tests fail against the old `(landmarks, timestamp, worldLandmarks)` callback.

- [ ] **Step 3: Update `processPose` and controller state to consume detection messages.** Remove world-landmark assumptions, clear/pause analyzer state on no-person or multiple-person frames, and report backend errors through the existing startup/error path.

```js
function processPose(result, timestamp) {
  if (!Array.isArray(result.detections) || result.detections.length !== 1) {
    const reasonId = result.person_count === 0 ? 'no-pose' : 'multiple-people';
    readinessGate.reset();
    analyzers[state.selectedExercise].update([], timestamp);
    update({
      personDetected: result.person_count > 0,
      readinessReady: false,
      readinessReasonId: reasonId,
    });
    return;
  }
  const detection = result.detections[0];
  const classification = classifyExerciseReadiness(state.selectedExercise, detection);
  const readiness = readinessGate.update(classification);
  const landmarks = detection.keypoints;
  const analysis = readiness.ready
    ? analyzers[state.selectedExercise].update(landmarks, timestamp)
    : analyzers[state.selectedExercise].update([], timestamp);
  update({
    personDetected: true,
    readinessReady: readiness.ready,
    readinessState: classification.state,
    readinessReasonId: classification.reasonId,
    count: analysis.count ?? state.count,
    elapsedMs: analysis.elapsedMs ?? state.elapsedMs,
    diagnosticMetrics: { ...classification.metrics, ...analysis.metrics, frame: result },
  });
}
```

- [ ] **Step 4: Extend the hidden diagnostics and multilingual coaching only for missing readiness states.** Add matching English, Yoruba, Igbo, Hausa, and Nigerian Pidgin entries for any newly introduced message IDs.

- [ ] **Step 5: Run app, feedback, workout, and voice tests** to verify exercise selection, workout controls, language options, and YarnGPT remain functional.

---

### Task 11: Exercise the Real Local Inference Path

**Files:**
- Create: `backend/scripts/pose_smoke.py`
- Test: `backend/tests/test_pose_route.py`
- Test: `test/camera-pose.test.js`

**Interfaces:**
- `npm run dev:all` runs the existing Vite app and Python API together.
- The backend has a model health signal and `/ws/pose` ready/result messages.
- A local smoke test records actual model/device, frame dimensions, person count, 17 keypoints, inference latency, and measured result FPS without persisting camera frames.

- [ ] **Step 1: Create a smoke script that accepts an explicit local image or video file path, runs repeated inference, and prints model/device, frame size, detection count, inference latency, and FPS.** Reject camera-device indices; do not capture from `cv2.VideoCapture(0)` or save frames.

```powershell
py -3.10 backend/scripts/pose_smoke.py public/assets/sabi-body-hero.jpg --model yolov8n-pose.pt
```

The script uses `cv2.VideoCapture` only with the supplied file path. For a still image, decode the file once and run repeated in-memory inference to measure model throughput.

- [ ] **Step 2: Run backend tests and frontend tracker tests before downloading weights.**

- [ ] **Step 3: Download only the selected official `yolov8n-pose.pt` weights** into the ignored backend model directory and verify `/api/health` reports the loaded model and actual device.

- [ ] **Step 4: Run a local WebSocket smoke test with a JPEG frame** and verify a valid result contains exactly 17 ordered keypoints and confidence values.

- [ ] **Step 5: Run `py -3.10 backend/scripts/pose_smoke.py public/assets/sabi-body-hero.jpg --model yolov8n-pose.pt`, then run a separate process with `--model yolov8s-pose.pt`.** The existing hero image supplies a local still-image smoke test; repeated still-frame inference measures throughput only and does not prove temporal or exercise accuracy. Record warm-up policy, device, image size, median/percentile inference latency, and FPS; compare the measured update rate with the 8–15 updates/second initial goal.

---

### Task 12: Document Operation, Privacy, and Licensing

**Files:**
- Modify: `README.md`
- Modify: `backend/.env.example`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- README setup starts the Python API and Vite together and lists the YOLO environment variables, selected model, local-only frame handling, model download, and troubleshooting.
- The privacy section accurately states frames are sent to the local backend for in-memory processing and are not stored or sent to YarnGPT.
- The licensing section states the Ultralytics AGPL-3.0 review requirement and advises Enterprise license review for commercial/proprietary deployment; it does not provide legal conclusions or accept terms.

- [ ] **Step 1: Add README setup and verification instructions** for startup, health, language/voice regression, local frame privacy, and physical-camera validation.

- [ ] **Step 2: Replace obsolete MediaPipe setup/privacy descriptions** with the approved YOLO local-backend flow; retain the physical-test and accuracy caveats.

```dotenv
YOLO_POSE_MODEL=yolov8n-pose.pt
YOLO_DEVICE=auto
YOLO_IMAGE_SIZE=640
YOLO_CONFIDENCE=0.25
```

- [ ] **Step 3: Add only the two YOLO weight paths to ignore rules** and keep other models/assets trackable.

```gitignore
backend/models/yolov8n-pose.pt
backend/models/yolov8s-pose.pt
```

- [ ] **Step 4: Review the README diff** to ensure unrelated existing documentation edits are preserved.

---

### Task 13: Remove MediaPipe Only After Migration Passes

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `backend/requirements.txt`
- Modify: `src/pose/pose-tracker.js`
- Modify: `src/pose/draw-pose.js`
- Modify: `test/camera-pose.test.js`
- Delete only if no remaining references: `public/mediapipe/wasm/vision_wasm_internal.js`
- Delete only if no remaining references: `public/mediapipe/wasm/vision_wasm_internal.wasm`
- Delete only if no remaining references: `public/mediapipe/wasm/vision_wasm_module_internal.js`
- Delete only if no remaining references: `public/mediapipe/wasm/vision_wasm_module_internal.wasm`
- Delete only if no remaining references: `public/mediapipe/wasm/vision_wasm_nosimd_internal.js`
- Delete only if no remaining references: `public/mediapipe/wasm/vision_wasm_nosimd_internal.wasm`
- Delete only if no remaining references: `public/models/pose_landmarker_lite.task`
- Delete only if no remaining references: `backend/models/pose_landmarker.task`
- Delete only if no remaining references: `backend/app/services/mediapipe_service.py`
- Delete only if no remaining references: `backend/app/utils/pose_utils.py`

**Interfaces:**
- No active source/test import references `@mediapipe/tasks-vision`, Python `mediapipe`, `/mediapipe/wasm`, or `pose_landmarker_lite.task`.
- YOLO remains the sole production detector; unrelated files and uncommitted work remain untouched.

- [ ] **Step 1: Run `rg -n 'mediapipe|MediaPipe|PoseLandmarker|DrawingUtils|pose_landmarker_lite' src backend test package.json package-lock.json vite.config.js README.md`** and classify each remaining match as a removable detector reference or historical/licensing text.

- [ ] **Step 2: Confirm the YOLO fake-model, WebSocket, analyzer, app, and YarnGPT suites pass** before deleting MediaPipe assets.

- [ ] **Step 3: Remove `@mediapipe/tasks-vision` through npm and remove `mediapipe` from Python requirements.** Preserve exactly one `opencv-python` package.

```powershell
npm uninstall @mediapipe/tasks-vision
Push-Location backend
py -3.10 -m pip uninstall -y mediapipe
Pop-Location
```

- [ ] **Step 4: Remove only the listed MediaPipe WASM/model assets after confirming no non-MediaPipe consumer references them.**

- [ ] **Step 5: Re-run the MediaPipe reference search, backend tests, frontend tests, and production build.**

---

### Task 14: Final Verification and Handoff Evidence

**Files:**
- Verify: all changed backend/frontend source and tests
- Verify: `README.md`

- [ ] **Step 1: Run the backend suite.**

```powershell
Push-Location backend
py -3.10 -m unittest discover -s tests -v
Pop-Location
```

Expected: all backend tests pass, including unchanged YarnGPT tests.

- [ ] **Step 2: Run the complete frontend suite and build.**

```powershell
npm test
npm run build
```

Expected: all Node tests pass and Vite completes a production build.

- [ ] **Step 3: Run the app and confirm the real YOLO path** if weights and a usable sample/camera are available; record actual model/device, latency, FPS, person/keypoint result, and any resource constraints.

- [ ] **Step 4: Verify the user-visible workflow** with a physical camera when available: backend offline gives a clear error; camera permission/start/stop is unchanged; exercise selection and controls work; no invalid rep is counted; plank time pauses on invalid pose and resumes with prior time retained; all five languages remain available; YarnGPT speech works.

- [ ] **Step 5: Inspect `git status --short` and `git diff --check`.** Confirm no model weights, secrets, camera frames, or unrelated staged files are present.

## Coverage Crosswalk

| Spec requirement | Plan tasks |
|---|---|
| Configurable model/device/image-size/confidence; model loads once; CPU/CUDA truthful | 1–3 |
| Local browser camera, JPEG transport, latest-only flow, safe threaded inference, cleanup | 4, 8, 11 |
| Shared 17-point COCO contract and confidence/missing-point handling | 2, 5–7 |
| Person readiness, framing, orientation uncertainty, exercise state machines, plank pause/resume | 6–7, 10 |
| Mirrored skeleton overlay and developer diagnostics | 9–10 |
| Multilingual event coaching and unchanged YarnGPT | 10, 12, 14 |
| Privacy copy, licensing, ignored weights, MediaPipe removal | 12–13 |
| Backend/frontend tests, real inference evidence, benchmark, physical checks | 1–14 |

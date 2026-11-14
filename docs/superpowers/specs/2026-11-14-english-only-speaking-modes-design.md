# English-Only Release and Mutually Exclusive Speaking Modes

## Goal

Prepare the existing SabiBody application for an English-only release while
retaining its multilingual implementation and YarnGPT integration. Make
Voice Coaching and Speak Each Rep mutually exclusive in persistent state and
spoken output, without changing exercise recognition or workout behavior.

## Current implementation

- `src/feedback/messages.js` exposes the full language catalog and translates
  from the shared phrase library in `api/src/shared/coaching-messages.js`.
- The app loads a persisted language into state and renders it in both language
  selectors and the home-page language badges.
- English workout text is authored locally in the exercise content and phrase
  catalog. English speech uses browser speech synthesis; other languages use
  the existing YarnGPT service and audio playback path.
- `src/feedback/speech-queue.js` is the single scheduler for spoken output.
- `voiceEnabled` and `countEachRep` are independent persisted booleans. The
  controller can therefore currently emit contextual feedback and rep counts
  in the same session.
- No ChatGPT or OpenAI integration was found in the application.

## Design

### Release language availability

Keep the complete `LANGUAGES` catalog, translations, backend language support,
and YarnGPT implementation. Add a release-level allowlist containing only
English and use it for the visible language selector and accepted UI language
changes. Normalize previously persisted non-English selections to English.
The existing English exercise instructions and phrase catalog remain the
source of basic English text; English speech continues through browser speech
and does not require the YarnGPT backend or an API key.

Update the home-page language badges and README availability description to
reflect the English-only release. Do not remove any non-English implementation
or alter backend language support. Keep the existing voice selector and
YarnGPT integration; do not add another TTS provider or voice test controls.

### Mutually exclusive speaking modes

Retain the existing `voiceEnabled` and `countEachRep` preference/state fields
to minimize compatibility changes. Normalize a persisted conflict using
Voice Coaching as the winner. Enabling Voice Coaching turns off Speak Each
Rep; enabling Speak Each Rep turns off Voice Coaching. Turning the active mode
off leaves both modes off. Every transition updates and persists the pair as
one invariant-preserving state change.

The controller is the authority for speech eligibility:

- Voice Coaching may enqueue contextual coaching, instructions, progress, and
  completion messages, but never per-repetition announcements.
- Speak Each Rep may enqueue only the repetition-count event generated after
  the existing analyzer count increases; contextual messages remain visual
  feedback only.
- With both modes off, the controller enqueues no workout speech.

Keep the other mode control available to switch modes. Use the existing live
voice-status text to explain that the other mode cannot run while one mode is
selected. Preserve both controls' accessible labels and current styling.

### Shared speech lifecycle

Continue using the existing shared queue and its browser/YarnGPT playback
adapters. Do not add a queue or announcement controller. On mode changes,
cancel queued and active speech and increment the synthesis generation. Check
the current mode and generation immediately before playback so delayed
YarnGPT results cannot become audible under a different mode.

Apply cancellation and generation invalidation when changing exercises or
explicitly ending a workout, preventing old announcements from crossing those
boundaries. On target completion, cancel stale in-progress announcements and
allow a new completion announcement only if Voice Coaching is selected.
Speech errors continue through existing status/error handling and must not
escape into pose processing, repetition counting, or workout lifecycle code.

## Out of scope

- Changing MediaPipe, exercise analyzers, camera behavior, targets, or
  completion-screen behavior.
- Removing translations or backend support for Yoruba, Igbo, Hausa, or
  Nigerian Pidgin.
- Replacing YarnGPT, changing its endpoints or request payloads, or adding a
  second speech queue/provider.
- Adding voice-test or pronunciation controls.

## Validation

Focused tests will verify the English-only UI and preference normalization,
offline English message availability, mutually exclusive state transitions
and legacy conflict behavior, mode-specific speech eligibility, valid rep
announcement events, stale queue/synthesis cancellation, and playback-error
recovery. Then run the existing Node test suite and production build. Existing
exercise and plank tests remain the regression check for workout behavior.

# Global Speech Queue Design

## Goal

Ensure every spoken SabiBody message uses one coordinator so a new announcement
cannot interrupt a statement already playing. Preserve browser speech for
English and YarnGPT-generated audio for the other supported languages.

## Current behavior

- `src/feedback/speech.js` sends English utterances directly to
  `SpeechSynthesis` and returns before an utterance finishes.
- `src/ui/app.js` requests YarnGPT audio for other languages and passes the
  resulting blob to `src/feedback/voice-playback.js`.
- The playback manager can stop existing audio when a higher-priority item is
  requested, so a newer announcement can interrupt a current one.
- Voice-test playback and the local audio diagnostic call the playback manager
  directly.
- Workout completion cancels both speech paths before queuing the completion
  message.

## Design

Introduce one `createSpeechQueue` coordinator in the feedback layer. A queued
item contains a stable event key, priority, and a playback task that resolves
only when its spoken output has ended. The queue owns the active item, waiting
items, deduplication, inter-statement delay, cancellation, and recovery after
playback errors.

The queue selects the highest-priority waiting item next, preserving arrival
order among items with equal priority. It never replaces or stops the active
item merely because a higher-priority message arrives. Duplicate event keys
are coalesced while queued or active and suppressed for a short per-event
cooldown of 4.5 seconds after completion. Different repetition counts remain
distinct events.

The existing global cooldown between different feedback events is removed so
distinct eligible announcements are queued instead of silently dropped.
Eligibility rules that intentionally disable a message for the selected coach
personality remain unchanged; duplicate suppression is owned by the queue.

Priority levels are: workout completion and explicit audio diagnostics (100),
essential form corrections (80), workout controls and countdowns (70),
repetition counts (50), and routine encouragement and milestones (30).

`createSpeechCoach` becomes the browser-speech adapter and reports completion
from the utterance end/error events. Browser speech uses a moderate rate of
0.92. The YarnGPT audio playback manager remains responsible for creating,
playing, and releasing audio resources, but its output is requested only by the
queue; its playback rate is set to 0.92 with pitch preservation where
supported. YarnGPT endpoints, language selection, and request payloads remain
unchanged.

All announcement sources in `src/ui/app.js` use the queue: feedback messages,
YarnGPT-generated audio, browser and YarnGPT voice tests, and the local audio
diagnostic. Priority affects only waiting items. The completion path no longer
cancels the active statement before enqueuing completion. Explicit voice-off
or language changes may cancel active playback and clear waiting items.
Workout lifecycle messages can discard stale waiting items without
interrupting the statement already playing.

The queue inserts a 350 ms pause between completed statements. Playback
rejection, utterance error, cancellation, and synchronous adapter failure all
release the active slot; non-cancellation errors are surfaced through the
existing voice status/error handlers, and the next valid item can proceed.

## Interfaces and boundaries

- The queue exposes enqueue and cancellation operations plus a way to clear
  stale waiting items without stopping the current statement.
- Speech and audio modules are output adapters, not independent schedulers.
- The UI controller assigns event keys and priorities but does not manage
  playback lifecycle or invoke output adapters directly.
- Existing YarnGPT synthesis and voice catalog behavior remain unchanged.

## Validation

Add focused tests proving:

- Rapid announcements never overlap and a task occupies the queue until its
  end callback.
- Higher-priority waiting items go next without interrupting active speech;
  equal-priority items retain FIFO order.
- Duplicate events do not accumulate, while distinct repetition events remain
  eligible.
- A pause occurs between completed statements.
- Cancellation, synchronous failure, and asynchronous playback failure do not
  leave the queue stuck.
- English and YarnGPT-backed paths both pass through the same queue and keep
  their existing language selection behavior.

Run the focused speech/controller tests, the full test suite, and the
production build.

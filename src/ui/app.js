import { stopCamera, startCamera } from '../camera/camera.js';
import { createJumpingJackAnalyzer } from '../exercises/jumping-jacks.js';
import { hasFullBodyVisible } from '../exercises/geometry.js';
import { createPlankAnalyzer } from '../exercises/plank.js';
import { createSquatAnalyzer } from '../exercises/squat.js';
import { LANGUAGES, translateMessage } from '../feedback/messages.js';
import { createSpeechCoach } from '../feedback/speech.js';
import { createPoseTracker } from '../pose/pose-tracker.js';

const EXERCISES = {
  squats: {
    name: 'Squats',
    description: 'Build a steady rhythm with a comfortable squat and return.',
    instruction: 'Stand side-on to the camera with your hip, knee, and ankle visible.',
    cameraInstruction: 'Keep your hip, knee, and ankle in view from the side.',
    progressLabel: 'Repetitions',
  },
  'jumping-jacks': {
    name: 'Jumping Jacks',
    description: 'Move your arms and feet together, then return to your start.',
    instruction: 'Face the camera and leave room to move your arms and feet.',
    cameraInstruction: 'Step back until your hands and feet stay inside the frame.',
    progressLabel: 'Repetitions',
  },
  plank: {
    name: 'Plank',
    description: 'Hold a comfortable side-on plank and keep your body aligned.',
    instruction: 'Turn side-on to the camera and hold a steady plank position.',
    cameraInstruction: 'Keep your shoulder, hip, and ankle visible from the side.',
    progressLabel: 'Time',
  },
};

function createAnalyzers() {
  return {
    squats: createSquatAnalyzer(),
    'jumping-jacks': createJumpingJackAnalyzer(),
    plank: createPlankAnalyzer(),
  };
}

function makeInitialState() {
  return {
    view: 'home',
    selectedExercise: 'squats',
    language: 'en',
    voiceEnabled: false,
    workoutStatus: 'idle',
    personDetected: false,
    fullBodyVisible: false,
    exerciseState: 'waiting',
    count: 0,
    elapsedMs: 0,
    feedback: 'Choose a workout to get started.',
    feedbackId: 'ready',
    isFallback: false,
    statusMessage: 'Camera is off. Choose an exercise to begin.',
  };
}

function formatTime(elapsedMs) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function clearOverlay(canvas) {
  const context = canvas?.getContext?.('2d');
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
}

export function createWorkoutController({
  video,
  canvas,
  onState = () => {},
  startCamera: acquireCamera = startCamera,
  stopCamera: releaseCamera = stopCamera,
  createPoseTracker: makePoseTracker = createPoseTracker,
  createAnalyzers: makeAnalyzers = createAnalyzers,
  translateMessage: lookupMessage = translateMessage,
  speechCoach,
} = {}) {
  let state = makeInitialState();
  let analyzers = makeAnalyzers();
  let stream = null;
  let tracker = null;
  let startPromise = null;
  let generation = 0;
  let trackEndedHandler = null;
  let lastSpokenFeedbackId = null;
  let interrupted = false;

  const coach =
    speechCoach ??
    createSpeechCoach({
      synthesis: globalThis.speechSynthesis ?? { speak() {}, cancel() {} },
      Utterance: globalThis.SpeechSynthesisUtterance ?? class {
        constructor(text) {
          this.text = text;
        }
      },
      onError: (error) => {
        update({ statusMessage: `${error.message} Written coaching is still available.` });
      },
    });

  function snapshot() {
    const isBusy = state.workoutStatus === 'loading';
    const active = state.workoutStatus === 'running';
    const paused = state.workoutStatus === 'paused';
    const hasSession = ['loading', 'running', 'paused'].includes(state.workoutStatus);
    return {
      ...state,
      canStart: !isBusy && !active && !paused,
      canPause: active,
      canResume: paused,
      canReset: active || paused,
      canEnd: hasSession || state.workoutStatus === 'error',
      exercise: EXERCISES[state.selectedExercise],
    };
  }

  function update(changes) {
    state = { ...state, ...changes };
    onState(snapshot());
  }

  function setFeedback(feedbackId) {
    const translated = lookupMessage(feedbackId, state.language);
    update({
      feedbackId,
      feedback: translated.text,
      isFallback: translated.isFallback,
    });

    if (
      feedbackId !== lastSpokenFeedbackId &&
      state.language === 'en' &&
      state.voiceEnabled
    ) {
      try {
        coach.speak(feedbackId, translated.text, state.language);
      } catch (error) {
        update({ statusMessage: `${error.message} Written coaching is still available.` });
      }
    }
    lastSpokenFeedbackId = feedbackId;
  }

  function releaseResources({ stopTracker = true } = {}) {
    if (trackEndedHandler) {
      for (const track of stream?.getTracks?.() ?? []) {
        track.removeEventListener?.('ended', trackEndedHandler);
      }
      trackEndedHandler = null;
    }

    if (stopTracker) {
      try {
        tracker?.stop();
      } catch {
        // Continue releasing camera tracks if tracker cleanup fails.
      }
      tracker = null;
    }

    if (stream) {
      try {
        releaseCamera(stream, video);
      } catch {
        // The preview is still cleared if a browser track refuses to stop.
        if (video) {
          video.srcObject = null;
        }
      }
      stream = null;
    }
    clearOverlay(canvas);
  }

  function failStartup(error, runGeneration) {
    if (runGeneration !== generation) {
      return;
    }
    releaseResources();
    interrupted = false;
    update({
      workoutStatus: 'error',
      personDetected: false,
      fullBodyVisible: false,
      statusMessage:
        error?.message ||
        'The camera or pose model could not start. Check camera access and try again.',
    });
  }

  function handleTrackEnded(track, runGeneration) {
    if (
      runGeneration !== generation ||
      state.workoutStatus === 'idle' ||
      state.workoutStatus === 'error'
    ) {
      return;
    }

    try {
      tracker?.pause();
    } catch {
      // The stream ending must still be reported even if pause fails.
    }
    if (state.selectedExercise === 'plank') {
      analyzers.plank.update([], globalThis.performance?.now?.());
    }
    interrupted = true;
    if (trackEndedHandler) {
      track.removeEventListener?.('ended', trackEndedHandler);
      trackEndedHandler = null;
    }
    if (stream) {
      try {
        releaseCamera(stream, video);
      } catch {
        if (video) {
          video.srcObject = null;
        }
      }
      stream = null;
    }
    clearOverlay(canvas);
    update({
      workoutStatus: 'paused',
      personDetected: false,
      fullBodyVisible: false,
      statusMessage: 'The camera stopped. Reconnect it, then choose Resume to continue.',
    });
  }

  function processPose(landmarks, timestamp) {
    if (state.workoutStatus !== 'running') {
      return;
    }
    const personDetected = Array.isArray(landmarks) && landmarks.length > 0;
    const fullBodyVisible = personDetected && hasFullBodyVisible(landmarks);
    const analysis = analyzers[state.selectedExercise].update(landmarks, timestamp);
    update({
      personDetected,
      fullBodyVisible,
      exerciseState: analysis.state,
      count: analysis.count ?? state.count,
      elapsedMs: analysis.elapsedMs ?? state.elapsedMs,
      statusMessage: fullBodyVisible
        ? 'Camera and pose tracking are running.'
        : EXERCISES[state.selectedExercise].cameraInstruction,
    });
    if (analysis.feedbackId) {
      setFeedback(analysis.feedbackId);
    }
  }

  async function initializeTracker(runGeneration) {
    let createdTracker;
    try {
      createdTracker = makePoseTracker({
        onPose: processPose,
        onError: (error) => failStartup(error, runGeneration),
      });
      tracker = createdTracker;
      const acquiredStream = await acquireCamera(video);
      if (runGeneration !== generation) {
        if (video?.srcObject === acquiredStream) {
          video.srcObject = stream ?? null;
        }
        releaseCamera(acquiredStream, null);
        createdTracker.stop();
        return false;
      }
      stream = acquiredStream;
      const videoTrack = acquiredStream.getVideoTracks?.()[0];
      if (videoTrack?.addEventListener) {
        trackEndedHandler = () => handleTrackEnded(videoTrack, runGeneration);
        videoTrack.addEventListener('ended', trackEndedHandler, { once: true });
      }
      if (videoTrack?.readyState === 'ended') {
        handleTrackEnded(videoTrack, runGeneration);
        return false;
      }

      await createdTracker.start(video, canvas);
      if (runGeneration !== generation) {
        return false;
      }
      if (interrupted) {
        return false;
      }
      if (state.workoutStatus !== 'error') {
        interrupted = false;
        update({
          workoutStatus: 'running',
          statusMessage: 'Camera and pose tracking are running.',
        });
        return true;
      }
      return false;
    } catch (error) {
      failStartup(error, runGeneration);
      return false;
    }
  }

  function start({ resetProgress = true } = {}) {
    if (startPromise) {
      return startPromise;
    }
    if (state.workoutStatus === 'running') {
      return Promise.resolve();
    }
    if (state.workoutStatus === 'paused' && resetProgress) {
      return resume();
    }

    const runGeneration = ++generation;
    interrupted = false;
    if (resetProgress) {
      analyzers[state.selectedExercise].reset();
      lastSpokenFeedbackId = null;
      update({
        workoutStatus: 'loading',
        personDetected: false,
        fullBodyVisible: false,
        exerciseState: 'waiting',
        count: 0,
        elapsedMs: 0,
        feedbackId: 'ready',
        feedback: lookupMessage('ready', state.language).text,
        isFallback: lookupMessage('ready', state.language).isFallback,
        statusMessage: 'Requesting camera access and loading pose tracking.',
      });
    } else {
      update({
        workoutStatus: 'loading',
        personDetected: false,
        fullBodyVisible: false,
        statusMessage: 'Reconnecting to the camera and restarting pose tracking.',
      });
    }

    const attempt = initializeTracker(runGeneration);
    startPromise = attempt;
    attempt.then(
      () => {
        if (startPromise === attempt) {
          startPromise = null;
        }
      },
      () => {
        if (startPromise === attempt) {
          startPromise = null;
        }
      },
    );
    return attempt;
  }

  function pause() {
    if (state.workoutStatus !== 'running') {
      return;
    }
    tracker?.pause();
    if (state.selectedExercise === 'plank') {
      analyzers.plank.update([], globalThis.performance?.now?.());
    }
    update({
      workoutStatus: 'paused',
      statusMessage: 'Workout paused. Your camera preview is still on.',
    });
  }

  function resume() {
    if (state.workoutStatus !== 'paused') {
      return Promise.resolve();
    }
    if (startPromise) {
      return startPromise;
    }
    if (interrupted || !stream || !tracker) {
      try {
        tracker?.stop();
      } catch {
        // A fresh tracker will replace the interrupted instance.
      }
      tracker = null;
      return start({ resetProgress: false });
    }

    if (state.selectedExercise === 'plank') {
      analyzers.plank.update([], globalThis.performance?.now?.());
    }
    tracker.resume();
    update({
      workoutStatus: 'running',
      statusMessage: 'Camera and pose tracking are running.',
    });
    return Promise.resolve();
  }

  function reset() {
    if (!['running', 'paused'].includes(state.workoutStatus)) {
      return;
    }
    const wasRunning = state.workoutStatus === 'running';
    analyzers[state.selectedExercise].reset();
    lastSpokenFeedbackId = null;
    update({
      exerciseState: 'waiting',
      count: 0,
      elapsedMs: 0,
      personDetected: false,
      fullBodyVisible: false,
      feedbackId: 'ready',
      feedback: lookupMessage('ready', state.language).text,
      isFallback: lookupMessage('ready', state.language).isFallback,
      statusMessage: wasRunning
        ? 'Progress reset. Pose tracking is running.'
        : 'Progress reset. Workout remains paused.',
    });
    if (wasRunning) {
      tracker?.resume();
    }
  }

  async function end() {
    generation += 1;
    startPromise = null;
    releaseResources();
    interrupted = false;
    lastSpokenFeedbackId = null;
    analyzers[state.selectedExercise].reset();
    update({
      view: 'home',
      workoutStatus: 'idle',
      personDetected: false,
      fullBodyVisible: false,
      exerciseState: 'waiting',
      count: 0,
      elapsedMs: 0,
      feedback: 'Choose a workout to get started.',
      feedbackId: 'ready',
      isFallback: false,
      statusMessage: 'Camera is off. Choose an exercise to begin.',
    });
  }

  function selectExercise(exerciseId) {
    if (!Object.hasOwn(EXERCISES, exerciseId)) {
      return false;
    }
    if (state.workoutStatus !== 'idle' && state.workoutStatus !== 'error') {
      return false;
    }
    if (state.selectedExercise !== exerciseId) {
      analyzers[state.selectedExercise].reset();
      state = {
        ...state,
        selectedExercise: exerciseId,
        count: 0,
        elapsedMs: 0,
      };
    }
    update({
      view: 'workout',
      workoutStatus: 'idle',
      exerciseState: 'waiting',
      feedbackId: 'ready',
      feedback: lookupMessage('ready', state.language).text,
      isFallback: lookupMessage('ready', state.language).isFallback,
      statusMessage: 'Camera is off. Press Start when you are ready.',
    });
    return true;
  }

  function setLanguage(language) {
    if (!LANGUAGES.some(({ code }) => code === language)) {
      return;
    }
    update({ language });
    setFeedback(state.feedbackId);
  }

  function setVoiceEnabled(enabled) {
    const voiceEnabled = Boolean(enabled);
    try {
      coach.setEnabled(voiceEnabled);
    } catch (error) {
      update({ statusMessage: `${error.message} Written coaching is still available.` });
    }
    update({ voiceEnabled });
  }

  function goHome() {
    if (['loading', 'running', 'paused'].includes(state.workoutStatus)) {
      void end();
      return;
    }
    update({ view: 'home' });
  }

  return {
    start,
    pause,
    resume,
    reset,
    end,
    selectExercise,
    setLanguage,
    setVoiceEnabled,
    goHome,
    getState: snapshot,
  };
}

function languageOptions(selectedLanguage) {
  return LANGUAGES.map(
    ({ code, label }) =>
      `<option value="${code}"${code === selectedLanguage ? ' selected' : ''}>${label}</option>`,
  ).join('');
}

function renderHome(root, state) {
  const cards = Object.entries(EXERCISES)
    .map(
      ([id, exercise]) => `
        <article class="exercise-card">
          <div class="exercise-card__mark" aria-hidden="true">${exercise.name === 'Squats' ? 'S' : exercise.name === 'Plank' ? 'P' : 'J'}</div>
          <h3>${exercise.name}</h3>
          <p>${exercise.description}</p>
          <button class="button button--quiet" type="button" data-action="choose-exercise" data-exercise="${id}">
            Start ${exercise.name}
          </button>
        </article>`,
    )
    .join('');

  root.innerHTML = `
    <div class="home-page">
      <header class="site-header">
        <a class="wordmark" href="#home" data-action="home" aria-label="Sabi Body home">Sabi Body</a>
        <p class="tagline">The sabi-sabi fitness coach</p>
        <label class="language-control">
          <span>Language</span>
          <select data-action="language" aria-label="Choose coaching language">${languageOptions(state.language)}</select>
        </label>
      </header>
      <section class="welcome" aria-labelledby="welcome-title">
        <p class="welcome__eyebrow">Move in your own way</p>
        <h1 id="welcome-title">A little movement goes a long way.</h1>
        <p class="welcome__intro">
          Find your rhythm with simple, guided workouts you can do at home.
          Your camera stays on this device—video is not recorded, uploaded, or stored.
        </p>
        <button class="button button--primary welcome__action" type="button" data-action="scroll-exercises">
          Start a workout <span aria-hidden="true">↓</span>
        </button>
      </section>
      <section class="exercises" id="exercise-selection" aria-labelledby="exercises-title">
        <div class="section-heading">
          <p class="section-heading__eyebrow">Choose what feels right</p>
          <h2 id="exercises-title" tabindex="-1">Your workouts</h2>
        </div>
        <div class="exercise-grid">${cards}</div>
      </section>
      <footer class="privacy-note">
        <span class="privacy-note__icon" aria-hidden="true">◎</span>
        <p>Private by design. Movement is analyzed in your browser, and camera access starts only when you press Start.</p>
      </footer>
    </div>`;
}

function renderWorkout(root, state) {
  const exercise = EXERCISES[state.selectedExercise];
  const isPlank = state.selectedExercise === 'plank';
  root.innerHTML = `
    <div class="workout-page">
      <header class="site-header workout-header">
        <a class="wordmark" href="#home" data-action="home" aria-label="Sabi Body home">Sabi Body</a>
        <p class="tagline">The sabi-sabi fitness coach</p>
        <label class="language-control">
          <span>Language</span>
          <select data-action="language" aria-label="Choose coaching language">${languageOptions(state.language)}</select>
        </label>
      </header>
      <div class="workout-heading">
        <button class="back-link" type="button" data-action="home">← <span>Home</span></button>
        <p class="workout-heading__eyebrow">Your movement, your pace</p>
        <h1 tabindex="-1">${exercise.name}</h1>
        <p>${exercise.instruction}</p>
      </div>
      <div class="workout-layout">
        <section class="camera-column" aria-label="Camera and body position">
          <div class="camera-stage">
            <video autoplay muted playsinline role="img" aria-label="Live mirrored camera preview"></video>
            <canvas aria-hidden="true"></canvas>
            <div class="camera-placeholder" data-placeholder>
              <span class="camera-placeholder__glyph" aria-hidden="true">◉</span>
              <p>Camera preview will appear here</p>
              <small>Your camera stays on this device</small>
            </div>
            <span class="camera-badge" data-camera-badge>Camera off</span>
          </div>
          <div class="positioning-note">
            <span aria-hidden="true">↗</span>
            <p>${exercise.cameraInstruction}</p>
          </div>
          <div class="visibility-list" aria-label="Position checks">
            <p class="visibility-item" data-person-status><span class="status-dot" aria-hidden="true"></span><span>Body not detected</span></p>
            <p class="visibility-item" data-full-body-status><span class="status-dot" aria-hidden="true"></span><span>Move into full view</span></p>
          </div>
        </section>
        <section class="progress-column" aria-labelledby="progress-title">
          <div class="progress-card">
            <div class="progress-card__topline">
              <h2 id="progress-title">${exercise.progressLabel}</h2>
              <span class="exercise-state" data-exercise-state>Waiting to start</span>
            </div>
            <p class="progress-value${isPlank ? ' progress-value--timer' : ''}" data-progress>${isPlank ? '00:00' : '0'}</p>
            <p class="progress-caption">${isPlank ? 'Time in a steady position' : 'Complete reps'}</p>
          </div>
          <section class="coaching-card" aria-labelledby="coaching-title">
            <h2 class="coaching-card__eyebrow" id="coaching-title">Your coach</h2>
            <p class="coaching-message" data-feedback aria-live="polite">${state.feedback}</p>
            <p class="fallback-notice" data-fallback hidden>English text shown; translation unavailable.</p>
          </section>
          <div class="voice-row">
            <label class="voice-toggle">
              <input type="checkbox" data-action="voice" ${state.voiceEnabled ? 'checked' : ''} ${'speechSynthesis' in globalThis ? '' : 'disabled'} />
              <span class="voice-toggle__switch" aria-hidden="true"></span>
              <span>Spoken coaching</span>
            </label>
            <span class="voice-support" data-voice-support>${'speechSynthesis' in globalThis ? 'English only' : 'Not available in this browser'}</span>
          </div>
          <div class="workout-controls" aria-label="Workout controls">
            <button class="button button--primary" type="button" data-action="start">Start</button>
            <button class="button button--quiet" type="button" data-action="pause">Pause</button>
            <button class="button button--quiet" type="button" data-action="resume">Resume</button>
            <button class="button button--quiet" type="button" data-action="reset">Reset</button>
            <button class="button button--end" type="button" data-action="end">End workout</button>
          </div>
          <p class="workout-status" data-workout-status role="status" aria-live="polite">${state.statusMessage}</p>
        </section>
      </div>
    </div>`;
}

function updateWorkout(root, state) {
  const isPlank = state.selectedExercise === 'plank';
  const progress = root.querySelector('[data-progress]');
  if (progress) {
    const value = isPlank ? formatTime(state.elapsedMs) : String(state.count);
    if (progress.textContent !== value) {
      progress.textContent = value;
    }
  }

  const status = root.querySelector('[data-workout-status]');
  if (status && status.textContent !== state.statusMessage) {
    status.textContent = state.statusMessage;
  }

  const feedback = root.querySelector('[data-feedback]');
  if (feedback && feedback.textContent !== state.feedback) {
    feedback.textContent = state.feedback;
  }

  const fallback = root.querySelector('[data-fallback]');
  if (fallback) {
    fallback.hidden = !state.isFallback;
  }

  const person = root.querySelector('[data-person-status]');
  if (person) {
    person.classList.toggle('is-ready', state.personDetected);
    person.lastElementChild.textContent = state.personDetected
      ? 'Body detected'
      : 'Body not detected';
  }

  const fullBody = root.querySelector('[data-full-body-status]');
  if (fullBody) {
    fullBody.classList.toggle('is-ready', state.fullBodyVisible);
    fullBody.lastElementChild.textContent = state.fullBodyVisible
      ? 'Full body visible'
      : 'Move into full view';
  }

  const exerciseState = root.querySelector('[data-exercise-state]');
  if (exerciseState) {
    exerciseState.textContent = state.workoutStatus === 'loading'
      ? 'Loading'
      : state.workoutStatus === 'running'
        ? 'In progress'
        : state.workoutStatus === 'paused'
          ? 'Paused'
          : state.workoutStatus === 'error'
            ? 'Needs attention'
            : 'Waiting to start';
    exerciseState.dataset.status = state.workoutStatus;
  }

  const badge = root.querySelector('[data-camera-badge]');
  if (badge) {
    badge.textContent = state.workoutStatus === 'running'
      ? 'Camera on'
      : state.workoutStatus === 'loading'
        ? 'Starting'
        : state.workoutStatus === 'paused'
          ? 'Paused'
          : 'Camera off';
    badge.dataset.status = state.workoutStatus;
  }

  const placeholder = root.querySelector('[data-placeholder]');
  if (placeholder) {
    placeholder.hidden = ['loading', 'running', 'paused'].includes(state.workoutStatus);
  }

  for (const button of root.querySelectorAll('[data-action]')) {
    switch (button.dataset.action) {
      case 'start':
        button.disabled = !state.canStart;
        break;
      case 'pause':
        button.disabled = !state.canPause;
        break;
      case 'resume':
        button.disabled = !state.canResume;
        break;
      case 'reset':
        button.disabled = !state.canReset;
        break;
      case 'end':
        button.disabled = !state.canEnd;
        break;
      default:
        break;
    }
  }

  const language = root.querySelector('[data-action="language"]');
  if (language && language.value !== state.language) {
    language.value = state.language;
  }
  const voice = root.querySelector('[data-action="voice"]');
  if (voice) {
    voice.checked = state.voiceEnabled;
  }
}

export function mountApp(root) {
  if (!root) {
    throw new Error('Cannot start Sabi Body: the app root (#app) was not found.');
  }

  let currentView = null;
  let latestState = makeInitialState();
  let controller;

  function render(state) {
    latestState = state;
    if (state.view !== currentView) {
      currentView = state.view;
      if (state.view === 'home') {
        renderHome(root, state);
      } else {
        renderWorkout(root, state);
        updateWorkout(root, state);
        root.querySelector('.workout-heading h1')?.focus?.();
      }
    } else if (state.view === 'workout') {
      updateWorkout(root, state);
    } else {
      const selector = root.querySelector('[data-action="language"]');
      if (selector && selector.value !== state.language) {
        selector.value = state.language;
      }
    }
  }

  const coach = createSpeechCoach({
    synthesis: globalThis.speechSynthesis ?? { speak() {}, cancel() {} },
    Utterance: globalThis.SpeechSynthesisUtterance ?? class {
      constructor(text) {
        this.text = text;
      }
    },
    onError: (error) => {
      const status = root.querySelector('[data-workout-status]');
      if (status) {
        status.textContent = `${error.message} Written coaching is still available.`;
      }
    },
  });
  controller = createWorkoutController({ onState: render, speechCoach: coach });

  root.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-action]');
    if (!button) {
      return;
    }
    switch (button.dataset.action) {
      case 'scroll-exercises': {
        const section = root.querySelector('#exercise-selection');
        const reducedMotion = globalThis.matchMedia?.(
          '(prefers-reduced-motion: reduce)',
        ).matches;
        section?.scrollIntoView?.({
          behavior: reducedMotion ? 'auto' : 'smooth',
          block: 'start',
        });
        root.querySelector('#exercises-title')?.focus?.();
        break;
      }
      case 'choose-exercise':
        controller.selectExercise(button.dataset.exercise);
        break;
      case 'start':
        void controller.start();
        break;
      case 'pause':
        controller.pause();
        break;
      case 'resume':
        void controller.resume();
        break;
      case 'reset':
        controller.reset();
        break;
      case 'end':
        void controller.end();
        break;
      case 'home':
        controller.goHome();
        break;
      default:
        break;
    }
  });

  root.addEventListener('change', (event) => {
    const control = event.target;
    if (control.matches?.('[data-action="language"]')) {
      controller.setLanguage(control.value);
    } else if (control.matches?.('[data-action="voice"]')) {
      controller.setVoiceEnabled(control.checked);
    }
  });

  render(latestState);
  return controller;
}

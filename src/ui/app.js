import { stopCamera, startCamera } from '../camera/camera.js';
import { createJumpingJackAnalyzer } from '../exercises/jumping-jacks.js';
import { hasFullBodyVisible, isVisible } from '../exercises/geometry.js';
import { createPlankAnalyzer } from '../exercises/plank.js';
import { createPushUpAnalyzer } from '../exercises/push-ups.js';
import { createSquatAnalyzer } from '../exercises/squat.js';
import { createSitUpAnalyzer } from '../exercises/sit-ups.js';
import { createLungeAnalyzer } from '../exercises/lunges.js';
import {
  EXERCISE_INSTRUCTION_IDS,
  LANGUAGES,
  translateMessage,
} from '../feedback/messages.js';
import {
  COACH_PERSONALITIES,
  getPersonalityMessageId,
  isSpeakableFeedback,
  loadPersonality,
  savePersonality,
} from '../feedback/personality.js';
import { loadVoicePreferences, saveVoicePreferences } from '../feedback/preferences.js';
import { createSpeechQueue } from '../feedback/speech-queue.js';
import { createSpeechCoach } from '../feedback/speech.js';
import { createVoicePlaybackManager } from '../feedback/voice-playback.js';
import {
  createPoseDiagnostics,
  serializeLandmarkDiagnostics,
} from '../pose/pose-diagnostics.js';
import { createPoseTracker } from '../pose/pose-tracker.js';
import { createVoiceClient } from '../services/voice-client.js';
import { EXERCISES } from './exercise-content.js';

const MOBILE_WORKOUT_QUERY =
  '(max-width: 480px), (max-width: 900px) and (max-height: 430px) and (orientation: landscape) and (pointer: coarse)';

const MIN_YARNGPT_TEXT_CHARACTERS = 20;

const ESSENTIAL_CORRECTIONS = new Set([
  'body-not-visible',
  'adjust-alignment',
  'move-lower',
  'return-to-start',
]);
const CONTROL_ANNOUNCEMENTS = new Set([
  'welcome',
  'workout-countdown',
  'workout-paused',
  'workout-resumed',
  'plank-five-seconds-left',
]);

const GOAL_PRESETS = {
  squats: [5, 10, 15, 20, 25, 30, 50],
  'jumping-jacks': [5, 10, 15, 20, 25, 30, 50],
  plank: [15, 30, 45, 60, 90],
  'push-ups': [5, 10, 15, 20, 25, 30],
  'sit-ups': [5, 6, 10, 15, 20, 30],
  lunges: [5, 10, 15, 20, 25, 30],
};

const DEFAULT_TARGETS = Object.freeze({
  squats: 10,
  'jumping-jacks': 10,
  plank: 30,
  'push-ups': 5,
  'sit-ups': 6,
  lunges: 10,
});

export function getDefaultTarget(exerciseId) {
  return DEFAULT_TARGETS[exerciseId] ?? 10;
}

export function normalizeGoalTarget(exerciseId, proposedTarget) {
  const isPlank = exerciseId === 'plank';
  const minimum = isPlank ? 1 : 1;
  const maximum = isPlank ? 3600 : 200;
  const parsed = Number.parseInt(proposedTarget, 10);
  if (!Number.isFinite(parsed)) {
    return getDefaultTarget(exerciseId);
  }
  if (parsed < minimum || parsed > maximum) {
    return getDefaultTarget(exerciseId);
  }
  return parsed;
}

export function getMilestoneThresholds(target) {
  if (!Number.isFinite(target) || target <= 0) {
    return [];
  }
  const thresholds = [
    Math.ceil(target * 0.25),
    Math.ceil(target * 0.5),
    Math.ceil(target * 0.75),
    target - 1,
  ]
    .filter((value) => Number.isFinite(value) && value > 0 && value < target)
    .sort((a, b) => a - b);

  return [...new Set(thresholds)];
}

function getGoalStorageKey(exerciseId) {
  return `sabi-body-goal-${exerciseId}`;
}

function loadStoredTarget(exerciseId) {
  if (typeof globalThis.localStorage === 'undefined') {
    return getDefaultTarget(exerciseId);
  }

  try {
    const storedValue = globalThis.localStorage.getItem(getGoalStorageKey(exerciseId));
    if (storedValue === null) {
      return getDefaultTarget(exerciseId);
    }
    const parsed = Number.parseInt(storedValue, 10);
    if (!Number.isFinite(parsed)) {
      return getDefaultTarget(exerciseId);
    }
    return normalizeGoalTarget(exerciseId, parsed);
  } catch {
    return getDefaultTarget(exerciseId);
  }
}

function persistTarget(exerciseId, target) {
  if (typeof globalThis.localStorage === 'undefined') {
    return false;
  }

  try {
    globalThis.localStorage.setItem(getGoalStorageKey(exerciseId), String(target));
    return true;
  } catch {
    return false;
  }
}

function getViewTargetLabel(exerciseId, target) {
  if (exerciseId === 'plank') {
    return `${target} sec`;
  }
  return `${target} reps`;
}

function createAnalyzers() {
  return {
    squats: createSquatAnalyzer(),
    'jumping-jacks': createJumpingJackAnalyzer(),
    plank: createPlankAnalyzer(),
    'push-ups': createPushUpAnalyzer(),
    'sit-ups': createSitUpAnalyzer(),
    lunges: createLungeAnalyzer(),
  };
}

function makeInitialState() {
  const selectedExercise = 'squats';
  return {
    view: 'home',
    selectedExercise,
    language: 'en',
    voiceEnabled: false,
    voiceVolume: 1,
    voiceId: '',
    voiceStatus: 'Voice is off.',
    countEachRep: false,
    workoutStatus: 'idle',
    cameraStatus: 'off',
    personDetected: false,
    fullBodyVisible: false,
    exerciseState: 'waiting',
    readinessState: 'camera-off',
    readinessReasonId: 'camera-off',
    readinessReady: false,
    movementPhase: 'waiting',
    formValid: false,
    rejectionReasonId: null,
    diagnosticMetrics: {},
    diagnosticLandmarks: [],
    count: 0,
    elapsedMs: 0,
    completedWorkouts: [],
    target: getDefaultTarget(selectedExercise),
    feedback: 'Choose a workout to get started.',
    feedbackId: 'ready',
    isFallback: false,
    statusMessage: 'Camera is off. Choose an exercise to begin.',
    storageWarning: '',
    availableVoices: [],
    voiceCatalogStatus: '',
  };
}

function isVoiceCompatible(voice, language) {
  return (voice.languages ?? []).some((supported) =>
    supported === language || supported === `${language}-ng` || supported.startsWith(`${language}-`),
  );
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
  audioCoach,
  voicePlayback,
  speechQueue,
  storage,
  getMediaElements,
  diagnosticsEnabled = import.meta.env?.DEV === true,
} = {}) {
  const voicePreferences = loadVoicePreferences(storage);
  let state = {
    ...makeInitialState(),
    ...voicePreferences,
    personality: loadPersonality(storage),
    personalityStorageWarning: '',
  };
  let analyzers = makeAnalyzers();
  let stream = null;
  let tracker = null;
  let activeVideo = video;
  let activeCanvas = canvas;
  let startPromise = null;
  let generation = 0;
  let trackEndedHandler = null;
  let lastFeedbackEvent = { feedbackId: 'ready', parameters: {} };
  let voiceGeneration = 0;
  let voiceCatalogRequest = null;
  let interrupted = false;
  let completionHandled = false;
  let countdownAnnounced = false;
  let announcedMilestones = new Set();
  const workoutSpeechQueue = speechQueue ?? createSpeechQueue({
    onError: (error) => {
      update({ voiceStatus: `${error.message} Written coaching is still available.` });
    },
  });

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
  voicePlayback?.setVolume?.(state.voiceVolume);
  voicePlayback?.setMuted?.(!state.voiceEnabled);

  function getWorkoutProgress() {
    const target = Number.isFinite(state.target) ? state.target : getDefaultTarget(state.selectedExercise);
    const completed = state.selectedExercise === 'plank'
      ? Math.floor((state.elapsedMs ?? 0) / 1000)
      : (state.count ?? 0);
    const remaining = Math.max(target - completed, 0);
    const percent = target > 0 ? Math.min(100, (completed / target) * 100) : 0;
    return { target, completed, remaining, percent };
  }

  function snapshot() {
    const isBusy = state.workoutStatus === 'loading';
    const active = state.workoutStatus === 'running';
    const paused = state.workoutStatus === 'paused';
    const completed = state.workoutStatus === 'completed';
    const hasSession = ['loading', 'running', 'paused', 'completed'].includes(state.workoutStatus);
    const progress = getWorkoutProgress();
    return {
      ...state,
      target: Number.isFinite(state.target) ? state.target : getDefaultTarget(state.selectedExercise),
      progressTarget: progress.target,
      progressCompleted: progress.completed,
      progressRemaining: progress.remaining,
      progressPercent: progress.percent,
      canStart: !isBusy && !active && !paused && !completed,
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

  function persistVoicePreferences(changes) {
    const saved = saveVoicePreferences(changes, storage);
    update({
      ...changes,
      personalityStorageWarning: saved
        ? ''
        : 'Preferences are active for this session, but browser storage is unavailable.',
    });
    return saved;
  }

  function resolveMediaElements() {
    if (typeof getMediaElements === 'function') {
      const elements = getMediaElements();
      activeVideo = elements?.video ?? null;
      activeCanvas = elements?.canvas ?? null;
    }
    return { video: activeVideo, canvas: activeCanvas };
  }

  function invalidateCurrentPhase() {
    analyzers[state.selectedExercise].invalidatePhase?.();
  }

  function getYarnGptText(text, language = state.language, personality = state.personality) {
    const message = String(text ?? '').trim();
    if (Array.from(message).length >= MIN_YARNGPT_TEXT_CHARACTERS) {
      return message;
    }
    const continuation = lookupMessage(
      getPersonalityMessageId(personality, 'keep-going'),
      language,
      {},
    ).text.trim();
    return `${message} ${continuation}`.trim();
  }

  function setFeedback(feedbackId, parameters = {}, { suppressVoice = false, spokenOnly = false } = {}) {
    const localizedMessageId = getPersonalityMessageId(state.personality, feedbackId);
    const translated = lookupMessage(localizedMessageId, state.language, parameters);
    if (!spokenOnly) {
      lastFeedbackEvent = { feedbackId, parameters: { ...parameters } };
      update({
        feedbackId,
        feedback: translated.text,
        isFallback: translated.isFallback,
        translationStatus: translated.translationStatus ?? (translated.isFallback ? 'fallback' : 'verified'),
      });
    }

    const voiceEventKey = JSON.stringify([
      localizedMessageId,
      state.language,
      state.personality,
      parameters,
    ]);
    const isCompletion = ['exercise-completed', 'plank-completed'].includes(feedbackId);
    const isEssentialCorrection = ESSENTIAL_CORRECTIONS.has(feedbackId);
    const speakable = isSpeakableFeedback(state.personality, feedbackId) ||
      (feedbackId === 'repetition-count' && state.countEachRep);
    if (!suppressVoice && state.voiceEnabled && speakable) {
      const requestGeneration = voiceGeneration;
      const language = state.language;
      const personality = state.personality;
      const spokenMessageId = localizedMessageId;
      const text = translated.text;
      const queuedVoiceId = selectVoiceId(language);
      const priority = isCompletion
        ? 100
        : isEssentialCorrection
          ? 80
          : CONTROL_ANNOUNCEMENTS.has(feedbackId)
            ? 70
            : feedbackId === 'repetition-count'
              ? 50
              : 30;
      const play = language === 'en'
        ? () => {
          if (requestGeneration !== voiceGeneration || !state.voiceEnabled) return false;
          return coach.speak(spokenMessageId, text, language);
        }
        : async () => {
          if (requestGeneration !== voiceGeneration || !state.voiceEnabled) return false;
          if (!audioCoach?.synthesizeAudio) {
            throw new Error('Voice service is unavailable.');
          }
          let voiceId = queuedVoiceId;
          if (!voiceId || !state.availableVoices.some((voice) =>
            voice.id === voiceId && isVoiceCompatible(voice, language),
          )) {
            voiceId = await resolveVoiceId(language, requestGeneration);
          }
          if (requestGeneration !== voiceGeneration || !state.voiceEnabled) return false;
          if (!voiceId) {
            throw new Error(state.voiceCatalogStatus || `No compatible voice is available for ${language}.`);
          }
          const audio = await audioCoach.synthesizeAudio({
            text: getYarnGptText(text, language, personality),
            language,
            voice: voiceId,
          });
          if (requestGeneration !== voiceGeneration || !state.voiceEnabled) return false;
          if (!voicePlayback?.play) {
            throw new Error('Audio playback is unavailable.');
          }
          return await voicePlayback.play(audio);
        };
      workoutSpeechQueue.enqueue({
        eventKey: voiceEventKey,
        priority,
        play,
        cancel: () => (language === 'en' ? coach.cancel?.() : voicePlayback?.stop?.()),
      });
    }
  }

  function announceMilestone(currentCompleted, previousCompleted) {
    if (state.workoutStatus !== 'running' || completionHandled || currentCompleted <= previousCompleted) {
      return;
    }

    const target = getWorkoutProgress().target;
    const isPlank = state.selectedExercise === 'plank';
    if (
      isPlank &&
      target > 5 &&
      previousCompleted < target - 5 &&
      currentCompleted >= target - 5
    ) {
      setFeedback('plank-five-seconds-left', { count: currentCompleted, target });
    }
    const thresholds = getMilestoneThresholds(target);
    if (!isPlank && target > 5) {
      thresholds.push(target - 5);
    }
    const threshold = thresholds
      .filter((value) => previousCompleted < value && value <= currentCompleted && !announcedMilestones.has(value))
      .sort((left, right) => right - left)[0];
    if (threshold !== undefined) {
      announcedMilestones.add(threshold);
      if (isPlank) {
        setFeedback('milestone-plank', { count: threshold, target });
      } else if (threshold === target - 1) {
        setFeedback('final-repetition', { remaining: 1, target });
      } else if (threshold === Math.ceil(target / 2)) {
        setFeedback('halfway', { remaining: target - threshold, target });
      } else if (threshold === target - 5) {
        setFeedback('remaining-reps', { remaining: 5, target }, { suppressVoice: state.countEachRep });
      } else {
        setFeedback('milestone-reps', { count: threshold, target }, { suppressVoice: state.countEachRep });
      }
    }
  }

  function finishWorkout() {
    if (completionHandled) {
      return;
    }
    completionHandled = true;
    startPromise = null;
    generation += 1;
    invalidateCurrentPhase();

    try {
      tracker?.stop();
    } catch {
      // ignore stop errors during workout completion cleanup
    }
    releaseResources({ stopTracker: false });

    const target = getWorkoutProgress().target;
    const unit = state.selectedExercise === 'plank' ? 'seconds' : 'reps';
    const completedWorkout = {
      exerciseId: state.selectedExercise,
      exerciseName: EXERCISES[state.selectedExercise].name,
      target,
      unit,
      achieved: target,
      completedAt: Date.now(),
    };
    update({
      completedWorkouts: [...state.completedWorkouts, completedWorkout],
      workoutStatus: 'completed',
      cameraStatus: 'off',
      exerciseState: 'complete',
      readinessState: 'camera-off',
      readinessReasonId: 'camera-off',
      readinessReady: false,
      formValid: false,
      statusMessage: 'Workout complete. Start another workout or return home.',
    });
    setFeedback(state.selectedExercise === 'plank' ? 'plank-completed' : 'exercise-completed', {
      count: state.count,
      target: state.target,
      remaining: 0,
    });
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
        releaseCamera(stream, activeVideo);
      } catch {
        // The preview is still cleared if a browser track refuses to stop.
        if (activeVideo) {
          activeVideo.srcObject = null;
        }
      }
      stream = null;
    }
    clearOverlay(activeCanvas);
  }

  function failStartup(error, runGeneration) {
    if (runGeneration !== generation) {
      return;
    }
    releaseResources();
    interrupted = false;
    invalidateCurrentPhase();
    update({
      workoutStatus: 'error',
      cameraStatus: 'error',
      personDetected: false,
      fullBodyVisible: false,
      readinessState: 'camera-off',
      readinessReasonId: 'camera-off',
      readinessReady: false,
      formValid: false,
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
    invalidateCurrentPhase();
    interrupted = true;
    if (trackEndedHandler) {
      track.removeEventListener?.('ended', trackEndedHandler);
      trackEndedHandler = null;
    }
    if (stream) {
      try {
        releaseCamera(stream, activeVideo);
      } catch {
        if (activeVideo) {
          activeVideo.srcObject = null;
        }
      }
      stream = null;
    }
    clearOverlay(activeCanvas);
    update({
      workoutStatus: 'paused',
      cameraStatus: 'off',
      personDetected: false,
      fullBodyVisible: false,
      readinessState: 'camera-off',
      readinessReasonId: 'camera-off',
      readinessReady: false,
      movementPhase: 'positioning',
      formValid: false,
      statusMessage: 'The camera stopped. Reconnect it, then choose Resume to continue.',
    });
  }

  function processPose(landmarks, timestamp, worldLandmarks = []) {
    if (state.workoutStatus !== 'running') {
      return;
    }

    const wasRunning = state.workoutStatus === 'running';
    const personDetected =
      Array.isArray(landmarks) && landmarks.some((landmark) => isVisible(landmark));
    const fullBodyVisible = personDetected && hasFullBodyVisible(landmarks);
    const analysis = analyzers[state.selectedExercise].update(
      landmarks,
      timestamp,
      worldLandmarks,
    );

    const previousCount = state.count ?? 0;
    const previousCompleted = state.selectedExercise === 'plank'
      ? Math.floor((state.elapsedMs ?? 0) / 1000)
      : previousCount;
    const nextCount = analysis.count ?? state.count;
    const nextElapsedMs = analysis.elapsedMs ?? state.elapsedMs;
    const nextCompleted = state.selectedExercise === 'plank'
      ? Math.floor((nextElapsedMs ?? 0) / 1000)
      : nextCount;
    const goalTarget = getWorkoutProgress().target;
    const goalAchieved =
      wasRunning &&
      goalTarget > 0 &&
      nextCompleted >= goalTarget;
    const displayedCount =
      goalAchieved && state.selectedExercise !== 'plank'
        ? Math.min(nextCount, goalTarget)
        : nextCount;
    const displayedElapsedMs =
      goalAchieved && state.selectedExercise === 'plank'
        ? Math.min(nextElapsedMs, goalTarget * 1000)
        : nextElapsedMs;

    update({
      cameraStatus: 'ready',
      personDetected,
      fullBodyVisible,
      exerciseState: analysis?.state ?? 'positioning',
      count: displayedCount,
      elapsedMs: displayedElapsedMs,
      readinessState: 'tracking',
      readinessReasonId: null,
      readinessReady: true,
      movementPhase: analysis?.phase ?? 'positioning',
      formValid: Boolean(analysis?.formValid),
      rejectionReasonId: analysis?.rejectionReasonId ?? null,
      diagnosticMetrics: {
        exercise: {
          ...(analysis?.metrics ?? {}),
          ...(state.selectedExercise === 'plank'
            ? { timerState: analysis?.active ? 'accumulating' : 'paused' }
            : {}),
        },
      },
      diagnosticLandmarks: diagnosticsEnabled
        ? serializeLandmarkDiagnostics(landmarks)
        : [],
      statusMessage: 'Camera and pose tracking are running.',
    });

    if (goalAchieved) {
      finishWorkout();
      return {
        readinessReady: false,
        formValid: false,
        rejectionReasonId: null,
      };
    }

    if (analysis.feedbackId) {
      setFeedback(analysis.feedbackId);
    }

    if (
      state.selectedExercise !== 'plank' &&
      state.countEachRep &&
      nextCount > previousCount
    ) {
      setFeedback('repetition-count', { count: nextCount }, { spokenOnly: true });
    }

    announceMilestone(nextCompleted, previousCompleted);
    return {
      readinessReady: true,
      formValid: Boolean(analysis.formValid),
      rejectionReasonId: analysis.rejectionReasonId ?? null,
    };
  }

  async function initializeTracker(runGeneration) {
    let createdTracker;
    try {
      const mediaElements = resolveMediaElements();
      if (!mediaElements.video || !mediaElements.canvas) {
        throw new Error('The workout camera preview is not ready. Return to exercise setup and try again.');
      }
      createdTracker = makePoseTracker({
        onPose: processPose,
        onError: (error) => failStartup(error, runGeneration),
      });
      tracker = createdTracker;
      const acquiredStream = await acquireCamera(mediaElements.video);
      if (runGeneration !== generation) {
        if (mediaElements.video.srcObject === acquiredStream) {
          mediaElements.video.srcObject = stream ?? null;
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

      await createdTracker.start(mediaElements.video, mediaElements.canvas);
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
          cameraStatus: 'ready',
          readinessState: 'tracking',
          readinessReasonId: null,
          readinessReady: true,
          statusMessage: 'Camera and pose tracking are running.',
        });
        if (!countdownAnnounced) {
          countdownAnnounced = true;
          setFeedback('workout-countdown');
          const instructionId = EXERCISE_INSTRUCTION_IDS[state.selectedExercise];
          if (instructionId) {
            setFeedback(instructionId, {}, { spokenOnly: true });
          }
        }
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
    completionHandled = false;
    announcedMilestones = new Set();
    if (resetProgress) {
      countdownAnnounced = false;
    }
    invalidateCurrentPhase();
    if (resetProgress) {
      analyzers[state.selectedExercise].reset();
      workoutSpeechQueue.clearPending();
      update({
        workoutStatus: 'loading',
        cameraStatus: 'starting',
        personDetected: false,
        fullBodyVisible: false,
        exerciseState: 'waiting',
        readinessState: 'no-pose',
        readinessReasonId: 'no-pose',
        readinessReady: false,
        movementPhase: 'positioning',
        formValid: false,
        rejectionReasonId: null,
        diagnosticMetrics: {},
        count: 0,
        elapsedMs: 0,
        target: Number.isFinite(state.target) ? state.target : getDefaultTarget(state.selectedExercise),
        feedbackId: 'ready',
        feedback: lookupMessage('ready', state.language).text,
        isFallback: lookupMessage('ready', state.language).isFallback,
        statusMessage: 'Requesting camera access and loading pose tracking.',
      });
      setFeedback('welcome');
    } else {
      update({
        workoutStatus: 'loading',
        cameraStatus: 'starting',
        personDetected: false,
        fullBodyVisible: false,
        readinessReady: false,
        formValid: false,
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
    completionHandled = false;
    voiceGeneration += 1;
    workoutSpeechQueue.cancel();
    coach.cancel?.();
    voicePlayback?.stop?.();
    tracker?.pause();
    if (state.selectedExercise === 'plank') {
      analyzers.plank.update([], globalThis.performance?.now?.());
    }
    invalidateCurrentPhase();
    update({
      workoutStatus: 'paused',
      readinessState: 'tracking',
      readinessReasonId: 'no-pose',
      readinessReady: true,
      formValid: false,
      statusMessage: 'Workout paused. Your camera preview is still on.',
    });
    setFeedback('workout-paused');
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

    analyzers[state.selectedExercise].invalidatePhase?.();
    update({
      workoutStatus: 'running',
      cameraStatus: 'ready',
      readinessState: 'tracking',
      readinessReasonId: null,
      readinessReady: true,
      formValid: false,
      statusMessage: 'Camera and pose tracking are running.',
    });
    tracker.resume();
    setFeedback('workout-resumed');
    return Promise.resolve();
  }

  function setGoal(nextTarget, shouldPersist = true) {
    const target = normalizeGoalTarget(state.selectedExercise, nextTarget);
    const previousTarget = Number.isFinite(state.target) ? state.target : getDefaultTarget(state.selectedExercise);
    if (target !== previousTarget && shouldPersist) {
      persistTarget(state.selectedExercise, target);
    }

    update({
      target,
      statusMessage: `${getViewTargetLabel(state.selectedExercise, target)} is ready for this workout.`,
    });
    return target;
  }

  function reset() {
    if (!['running', 'paused'].includes(state.workoutStatus)) {
      return;
    }
    const wasRunning = state.workoutStatus === 'running';
    analyzers[state.selectedExercise].reset();
    completionHandled = false;
    announcedMilestones = new Set();
    countdownAnnounced = false;
    workoutSpeechQueue.clearPending();
    lastFeedbackEvent = { feedbackId: 'ready', parameters: {} };
    update({
      exerciseState: 'waiting',
      count: 0,
      elapsedMs: 0,
      personDetected: false,
      fullBodyVisible: false,
      readinessReady: state.cameraStatus === 'ready',
      formValid: false,
      movementPhase: 'positioning',
      feedbackId: 'ready',
      feedback: lookupMessage('ready', state.language).text,
      isFallback: lookupMessage('ready', state.language).isFallback,
      statusMessage: wasRunning
        ? 'Progress reset. Continue the exercise to begin again.'
        : 'Progress reset. Workout remains paused.',
    });
  }

  async function end() {
    generation += 1;
    startPromise = null;
    workoutSpeechQueue.clearPending();
    releaseResources();
    interrupted = false;
    countdownAnnounced = false;
    lastFeedbackEvent = { feedbackId: 'ready', parameters: {} };
    analyzers[state.selectedExercise].reset();
    update({
      view: 'home',
      workoutStatus: 'idle',
      cameraStatus: 'off',
      personDetected: false,
      fullBodyVisible: false,
      exerciseState: 'waiting',
      readinessState: 'camera-off',
      readinessReasonId: 'camera-off',
      readinessReady: false,
      movementPhase: 'waiting',
      formValid: false,
      rejectionReasonId: null,
      diagnosticMetrics: {},
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
    if (state.workoutStatus !== 'idle' && state.workoutStatus !== 'error' && state.workoutStatus !== 'completed') {
      return false;
    }
    const nextTarget = loadStoredTarget(exerciseId);
    analyzers[state.selectedExercise].reset();
    countdownAnnounced = false;
    completionHandled = false;
    lastFeedbackEvent = { feedbackId: 'ready', parameters: {} };
    state = {
      ...state,
      selectedExercise: exerciseId,
      count: 0,
      elapsedMs: 0,
      target: nextTarget,
    };
    update({
      view: 'workout',
      workoutStatus: 'idle',
      cameraStatus: 'off',
      exerciseState: 'waiting',
      readinessState: 'camera-off',
      readinessReasonId: 'camera-off',
      readinessReady: false,
      movementPhase: 'waiting',
      formValid: false,
      rejectionReasonId: null,
      diagnosticMetrics: {},
      feedbackId: 'ready',
      feedback: lookupMessage('ready', state.language).text,
      isFallback: lookupMessage('ready', state.language).isFallback,
      statusMessage: 'Camera is off. Press Start when you are ready.',
      target: nextTarget,
      storageWarning: '',
    });
    return true;
  }

  function setLanguage(language) {
    if (!LANGUAGES.some(({ code }) => code === language)) {
      return;
    }
    voiceGeneration += 1;
    workoutSpeechQueue.cancel();
    voicePlayback?.stop?.();
    try {
      coach.cancel();
    } catch {
      // A language change must not interrupt workout controls if speech cleanup fails.
    }
    persistVoicePreferences({ language });
    setFeedback(lastFeedbackEvent.feedbackId, lastFeedbackEvent.parameters, { suppressVoice: true });
    if (state.voiceEnabled) {
      void refreshVoiceCatalog();
    }
  }

  function setTargetFromCustom(rawValue) {
    const nextTarget = normalizeGoalTarget(state.selectedExercise, rawValue);
    const persistSucceeded = persistTarget(state.selectedExercise, nextTarget);
    update({
      target: nextTarget,
      storageWarning: persistSucceeded ? '' : 'Target is active for this session, but browser storage is unavailable.',
      statusMessage: `${getViewTargetLabel(state.selectedExercise, nextTarget)} is set for this workout.`,
    });
  }

  function setVoiceEnabled(enabled) {
    const voiceEnabled = Boolean(enabled);
    if (!voiceEnabled) {
      voiceGeneration += 1;
      workoutSpeechQueue.cancel();
      voicePlayback?.stop?.();
    }
    try {
      coach.setEnabled(voiceEnabled);
    } catch (error) {
      update({ statusMessage: `${error.message} Written coaching is still available.` });
    }
    voicePlayback?.setMuted?.(!voiceEnabled);
    persistVoicePreferences({ voiceEnabled });
    update({ voiceStatus: voiceEnabled ? 'Voice coaching is on.' : 'Voice is off.' });
    if (voiceEnabled) {
      void refreshVoiceCatalog();
    }
  }

  function setVoiceVolume(volume) {
    const voiceVolume = Math.min(1, Math.max(0, Number(volume)));
    if (!Number.isFinite(voiceVolume)) {
      return;
    }
    voicePlayback?.setVolume?.(voiceVolume);
    persistVoicePreferences({ voiceVolume });
  }

  function setVoiceId(voiceId) {
    persistVoicePreferences({ voiceId: typeof voiceId === 'string' ? voiceId : '' });
  }

  function setCountEachRep(enabled) {
    persistVoicePreferences({ countEachRep: Boolean(enabled) });
  }

  async function refreshVoiceCatalog() {
    if (!audioCoach?.listVoices) {
      update({ voiceCatalogStatus: 'Voice catalogue is unavailable. Start the backend to enable YarnGPT.' });
      return [];
    }
    if (voiceCatalogRequest) {
      return voiceCatalogRequest;
    }

    update({ voiceCatalogStatus: 'Loading available voices…' });
    const request = (async () => {
      try {
        const voices = await audioCoach.listVoices();
        const compatible = voices.filter((voice) => isVoiceCompatible(voice, state.language));
        const selected = compatible.some(({ id }) => id === state.voiceId)
          ? state.voiceId
          : (compatible.find(({ isDefault }) => isDefault)?.id ?? compatible[0]?.id ?? '');
        update({
          availableVoices: voices,
          voiceCatalogStatus: compatible.length
            ? `${compatible.length} voice${compatible.length === 1 ? '' : 's'} available for ${LANGUAGES.find(({ code }) => code === state.language)?.label ?? state.language}.`
            : state.language === 'en'
              ? 'No English speaker is listed by YarnGPT; English uses browser speech.'
              : `No YarnGPT voice is listed for ${state.language}. Written coaching remains available.`,
        });
        if (selected && selected !== state.voiceId) {
          setVoiceId(selected);
        }
        return voices;
      } catch (error) {
        update({ voiceCatalogStatus: `${error.message} Written coaching remains available.` });
        return [];
      }
    })();
    voiceCatalogRequest = request;
    try {
      return await request;
    } finally {
      if (voiceCatalogRequest === request) {
        voiceCatalogRequest = null;
      }
    }
  }

  function selectVoiceId(language) {
    const compatible = state.availableVoices.filter((voice) => isVoiceCompatible(voice, language));
    const selected = compatible.some(({ id }) => id === state.voiceId)
      ? state.voiceId
      : (compatible.find(({ isDefault }) => isDefault)?.id ?? compatible[0]?.id ?? '');
    if (selected && selected !== state.voiceId) {
      setVoiceId(selected);
    }
    return selected;
  }

  async function resolveVoiceId(language, expectedGeneration) {
    if (!state.availableVoices.length) {
      await refreshVoiceCatalog();
    }
    if (expectedGeneration !== voiceGeneration || !state.voiceEnabled) {
      return '';
    }
    return selectVoiceId(language);
  }

  function setPersonality(personality) {
    if (!COACH_PERSONALITIES.some(({ id }) => id === personality)) {
      return false;
    }

    const persisted = savePersonality(personality, storage);
    saveVoicePreferences({ personality }, storage);
    update({
      personality,
      personalityStorageWarning: persisted
        ? ''
        : 'Coach choice is active for this session, but browser storage is unavailable.',
      statusMessage: `${COACH_PERSONALITIES.find(({ id }) => id === personality).label} selected.`,
    });
    return true;
  }

  function goHome() {
    if (['loading', 'running', 'paused'].includes(state.workoutStatus)) {
      void end();
      return;
    }
    update({ view: 'home' });
  }

  function goToExerciseChooser() {
    if (['loading', 'running', 'paused'].includes(state.workoutStatus)) {
      void end();
      return;
    }
    update({ view: 'home', workoutStatus: 'idle' });
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
    setVoiceVolume,
    setVoiceId,
    setCountEachRep,
    refreshVoiceCatalog,
    setPersonality,
    setGoal,
    setTargetFromCustom,
    goHome,
    goToExerciseChooser,
    getState: snapshot,
  };
}

function languageOptions(selectedLanguage) {
  return LANGUAGES.map(
    ({ code, label }) =>
      `<option value="${code}"${code === selectedLanguage ? ' selected' : ''}>${label}</option>`,
  ).join('');
}

function personalityOptions(selectedPersonality) {
  return COACH_PERSONALITIES.map(
    ({ id, label }) =>
      `<option value="${id}"${id === selectedPersonality ? ' selected' : ''}>${label}</option>`,
  ).join('');
}

function mobileSettingsMarkup(state) {
  return `
    <div class="mobile-settings" data-mobile-settings-root>
      <button
        class="mobile-settings__toggle"
        type="button"
        data-action="toggle-mobile-settings"
        aria-label="Open language and coach settings"
        aria-controls="mobile-settings"
        aria-expanded="false"
      >
        <span class="mobile-settings__icon" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>Menu</span>
      </button>
      <div class="mobile-settings__panel" id="mobile-settings" data-mobile-settings data-open="false">
        <label class="personality-control">
          <span>Coach style</span>
          <select data-action="personality" aria-label="Choose coaching personality">${personalityOptions(state.personality)}</select>
        </label>
        <label class="language-control">
          <span>Language</span>
          <select data-action="language" aria-label="Choose coaching language">${languageOptions(state.language)}</select>
        </label>
      </div>
    </div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

export function voiceOptions(state) {
  const compatible = state.availableVoices.filter((voice) => isVoiceCompatible(voice, state.language));
  if (compatible.length === 0) {
    return '<option value="">No compatible voice listed</option>';
  }
  return compatible.map(({ id, name, gender, domain, isRecommended }) => {
    const details = [
      gender ? gender[0].toUpperCase() + gender.slice(1) : '',
      domain,
      isRecommended ? 'Recommended' : '',
    ].filter(Boolean).join(' · ');
    const label = details ? `${name} — ${details}` : name;
    return `<option value="${escapeHtml(id)}"${id === state.voiceId ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function goalOptions(exerciseId, selectedTarget) {
  const presets = GOAL_PRESETS[exerciseId] ?? [10, 20, 30];
  return `
    <div class="goal-picker" aria-label="Workout target chooser">
      ${presets.map(
        (value) => `
          <button
            class="button button--quiet goal-button${value === selectedTarget ? ' is-selected' : ''}"
            type="button"
            data-action="set-goal"
            data-target="${value}"
            aria-pressed="${value === selectedTarget}"
          >${exerciseId === 'plank' ? `${value}s` : value}</button>
        `,
      ).join('')}
      <label class="goal-custom">
        <span>Custom</span>
        <input
          type="number"
          min="${exerciseId === 'plank' ? 1 : 1}"
          max="${exerciseId === 'plank' ? 3600 : 200}"
          step="1"
          value="${selectedTarget}"
          data-action="goal-custom"
          aria-label="Custom ${exerciseId === 'plank' ? 'duration in seconds' : 'repetition goal'}"
        />
      </label>
    </div>
  `;
}

function brandLogoMarkup() {
  return `
    <a class="brand-logo" href="#home" data-action="home" aria-label="SabiBody home">
      <svg class="brand-logo__mark" viewBox="0 0 44 48" aria-hidden="true">
        <circle cx="25" cy="7" r="4.8" fill="#7bc64c" />
        <path d="M23 14 15 23 7 17M23 14l8-4 7-7" fill="none" stroke="#7bc64c" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.8" />
        <path d="M23 14c1 8-1 15-5 22m0 0-8 8m8-8 11 7" fill="none" stroke="#1f5a4c" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.8" />
      </svg>
      <span class="brand-logo__name">SabiBody</span>
    </a>`;
}

function formatWorkoutQuantity(value, unit, { valid = false } = {}) {
  const noun = unit === 'seconds'
    ? (value === 1 ? 'second' : 'seconds')
    : (value === 1 ? 'rep' : 'reps');
  return `${valid && unit === 'seconds' ? 'valid ' : ''}${value} ${noun}`;
}

function renderSessionSummary(state) {
  if (!state.completedWorkouts.length) {
    return '';
  }
  const results = state.completedWorkouts
    .map((workout) => `
      <li class="session-summary__item">
        <strong>${escapeHtml(workout.exerciseName)}</strong>
        <span>${formatWorkoutQuantity(workout.achieved, workout.unit, { valid: true })}</span>
      </li>
    `)
    .join('');
  return `
    <section class="session-summary" aria-labelledby="session-summary-title">
      <div class="section-heading">
        <p class="section-heading__eyebrow">Saved for this session only</p>
        <h2 id="session-summary-title">Completed workouts</h2>
      </div>
      <ul class="session-summary__list">${results}</ul>
    </section>
  `;
}

function exerciseImageMarkup(exercise, className, loading) {
  if (exercise.media.type !== 'image') {
    throw new Error(`Unsupported exercise media type: ${exercise.media.type}`);
  }
  return `<img class="${className}" src="${escapeHtml(exercise.media.src)}" alt="${escapeHtml(exercise.media.alt)}" loading="${loading}" decoding="async" />`;
}

function renderHome(root, state) {
  const cards = Object.entries(EXERCISES)
    .map(
      ([id, exercise]) => `
        <article class="exercise-card">
          <div class="exercise-card__mark" aria-hidden="true">${exercise.mark}</div>
          ${exerciseImageMarkup(exercise, 'exercise-card__image', 'lazy')}
          <h3>${exercise.name}</h3>
          <p>${exercise.benefits}</p>
          <button class="button button--quiet" type="button" data-action="choose-exercise" data-exercise="${id}">
            Start ${exercise.name}
          </button>
        </article>`,
    )
    .join('');

  root.innerHTML = `
    <div class="home-page">
      <header class="site-header">
        ${brandLogoMarkup()}
        <p class="tagline">The sabi-sabi fitness coach</p>
        ${mobileSettingsMarkup(state)}
      </header>
      <p class="storage-warning" data-personality-warning role="status" hidden></p>
      <section class="welcome" aria-labelledby="welcome-title">
        <div class="welcome__copy">
          <p class="welcome__eyebrow"><span aria-hidden="true"></span>Move in your own way</p>
          <h1 id="welcome-title">
            A little<br />movement goes<br /><span class="welcome__headline-accent">a long way.</span>
          </h1>
          <p class="welcome__intro">
            Find your rhythm with simple, guided workouts you can do at home.
            Your camera stays on this device—video is not recorded, uploaded, or stored.
          </p>
          <button class="button button--primary welcome__action" type="button" data-action="scroll-exercises">
            Start a workout <span aria-hidden="true">↓</span>
          </button>
          <p class="welcome__trust">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.7-2.8 8-7 10-4.2-2-7-5.3-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
            <span>Private by design. <strong>Your camera stays on your device.</strong></span>
          </p>
        </div>
        <div class="welcome__stage" aria-label="SabiBody movement tracking and voice coaching preview">
          <span class="welcome__stage-orbit" aria-hidden="true"></span>
          <span class="welcome__stage-spark welcome__stage-spark--one" aria-hidden="true"></span>
          <span class="welcome__stage-spark welcome__stage-spark--two" aria-hidden="true"></span>
          <figure class="welcome__photo">
            <img
              src="/assets/sabi-body-hero.jpg"
              alt="A woman doing a squat at home while SabiBody tracks her movement and offers voice coaching."
              width="1133"
              height="1086"
              fetchpriority="high"
              decoding="async"
            />
          </figure>
          <aside class="welcome__voice-card" aria-label="Voice coaching preview">
            <span class="welcome__voice-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8" /></svg>
            </span>
            <span class="welcome__voice-copy">
              <span class="welcome__card-kicker">Voice coaching</span>
              <strong>Your coach speaks your language.</strong>
            </span>
            <span class="welcome__sound-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
          </aside>
          <aside class="welcome__rep-card" aria-label="Illustrative workout preview, not a live session">
            <span class="welcome__rep-label">Illustrative preview</span>
            <span class="welcome__rep-exercise">Squats</span>
            <strong>03 <small>/ 10 reps</small></strong>
            <span class="welcome__rep-track" aria-hidden="true"><i></i></span>
            <span class="welcome__rep-note">A sample workout, not a live session</span>
          </aside>
          <div class="welcome__language-chips" role="group" aria-label="Available coaching languages">
            <span class="welcome__language-chip"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8v4h3l4 3V5L6 8H3Zm10-1a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" /></svg>Yoruba</span>
            <span class="welcome__language-chip"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8v4h3l4 3V5L6 8H3Zm10-1a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" /></svg>Igbo</span>
            <span class="welcome__language-chip"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8v4h3l4 3V5L6 8H3Zm10-1a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" /></svg>Hausa</span>
            <span class="welcome__language-chip"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8v4h3l4 3V5L6 8H3Zm10-1a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" /></svg>Nigerian Pidgin</span>
          </div>
        </div>
      </section>
      <section class="exercises" id="exercise-selection" aria-labelledby="exercises-title">
        <div class="section-heading">
          <p class="section-heading__eyebrow">Choose what feels right</p>
          <h2 id="exercises-title" tabindex="-1">Your workouts</h2>
        </div>
        <div class="exercise-grid">${cards}</div>
      </section>
      ${renderSessionSummary(state)}
      <footer class="privacy-note">
        <span class="privacy-note__icon" aria-hidden="true">◎</span>
        <p>Private by design. Movement is analyzed in your browser, and camera access starts only when you press Start.</p>
      </footer>
    </div>`;
}

function renderCompletion(root, state) {
  const workout = state.completedWorkouts.at(-1);
  if (!workout) {
    renderHome(root, state);
    return;
  }
  root.innerHTML = `
    <main class="completion-page">
      <header class="completion-header">${brandLogoMarkup()}</header>
      <section class="completion-card completion-card--dedicated" aria-live="polite">
        <div class="completion-icon" aria-hidden="true">✓</div>
        <p class="completion-card__eyebrow">Your movement, your pace</p>
        <h1 data-completion-title tabindex="-1">Workout Completed!</h1>
        <p class="completion-card__encouragement">Amazing work! You did it.</p>
        <dl class="completion-details">
          <div>
            <dt>Exercise</dt>
            <dd>${escapeHtml(workout.exerciseName)}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>${formatWorkoutQuantity(workout.achieved, workout.unit, { valid: true })}</dd>
          </div>
          <div>
            <dt>Goal</dt>
            <dd>${formatWorkoutQuantity(workout.target, workout.unit)} — goal achieved</dd>
          </div>
        </dl>
        <div class="completion-actions">
          <button class="button button--primary" type="button" data-action="next-workout">Next Workout</button>
          <button class="button button--quiet" type="button" data-action="home">Back to Home</button>
        </div>
      </section>
    </main>
  `;
}

function renderWorkout(root, state) {
  const exercise = EXERCISES[state.selectedExercise];
  const isPlank = state.selectedExercise === 'plank';
  const initialCompleted = isPlank
    ? Math.floor((state.elapsedMs ?? 0) / 1000)
    : (state.count ?? 0);
  const initialRemaining = Math.max(state.target - initialCompleted, 0);
  const initialPercent = Math.min(
    100,
    (initialCompleted / state.target) * 100,
  );
  const poseDiagnostics = import.meta.env?.DEV
    ? `
      <details class="pose-diagnostics">
        <summary>Pose diagnostics</summary>
        <pre data-pose-diagnostics></pre>
      </details>
    `
    : '';
  const goalSummary = `
    <div class="goal-panel">
      <div class="goal-panel__header">
        <h2>Workout goal</h2>
        <strong data-goal-target>${getViewTargetLabel(state.selectedExercise, state.target)}</strong>
      </div>
      ${goalOptions(state.selectedExercise, state.target)}
      ${state.storageWarning ? `<p class="storage-warning">${state.storageWarning}</p>` : ''}
    </div>
  `;

  root.innerHTML = `
    <div class="workout-page">
      <header class="site-header workout-header">
        ${brandLogoMarkup()}
        <p class="tagline">The sabi-sabi fitness coach</p>
        ${mobileSettingsMarkup(state)}
      </header>
      <p class="storage-warning" data-personality-warning role="status" hidden></p>
      <div class="workout-heading">
        <button class="back-link" type="button" data-action="home">← <span>Home</span></button>
        <p class="workout-heading__eyebrow">Your movement, your pace</p>
        <h1 tabindex="-1">${exercise.name}</h1>
        <p>${exercise.instruction}</p>
      </div>
      <section class="exercise-instructions" aria-labelledby="exercise-instructions-title">
        <figure class="exercise-instructions__figure">
          ${exerciseImageMarkup(exercise, 'exercise-instructions__image', 'eager')}
          <figcaption>Exercise demonstration picture</figcaption>
        </figure>
        <div class="exercise-instructions__copy">
          <p class="section-heading__eyebrow">Why this exercise</p>
          <p class="exercise-instructions__benefits">${exercise.benefits}</p>
          <h2 id="exercise-instructions-title">How to do it</h2>
          <p>${exercise.instructions}</p>
        </div>
      </section>
      ${goalSummary}
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
          ${poseDiagnostics}
        </section>
        <section class="progress-column" aria-labelledby="progress-title">
          <div class="progress-card">
            <div class="progress-card__topline">
              <h2 id="progress-title">${exercise.progressLabel}</h2>
              <span class="exercise-state" data-exercise-state>Waiting to start</span>
            </div>
            <p class="progress-value${isPlank ? ' progress-value--timer' : ''}" data-progress>${isPlank ? '00:00' : `${initialCompleted} / ${state.target} reps`}</p>
            <p class="progress-caption">${isPlank ? 'Time in a steady position' : 'Complete reps'}</p>
            <p class="progress-meta" data-progress-meta>${initialCompleted}/${state.target} • ${initialRemaining} remaining • ${Math.round(initialPercent)}%</p>
          </div>
          <section class="coaching-card" aria-labelledby="coaching-title">
            <h2 class="coaching-card__eyebrow" id="coaching-title">Your coach</h2>
            <p class="coaching-message" data-feedback aria-live="polite">${state.feedback}</p>
            <p class="fallback-notice" data-fallback hidden>English text shown; translation unavailable.</p>
          </section>
          <button
            class="mobile-voice-settings-toggle"
            type="button"
            data-action="toggle-mobile-voice-settings"
            aria-controls="mobile-voice-settings"
            aria-expanded="false"
          >Voice options</button>
          <div class="mobile-voice-settings" id="mobile-voice-settings" data-mobile-voice-settings data-open="false">
            <div class="voice-row">
              <label class="voice-toggle">
                <input type="checkbox" data-action="voice" ${state.voiceEnabled ? 'checked' : ''} />
                <span class="voice-toggle__switch" aria-hidden="true"></span>
                <span>Voice coaching</span>
              </label>
              <label class="voice-volume">
                <span>Volume</span>
                <input type="range" min="0" max="1" step="0.05" value="${state.voiceVolume}" data-action="voice-volume" aria-label="Voice volume" />
              </label>
              <label class="voice-choice">
                <span>Voice</span>
                <select data-action="voice-id" aria-label="Choose a discovered voice" ${state.availableVoices.length ? '' : 'disabled'}>${voiceOptions(state)}</select>
              </label>
              <label class="rep-count-toggle">
                <input type="checkbox" data-action="count-each-rep" ${state.countEachRep ? 'checked' : ''} />
                <span>Speak each rep</span>
              </label>
            </div>
          </div>
          <p data-fullscreen-status role="status" aria-live="polite" hidden></p>
          <p class="voice-status" data-voice-status role="status" aria-live="polite">${escapeHtml(state.voiceStatus)}</p>
          <p class="voice-status" data-voice-catalog-status role="status" aria-live="polite">${escapeHtml(state.voiceCatalogStatus)}</p>
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
  const goalTarget = root.querySelector('[data-goal-target]');
  const goalTargetText = getViewTargetLabel(state.selectedExercise, state.target);
  if (goalTarget && goalTarget.textContent !== goalTargetText) {
    goalTarget.textContent = goalTargetText;
  }
  for (const button of root.querySelectorAll('[data-action="set-goal"]')) {
    const selected = Number(button.dataset.target) === state.target;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  const customGoal = root.querySelector('[data-action="goal-custom"]');
  if (customGoal && customGoal.value !== String(state.target)) {
    customGoal.value = String(state.target);
  }

  const progress = root.querySelector('[data-progress]');
  if (progress) {
    const value = isPlank
      ? formatTime(state.elapsedMs)
      : `${state.count ?? 0} / ${state.target} reps`;
    if (progress.textContent !== value) {
      progress.textContent = value;
    }
  }

  const progressMeta = root.querySelector('[data-progress-meta]');
  if (progressMeta) {
    const completed = isPlank ? Math.floor((state.elapsedMs ?? 0) / 1000) : (state.count ?? 0);
    const remaining = Math.max(state.target - completed, 0);
    const percent = Math.min(100, (completed / state.target) * 100);
    progressMeta.textContent = `${completed}/${state.target} • ${remaining} remaining • ${Math.round(percent)}%`;
  }

  const status = root.querySelector('[data-workout-status]');
  if (status && status.textContent !== state.statusMessage) {
    status.textContent = state.statusMessage;
  }

  const poseDiagnostics = root.querySelector('[data-pose-diagnostics]');
  if (poseDiagnostics) {
    poseDiagnostics.textContent = JSON.stringify(
      createPoseDiagnostics(state),
      (_key, value) =>
        typeof value === 'number' && !Number.isFinite(value) ? null : value,
      2,
    );
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
      ? state.cameraStatus === 'ready'
        ? 'Positioning'
        : 'Loading'
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
    badge.textContent = state.cameraStatus === 'error'
      ? 'Camera error'
      : state.cameraStatus === 'ready' &&
          !state.readinessReady &&
          state.workoutStatus !== 'running'
        ? 'Positioning'
        : state.workoutStatus === 'running'
          ? 'Camera on'
          : state.workoutStatus === 'loading'
            ? 'Starting'
            : state.workoutStatus === 'paused'
              ? 'Paused'
              : 'Camera off';
    badge.dataset.status = state.cameraStatus === 'error'
      ? 'error'
      : state.cameraStatus === 'ready' && !state.readinessReady
        ? 'positioning'
        : state.workoutStatus;
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

  const voiceId = root.querySelector('[data-action="voice-id"]');
  if (voiceId) {
    voiceId.innerHTML = voiceOptions(state);
    voiceId.disabled = !state.availableVoices.some((item) => isVoiceCompatible(item, state.language));
    voiceId.value = state.voiceId;
  }
  const voiceVolume = root.querySelector('[data-action="voice-volume"]');
  if (voiceVolume && Number(voiceVolume.value) !== state.voiceVolume) {
    voiceVolume.value = String(state.voiceVolume);
  }
  const countEachRep = root.querySelector('[data-action="count-each-rep"]');
  if (countEachRep) {
    countEachRep.checked = state.countEachRep;
  }
  const voiceStatus = root.querySelector('[data-voice-status]');
  if (voiceStatus && voiceStatus.textContent !== state.voiceStatus) {
    voiceStatus.textContent = state.voiceStatus;
  }
  const voiceCatalogStatus = root.querySelector('[data-voice-catalog-status]');
  if (voiceCatalogStatus && voiceCatalogStatus.textContent !== state.voiceCatalogStatus) {
    voiceCatalogStatus.textContent = state.voiceCatalogStatus;
  }

  const personality = root.querySelector('[data-action="personality"]');
  if (personality && personality.value !== state.personality) {
    personality.value = state.personality;
  }
}

export function mountApp(root, {
  audioCoach = createVoiceClient({ endpoint: '/api/coach/audio' }),
  voicePlayback,
  controllerOptions = {},
} = {}) {
  if (!root) {
    throw new Error('Cannot start Sabi Body: the app root (#app) was not found.');
  }

  const ownerDocument = root.ownerDocument;
  let currentScreen = null;
  let latestState = makeInitialState();
  let controller;

  function setMobileSettingsOpen(open) {
    const toggle = root.querySelector('[data-action="toggle-mobile-settings"]');
    const panel = root.querySelector('[data-mobile-settings]');
    if (!toggle || !panel) {
      return;
    }
    toggle.setAttribute('aria-expanded', String(open));
    panel.dataset.open = String(open);
  }

  function setMobileVoiceSettingsOpen(open) {
    const toggle = root.querySelector('[data-action="toggle-mobile-voice-settings"]');
    const panel = root.querySelector('[data-mobile-voice-settings]');
    if (!toggle || !panel) {
      return;
    }
    toggle.setAttribute('aria-expanded', String(open));
    panel.dataset.open = String(open);
  }

  function reportFullscreenExitError(error) {
    const status = root.querySelector('[data-fullscreen-status]')
      ?? root.querySelector('[data-workout-status]');
    if (status) {
      status.hidden = false;
      status.textContent = `Unable to exit fullscreen: ${error.message}`;
      return;
    }
    globalThis.console?.error?.('Unable to exit workout fullscreen.', error);
  }

  function exitFullscreenIfOwned(workoutPage) {
    if (
      !workoutPage ||
      ownerDocument?.fullscreenElement !== workoutPage ||
      typeof ownerDocument.exitFullscreen !== 'function'
    ) {
      return;
    }
    try {
      void Promise.resolve(ownerDocument.exitFullscreen()).catch(reportFullscreenExitError);
    } catch (error) {
      reportFullscreenExitError(error);
    }
  }

  function requestMobileFullscreen(workoutPage) {
    const status = workoutPage?.querySelector?.('[data-fullscreen-status]');
    const showFallback = () => {
      if (status) {
        status.hidden = false;
        status.textContent = 'Fullscreen unavailable; the camera view remains active.';
      }
    };
    if (typeof workoutPage?.requestFullscreen !== 'function') {
      showFallback();
      return;
    }
    try {
      void Promise.resolve(workoutPage.requestFullscreen())
        .then(() => {
          const active = ['loading', 'running', 'paused'].includes(
            controller.getState().workoutStatus,
          );
          if (!active && ownerDocument?.fullscreenElement === workoutPage) {
            exitFullscreenIfOwned(workoutPage);
          }
        })
        .catch(showFallback);
    } catch {
      showFallback();
    }
  }

  function isMobileWorkoutViewport() {
    const view = ownerDocument?.defaultView;
    const matchMedia = view?.matchMedia ?? globalThis.matchMedia;
    return typeof matchMedia === 'function'
      && Boolean(matchMedia.call(view ?? globalThis, MOBILE_WORKOUT_QUERY).matches);
  }

  function render(state) {
    latestState = state;
    const screen = state.view === 'home'
      ? 'home'
      : state.workoutStatus === 'completed'
        ? 'completion'
        : 'workout';
    if (screen !== currentScreen) {
      setMobileSettingsOpen(false);
      setMobileVoiceSettingsOpen(false);
      if (!['loading', 'running', 'paused'].includes(state.workoutStatus)) {
        exitFullscreenIfOwned(root.querySelector('.workout-page'));
      }
      currentScreen = screen;
      if (screen === 'home') {
        renderHome(root, state);
      } else if (screen === 'completion') {
        renderCompletion(root, state);
        root.querySelector('[data-completion-title]')?.focus?.();
      } else {
        renderWorkout(root, state);
        updateWorkout(root, state);
        root.querySelector('.workout-heading h1')?.focus?.();
      }
    } else if (screen === 'workout') {
      updateWorkout(root, state);
    } else {
      const selector = root.querySelector('[data-action="language"]');
      if (selector && selector.value !== state.language) {
        selector.value = state.language;
      }
      const personality = root.querySelector('[data-action="personality"]');
      if (personality && personality.value !== state.personality) {
        personality.value = state.personality;
      }
    }

    const workoutActive = ['loading', 'running', 'paused'].includes(state.workoutStatus);
    root.querySelector('.workout-page')?.classList?.toggle('is-active', workoutActive);
    ownerDocument?.body?.classList?.toggle('workout-active', workoutActive);

    const personalityWarning = root.querySelector('[data-personality-warning]');
    if (personalityWarning) {
      personalityWarning.textContent = state.personalityStorageWarning;
      personalityWarning.hidden = !state.personalityStorageWarning;
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
  const playbackManager = voicePlayback ?? createVoicePlaybackManager({
    onError: (error) => {
      const status = root.querySelector('[data-voice-status]');
      if (status) {
        status.textContent = `${error.message} Written coaching remains available.`;
      }
    },
  });
  controller = createWorkoutController({
    ...controllerOptions,
    onState: render,
    speechCoach: coach,
    audioCoach,
    voicePlayback: playbackManager,
    getMediaElements: () => ({
      video: root.querySelector('video'),
      canvas: root.querySelector('canvas'),
    }),
  });

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
        if (isMobileWorkoutViewport()) {
          requestMobileFullscreen(root.querySelector('.workout-page'));
        }
        void controller.start();
        break;
      case 'toggle-mobile-settings': {
        const panel = root.querySelector('[data-mobile-settings]');
        setMobileSettingsOpen(panel?.dataset.open !== 'true');
        break;
      }
      case 'toggle-mobile-voice-settings': {
        const panel = root.querySelector('[data-mobile-voice-settings]');
        setMobileVoiceSettingsOpen(panel?.dataset.open !== 'true');
        break;
      }
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
        root.querySelector('.home-page')?.scrollIntoView?.({
          behavior: 'auto',
          block: 'start',
        });
        root.querySelector('#welcome-title')?.focus?.();
        break;
      case 'set-goal':
        controller.setGoal(button.dataset.target);
        break;
      case 'start-another-workout':
        controller.selectExercise(controller.getState().selectedExercise);
        break;
      case 'next-workout': {
        controller.goToExerciseChooser();
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
      default:
        break;
    }
  });

  root.addEventListener('change', (event) => {
    const control = event.target;
    if (control.matches?.('[data-action="language"]')) {
      controller.setLanguage(control.value);
      setMobileSettingsOpen(false);
    } else if (control.matches?.('[data-action="voice"]')) {
      controller.setVoiceEnabled(control.checked);
    } else if (control.matches?.('[data-action="personality"]')) {
      controller.setPersonality(control.value);
      setMobileSettingsOpen(false);
    } else if (control.matches?.('[data-action="voice-volume"]')) {
      controller.setVoiceVolume(control.value);
    } else if (control.matches?.('[data-action="voice-id"]')) {
      controller.setVoiceId(control.value);
    } else if (control.matches?.('[data-action="count-each-rep"]')) {
      controller.setCountEachRep(control.checked);
    } else if (control.matches?.('[data-action="goal-custom"]')) {
      controller.setTargetFromCustom(control.value);
    }
  });

  root.addEventListener('input', (event) => {
    const control = event.target;
    if (
      control.matches?.('[data-action="goal-custom"]') &&
      control.value !== '' &&
      control.validity?.valid
    ) {
      controller.setTargetFromCustom(control.value);
    }
  });

  if (typeof ownerDocument?.addEventListener === 'function') {
    ownerDocument.addEventListener('pointerdown', (event) => {
      const settingsRoot = root.querySelector('[data-mobile-settings-root]');
      if (settingsRoot && !settingsRoot.contains(event.target)) {
        setMobileSettingsOpen(false);
      }
    });
    ownerDocument.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setMobileSettingsOpen(false);
        setMobileVoiceSettingsOpen(false);
      }
    });
  }

  render(latestState);
  return controller;
}

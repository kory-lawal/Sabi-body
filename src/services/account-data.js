/** Workout history, dashboard statistics, reminders and admin data. */

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function toWorkoutPayload(attempt) {
  return {
    idempotency_key: attempt.clientSessionId,
    exercise_id: attempt.exerciseId,
    completed: attempt.completed,
    completed_reps: attempt.completedReps,
    target_reps: attempt.targetReps,
    target_duration_seconds: attempt.targetDurationSeconds,
    duration_seconds: attempt.durationSeconds,
    started_at: attempt.startedAt,
    completed_at: attempt.completedAt,
  };
}

export function createAccountData(api, { timeZone = browserTimeZone } = {}) {
  const auth = { auth: true };
  return {
    saveWorkout: (attempt) => api.post('/api/workouts', toWorkoutPayload(attempt), auth),
    summary: (weekOffset = 0) => api.get(`/api/workouts/summary${query({ tz: timeZone(), week_offset: weekOffset })}`, auth),
    history: ({ exercise, status = 'all', from, to, limit = 20, offset = 0 } = {}) =>
      api.get(`/api/workouts${query({ tz: timeZone(), exercise, status, from, to, limit, offset })}`, auth),
    reminders: () => api.get('/api/reminders', auth),
    saveReminders: (preferences) => api.put('/api/reminders', preferences, auth),
    sessions: () => api.get('/api/account/sessions', auth),
    adminOverview: (days = 30) => api.get(`/api/admin/overview${query({ tz: timeZone(), days })}`, auth),
  };
}

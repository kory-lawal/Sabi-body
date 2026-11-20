export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  }
  return `${rest}s`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

export function formatDate(iso, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, options).format(date);
}

export function formatDateTime(iso) {
  return formatDate(iso, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** "2026-11-16" (a local calendar date) → "Mon" etc., without timezone shifts. */
export function weekdayLabel(isoDate, style = 'short') {
  const [year, month, day] = String(isoDate).split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function calendarDateLabel(isoDate) {
  const [year, month, day] = String(isoDate).split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

export function workoutResult(workout) {
  if (workout.exercise_type === 'duration') {
    return `${formatDuration(workout.duration_seconds)} held`;
  }
  const reps = workout.completed_reps ?? 0;
  return `${reps} ${reps === 1 ? 'rep' : 'reps'}`;
}

export function workoutTarget(workout) {
  if (workout.exercise_type === 'duration') {
    return workout.target_duration_seconds ? `of ${formatDuration(workout.target_duration_seconds)}` : '';
  }
  return workout.target_reps ? `of ${workout.target_reps}` : '';
}

export function firstName(fullName = '') {
  return String(fullName).trim().split(/\s+/)[0] || 'there';
}

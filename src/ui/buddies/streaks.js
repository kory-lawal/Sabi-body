/** Streak badges, the per-friend streak list and the plain-language streak rules. */
import { EXERCISES } from '../exercise-content.js';
import { emptyState, errorState, escapeHtml, loadingState, personLine } from './components.js';

export const MILESTONES = [3, 7, 14, 30, 50, 100];

export function streakBadge(streak) {
  if (!streak?.current) return '';
  return `<span class="streak-badge" title="${streak.current} shared workouts in a row">🔥 ${streak.current}</span>`;
}

export function streakRulesMarkup({ open = false } = {}) {
  return `
    <details class="disclosure streak-rules"${open ? ' open' : ''}>
      <summary>How buddy streaks work</summary>
      <div class="streak-rules__body">
        <p>Your streak counts the workouts you <strong>agreed to do together and both completed</strong> in a row — not calendar days. Plan three workouts a week and rest days never cost you anything.</p>
        <ul>
          <li><strong>Counts:</strong> you both finish the target in a confirmed workout.</li>
          <li><strong>Resets to zero:</strong> someone doesn’t show up within 30 minutes of the start, cancels less than 2 hours before, or ends without reaching the target.</li>
          <li><strong>Doesn’t change it:</strong> agreeing a new time, cancelling more than 2 hours ahead, invitations nobody accepted, or a dropped connection you couldn’t come back from.</li>
          <li>Extra rounds in the same session are great training but count once.</li>
          <li>Exercise streaks follow the same rules for each exercise. Nobody — not even you — can edit a streak by hand.</li>
        </ul>
        <p>Milestones: ${MILESTONES.join(', ')} shared workouts.</p>
      </div>
    </details>`;
}

function exerciseName(id) {
  return EXERCISES[id]?.name ?? id;
}

function lastDone(iso) {
  return iso ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(iso)) : '—';
}

export function renderStreakList({ streaks, error }) {
  if (error && !streaks) return errorState(error, 'retry');
  if (!streaks) return loadingState('Loading your streaks…');
  if (!streaks.length) {
    return `${emptyState({ title: 'No streaks yet', body: 'Complete a workout with a friend to start your first buddy streak.', action: '<a class="button button--primary" href="#/calendar?new=scheduled">Schedule a workout</a>' })}${streakRulesMarkup()}`;
  }
  return `
    <ul class="streak-list">
      ${streaks.map((s) => `
        <li class="streak-card">
          <div class="streak-card__head">
            ${personLine(s.friend)}
            <div class="streak-card__big"><span class="streak-card__num">${s.buddy.current}</span><span class="streak-card__label">in a row</span></div>
          </div>
          <dl class="streak-card__stats">
            <div><dt>Longest</dt><dd>${s.buddy.longest}</dd></div>
            <div><dt>Together</dt><dd>${s.buddy.total_completed}</dd></div>
            <div><dt>Last</dt><dd>${escapeHtml(lastDone(s.buddy.last_completed_at))}</dd></div>
            <div><dt>Next milestone</dt><dd>${s.buddy.next_milestone ?? '🏆'}</dd></div>
          </dl>
          ${s.exercises.length ? `
          <table class="streak-table">
            <caption class="visually-hidden">Exercise streaks with ${escapeHtml(s.friend.first_name)}</caption>
            <thead><tr><th scope="col">Exercise</th><th scope="col">Current</th><th scope="col">Longest</th><th scope="col">Total</th><th scope="col">Last</th></tr></thead>
            <tbody>${s.exercises.map((e) => `<tr><th scope="row">${escapeHtml(exerciseName(e.exercise_id))}</th><td>${e.current}</td><td>${e.longest}</td><td>${e.total_completed}</td><td>${escapeHtml(lastDone(e.last_completed_at))}</td></tr>`).join('')}</tbody>
          </table>` : ''}
          <a class="button button--quiet button--small" href="#/calendar?new=scheduled&amp;with=${encodeURIComponent(s.friend.username)}">Plan the next one</a>
        </li>`).join('')}
    </ul>
    ${streakRulesMarkup()}`;
}

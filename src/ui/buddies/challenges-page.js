/** #/challenges — one-to-one challenges with friends. Progress comes from real workouts. */
import { EXERCISES } from '../exercise-content.js';
import { busyAttrs, emptyState, errorState, escapeHtml, loadingState, notice, pageHeader, personLine } from './components.js';

const STATUS = {
  pending: ['Waiting for an answer', 'warning'],
  active: ['In progress', 'success'],
  completed: ['Completed', 'success'],
  expired: ['Ended', 'muted'],
  declined: ['Declined', 'muted'],
  cancelled: ['Cancelled', 'muted'],
};

function unit(c) {
  if (c.metric === 'seconds') return 's';
  if (c.metric === 'workouts') return c.target === 1 ? ' workout' : ' workouts';
  return ' reps';
}

function timeLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Ended';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return `${Math.floor(hours / 24)} days left`;
  if (hours >= 1) return `${hours} h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min left`;
}

function bar(label, value, target, reached, tone) {
  const pct = Math.min(100, (value / target) * 100);
  return `
    <div class="challenge-progress">
      <div class="challenge-progress__top"><span>${escapeHtml(label)}</span><strong>${escapeHtml(Math.min(value, target))} / ${escapeHtml(target)}${reached ? ' ✓' : ''}</strong></div>
      <div class="challenge-bar challenge-bar--${tone}" role="progressbar" aria-label="${escapeHtml(label)} progress" aria-valuemin="0" aria-valuemax="${escapeHtml(target)}" aria-valuenow="${escapeHtml(Math.min(value, target))}"><span style="width:${pct}%"></span></div>
    </div>`;
}

function challengeCard(c, { pending, confirm }) {
  const friend = c.friend ?? {};
  const [label, tone] = STATUS[c.status] ?? [c.status, 'muted'];
  const who = c.created_by_me ? `You challenged ${friend.first_name}` : `${friend.first_name} challenged you`;
  const busy = busyAttrs(pending === `challenge:${c.id}`);
  const actions = [];
  if (c.awaiting_me) {
    actions.push(`<button class="button button--primary button--small" type="button" data-buddy-action="challenge-accept" data-id="${c.id}"${busy}>Accept challenge</button>`);
    actions.push(`<button class="button button--quiet button--small" type="button" data-buddy-action="challenge-decline" data-id="${c.id}"${busy}>Decline</button>`);
  }
  if (c.status === 'active' && c.exercise_id !== 'any' && EXERCISES[c.exercise_id]) {
    actions.push(`<button class="button button--primary button--small" type="button" data-action="choose-exercise" data-exercise="${escapeHtml(c.exercise_id)}">Start ${escapeHtml(EXERCISES[c.exercise_id].name)}</button>`);
    actions.push(`<a class="button button--quiet button--small" href="#/calendar?new=instant&amp;with=${encodeURIComponent(friend.username ?? '')}&amp;exercise=${encodeURIComponent(c.exercise_id)}">Do it together</a>`);
  }
  if (c.created_by_me && ['pending', 'active'].includes(c.status)) {
    actions.push(confirm === `challenge-cancel:${c.id}`
      ? `<span class="confirm-inline" role="group" aria-label="Confirm cancellation"><button class="button button--danger button--small" type="button" data-buddy-action="challenge-cancel" data-id="${c.id}" data-confirmed="true"${busy}>Yes, cancel</button><button class="button button--quiet button--small" type="button" data-buddy-action="cancel-confirm">Keep it</button></span>`
      : `<button class="button button--quiet button--small button--danger-text" type="button" data-buddy-action="challenge-cancel" data-id="${c.id}"${busy}>Cancel</button>`);
  }
  let outcome = '';
  if (c.status === 'completed') {
    outcome = `<p class="challenge-outcome">🏆 You both did it! ${c.first_is_me ? 'You' : escapeHtml(friend.first_name)} got there first.</p>`;
  } else if (c.status === 'expired') {
    outcome = `<p class="challenge-outcome muted">${c.i_reached || c.friend_reached
      ? `${c.i_reached ? 'You' : escapeHtml(friend.first_name)} completed it before the deadline.`
      : 'Nobody reached the target this time — try another one!'}</p>`;
  }
  return `
    <li class="challenge-card" id="challenge-${escapeHtml(c.id)}">
      <div class="challenge-card__head">
        <div>
          <p class="challenge-card__who">${escapeHtml(who)}</p>
          <h3 class="challenge-card__title">${escapeHtml(c.summary.charAt(0).toUpperCase() + c.summary.slice(1))}</h3>
        </div>
        <span class="badge badge--${tone}">${escapeHtml(label)}</span>
      </div>
      ${c.message ? `<blockquote class="session-details__message">${escapeHtml(c.message)}</blockquote>` : ''}
      ${['active', 'completed', 'expired'].includes(c.status) ? `
        <div class="challenge-card__bars">
          ${bar('You', c.my_progress, c.target, c.i_reached, 'me')}
          ${bar(friend.first_name ?? 'Friend', c.friend_progress, c.target, c.friend_reached, 'friend')}
        </div>` : ''}
      <p class="challenge-card__meta">${c.status === 'active' || c.status === 'pending' ? escapeHtml(timeLeft(c.deadline)) : `Deadline ${escapeHtml(new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(c.deadline)))}`} · Progress comes from your saved workouts${c.metric === 'seconds' ? ' (your longest single hold)' : ''}.</p>
      ${outcome}
      ${actions.length ? `<div class="challenge-card__actions">${actions.join('')}</div>` : ''}
    </li>`;
}

function endOfDay(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(23, 59, 0, 0);
  return d;
}

export function deadlineFromPreset(preset, custom) {
  switch (preset) {
    case 'today': {
      const end = endOfDay(0);
      return end.getTime() - Date.now() < 3_600_000 ? endOfDay(1) : end;
    }
    case '3days': return endOfDay(3);
    case 'week': {
      const d = endOfDay(0);
      d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
      return d.getTime() - Date.now() < 3_600_000 ? endOfDay(7) : d;
    }
    case '7days': return endOfDay(7);
    case 'custom': return custom ? new Date(custom) : null;
    default: return null;
  }
}

function createForm(form, { friends, pending }) {
  if (!friends?.length) {
    return `<section class="card">${emptyState({ title: 'Add a friend to challenge', action: '<a class="button button--primary" href="#/buddies?tab=find">Find friends</a>' })}</section>`;
  }
  const v = form.values;
  const metric = v.metric ?? 'reps';
  const repExercises = Object.entries(EXERCISES).filter(([id]) => id !== 'plank');
  return `
    <section class="card invite-form" aria-labelledby="challenge-form-title">
      <h2 id="challenge-form-title">New challenge</h2>
      <form class="form" data-buddy-form="create-challenge" novalidate>
        <fieldset class="mode-switch mode-switch--wrap">
          <legend class="visually-hidden">Challenge type</legend>
          <label class="mode-switch__option"><input type="radio" name="metric" value="reps" ${metric === 'reps' ? 'checked' : ''} data-buddy-metric /> <span>Total reps</span></label>
          <label class="mode-switch__option"><input type="radio" name="metric" value="seconds" ${metric === 'seconds' ? 'checked' : ''} data-buddy-metric /> <span>Plank hold</span></label>
          <label class="mode-switch__option"><input type="radio" name="metric" value="workouts" ${metric === 'workouts' ? 'checked' : ''} data-buddy-metric /> <span>Workouts</span></label>
        </fieldset>
        <div class="form-grid">
          <div class="field">
            <label class="field__label" for="challenge-friend">Friend</label>
            <select class="field__input" id="challenge-friend" name="friend_id">
              ${friends.map((f) => `<option value="${escapeHtml(f.id)}"${f.username === v.with || f.id === v.friend_id ? ' selected' : ''}>${escapeHtml(f.display_name)}</option>`).join('')}
            </select>
          </div>
          ${metric === 'seconds' ? '' : `
          <div class="field">
            <label class="field__label" for="challenge-exercise">Exercise</label>
            <select class="field__input" id="challenge-exercise" name="exercise_id">
              ${metric === 'workouts' ? `<option value="any"${(v.exercise_id ?? 'any') === 'any' ? ' selected' : ''}>Any exercise</option>` : ''}
              ${(metric === 'workouts' ? Object.entries(EXERCISES) : repExercises).map(([id, ex]) => `<option value="${id}"${id === v.exercise_id ? ' selected' : ''}>${escapeHtml(ex.name)}</option>`).join('')}
            </select>
          </div>`}
          <div class="field">
            <label class="field__label" for="challenge-target">${metric === 'seconds' ? 'Hold for (seconds)' : metric === 'workouts' ? 'Number of workouts' : 'Total reps'}</label>
            <input class="field__input" id="challenge-target" name="target" type="number" min="1" max="${metric === 'workouts' ? 50 : metric === 'seconds' ? 3600 : 5000}" value="${escapeHtml(v.target ?? (metric === 'seconds' ? 60 : metric === 'workouts' ? 3 : 30))}" required />
          </div>
          <div class="field">
            <label class="field__label" for="challenge-deadline">Deadline</label>
            <select class="field__input" id="challenge-deadline" name="preset">
              ${[['today', 'End of today'], ['3days', 'In 3 days'], ['week', 'End of this week'], ['7days', 'In 7 days'], ['custom', 'Pick a date…']]
                .map(([id, label]) => `<option value="${id}"${(v.preset ?? 'week') === id ? ' selected' : ''}>${label}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="challenge-custom">Custom deadline (if “Pick a date”)</label>
            <input class="field__input" id="challenge-custom" name="custom" type="datetime-local" value="${escapeHtml(v.custom ?? '')}" />
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="challenge-message">Message (optional)</label>
          <textarea class="field__input" id="challenge-message" name="message" maxlength="280" rows="2" placeholder="Bet you can’t beat me!">${escapeHtml(v.message ?? '')}</textarea>
        </div>
        ${form.error ? notice(form.error) : ''}
        <p class="field__hint">Progress counts automatically from workouts you each save after the challenge is accepted. No honour system needed.</p>
        <div class="form-actions">
          <button class="button button--primary" type="submit"${busyAttrs(pending === 'create-challenge')}>Send challenge</button>
          <a class="button button--quiet" href="#/challenges">Cancel</a>
        </div>
      </form>
    </section>`;
}

function section(title, items, opts, empty) {
  return `
    <section class="challenge-section" aria-label="${escapeHtml(title)}">
      <h2>${escapeHtml(title)}</h2>
      ${items.length ? `<ul class="challenge-list">${items.map((c) => challengeCard(c, opts)).join('')}</ul>` : `<p class="muted">${escapeHtml(empty)}</p>`}
    </section>`;
}

export function renderChallengesPage({ data, error, form, friends, pending, message, failure, confirm = '' }) {
  let body;
  if (error && !data) body = errorState(error);
  else if (!data) body = loadingState('Loading challenges…');
  else {
    body = `
      ${section('Waiting for an answer', data.pending, { pending, confirm }, 'No open challenge invitations.')}
      ${section('In progress', data.active, { pending, confirm }, 'No active challenges. Challenge a friend to get going!')}
      ${section('Finished', data.past, { pending, confirm }, 'Finished challenges appear here.')}`;
  }
  return `
    ${pageHeader({
      title: 'Challenges',
      intro: 'Friendly one-to-one challenges. Progress updates from your real workouts.',
      actions: '<a class="button button--primary button--small" href="#/challenges?new=1">New challenge</a>',
    })}
    ${notice(message, 'success')}
    ${notice(failure)}
    ${form.open ? createForm(form, { friends, pending }) : ''}
    ${body}`;
}

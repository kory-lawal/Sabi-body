/** #/calendar — plan workouts with friends: month/week views, lists, invitations and details. */
import { EXERCISES } from '../exercise-content.js';
import { busyAttrs, emptyState, errorState, escapeHtml, loadingState, notice, pageHeader, personLine, tabs } from './components.js';
import { connectionNotice } from './friends-page.js';
import { streakRulesMarkup } from './streaks.js';

export const CALENDAR_VIEWS = ['month', 'week', 'upcoming', 'pending', 'past', 'cancelled'];

const STATUS_LABELS = {
  proposed: ['Awaiting reply', 'warning'],
  accepted: ['Confirmed', 'success'],
  live: ['Happening now', 'success'],
  completed: ['Completed', 'success'],
  incomplete: ['Not completed', 'muted'],
  declined: ['Declined', 'muted'],
  cancelled: ['Cancelled', 'muted'],
  expired: ['Expired', 'muted'],
};

export function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return new Date(new Date().setHours(0, 0, 0, 0));
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** First and last (exclusive) local dates shown by the month grid (Monday-first weeks). */
export function monthGridRange(anchor) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 42);
  return { start, end };
}

export function weekRange(anchor) {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

export function formatWhen(iso, options = { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) {
  if (!iso) return 'Now';
  return new Intl.DateTimeFormat(undefined, options).format(new Date(iso));
}

function timeOnly(iso) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function targetText(session) {
  return session.exercise_type === 'duration' ? `${session.target} seconds` : `${session.target} reps`;
}

function statusBadge(status) {
  const [label, tone] = STATUS_LABELS[status] ?? [status, 'muted'];
  return `<span class="badge badge--${tone}">${escapeHtml(label)}</span>`;
}

function sessionHref(session, view, date) {
  const params = new URLSearchParams({ session: session.id });
  if (view) params.set('view', view);
  if (date) params.set('date', date);
  return `#/calendar?${params}`;
}

function eventChip(session, view, date) {
  return `
    <a class="cal-event cal-event--${escapeHtml(session.status)}" href="${sessionHref(session, view, date)}">
      <span class="cal-event__time">${escapeHtml(timeOnly(session.scheduled_at))}</span>
      <span class="cal-event__name">${escapeHtml(session.exercise_name)}</span>
      <span class="cal-event__with">with ${escapeHtml(session.partner?.first_name ?? '')}</span>
    </a>`;
}

function byDay(sessions) {
  const map = new Map();
  for (const s of sessions ?? []) {
    if (!s.scheduled_at) continue;
    const key = isoDate(new Date(s.scheduled_at));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return map;
}

function monthView(anchor, sessions, today) {
  const { start } = monthGridRange(anchor);
  const days = byDay(sessions.filter((s) => !['declined', 'expired'].includes(s.status)));
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const key = isoDate(day);
    const events = days.get(key) ?? [];
    const outside = day.getMonth() !== anchor.getMonth();
    cells.push(`
      <div class="cal-day${outside ? ' is-outside' : ''}${key === today ? ' is-today' : ''}" role="gridcell" aria-label="${escapeHtml(formatWhen(day.toISOString(), { weekday: 'long', day: 'numeric', month: 'long' }))}${events.length ? `, ${events.length} workout${events.length > 1 ? 's' : ''}` : ''}">
        <span class="cal-day__num">${day.getDate()}</span>
        ${events.map((s) => eventChip(s, 'month', isoDate(anchor))).join('')}
      </div>`);
  }
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return `
    <div class="cal-month" role="grid" aria-label="${escapeHtml(new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(anchor))}">
      <div class="cal-weekdays" role="row">${weekdays.map((d) => `<span role="columnheader">${d}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
    </div>`;
}

function weekView(anchor, sessions, today) {
  const { start } = weekRange(anchor);
  const days = byDay(sessions.filter((s) => !['declined', 'expired'].includes(s.status)));
  const cols = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const key = isoDate(day);
    const events = days.get(key) ?? [];
    cols.push(`
      <section class="cal-week__day${key === today ? ' is-today' : ''}" aria-label="${escapeHtml(formatWhen(day.toISOString(), { weekday: 'long', day: 'numeric', month: 'long' }))}">
        <h3>${escapeHtml(formatWhen(day.toISOString(), { weekday: 'short', day: 'numeric' }))}</h3>
        ${events.length ? events.map((s) => eventChip(s, 'week', isoDate(anchor))).join('') : '<p class="muted cal-week__empty">—</p>'}
      </section>`);
  }
  return `<div class="cal-week">${cols.join('')}</div>`;
}

function listRow(session, view) {
  return `
    <li>
      <a class="session-row" href="${sessionHref(session, view)}">
        <span class="session-row__when">${escapeHtml(session.mode === 'instant' ? 'Now' : formatWhen(session.scheduled_at))}</span>
        <span class="session-row__what"><strong>${escapeHtml(session.exercise_name)}</strong> · ${escapeHtml(targetText(session))}</span>
        <span class="session-row__who">with ${escapeHtml(session.partner?.display_name ?? '')}</span>
        ${statusBadge(session.status)}
        ${session.awaiting_me ? '<span class="badge badge--warning">Your reply needed</span>' : ''}
      </a>
    </li>`;
}

function listView(view, sessions) {
  const empty = {
    upcoming: ['No upcoming workouts', 'Schedule a workout with a friend and it will appear here.'],
    pending: ['No open invitations', 'Invitations you send or receive wait here until someone answers.'],
    past: ['No past workouts yet', 'Workouts you’ve done together will appear here.'],
    cancelled: ['Nothing cancelled', 'Cancelled, declined and expired invitations appear here.'],
  }[view];
  if (!sessions) return loadingState('Loading workouts…');
  if (!sessions.length) return emptyState({ title: empty[0], body: empty[1] });
  return `<ul class="session-list">${sessions.map((s) => listRow(s, view)).join('')}</ul>`;
}

function defaultDate() {
  const d = new Date(Date.now() + 86_400_000);
  return isoDate(d);
}

function inviteForm(form, { friends, pending }) {
  const v = form.values;
  const mode = v.mode ?? 'instant';
  const exerciseId = EXERCISES[v.exercise_id] ? v.exercise_id : 'push-ups';
  const isPlank = exerciseId === 'plank';
  if (!friends?.length) {
    return `<section class="card">${emptyState({ title: 'Add a friend first', body: 'You can invite friends once they accept your friend request.', action: '<a class="button button--primary" href="#/buddies?tab=find">Find friends</a>' })}</section>`;
  }
  return `
    <section class="card invite-form" aria-labelledby="invite-title">
      <h2 id="invite-title">${mode === 'instant' ? 'Work out together now' : 'Schedule a workout'}</h2>
      <form class="form" data-buddy-form="create-session" novalidate>
        <fieldset class="mode-switch">
          <legend class="visually-hidden">When</legend>
          <label class="mode-switch__option"><input type="radio" name="mode" value="instant" ${mode === 'instant' ? 'checked' : ''} data-buddy-mode /> <span>Now</span></label>
          <label class="mode-switch__option"><input type="radio" name="mode" value="scheduled" ${mode === 'scheduled' ? 'checked' : ''} data-buddy-mode /> <span>Pick a time</span></label>
        </fieldset>
        <div class="form-grid">
          <div class="field">
            <label class="field__label" for="invite-friend">Friend</label>
            <select class="field__input" id="invite-friend" name="friend_id">
              ${friends.map((f) => `<option value="${escapeHtml(f.id)}"${f.username === v.with || f.id === v.friend_id ? ' selected' : ''}>${escapeHtml(f.display_name)} (@${escapeHtml(f.username)})</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="invite-exercise">Exercise</label>
            <select class="field__input" id="invite-exercise" name="exercise_id">
              ${Object.entries(EXERCISES).map(([id, ex]) => `<option value="${id}"${id === exerciseId ? ' selected' : ''}>${escapeHtml(ex.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="invite-target">Target (${isPlank ? 'seconds for plank' : 'reps; seconds for plank'})</label>
            <input class="field__input" id="invite-target" name="target" type="number" min="1" max="3600" step="1" value="${escapeHtml(v.target ?? (isPlank ? 30 : 20))}" required />
          </div>
          ${mode === 'scheduled' ? `
          <div class="field">
            <label class="field__label" for="invite-date">Date</label>
            <input class="field__input" id="invite-date" name="date" type="date" min="${isoDate(new Date())}" value="${escapeHtml(v.date ?? defaultDate())}" required />
          </div>
          <div class="field">
            <label class="field__label" for="invite-time">Time (your local time)</label>
            <input class="field__input" id="invite-time" name="time" type="time" value="${escapeHtml(v.time ?? '18:00')}" step="300" required />
          </div>` : ''}
        </div>
        <div class="field">
          <label class="field__label" for="invite-message">Message (optional)</label>
          <textarea class="field__input" id="invite-message" name="message" maxlength="280" rows="2" placeholder="Let’s show up for each other!">${escapeHtml(v.message ?? '')}</textarea>
        </div>
        ${form.error ? notice(form.error) : ''}
        <p class="field__hint">${mode === 'instant' ? 'Your friend has 30 minutes to accept. Once they do, you both join the same workout.' : 'Your friend sees the time in their own timezone. Only accepted invitations become commitments.'}</p>
        <div class="form-actions">
          <button class="button button--primary" type="submit"${busyAttrs(pending === 'create-session')}>${mode === 'instant' ? 'Send invitation' : 'Send workout invitation'}</button>
          <a class="button button--quiet" href="#/calendar">Cancel</a>
        </div>
      </form>
    </section>`;
}

function rescheduleForm(session, label) {
  const local = session.scheduled_at ? new Date(session.scheduled_at) : new Date(Date.now() + 86_400_000);
  const hh = String(local.getHours()).padStart(2, '0');
  const mm = String(local.getMinutes()).padStart(2, '0');
  return `
    <details class="disclosure disclosure--compact">
      <summary>${escapeHtml(label)}</summary>
      <form class="form form--inline" data-buddy-form="reschedule" novalidate>
        <input type="hidden" name="session_id" value="${escapeHtml(session.id)}" />
        <div class="field field--compact"><label class="field__label" for="resched-date">New date</label>
          <input class="field__input" id="resched-date" name="date" type="date" min="${isoDate(new Date())}" value="${isoDate(local)}" required /></div>
        <div class="field field--compact"><label class="field__label" for="resched-time">New time</label>
          <input class="field__input" id="resched-time" name="time" type="time" step="300" value="${hh}:${mm}" required /></div>
        <button class="button button--primary button--small" type="submit">Send new time</button>
      </form>
    </details>`;
}

function cancelButton(s, { confirm, busy, label }) {
  if (confirm === `session-cancel:${s.id}`) {
    return `<span class="confirm-inline" role="group" aria-label="Confirm cancellation">
      <button class="button button--danger button--small" type="button" data-buddy-action="session-cancel" data-id="${s.id}" data-confirmed="true"${busy}>Yes, cancel it</button>
      <button class="button button--quiet button--small" type="button" data-buddy-action="cancel-confirm">Keep it</button></span>`;
  }
  return `<button class="button button--quiet button--danger-text" type="button" data-buddy-action="session-cancel" data-id="${s.id}"${busy}>${label}</button>`;
}

function sessionDetails(selected, { pending, features, confirm }) {
  if (!selected) return '';
  if (selected.error) return `<section class="card">${errorState(selected.error, 'retry-session')}</section>`;
  const s = selected.session;
  if (!s) return `<section class="card">${loadingState('Loading workout…')}</section>`;
  const partner = s.partner?.first_name ?? 'your friend';
  const busy = (name) => busyAttrs(pending === `${name}:${s.id}`);
  const actions = [];
  let note = '';
  if (s.status === 'proposed' && s.awaiting_me) {
    note = s.created_by_me ? `${partner} suggested a new time.` : `${partner} invited you.`;
    actions.push(`<button class="button button--primary" type="button" data-buddy-action="session-accept" data-id="${s.id}"${busy('session')}>Accept</button>`);
    actions.push(`<button class="button button--quiet" type="button" data-buddy-action="session-decline" data-id="${s.id}"${busy('session')}>Decline</button>`);
    if (s.mode === 'scheduled') actions.push(rescheduleForm(s, 'Suggest another time'));
  } else if (s.status === 'proposed') {
    note = `Waiting for ${partner} to answer.`;
    actions.push(cancelButton(s, { confirm, busy: busy('session'), label: 'Cancel invitation' }));
  } else if (s.status === 'accepted' || s.status === 'live') {
    if (features.together && s.can_join) {
      actions.push(`<a class="button button--primary" href="#/together?session=${encodeURIComponent(s.id)}">Start workout together</a>`);
    } else if (s.mode === 'scheduled') {
      note = 'You can join from 15 minutes before the start time.';
    }
    if (s.mode === 'scheduled' && s.status === 'accepted') actions.push(rescheduleForm(s, 'Reschedule'));
    if (s.status === 'accepted') {
      actions.push(cancelButton(s, { confirm, busy: busy('session'), label: 'Cancel workout' }));
    }
  }
  const exercise = EXERCISES[s.exercise_id];
  return `
    <section class="card session-details" aria-labelledby="session-title">
      <div class="session-details__head">
        ${exercise ? `<img class="session-details__image" src="${escapeHtml(exercise.media.src)}" alt="" width="96" height="72" />` : ''}
        <div>
          <h2 id="session-title">${escapeHtml(s.exercise_name)} · ${escapeHtml(targetText(s))}</h2>
          <p class="session-details__when">${escapeHtml(s.mode === 'instant' ? 'Right now' : formatWhen(s.scheduled_at, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }))}</p>
        </div>
        ${statusBadge(s.status)}
      </div>
      <p class="session-details__with">With ${personLine(s.partner ?? {})}</p>
      ${s.message ? `<blockquote class="session-details__message">${escapeHtml(s.message)}</blockquote>` : ''}
      ${note ? `<p class="muted">${escapeHtml(note)}</p>` : ''}
      ${actions.length ? `<div class="session-details__actions">${actions.join('')}</div>` : ''}
      <a class="text-link" href="#/messages?with=${encodeURIComponent(s.partner?.username ?? '')}">Message ${escapeHtml(partner)}</a>
    </section>`;
}

export function renderCalendarPage({ calendar, friends, pending, message, failure, connection, features = {}, confirm = '' }) {
  const { view, date } = calendar;
  const anchor = parseIsoDate(date);
  const today = isoDate(new Date());
  const shift = (amount) => {
    const next = new Date(anchor);
    if (view === 'week') next.setDate(next.getDate() + 7 * amount);
    else next.setMonth(next.getMonth() + amount, 1);
    return `#/calendar?view=${view}&date=${isoDate(next)}`;
  };
  const awaiting = (calendar.lists.pending ?? []).filter((s) => s.awaiting_me).length;
  const nav = tabs([
    { id: 'month', title: 'Month', href: `#/calendar?view=month&date=${isoDate(anchor)}` },
    { id: 'week', title: 'Week', href: `#/calendar?view=week&date=${isoDate(anchor)}` },
    { id: 'upcoming', title: 'Upcoming', href: '#/calendar?view=upcoming' },
    { id: 'pending', title: 'Invitations', href: '#/calendar?view=pending', count: awaiting },
    { id: 'past', title: 'Past', href: '#/calendar?view=past' },
    { id: 'cancelled', title: 'Cancelled', href: '#/calendar?view=cancelled' },
  ], view, 'Calendar views');

  let body;
  if (view === 'month' || view === 'week') {
    const range = calendar.range;
    const title = view === 'month'
      ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(anchor)
      : `Week of ${formatWhen(weekRange(anchor).start.toISOString(), { day: 'numeric', month: 'long' })}`;
    const grid = range.error ? errorState(range.error) : !range.sessions ? loadingState('Loading your calendar…')
      : view === 'month' ? monthView(anchor, range.sessions, today) : weekView(anchor, range.sessions, today);
    body = `
      <div class="cal-toolbar">
        <a class="button button--quiet button--small" href="${shift(-1)}" aria-label="Previous ${view}">←</a>
        <h2 class="cal-toolbar__title">${escapeHtml(title)}</h2>
        <a class="button button--quiet button--small" href="${shift(1)}" aria-label="Next ${view}">→</a>
        <a class="button button--quiet button--small" href="#/calendar?view=${view}&date=${today}">Today</a>
      </div>
      ${grid}`;
  } else {
    body = listView(view, calendar.lists[view]);
  }

  return `
    ${pageHeader({
      title: 'Workout calendar',
      intro: 'Plan workouts with friends. Times are shown in your timezone.',
      actions: `<a class="button button--primary button--small" href="#/calendar?new=scheduled">Schedule a workout</a>
        <a class="button button--quiet button--small" href="#/calendar?new=instant">Work out now</a>`,
    })}
    ${connectionNotice(connection)}
    ${notice(message, 'success')}
    ${notice(failure)}
    ${calendar.form.open ? inviteForm(calendar.form, { friends, pending }) : ''}
    ${sessionDetails(calendar.selected, { pending, features, confirm })}
    ${nav}
    <div class="buddy-panel">${body}</div>
    ${streakRulesMarkup()}`;
}

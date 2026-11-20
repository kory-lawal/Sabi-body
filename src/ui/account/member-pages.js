import { growthChart, weeklyActivityChart } from './charts.js';
import { passwordField } from './auth-pages.js';
import {
  calendarDateLabel,
  escapeHtml,
  firstName,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  workoutResult,
  workoutTarget,
} from './format.js';

const EXERCISE_OPTIONS = [
  ['squats', 'Squats'],
  ['jumping-jacks', 'Jumping Jacks'],
  ['plank', 'Plank'],
  ['push-ups', 'Push-ups'],
  ['sit-ups', 'Sit-ups'],
  ['lunges', 'Lunges'],
  ['high-knees', 'High Knees'],
];

function notice(message, tone = 'error') {
  if (!message) {
    return '';
  }
  return `<div class="notice notice--${tone}" role="${tone === 'error' ? 'alert' : 'status'}">${escapeHtml(message)}</div>`;
}

function pageHeader({ eyebrow, title, intro = '', actions = '' }) {
  return `
    <header class="page-header">
      <div>
        ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}
        <h1 id="page-title" tabindex="-1">${title}</h1>
        ${intro ? `<p class="page-header__intro">${intro}</p>` : ''}
      </div>
      ${actions ? `<div class="page-header__actions">${actions}</div>` : ''}
    </header>`;
}

export function loadingState(label = 'Loading…') {
  return `<div class="state-panel" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><p>${escapeHtml(label)}</p></div>`;
}

export function errorState(message, retryAction = 'retry') {
  return `
    <div class="state-panel state-panel--error" role="alert">
      <p><strong>We couldn’t load this page.</strong></p>
      <p>${escapeHtml(message || 'Please check your connection and try again.')}</p>
      <button class="button button--quiet" type="button" data-acct-action="${retryAction}">Try again</button>
    </div>`;
}

function statCard(label, value, detail = '', tone = '') {
  return `
    <article class="stat-card${tone ? ` stat-card--${tone}` : ''}">
      <p class="stat-card__label">${label}</p>
      <p class="stat-card__value">${value}</p>
      ${detail ? `<p class="stat-card__detail">${detail}</p>` : ''}
    </article>`;
}

function statusBadge(completed) {
  return completed
    ? '<span class="badge badge--success">Completed</span>'
    : '<span class="badge badge--muted">Not finished</span>';
}

function workoutRow(workout) {
  return `
    <li class="workout-row">
      <div class="workout-row__main">
        <p class="workout-row__name">${escapeHtml(workout.exercise_name)}</p>
        <p class="workout-row__meta"><time datetime="${escapeHtml(workout.started_at)}">${escapeHtml(formatDateTime(workout.started_at))}</time></p>
      </div>
      <div class="workout-row__result">
        <p><strong>${escapeHtml(workoutResult(workout))}</strong> <span class="muted">${escapeHtml(workoutTarget(workout))}</span></p>
        <p class="workout-row__meta">${workout.exercise_type === 'duration' ? 'Plank hold' : `${escapeHtml(formatDuration(workout.duration_seconds))} total`}</p>
      </div>
      ${statusBadge(workout.completed)}
    </li>`;
}

function weekComparison(week) {
  const diff = week.workouts - week.previous_week_workouts;
  if (week.workouts === 0 && week.previous_week_workouts === 0) {
    return 'No workouts this week yet.';
  }
  if (diff === 0) {
    return `Same as the week before (${week.previous_week_workouts}).`;
  }
  const word = Math.abs(diff) === 1 ? 'workout' : 'workouts';
  return diff > 0
    ? `${diff} more ${word} than the week before.`
    : `${Math.abs(diff)} fewer ${word} than the week before.`;
}

export function renderDashboard({ user, summary, loading, error, weekOffset = 0, todayIso = '' }) {
  const header = pageHeader({
    eyebrow: 'Dashboard',
    title: `Welcome back, ${escapeHtml(firstName(user?.full_name))}!`,
    intro: 'Ready for another workout?',
    actions: '<a class="button button--primary" href="#/exercises">Start a workout</a>',
  });
  if (error && !summary) {
    return `${header}${errorState(error)}`;
  }
  if (!summary) {
    return `${header}${loadingState('Loading your progress…')}`;
  }
  if (summary.total_attempts === 0) {
    return `${header}
      <section class="card empty-state">
        <div class="empty-state__icon" aria-hidden="true">✦</div>
        <h2>Your first workout starts here</h2>
        <p>Pick an exercise, allow your camera, and SabiBody will count every rep. Your results appear here automatically.</p>
        <a class="button button--primary" href="#/exercises">Choose an exercise</a>
      </section>`;
  }
  const week = summary.week;
  const completionPercent = Math.round((summary.completion_rate || 0) * 100);
  const maxByExercise = Math.max(1, ...summary.by_exercise.map((item) => item.workouts));
  return `${header}
    ${notice(error)}
    <section class="stat-grid" aria-label="Your totals">
      ${statCard('Workouts completed', formatNumber(summary.total_workouts), summary.streak_days ? `${summary.streak_days}-day streak` : 'Start a streak today', 'primary')}
      ${statCard('Total reps', formatNumber(summary.total_reps), 'Across all saved workouts')}
      ${statCard('Total workout time', formatDuration(summary.total_duration_seconds), `Average ${formatDuration(summary.average_duration_seconds)} per workout`)}
      ${statCard('This week', formatNumber(summary.workouts_this_week), summary.workouts_this_week === 1 ? 'workout completed' : 'workouts completed')}
    </section>
    <div class="dashboard-grid">
      <section class="card card--chart" aria-labelledby="week-title">
        <div class="card__header">
          <div>
            <h2 id="week-title">Weekly activity</h2>
            <p class="card__subtitle">${escapeHtml(calendarDateLabel(week.start))} – ${escapeHtml(calendarDateLabel(week.end))}${weekOffset === 0 ? ' · This week' : ''}</p>
          </div>
          <div class="week-nav" role="group" aria-label="Change week">
            <button class="icon-button" type="button" data-acct-action="previous-week" aria-label="Previous week"${loading ? ' disabled' : ''}>‹</button>
            <button class="icon-button" type="button" data-acct-action="next-week" aria-label="Next week"${weekOffset >= 0 || loading ? ' disabled' : ''}>›</button>
          </div>
        </div>
        ${weeklyActivityChart(week.days, { todayIso })}
        <p class="card__footnote">${escapeHtml(weekComparison(week))}</p>
      </section>
      <section class="card" aria-labelledby="progress-title">
        <h2 id="progress-title">Overall progress</h2>
        <div class="progress-meter" role="img" aria-label="${completionPercent}% of started workouts completed">
          <div class="progress-meter__bar"><span style="width:${completionPercent}%"></span></div>
          <p><strong>${completionPercent}%</strong> of started workouts finished (${summary.total_workouts} of ${summary.total_attempts})</p>
        </div>
        ${summary.by_exercise.length ? `
          <h3 class="card__minor-title">Completed by exercise</h3>
          <ul class="exercise-bars">${summary.by_exercise.map((item) => `
            <li><span>${escapeHtml(item.exercise_name)}</span><span class="exercise-bars__track"><span style="width:${Math.round((item.workouts / maxByExercise) * 100)}%"></span></span><strong>${item.workouts}</strong></li>`).join('')}
          </ul>` : '<p class="muted">Finish a workout to see your exercise mix.</p>'}
      </section>
    </div>
    <section class="card" aria-labelledby="recent-title">
      <div class="card__header">
        <h2 id="recent-title">Recent workouts</h2>
        <a class="text-link" href="#/history">View full history →</a>
      </div>
      <ul class="workout-list">${summary.recent.map(workoutRow).join('')}</ul>
    </section>`;
}

const GROUP_LABELS = {
  today: 'Today',
  this_week: 'Earlier this week',
  previous_weeks: 'Previous weeks',
  previous_months: 'Previous months',
};

export function renderHistory({ items, total, filters = {}, loading, loadingMore, error }) {
  const header = pageHeader({ eyebrow: 'Your workouts', title: 'Workout history', intro: 'Every workout you’ve saved, newest first.' });
  const filterForm = `
    <form class="card filter-bar" data-acct-form="history-filters" aria-label="Filter workouts">
      <div class="field field--compact">
        <label class="field__label" for="filter-exercise">Exercise</label>
        <select class="field__input" id="filter-exercise" name="exercise">
          <option value="">All exercises</option>
          ${EXERCISE_OPTIONS.map(([id, name]) => `<option value="${id}"${filters.exercise === id ? ' selected' : ''}>${name}</option>`).join('')}
        </select>
      </div>
      <div class="field field--compact">
        <label class="field__label" for="filter-status">Status</label>
        <select class="field__input" id="filter-status" name="status">
          <option value="all"${filters.status === 'all' || !filters.status ? ' selected' : ''}>All</option>
          <option value="completed"${filters.status === 'completed' ? ' selected' : ''}>Completed</option>
          <option value="incomplete"${filters.status === 'incomplete' ? ' selected' : ''}>Not finished</option>
        </select>
      </div>
      <div class="field field--compact">
        <label class="field__label" for="filter-from">From</label>
        <input class="field__input" id="filter-from" name="from" type="date" value="${escapeHtml(filters.from ?? '')}" />
      </div>
      <div class="field field--compact">
        <label class="field__label" for="filter-to">To</label>
        <input class="field__input" id="filter-to" name="to" type="date" value="${escapeHtml(filters.to ?? '')}" />
      </div>
      <div class="filter-bar__actions">
        <button class="button button--primary" type="submit">Apply</button>
        <button class="button button--quiet" type="button" data-acct-action="clear-filters">Clear</button>
      </div>
    </form>`;
  if (error && !items) {
    return `${header}${filterForm}${errorState(error)}`;
  }
  if (!items || loading) {
    return `${header}${filterForm}${loadingState('Loading workouts…')}`;
  }
  const filtered = Boolean(filters.exercise || (filters.status && filters.status !== 'all') || filters.from || filters.to);
  if (items.length === 0) {
    return `${header}${filterForm}
      <section class="card empty-state">
        <h2>${filtered ? 'No workouts match these filters' : 'No workouts yet'}</h2>
        <p>${filtered ? 'Try a different exercise, status or date range.' : 'Workouts you finish while logged in are saved here automatically.'}</p>
        ${filtered ? '<button class="button button--quiet" type="button" data-acct-action="clear-filters">Clear filters</button>' : '<a class="button button--primary" href="#/exercises">Start a workout</a>'}
      </section>`;
  }
  const groups = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last?.key === item.group) {
      last.items.push(item);
    } else {
      groups.push({ key: item.group, items: [item] });
    }
  }
  return `${header}${filterForm}
    ${notice(error)}
    <p class="result-count" role="status">${total} ${total === 1 ? 'workout' : 'workouts'}${filtered ? ' match your filters' : ''}</p>
    ${groups.map((group) => `
      <section class="card history-group" aria-label="${GROUP_LABELS[group.key] ?? 'Workouts'}">
        <h2 class="history-group__title">${GROUP_LABELS[group.key] ?? 'Workouts'}</h2>
        <ul class="workout-list">${group.items.map(workoutRow).join('')}</ul>
      </section>`).join('')}
    ${items.length < total ? `<div class="load-more"><button class="button button--quiet" type="button" data-acct-action="load-more"${loadingMore ? ' disabled aria-busy="true"' : ''}>${loadingMore ? 'Loading…' : `Show more (${total - items.length} left)`}</button></div>` : ''}`;
}

function initials(name = '') {
  return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'S';
}

function nameForm({ user, pending, idPrefix }) {
  return `
    <form class="form form--inline" data-acct-form="update-name" novalidate>
      <div class="field">
        <label class="field__label" for="${idPrefix}-name">Full name</label>
        <input class="field__input" id="${idPrefix}-name" name="fullName" autocomplete="name" maxlength="120" value="${escapeHtml(user.full_name)}" required />
      </div>
      <button class="button button--primary" type="submit"${pending === 'update-name' ? ' disabled aria-busy="true"' : ''}>${pending === 'update-name' ? 'Saving…' : 'Save name'}</button>
    </form>`;
}

function passwordForm({ pending, idPrefix }) {
  return `
    <form class="form" data-acct-form="change-password" novalidate>
      ${passwordField({ id: `${idPrefix}-current-password`, name: 'currentPassword', label: 'Current password', autocomplete: 'current-password' })}
      ${passwordField({ id: `${idPrefix}-new-password`, name: 'newPassword', label: 'New password', autocomplete: 'new-password', rules: true })}
      ${passwordField({ id: `${idPrefix}-confirm-password`, name: 'confirmPassword', label: 'Confirm new password', autocomplete: 'new-password' })}
      <button class="button button--primary" type="submit"${pending === 'change-password' ? ' disabled aria-busy="true"' : ''}>${pending === 'change-password' ? 'Updating…' : 'Change password'}</button>
    </form>`;
}

export function renderProfile({ user, summary, pending, message, error }) {
  const stats = summary
    ? `<div class="stat-grid stat-grid--compact">
        ${statCard('Total workouts', formatNumber(summary.total_workouts))}
        ${statCard('Total reps', formatNumber(summary.total_reps))}
        ${statCard('Exercise time', formatDuration(summary.total_duration_seconds))}
      </div>`
    : loadingState('Loading your totals…');
  return `
    ${pageHeader({ eyebrow: 'Profile', title: 'Your profile' })}
    ${notice(message, 'success')}
    ${notice(error)}
    <section class="card profile-card">
      <div class="avatar" aria-hidden="true">${escapeHtml(initials(user.full_name))}</div>
      <dl class="profile-card__details">
        <div><dt>Full name</dt><dd>${escapeHtml(user.full_name)}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(user.email)} ${user.email_verified ? '<span class="badge badge--success">Verified</span>' : '<span class="badge badge--warning">Not verified</span>'}</dd></div>
        <div><dt>Member since</dt><dd>${escapeHtml(formatDate(user.created_at))}</dd></div>
      </dl>
    </section>
    ${stats}
    <div class="two-column">
      <section class="card" aria-labelledby="profile-name-title">
        <h2 id="profile-name-title">Edit your name</h2>
        ${nameForm({ user, pending, idPrefix: 'profile' })}
      </section>
      <section class="card" aria-labelledby="profile-password-title">
        <h2 id="profile-password-title">Change password</h2>
        ${passwordForm({ pending, idPrefix: 'profile' })}
        <p class="card__footnote">Forgot your current password?
          <button class="text-button" type="button" data-acct-action="send-reset-email"${pending === 'send-reset-email' ? ' disabled' : ''}>Email me a reset link</button></p>
      </section>
    </div>
    <section class="card card--row">
      <div><h2>Log out</h2><p class="muted">Sign out of SabiBody on this device.</p></div>
      <button class="button button--quiet" type="button" data-acct-action="logout">Log out</button>
    </section>`;
}

function toggle({ name, label, checked, description = '', disabled = false }) {
  return `
    <label class="switch-row${disabled ? ' is-disabled' : ''}">
      <span class="switch-row__text"><span class="switch-row__label">${label}</span>${description ? `<span class="switch-row__description">${description}</span>` : ''}</span>
      <span class="switch"><input type="checkbox" role="switch" name="${name}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} data-reminder-toggle="${name}" /><span class="switch__track" aria-hidden="true"></span></span>
    </label>`;
}

function timeZoneOptions(selected) {
  let zones = [];
  try {
    zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch {
    zones = [];
  }
  const all = [...new Set(['UTC', 'Africa/Lagos', selected, ...zones].filter(Boolean))].sort();
  return all.map((zone) => `<option value="${escapeHtml(zone)}"${zone === selected ? ' selected' : ''}>${escapeHtml(zone.replaceAll('_', ' '))}</option>`).join('');
}

export function renderSettings({ user, reminders, sessions, emailDelivery, pending, message, error, sectionMessage = {} }) {
  const r = reminders;
  const remindersSection = !r
    ? loadingState('Loading reminder settings…')
    : `
      <form class="form" data-acct-form="reminders" novalidate>
        ${toggle({ name: 'email_reminders_enabled', label: 'Email workout reminders', checked: r.email_reminders_enabled, description: 'We only email you on days you haven’t worked out yet.' })}
        <fieldset class="reminder-slots" data-reminder-slots ${r.email_reminders_enabled ? '' : 'disabled'}>
          <legend class="visually-hidden">Reminder times</legend>
          <div class="reminder-slot">
            ${toggle({ name: 'morning_reminder_enabled', label: 'Morning reminder', checked: r.morning_reminder_enabled })}
            <div class="field field--compact">
              <label class="field__label" for="reminder-morning-time">Morning time</label>
              <input class="field__input" id="reminder-morning-time" name="morning_reminder_time" type="time" min="04:00" max="11:59" step="300" value="${escapeHtml(r.morning_reminder_time)}" />
            </div>
          </div>
          <div class="reminder-slot">
            ${toggle({ name: 'evening_reminder_enabled', label: 'Evening reminder', checked: r.evening_reminder_enabled })}
            <div class="field field--compact">
              <label class="field__label" for="reminder-evening-time">Evening time</label>
              <input class="field__input" id="reminder-evening-time" name="evening_reminder_time" type="time" min="15:00" max="23:59" step="300" value="${escapeHtml(r.evening_reminder_time)}" />
            </div>
          </div>
        </fieldset>
        <div class="field">
          <label class="field__label" for="reminder-timezone">Your timezone</label>
          <select class="field__input" id="reminder-timezone" name="timezone">${timeZoneOptions(r.timezone)}</select>
          <p class="field__hint">Reminder times use this timezone.</p>
        </div>
        ${emailDelivery === 'console' ? '<p class="notice notice--warning" role="note">Email delivery is not switched on for SabiBody yet. Your choices are saved and reminders will start once it is.</p>' : ''}
        ${notice(sectionMessage.reminders, 'success')}
        <button class="button button--primary" type="submit"${pending === 'reminders' ? ' disabled aria-busy="true"' : ''}>${pending === 'reminders' ? 'Saving…' : 'Save reminder settings'}</button>
      </form>`;
  return `
    ${pageHeader({ eyebrow: 'Settings', title: 'Settings', intro: 'Manage your account, reminders and security.' })}
    ${notice(message, 'success')}
    ${notice(error)}
    <nav class="section-tabs" aria-label="Settings sections">
      <a href="#/settings?section=account">Account</a>
      <a href="#/settings?section=reminders">Workout reminders</a>
      <a href="#/settings?section=security">Privacy &amp; security</a>
    </nav>
    <section class="card settings-section" id="settings-account" aria-labelledby="settings-account-title">
      <h2 id="settings-account-title">Account</h2>
      <div class="setting-line">
        <div><p class="setting-line__label">Email</p><p>${escapeHtml(user.email)}</p></div>
        ${user.email_verified ? '<span class="badge badge--success">Verified</span>' : '<span class="badge badge--warning">Not verified</span>'}
      </div>
      ${nameForm({ user, pending, idPrefix: 'settings' })}
      <form class="form form--inline" data-acct-form="update-username" novalidate>
        <div class="field">
          <label class="field__label" for="settings-username">Username</label>
          <input class="field__input" id="settings-username" name="username" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="20" value="${escapeHtml(user.username ?? '')}" required />
          <p class="field__hint">Friends find you with this. 3–20 lowercase letters, numbers or underscores. You can change it once a week.</p>
        </div>
        <button class="button button--primary" type="submit"${pending === 'update-username' ? ' disabled aria-busy="true"' : ''}>${pending === 'update-username' ? 'Saving…' : 'Save username'}</button>
      </form>
      <details class="disclosure">
        <summary>Change email address</summary>
        <form class="form" data-acct-form="change-email" novalidate>
          <div class="field">
            <label class="field__label" for="settings-new-email">New email address</label>
            <input class="field__input" id="settings-new-email" name="newEmail" type="email" autocomplete="email" inputmode="email" required />
            <p class="field__hint">We’ll send a link to the new address. Your email changes only after you confirm it.</p>
          </div>
          ${passwordField({ id: 'settings-email-password', label: 'Your password', autocomplete: 'current-password' })}
          ${notice(sectionMessage.email, 'success')}
          <button class="button button--primary" type="submit"${pending === 'change-email' ? ' disabled aria-busy="true"' : ''}>${pending === 'change-email' ? 'Sending…' : 'Send confirmation link'}</button>
        </form>
      </details>
      <details class="disclosure">
        <summary>Change password</summary>
        ${passwordForm({ pending, idPrefix: 'settings' })}
      </details>
    </section>
    <section class="card settings-section" id="settings-reminders" aria-labelledby="settings-reminders-title">
      <h2 id="settings-reminders-title">Workout reminders</h2>
      <p class="muted">Choose morning, evening, both or neither. You can change this at any time.</p>
      ${remindersSection}
    </section>
    <section class="card settings-section" id="settings-security" aria-labelledby="settings-security-title">
      <h2 id="settings-security-title">Privacy &amp; security</h2>
      <ul class="security-facts">
        <li>Your password is stored only as a secure Argon2id hash — never as plain text.</li>
        <li>Your camera video is analysed on your device and is never uploaded or recorded.</li>
        <li>Only you can see your workouts, profile and reminder settings.</li>
      </ul>
      <div class="setting-line">
        <div><p class="setting-line__label">Signed-in devices</p><p>${sessions == null ? 'Checking…' : `${sessions} active ${sessions === 1 ? 'session' : 'sessions'}`}</p></div>
        <button class="button button--quiet" type="button" data-acct-action="revoke-others"${pending === 'revoke-others' ? ' disabled' : ''}>Sign out other devices</button>
      </div>
      <div class="setting-line">
        <div><p class="setting-line__label">This device</p><p>Log out of SabiBody here.</p></div>
        <button class="button button--quiet" type="button" data-acct-action="logout">Log out</button>
      </div>
      <details class="disclosure disclosure--danger">
        <summary>Delete my account</summary>
        <form class="form" data-acct-form="delete-account" novalidate>
          <p>This permanently deletes your account, workout history and reminder settings. It cannot be undone.</p>
          ${passwordField({ id: 'delete-password', label: 'Enter your password to confirm', autocomplete: 'current-password' })}
          <button class="button button--danger" type="submit"${pending === 'delete-account' ? ' disabled aria-busy="true"' : ''}>${pending === 'delete-account' ? 'Deleting…' : 'Permanently delete account'}</button>
        </form>
      </details>
    </section>`;
}

export function renderAdmin({ overview, loading, error, days = 30 }) {
  const header = pageHeader({
    eyebrow: 'Owner tools',
    title: 'Admin dashboard',
    intro: 'Platform growth from registration records. Visible only to administrators.',
    actions: `<label class="field field--compact field--inline"><span class="field__label">Range</span>
      <select class="field__input" data-acct-action="admin-range" aria-label="Chart range">
        ${[30, 90, 180].map((value) => `<option value="${value}"${value === days ? ' selected' : ''}>Last ${value} days</option>`).join('')}
      </select></label>`,
  });
  if (error && !overview) {
    return `${header}${errorState(error)}`;
  }
  if (!overview || loading) {
    return `${header}${loadingState('Loading platform statistics…')}`;
  }
  return `${header}
    <section class="stat-grid" aria-label="Registration statistics">
      ${statCard('Registered users', formatNumber(overview.total_users), `${formatNumber(overview.verified_users)} verified`, 'primary')}
      ${statCard('New today', formatNumber(overview.new_today))}
      ${statCard('New this week', formatNumber(overview.new_this_week))}
      ${statCard('New this month', formatNumber(overview.new_this_month))}
    </section>
    <div class="dashboard-grid">
      <section class="card card--chart" aria-labelledby="growth-title">
        <h2 id="growth-title">Registration growth</h2>
        ${growthChart(overview.growth)}
      </section>
      <section class="card" aria-labelledby="platform-title">
        <h2 id="platform-title">Platform activity</h2>
        ${statCard('Completed workouts', formatNumber(overview.total_completed_workouts), 'All users, all time')}
      </section>
    </div>
    <section class="card" aria-labelledby="recent-users-title">
      <h2 id="recent-users-title">Recent registrations</h2>
      ${overview.recent_users.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Joined</th><th scope="col">Status</th></tr></thead>
            <tbody>${overview.recent_users.map((user) => `
              <tr>
                <td data-label="Name">${escapeHtml(user.full_name)}</td>
                <td data-label="Email">${escapeHtml(user.email)}</td>
                <td data-label="Joined">${escapeHtml(formatDateTime(user.created_at))}</td>
                <td data-label="Status">${user.email_verified ? '<span class="badge badge--success">Verified</span>' : '<span class="badge badge--warning">Unverified</span>'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<p class="muted">No registrations yet.</p>'}
    </section>`;
}

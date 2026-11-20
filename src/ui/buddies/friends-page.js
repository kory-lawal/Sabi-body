/** #/buddies?tab=friends|requests|sent|blocked|find — friend management. */
import { renderStreakList, streakBadge } from './streaks.js';
import {
  busyAttrs,
  emptyState,
  errorState,
  escapeHtml,
  loadingState,
  notice,
  pageHeader,
  personLine,
  tabs,
} from './components.js';

export function connectionNotice(connection) {
  if (connection === 'reconnecting' || connection === 'offline') {
    return `<p class="connection-note" role="status">${connection === 'offline' ? 'You’re offline. Changes will sync when you reconnect.' : 'Reconnecting to SabiBody… live updates will resume shortly.'}</p>`;
  }
  return '';
}

export const FRIEND_TABS = ['friends', 'streaks', 'requests', 'sent', 'blocked', 'find'];

const REPORT_REASONS = [
  ['spam', 'Spam or advertising'],
  ['harassment', 'Harassment or bullying'],
  ['inappropriate', 'Inappropriate content'],
  ['impersonation', 'Pretending to be someone else'],
  ['other', 'Something else'],
];

function friendsSince(iso) {
  if (!iso) return '';
  return `Friends since ${new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(iso))}`;
}

function confirmButton({ confirm, action, id, label, confirmLabel, danger = false, pending }) {
  const key = `${action}:${id}`;
  if (confirm === key) {
    return `
      <span class="confirm-inline" role="group" aria-label="${escapeHtml(confirmLabel)}">
        <button class="button button--${danger ? 'danger' : 'primary'} button--small" type="button" data-buddy-action="${action}" data-id="${escapeHtml(id)}" data-confirmed="true"${busyAttrs(pending === key)}>${escapeHtml(confirmLabel)}</button>
        <button class="button button--quiet button--small" type="button" data-buddy-action="cancel-confirm">Keep</button>
      </span>`;
  }
  return `<button class="button button--quiet button--small${danger ? ' button--danger-text' : ''}" type="button" data-buddy-action="${action}" data-id="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
}

function reportForm(friend, pending) {
  return `
    <form class="form buddy-report" data-buddy-form="report" novalidate>
      <input type="hidden" name="username" value="${escapeHtml(friend.username)}" />
      <div class="field">
        <label class="field__label" for="report-reason-${escapeHtml(friend.id)}">Reason</label>
        <select class="field__input" id="report-reason-${escapeHtml(friend.id)}" name="reason">
          ${REPORT_REASONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="report-details-${escapeHtml(friend.id)}">What happened? (optional)</label>
        <textarea class="field__input" id="report-details-${escapeHtml(friend.id)}" name="details" maxlength="1000" rows="3"></textarea>
      </div>
      <label class="check-row"><input type="checkbox" name="alsoBlock" checked /> Also block @${escapeHtml(friend.username)}</label>
      <button class="button button--danger button--small" type="submit"${busyAttrs(pending === `report:${friend.username}`)}>Send report</button>
    </form>`;
}

function friendCard(friend, { confirm, pending, features, online }) {
  const actions = [];
  if (features.messages) {
    actions.push(`<a class="button button--quiet button--small" href="#/messages?with=${encodeURIComponent(friend.username)}">Message</a>`);
  }
  if (features.together) {
    actions.push(`<a class="button button--primary button--small" href="#/calendar?new=instant&amp;with=${encodeURIComponent(friend.username)}">Work out together</a>`);
    actions.push(`<a class="button button--quiet button--small" href="#/calendar?new=scheduled&amp;with=${encodeURIComponent(friend.username)}">Schedule</a>`);
    actions.push(`<a class="button button--quiet button--small" href="#/challenges?new=1&amp;with=${encodeURIComponent(friend.username)}">Challenge</a>`);
  }
  return `
    <li class="friend-card">
      <div class="friend-card__main">
        <span class="friend-card__who">${personLine(friend)}${streakBadge(friend.streak)}</span>
        <p class="friend-card__meta">${online?.has(friend.id) ? '<span class="presence-dot" aria-hidden="true"></span><span>Online now</span> · ' : ''}${escapeHtml(friendsSince(friend.friends_since))}${friend.muted ? ' · <span class="badge badge--muted">Muted</span>' : ''}</p>
      </div>
      <div class="friend-card__actions">${actions.join('')}</div>
      <details class="friend-card__more">
        <summary>More options<span class="visually-hidden"> for ${escapeHtml(friend.display_name)}</span></summary>
        <div class="friend-card__menu">
          <a class="button button--quiet button--small" href="#/buddies?tab=find&amp;view=${encodeURIComponent(friend.username)}">View profile</a>
          <button class="button button--quiet button--small" type="button" data-buddy-action="${friend.muted ? 'unmute' : 'mute'}" data-id="${escapeHtml(friend.id)}"${busyAttrs(pending === `mute:${friend.id}`)}>${friend.muted ? 'Unmute notifications' : 'Mute notifications'}</button>
          ${confirmButton({ confirm, pending, action: 'remove-friend', id: friend.id, label: 'Remove friend', confirmLabel: 'Yes, remove' })}
          ${confirmButton({ confirm, pending, action: 'block', id: friend.username, label: 'Block', confirmLabel: 'Yes, block', danger: true })}
          <details class="disclosure disclosure--compact">
            <summary>Report</summary>
            ${reportForm(friend, pending)}
          </details>
        </div>
      </details>
    </li>`;
}

function requestCard(request, { incoming, pending }) {
  const id = request.request_id;
  const buttons = incoming
    ? `<button class="button button--primary button--small" type="button" data-buddy-action="accept-request" data-id="${escapeHtml(id)}"${busyAttrs(pending === `request:${id}`)}>Accept</button>
       <button class="button button--quiet button--small" type="button" data-buddy-action="decline-request" data-id="${escapeHtml(id)}"${busyAttrs(pending === `request:${id}`)}>Decline</button>`
    : `<button class="button button--quiet button--small" type="button" data-buddy-action="cancel-request" data-id="${escapeHtml(id)}"${busyAttrs(pending === `request:${id}`)}>Cancel request</button>`;
  return `
    <li class="friend-card friend-card--request">
      <div class="friend-card__main">${personLine(request.user)}</div>
      <div class="friend-card__actions">${buttons}</div>
    </li>`;
}

function searchResult(result, { pending, confirm }) {
  let action;
  switch (result.relationship) {
    case 'friends':
      action = '<span class="badge badge--success">Friends</span>';
      break;
    case 'outgoing':
      action = '<span class="badge badge--muted">Request sent</span>';
      break;
    case 'incoming':
      action = `<a class="button button--primary button--small" href="#/buddies?tab=requests">Respond to request</a>`;
      break;
    default:
      action = `<button class="button button--primary button--small" type="button" data-buddy-action="send-request" data-username="${escapeHtml(result.username)}"${busyAttrs(pending === `send:${result.username}`)}>Add friend</button>`;
  }
  return `
    <li class="friend-card">
      <div class="friend-card__main">${personLine(result)}</div>
      <div class="friend-card__actions">
        ${action}
        ${confirmButton({ confirm, pending, action: 'block', id: result.username, label: 'Block', confirmLabel: 'Yes, block', danger: true })}
      </div>
    </li>`;
}

function profilePanel(profile) {
  if (!profile) return '';
  const activity = profile.activity
    ? `<p class="muted">${profile.activity.workouts_last_7_days} workouts in the last 7 days · ${profile.activity.completed_workouts} completed in total</p>`
    : '<p class="muted">Become friends to see their workout activity.</p>';
  return `
    <section class="card buddy-profile" aria-label="Profile">
      ${personLine(profile.user)}
      ${activity}
    </section>`;
}

export function renderFriendsPage({ me, tab = 'friends', data, loading, error, search = {}, profile, confirm, pending,
  message, failure, features = {}, online = new Set(), connection = 'idle', streaks = {} }) {
  const incomingCount = data?.incoming?.length ?? 0;
  const header = pageHeader({
    title: 'Friends',
    intro: 'You don’t have to work out alone. Find a friend, make a commitment and show up for each other.',
    actions: `<span class="handle-chip" title="Your username">@${escapeHtml(me?.username ?? '')}</span>
      <a class="button button--quiet button--small" href="#/settings?section=account">Change username</a>`,
  });
  const nav = tabs([
    { id: 'friends', title: `My friends${data ? ` (${data.friends.length})` : ''}`, href: '#/buddies?tab=friends' },
    { id: 'streaks', title: 'Streaks', href: '#/buddies?tab=streaks' },
    { id: 'requests', title: 'Requests', href: '#/buddies?tab=requests', count: incomingCount },
    { id: 'sent', title: 'Sent', href: '#/buddies?tab=sent' },
    { id: 'blocked', title: 'Blocked', href: '#/buddies?tab=blocked' },
    { id: 'find', title: 'Find friends', href: '#/buddies?tab=find' },
  ], tab, 'Friends sections');

  let body;
  if (tab === 'find') {
    const results = search.results;
    body = `
      <section class="card" aria-labelledby="find-title">
        <h2 id="find-title">Find friends</h2>
        <form class="form form--inline buddy-search" data-buddy-form="search" role="search" novalidate>
          <div class="field">
            <label class="field__label" for="buddy-search-q">Search by username</label>
            <input class="field__input" id="buddy-search-q" name="q" value="${escapeHtml(search.q ?? '')}" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="40" placeholder="e.g. ada_fit" data-buddy-search />
          </div>
          <button class="button button--primary" type="submit"${busyAttrs(search.loading)}>Search</button>
        </form>
        <p class="field__hint">Ask your friend for their username — it’s shown at the top of their Friends page.</p>
        ${profilePanel(profile)}
        ${search.error ? notice(search.error) : ''}
        ${results == null
          ? ''
          : results.length
            ? `<ul class="friend-list" aria-live="polite">${results.map((r) => searchResult(r, { pending, confirm })).join('')}</ul>`
            : `<p class="muted" aria-live="polite">No members found for “${escapeHtml(search.q)}”.</p>`}
      </section>`;
  } else if (tab === 'streaks') {
    body = renderStreakList(streaks);
  } else if (error && !data) {
    body = errorState(error);
  } else if (!data || loading && !data) {
    body = loadingState('Loading your friends…');
  } else if (tab === 'requests') {
    body = data.incoming.length
      ? `<ul class="friend-list">${data.incoming.map((r) => requestCard(r, { incoming: true, pending })).join('')}</ul>`
      : emptyState({ title: 'No new requests', body: 'When someone adds you, their request appears here.' });
  } else if (tab === 'sent') {
    body = data.sent.length
      ? `<ul class="friend-list">${data.sent.map((r) => requestCard(r, { incoming: false, pending })).join('')}</ul>`
      : emptyState({ title: 'No pending requests', body: 'Requests you send wait here until they’re accepted.' });
  } else if (tab === 'blocked') {
    body = data.blocked.length
      ? `<ul class="friend-list">${data.blocked.map((b) => `
          <li class="friend-card">
            <div class="friend-card__main">${personLine(b)}</div>
            <div class="friend-card__actions"><button class="button button--quiet button--small" type="button" data-buddy-action="unblock" data-id="${escapeHtml(b.id)}"${busyAttrs(pending === `unblock:${b.id}`)}>Unblock</button></div>
          </li>`).join('')}</ul>`
      : emptyState({ title: 'You haven’t blocked anyone', body: 'Blocked people can’t find you, message you or invite you.' });
  } else {
    body = data.friends.length
      ? `<ul class="friend-list">${data.friends.map((f) => friendCard(f, { confirm, pending, features, online })).join('')}</ul>`
      : emptyState({
        title: 'Find your first workout buddy',
        body: 'People who exercise with a friend are more likely to keep going. Search for a friend’s username to get started.',
        action: '<a class="button button--primary" href="#/buddies?tab=find">Find friends</a>',
      });
  }

  return `
    ${header}
    ${connectionNotice(connection)}
    ${notice(message, 'success')}
    ${notice(failure)}
    ${nav}
    <div class="buddy-panel">${body}</div>`;
}

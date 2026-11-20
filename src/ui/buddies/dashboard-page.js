/** #/buddies — the SabiBody Buddies hub. */
import { avatar, busyAttrs, emptyState, errorState, escapeHtml, loadingState, notice, pageHeader, personLine, relativeTime } from './components.js';
import { formatWhen, targetText } from './calendar-page.js';
import { streakBadge, streakRulesMarkup } from './streaks.js';

function count(n) {
  return n ? ` <span class="count-pill" aria-label="${n} new">${n}</span>` : '';
}

function quickActions(data, counts) {
  const actions = [
    ['#/calendar?new=instant', '🏃', 'Start workout together', 'Invite a friend to work out now'],
    ['#/calendar?new=scheduled', '📅', 'Schedule a workout', 'Pick a time that suits you both'],
    ['#/buddies?tab=find', '🔍', 'Find friends', 'Search by username'],
    ['#/messages', '💬', `Messages${count(counts.messages)}`, 'Chat and cheer each other on'],
    ['#/calendar', '🗓️', `Calendar${count(counts.invites)}`, 'Your shared workouts'],
    ['#/challenges', '🏆', `Challenges${count(counts.challenges)}`, 'Friendly one-to-one goals'],
  ];
  return `
    <nav class="buddy-actions" aria-label="Buddies quick actions">
      ${actions.map(([href, icon, label, hint]) => `
        <a class="buddy-action" href="${href}">
          <span class="buddy-action__icon" aria-hidden="true">${icon}</span>
          <span class="buddy-action__label">${label}</span>
          <span class="buddy-action__hint">${escapeHtml(hint)}</span>
        </a>`).join('')}
    </nav>`;
}

function sessionLine(s, { pending, actions = '' }) {
  return `
    <li class="hub-row">
      ${avatar(s.partner, 'sm')}
      <div class="hub-row__text">
        <p class="hub-row__title"><strong>${escapeHtml(s.exercise_name)}</strong> · ${escapeHtml(targetText(s))} with ${escapeHtml(s.partner?.first_name ?? '')}</p>
        <p class="hub-row__meta">${escapeHtml(s.mode === 'instant' ? 'Right now' : formatWhen(s.scheduled_at))}${s.message ? ` · “${escapeHtml(s.message)}”` : ''}</p>
      </div>
      <div class="hub-row__actions">${actions}</div>
    </li>`;
}

function card(title, body, { href, linkLabel, id } = {}) {
  return `
    <section class="card hub-card"${id ? ` id="${id}"` : ''} aria-labelledby="${id ?? title.replace(/\W+/g, '-').toLowerCase()}-h">
      <div class="hub-card__head">
        <h2 id="${id ?? title.replace(/\W+/g, '-').toLowerCase()}-h">${escapeHtml(title)}</h2>
        ${href ? `<a class="text-link" href="${href}">${escapeHtml(linkLabel ?? 'See all')}</a>` : ''}
      </div>
      ${body}
    </section>`;
}

export function renderBuddiesDashboard({ me, dashboard, error, counts = {}, online = new Set(), pending, message, failure }) {
  const header = pageHeader({
    title: `Workout buddies`,
    intro: 'You don’t have to work out alone. Find a friend, make a commitment, show up for each other and get stronger together.',
    actions: `<span class="handle-chip" title="Your username — share it so friends can find you">@${escapeHtml(me?.username ?? '')}</span>`,
  });
  const tabsMarkup = `
    <nav class="buddy-tabs" aria-label="Buddies sections">
      <a class="buddy-tabs__tab is-active" href="#/buddies" aria-current="page">Overview</a>
      <a class="buddy-tabs__tab" href="#/buddies?tab=friends">My friends</a>
      <a class="buddy-tabs__tab" href="#/buddies?tab=streaks">Streaks</a>
      <a class="buddy-tabs__tab" href="#/buddies?tab=requests">Requests${count(counts.requests)}</a>
      <a class="buddy-tabs__tab" href="#/buddies?tab=find">Find friends</a>
    </nav>`;
  const notices = `${notice(message, 'success')}${notice(failure)}`;
  if (error && !dashboard) return `${header}${notices}${tabsMarkup}${errorState(error)}`;
  if (!dashboard) return `${header}${notices}${tabsMarkup}${loadingState('Loading your buddies…')}`;
  const d = dashboard;
  const busy = (id) => busyAttrs(pending === `session:${id}`);

  const invitations = d.invitations.length
    ? `<ul class="hub-list">${d.invitations.map((s) => sessionLine(s, { pending, actions: `
        <button class="button button--primary button--small" type="button" data-buddy-action="session-accept" data-id="${s.id}"${busy(s.id)}>Accept</button>
        <button class="button button--quiet button--small" type="button" data-buddy-action="session-decline" data-id="${s.id}"${busy(s.id)}>Decline</button>
        ${s.mode === 'scheduled' ? `<a class="button button--quiet button--small" href="#/calendar?session=${s.id}">Other time</a>` : ''}` })).join('')}</ul>`
    : '';
  const upcoming = d.upcoming.length
    ? `<ul class="hub-list">${d.upcoming.map((s) => sessionLine(s, { pending, actions: s.can_join
        ? `<a class="button button--primary button--small" href="#/together?session=${s.id}">Join now</a>`
        : `<a class="button button--quiet button--small" href="#/calendar?session=${s.id}">Details</a>` })).join('')}</ul>`
    : emptyState({ title: 'Nothing planned yet', body: 'Commit to a workout with a friend — people who plan together keep going.', action: '<a class="button button--primary button--small" href="#/calendar?new=scheduled">Schedule a workout</a>' });

  const streakFriends = d.friends.filter((f) => f.streak?.current || f.streak?.total_completed).slice(0, 4);
  const streakBody = streakFriends.length
    ? `<ul class="hub-list">${streakFriends.map((f) => `
        <li class="hub-row">${avatar(f, 'sm')}<div class="hub-row__text"><p class="hub-row__title"><strong>${escapeHtml(f.display_name)}</strong> ${streakBadge(f.streak)}</p>
        <p class="hub-row__meta">Longest ${f.streak.longest} · ${f.streak.total_completed} together${f.streak.next_milestone ? ` · next milestone ${f.streak.next_milestone}` : ''}</p></div></li>`).join('')}</ul>`
    : '<p class="muted">Complete a planned workout together to start your first buddy streak.</p>';

  const challengeItems = [...d.challenges.received, ...d.challenges.active].slice(0, 4);
  const challengeBody = challengeItems.length
    ? `<ul class="hub-list">${challengeItems.map((c) => `
        <li class="hub-row">${avatar(c.friend, 'sm')}<div class="hub-row__text">
          <p class="hub-row__title"><strong>${escapeHtml(c.summary)}</strong> with ${escapeHtml(c.friend?.first_name ?? '')}</p>
          <p class="hub-row__meta">${c.status === 'pending' ? 'Waiting for your answer' : `You ${c.my_progress}/${c.target} · ${escapeHtml(c.friend?.first_name ?? '')} ${c.friend_progress}/${c.target}`}</p></div>
          <div class="hub-row__actions"><a class="button button--quiet button--small" href="#/challenges">${c.awaiting_me ? 'Respond' : 'View'}</a></div></li>`).join('')}</ul>`
    : '<p class="muted">No challenges right now. <a class="text-link" href="#/challenges?new=1">Challenge a friend</a></p>';

  const friendsBody = d.friends.length
    ? `<ul class="hub-friends">${d.friends.slice(0, 8).map((f) => `
        <li class="hub-friend">
          ${personLine(f)}
          ${online.has(f.id) || f.online ? '<span class="hub-friend__online"><span class="presence-dot" aria-hidden="true"></span>Online</span>' : ''}
          <a class="button button--quiet button--small" href="#/calendar?new=instant&amp;with=${encodeURIComponent(f.username)}">Invite</a>
        </li>`).join('')}</ul>`
    : emptyState({ title: 'Find your first workout buddy', body: 'Search for a friend’s username to send a request.', action: '<a class="button button--primary button--small" href="#/buddies?tab=find">Find friends</a>' });

  const requests = d.requests.incoming.length
    ? `<p class="hub-note">${d.requests.incoming.length === 1 ? `${escapeHtml(d.requests.incoming[0].user.first_name)} wants to be your workout buddy.` : `${d.requests.incoming.length} people want to be your workout buddy.`} <a class="text-link" href="#/buddies?tab=requests">Respond</a></p>`
    : '';

  const recent = d.recent.length
    ? `<ul class="hub-list">${d.recent.map((s) => sessionLine(s, { pending, actions: `<span class="badge badge--${s.status === 'completed' ? 'success' : 'muted'}">${s.status === 'completed' ? 'Completed' : 'Not completed'}</span>` })).join('')}</ul>`
    : '<p class="muted">Workouts you do together appear here.</p>';

  const activity = d.activity.length
    ? `<ul class="hub-list">${d.activity.map((a) => `
        <li class="hub-row">${avatar(a.user, 'sm')}<div class="hub-row__text"><p class="hub-row__title"><strong>${escapeHtml(a.user.first_name)}</strong> completed ${escapeHtml(a.exercise_name)}</p>
        <p class="hub-row__meta"><time datetime="${escapeHtml(a.completed_at)}">${escapeHtml(relativeTime(a.completed_at))}</time></p></div></li>`).join('')}</ul>`
    : '<p class="muted">When your friends work out, you’ll see it here.</p>';

  return `
    ${header}
    ${notices}
    ${tabsMarkup}
    ${requests}
    ${quickActions(d, counts)}
    ${invitations ? card('Invitations for you', invitations, { href: '#/calendar?view=pending', linkLabel: 'All invitations' }) : ''}
    <div class="hub-grid">
      ${card('Upcoming workouts', upcoming, { href: '#/calendar?view=upcoming', linkLabel: 'Calendar' })}
      ${card('Buddy streaks', streakBody, { href: '#/buddies?tab=streaks', linkLabel: 'All streaks' })}
      ${card('Challenges', challengeBody, { href: '#/challenges', linkLabel: 'All challenges' })}
      ${card('Friends', friendsBody, { href: '#/buddies?tab=friends', linkLabel: 'Manage friends' })}
      ${card('Recent workouts together', recent, { href: '#/calendar?view=past', linkLabel: 'History' })}
      ${card('Friends’ activity', activity)}
    </div>
    ${streakRulesMarkup()}`;
}

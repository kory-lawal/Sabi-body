/** #/notifications — the in-app notification centre and its preferences. */
import { avatar, busyAttrs, emptyState, errorState, escapeHtml, loadingState, notice, pageHeader, relativeTime } from './components.js';

const EXERCISE_NAMES = {
  squats: 'squats', 'jumping-jacks': 'jumping jacks', plank: 'plank', 'push-ups': 'push-ups', 'sit-ups': 'sit-ups',
  lunges: 'lunges', 'high-knees': 'high knees',
};

function whenText(iso) {
  if (!iso) return 'a scheduled day';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function exerciseLabel(id) {
  return EXERCISE_NAMES[id] ?? 'workout';
}

/** Plain-language text and destination for one notification. */
export function describeNotification(n) {
  const who = n.actor?.first_name || n.actor?.display_name || 'A friend';
  const p = n.payload ?? {};
  switch (n.type) {
    case 'friend_request':
      return { text: `${who} sent you a friend request.`, href: '#/buddies?tab=requests' };
    case 'friend_accepted':
      return { text: `${who} accepted your friend request. Time to plan a workout together!`, href: '#/buddies' };
    case 'message':
      return { text: `${who} sent you ${p.count > 1 ? `${p.count} messages` : 'a message'}.`, href: `#/messages?with=${encodeURIComponent(n.actor?.username ?? '')}` };
    case 'workout_invite':
      return p.mode === 'instant'
        ? { text: `${who} wants to do ${exerciseLabel(p.exercise_id)} with you now.`, href: `#/calendar?session=${n.entity_id}` }
        : { text: `${who} invited you to ${exerciseLabel(p.exercise_id)} on ${whenText(p.scheduled_at)}.`, href: `#/calendar?session=${n.entity_id}` };
    case 'invite_response':
      return { text: `${who} ${p.response === 'accepted' ? 'accepted' : p.response === 'countered' ? 'suggested a new time for' : 'declined'} your ${exerciseLabel(p.exercise_id)} workout.`, href: `#/calendar?session=${n.entity_id}` };
    case 'session_update':
      return { text: p.change === 'cancelled' ? `${who} cancelled your ${exerciseLabel(p.exercise_id)} workout.` : `${who} moved your ${exerciseLabel(p.exercise_id)} workout to ${whenText(p.scheduled_at)}.`, href: `#/calendar?session=${n.entity_id}` };
    case 'workout_reminder':
      return { text: p.kind === 'start' ? `It’s time for your ${exerciseLabel(p.exercise_id)} workout with ${who}!` : `Your ${exerciseLabel(p.exercise_id)} workout with ${who} starts ${p.kind === '24h' ? 'tomorrow' : 'in one hour'}.`, href: `#/calendar?session=${n.entity_id}` };
    case 'missed_commitment':
      return { text: `Your ${exerciseLabel(p.exercise_id)} workout with ${who} was missed. Plan the next one to start a new streak.`, href: '#/calendar' };
    case 'streak_milestone':
      return { text: `You and ${who} reached ${p.level} shared workouts! Keep showing up for each other.`, href: '#/buddies' };
    case 'challenge':
      return { text: challengeText(who, p), href: `#/challenges?id=${n.entity_id}` };
    case 'encouragement':
      return { text: `${who}: “${p.text ?? 'Keep going!'}”`, href: `#/messages?with=${encodeURIComponent(n.actor?.username ?? '')}` };
    default:
      return { text: 'You have a new update.', href: '#/notifications' };
  }
}

function challengeText(who, p) {
  switch (p.event) {
    case 'accepted': return `${who} accepted your ${exerciseLabel(p.exercise_id)} challenge. Game on!`;
    case 'declined': return `${who} declined your ${exerciseLabel(p.exercise_id)} challenge.`;
    case 'completed': return `${p.winner_is_you ? 'You' : who} completed the ${exerciseLabel(p.exercise_id)} challenge first!`;
    case 'expired': return `Your ${exerciseLabel(p.exercise_id)} challenge with ${who} has ended.`;
    default: return `${who} challenged you: ${p.summary ?? exerciseLabel(p.exercise_id)}.`;
  }
}

function notificationItem(n) {
  const { text, href } = describeNotification(n);
  return `
    <li class="notification${n.read ? '' : ' is-unread'}">
      <a class="notification__link" href="${escapeHtml(href)}" data-buddy-action="open-notification" data-id="${escapeHtml(n.id)}">
        ${n.actor ? avatar(n.actor, 'sm') : '<span class="avatar avatar--sm" aria-hidden="true">SB</span>'}
        <span class="notification__text">${escapeHtml(text)}</span>
        <time class="notification__time" datetime="${escapeHtml(n.created_at)}">${escapeHtml(relativeTime(n.created_at))}</time>
        ${n.read ? '' : '<span class="visually-hidden">(unread)</span><span class="notification__dot" aria-hidden="true"></span>'}
      </a>
    </li>`;
}

function preferencesForm(prefs, pending) {
  if (!prefs) {
    return loadingState('Loading notification settings…');
  }
  return `
    <form class="form" data-buddy-form="notification-preferences" novalidate>
      <fieldset class="pref-list">
        <legend class="visually-hidden">Show these in my notification centre</legend>
        ${prefs.preferences.map((p) => `
          <label class="switch-row">
            <span class="switch-row__text"><span class="switch-row__label">${escapeHtml(p.label)}</span>${p.email_supported ? '<span class="switch-row__description">In-app. Email reminders are below.</span>' : ''}</span>
            <span class="switch"><input type="checkbox" role="switch" name="inapp:${escapeHtml(p.type)}" ${p.in_app ? 'checked' : ''} /><span class="switch__track" aria-hidden="true"></span></span>
          </label>`).join('')}
      </fieldset>
      <h3 class="pref-heading">Email reminders for shared workouts</h3>
      <label class="switch-row">
        <span class="switch-row__text"><span class="switch-row__label">Email me before workouts with friends</span><span class="switch-row__description">One hour before and when it’s time to start.</span></span>
        <span class="switch"><input type="checkbox" role="switch" name="email:workout_reminder" ${prefs.preferences.find((p) => p.type === 'workout_reminder')?.email ? 'checked' : ''} /><span class="switch__track" aria-hidden="true"></span></span>
      </label>
      <label class="switch-row">
        <span class="switch-row__text"><span class="switch-row__label">Also remind me the day before</span><span class="switch-row__description">An extra email 24 hours ahead.</span></span>
        <span class="switch"><input type="checkbox" role="switch" name="buddy_reminder_24h" ${prefs.buddy_reminder_24h ? 'checked' : ''} /><span class="switch__track" aria-hidden="true"></span></span>
      </label>
      <p class="field__hint">To silence one friend, open <a class="text-link" href="#/buddies">Friends</a> → More options → Mute.</p>
      <button class="button button--primary" type="submit"${busyAttrs(pending === 'notification-preferences')}>Save notification settings</button>
    </form>`;
}

export function renderNotificationsPage({ items, unread, loading, error, prefs, pending, message, failure, hasMore }) {
  let list;
  if (error && !items) {
    list = errorState(error);
  } else if (!items) {
    list = loadingState('Loading notifications…');
  } else if (!items.length) {
    list = emptyState({ title: 'You’re all caught up', body: 'Friend requests, invitations and reminders will appear here.' });
  } else {
    list = `<ul class="notification-list">${items.map(notificationItem).join('')}</ul>
      ${hasMore ? `<button class="button button--quiet" type="button" data-buddy-action="more-notifications"${busyAttrs(loading)}>Show older</button>` : ''}`;
  }
  return `
    ${pageHeader({
      title: 'Notifications',
      actions: unread ? `<button class="button button--quiet button--small" type="button" data-buddy-action="read-all"${busyAttrs(pending === 'read-all')}>Mark all as read</button>` : '',
    })}
    ${notice(message, 'success')}
    ${notice(failure)}
    <section class="card" aria-label="Notifications">${list}</section>
    <section class="card" aria-labelledby="notif-prefs-title">
      <h2 id="notif-prefs-title">Notification settings</h2>
      ${preferencesForm(prefs, pending)}
    </section>`;
}

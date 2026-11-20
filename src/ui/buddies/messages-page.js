/** #/messages — private chat with friends, exercise cards and encouragement. */
import { EXERCISES } from '../exercise-content.js';
import {
  avatar,
  busyAttrs,
  emptyState,
  errorState,
  escapeHtml,
  loadingState,
  notice,
  pageHeader,
  personLine,
  relativeTime,
} from './components.js';
import { connectionNotice } from './friends-page.js';

export const NUDGES = [
  ['remind_today', 'Don’t forget your workout today!'],
  ['waiting', 'Your workout partner is waiting for you.'],
  ['lets_finish', 'Let’s finish our workout today!'],
  ['milestone', 'One more workout to reach our next milestone!'],
  ['you_got_this', 'You’ve got this — keep going!'],
  ['upcoming', 'Don’t forget our workout together later!'],
];

export function exerciseTargetLabel(exerciseId, target) {
  return exerciseId === 'plank' ? `${target} seconds` : `${target} reps`;
}

/** A shareable exercise card. Contains catalogue information only — never workout records. */
export function exerciseCardMarkup({ exercise_id: exerciseId, target }, { actions = true, invite = false, username = '' } = {}) {
  const exercise = EXERCISES[exerciseId];
  if (!exercise) {
    return '<p class="muted">This exercise is no longer available.</p>';
  }
  return `
    <article class="exercise-card-msg">
      <img class="exercise-card-msg__image" src="${escapeHtml(exercise.media.src)}" alt="${escapeHtml(exercise.media.alt)}" loading="lazy" width="320" height="200" />
      <div class="exercise-card-msg__body">
        <p class="exercise-card-msg__name">${escapeHtml(exercise.name)}</p>
        <p class="exercise-card-msg__desc">${escapeHtml(exercise.description)}</p>
        <p class="exercise-card-msg__target">Suggested target: <strong>${escapeHtml(exerciseTargetLabel(exerciseId, target))}</strong></p>
        ${actions ? `
        <div class="exercise-card-msg__actions">
          <button class="button button--primary button--small" type="button" data-action="choose-exercise" data-exercise="${escapeHtml(exerciseId)}" data-target="${escapeHtml(target)}">Start exercise</button>
          ${invite ? `<a class="button button--quiet button--small" href="#/calendar?new=instant&amp;with=${encodeURIComponent(username)}&amp;exercise=${encodeURIComponent(exerciseId)}&amp;target=${encodeURIComponent(target)}">Do it together</a>` : ''}
        </div>` : ''}
      </div>
    </article>`;
}

function preview(message, meId) {
  if (!message) return '';
  const mine = message.sender_id === meId ? 'You: ' : '';
  switch (message.kind) {
    case 'exercise_card': return `${mine}Shared ${message.payload?.exercise_name ?? 'an exercise'}`;
    case 'nudge': return `${mine}${message.body}`;
    case 'invitation': return `${mine}Workout invitation`;
    case 'scheduled_workout': return `${mine}Scheduled a workout`;
    default: return `${mine}${message.body}`;
  }
}

function conversationList({ conversations, friends, me, activeUsername, online }) {
  const known = new Set((conversations ?? []).map((c) => c.with_user.username));
  const others = (friends ?? []).filter((f) => !known.has(f.username));
  const items = (conversations ?? []).map((c) => `
    <li>
      <a class="convo${c.with_user.username === activeUsername ? ' is-active' : ''}" href="#/messages?with=${encodeURIComponent(c.with_user.username)}"${c.with_user.username === activeUsername ? ' aria-current="page"' : ''}>
        ${avatar(c.with_user, 'sm')}
        <span class="convo__text">
          <span class="convo__name">${escapeHtml(c.with_user.display_name)}${online?.has(c.with_user.id) ? ' <span class="presence-dot" aria-label="online"></span>' : ''}</span>
          <span class="convo__preview">${escapeHtml(preview(c.last_message, me?.id))}</span>
        </span>
        <span class="convo__side">
          <time datetime="${escapeHtml(c.last_message?.created_at ?? '')}">${escapeHtml(relativeTime(c.last_message?.created_at))}</time>
          ${c.unread ? `<span class="count-pill" aria-label="${c.unread} unread">${c.unread}</span>` : ''}
        </span>
      </a>
    </li>`).join('');
  const start = others.length ? `
    <p class="convo-heading">Start a chat</p>
    <ul class="convo-list">${others.map((f) => `
      <li><a class="convo" href="#/messages?with=${encodeURIComponent(f.username)}">${avatar(f, 'sm')}<span class="convo__text"><span class="convo__name">${escapeHtml(f.display_name)}</span><span class="convo__preview">@${escapeHtml(f.username)}</span></span></a></li>`).join('')}
    </ul>` : '';
  if (!items && !start) {
    return emptyState({ title: 'No conversations yet', body: 'Add a friend first, then you can chat, share exercises and cheer each other on.', action: '<a class="button button--primary" href="#/buddies?tab=find">Find friends</a>' });
  }
  return `${items ? `<ul class="convo-list">${items}</ul>` : ''}${start}`;
}

function bubble(message, { meId, friend, seenAt, isLastMine, features = {} }) {
  const mine = message.sender_id === meId;
  let content;
  switch (message.kind) {
    case 'exercise_card':
      content = `${message.body ? `<p class="bubble__text">${escapeHtml(message.body)}</p>` : ''}${exerciseCardMarkup(message.payload, { invite: Boolean(features.together), username: friend?.username })}`;
      break;
    case 'nudge':
      content = `<p class="bubble__nudge"><span aria-hidden="true">💪</span> ${escapeHtml(message.body)}</p>`;
      break;
    case 'invitation':
    case 'scheduled_workout':
      content = `<p class="bubble__text">${escapeHtml(message.body)}</p>
        <a class="button button--quiet button--small" href="#/calendar?session=${encodeURIComponent(message.payload?.session_id ?? '')}">View workout</a>`;
      break;
    default:
      content = `<p class="bubble__text">${escapeHtml(message.body)}</p>`;
  }
  const status = message.failed
    ? `<button class="text-button bubble__retry" type="button" data-buddy-action="retry-message" data-id="${escapeHtml(message.client_msg_id)}">Not sent — tap to retry</button>`
    : message.pending
      ? '<span class="bubble__meta">Sending…</span>'
      : `<span class="bubble__meta"><time datetime="${escapeHtml(message.created_at)}">${escapeHtml(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(message.created_at)))}</time>${mine && isLastMine && seenAt && seenAt >= message.created_at ? ' · Seen' : ''}</span>`;
  return `
    <li class="bubble ${mine ? 'bubble--mine' : 'bubble--theirs'}${message.kind !== 'text' ? ` bubble--${message.kind}` : ''}">
      ${content}
      ${status}
    </li>`;
}

function dayLabel(iso) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short' }).format(date);
}

function threadMarkup(thread, { me, online, pending, features }) {
  if (thread.error) {
    return errorState(thread.error, 'retry-thread');
  }
  if (!thread.friend) {
    return loadingState('Opening conversation…');
  }
  const friend = thread.friend;
  const lastMine = [...(thread.messages ?? [])].reverse().find((m) => m.sender_id === me?.id && !m.pending);
  let lastDay = '';
  const items = (thread.messages ?? []).map((m) => {
    const day = dayLabel(m.created_at);
    const divider = day !== lastDay ? `<li class="chat-day" aria-hidden="false"><span>${escapeHtml(day)}</span></li>` : '';
    lastDay = day;
    return divider + bubble(m, { meId: me?.id, friend, seenAt: thread.otherReadAt, isLastMine: m === lastMine, features });
  }).join('');
  const typing = thread.typingUntil && thread.typingUntil > Date.now()
    ? `<p class="chat-typing" aria-live="polite">${escapeHtml(friend.first_name)} is typing…</p>` : '';
  const tools = thread.canSend ? `
    <div class="chat-tools">
      <details class="chat-tool">
        <summary>Encourage</summary>
        <div class="chat-tool__panel">
          ${NUDGES.map(([id, text]) => `<button class="chip" type="button" data-buddy-action="nudge" data-id="${id}"${busyAttrs(pending === `nudge:${id}`)}>${escapeHtml(text)}</button>`).join('')}
          <p class="field__hint">Sends a friendly reminder. You can nudge each friend once every 4 hours.</p>
        </div>
      </details>
      <details class="chat-tool">
        <summary>Share an exercise</summary>
        <form class="chat-tool__panel form" data-buddy-form="share-exercise" novalidate>
          <div class="field field--compact">
            <label class="field__label" for="chat-share-exercise">Exercise</label>
            <select class="field__input" id="chat-share-exercise" name="exercise_id">
              ${Object.entries(EXERCISES).map(([id, ex]) => `<option value="${id}">${escapeHtml(ex.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field field--compact">
            <label class="field__label" for="chat-share-target">Suggested target (reps, or seconds for plank)</label>
            <input class="field__input" id="chat-share-target" name="target" type="number" min="1" max="3600" value="20" />
          </div>
          <button class="button button--primary button--small" type="submit"${busyAttrs(pending === 'share-exercise')}>Send exercise</button>
        </form>
      </details>
      ${features.together ? `<a class="chat-tool__link" href="#/calendar?new=instant&amp;with=${encodeURIComponent(friend.username)}">Invite to work out</a>` : ''}
    </div>` : '';
  const composer = thread.canSend ? `
    <form class="chat-composer" data-buddy-form="send-message" novalidate>
      <label class="visually-hidden" for="chat-input">Message ${escapeHtml(friend.first_name)}</label>
      <textarea class="chat-composer__input" id="chat-input" name="body" rows="1" maxlength="2000" placeholder="Message ${escapeHtml(friend.first_name)}…" data-chat-input></textarea>
      <button class="button button--primary" type="submit">Send</button>
    </form>` : '<p class="chat-locked">You can only message people who are your friends.</p>';
  return `
    <div class="chat-thread-wrap">
      <header class="chat-header">
        <a class="chat-back" href="#/messages" aria-label="Back to conversations">←</a>
        ${personLine(friend)}
        ${online?.has(friend.id) ? '<span class="chat-header__online"><span class="presence-dot" aria-hidden="true"></span>Online</span>' : ''}
      </header>
      ${thread.hasMore ? `<button class="button button--quiet button--small chat-older" type="button" data-buddy-action="older-messages"${busyAttrs(thread.loading)}>Load earlier messages</button>` : ''}
      <ol class="chat-thread" data-chat-thread aria-live="polite" aria-label="Conversation with ${escapeHtml(friend.display_name)}">
        ${items || `<li class="chat-empty">Say hi to ${escapeHtml(friend.first_name)} and plan your next workout together.</li>`}
      </ol>
      ${typing}
      ${tools}
      ${composer}
    </div>`;
}

function sharePicker(share, { friends, pending }) {
  const exercise = EXERCISES[share.exerciseId];
  if (!exercise) return '';
  return `
    <section class="card share-picker" aria-labelledby="share-title">
      <h2 id="share-title">Send ${escapeHtml(exercise.name)} to a friend</h2>
      ${exerciseCardMarkup({ exercise_id: share.exerciseId, target: share.target }, { actions: false })}
      ${friends?.length ? `
        <ul class="friend-list">${friends.map((f) => `
          <li class="friend-card">
            <div class="friend-card__main">${personLine(f)}</div>
            <div class="friend-card__actions"><button class="button button--primary button--small" type="button" data-buddy-action="share-card" data-id="${escapeHtml(f.id)}"${busyAttrs(pending === `share:${f.id}`)}>Send</button></div>
          </li>`).join('')}</ul>`
        : emptyState({ title: 'No friends yet', body: 'Add a friend to share exercises.', action: '<a class="button button--primary" href="#/buddies?tab=find">Find friends</a>' })}
    </section>`;
}

export function renderMessagesPage({ me, chat, friends, online, connection, pending, message, failure, share, features = {} }) {
  const thread = chat.thread;
  let body;
  if (chat.error && !chat.conversations) {
    body = errorState(chat.error);
  } else if (!chat.conversations) {
    body = loadingState('Loading your messages…');
  } else {
    body = `
      <div class="chat-layout${thread ? ' has-thread' : ''}">
        <aside class="chat-list card" aria-label="Conversations">${conversationList({ conversations: chat.conversations, friends, me, activeUsername: thread?.username, online })}</aside>
        <section class="chat-main card" aria-label="Conversation">${thread
          ? threadMarkup(thread, { me, online, pending, features })
          : '<div class="chat-placeholder"><p>Choose a friend to start chatting.</p></div>'}</section>
      </div>`;
  }
  return `
    ${pageHeader({ title: 'Messages', intro: thread ? '' : 'Chat with your workout buddies, share exercises and cheer each other on.' })}
    ${connectionNotice(connection)}
    ${notice(message, 'success')}
    ${notice(failure)}
    ${share ? sharePicker(share, { friends, pending }) : ''}
    ${body}`;
}

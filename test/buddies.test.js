import test from 'node:test';
import assert from 'node:assert/strict';

import { createBuddiesController } from '../src/ui/buddies/buddies-controller.js';
import { renderFriendsPage } from '../src/ui/buddies/friends-page.js';
import { describeNotification, renderNotificationsPage } from '../src/ui/buddies/notifications-page.js';
import { parseRoute } from '../src/ui/router.js';

const ada = { id: 'a1', username: 'adaobi', display_name: 'Ada Obi', first_name: 'Ada', initials: 'AO' };
const bola = { id: 'b1', username: 'bola', display_name: 'Bola <Ade>', first_name: 'Bola', initials: 'BA' };

function fakeApi(overrides = {}) {
  const calls = [];
  const api = {
    calls,
    friends: async () => ({ friends: [{ ...bola, friends_since: '2026-11-20T10:00:00Z', muted: false }], incoming: [], sent: [], blocked: [] }),
    search: async (q) => { calls.push(['search', q]); return { results: [{ ...bola, relationship: 'none' }] }; },
    sendRequest: async (username) => { calls.push(['send', username]); return { status: 'pending', user: bola }; },
    respondRequest: async (id, action) => { calls.push(['respond', id, action]); return {}; },
    removeFriend: async (id) => { calls.push(['remove', id]); },
    block: async (username) => { calls.push(['block', username]); },
    unreadCount: async () => ({ unread: 3 }),
    notifications: async () => ({ notifications: [], unread: 0, next_before: null }),
    notificationPreferences: async () => ({ preferences: [], buddy_reminder_24h: false }),
    markRead: async () => ({}),
    ...overrides,
  };
  return api;
}

function click(dataset) {
  return { target: { closest: () => ({ dataset }) } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('buddy routes are protected routes', () => {
  assert.equal(parseRoute('#/buddies?tab=find').name, 'buddies');
  assert.equal(parseRoute('#/notifications').name, 'notifications');
});

test('friends page escapes names and offers the right actions', () => {
  const html = renderFriendsPage({
    me: ada, tab: 'friends',
    data: { friends: [{ ...bola, friends_since: '2026-11-20T10:00:00Z', muted: true }], incoming: [{ request_id: 'r1', user: bola }], sent: [], blocked: [] },
  });
  assert.match(html, /@adaobi/);
  assert.match(html, /Bola &lt;Ade&gt;/);
  assert.doesNotMatch(html, /Bola <Ade>/);
  assert.match(html, /data-buddy-action="remove-friend"/);
  assert.match(html, /Unmute notifications/);
  assert.match(html, /count-pill[^>]*>1</); // incoming request badge
  // Features that are not built yet must not appear as dead buttons.
  assert.doesNotMatch(html, /Work out together/);
});

test('empty friends list invites the user to find friends', () => {
  const html = renderFriendsPage({ me: ada, tab: 'friends', data: { friends: [], incoming: [], sent: [], blocked: [] } });
  assert.match(html, /Find your first workout buddy/);
});

test('search results show add, sent and friends states', () => {
  const html = renderFriendsPage({
    me: ada, tab: 'find', data: null,
    search: { q: 'bo', results: [{ ...bola, relationship: 'none' }, { ...ada, username: 'bob', relationship: 'outgoing' }] },
  });
  assert.match(html, /data-buddy-action="send-request" data-username="bola"/);
  assert.match(html, /Request sent/);
});

test('controller sends a request and requires confirmation before removing a friend', async () => {
  const api = fakeApi();
  const controller = createBuddiesController({ buddiesApi: api, getUser: () => ada });
  let renders = 0;
  controller.setChangeListener(() => { renders += 1; });
  controller.load({ name: 'buddies', params: {} });
  await flush();

  assert.equal(controller.handleClick(click({ buddyAction: 'send-request', username: 'bola' })), true);
  await flush();
  await flush();
  assert.deepEqual(api.calls.find((c) => c[0] === 'send'), ['send', 'bola']);
  assert.match(controller.render('buddies', {}), /Friend request sent to @bola/);

  controller.handleClick(click({ buddyAction: 'remove-friend', id: 'b1' }));
  assert.equal(api.calls.some((c) => c[0] === 'remove'), false, 'first click only asks for confirmation');
  assert.match(controller.render('buddies', {}), /Yes, remove/);
  controller.handleClick(click({ buddyAction: 'remove-friend', id: 'b1', confirmed: 'true' }));
  await flush();
  assert.equal(api.calls.some((c) => c[0] === 'remove'), true);
  assert.ok(renders > 0);
});

test('controller shows API errors instead of failing silently', async () => {
  const api = fakeApi({ sendRequest: async () => { throw new Error('You can send this person another request in a few days.'); } });
  const controller = createBuddiesController({ buddiesApi: api, getUser: () => ada });
  controller.handleClick(click({ buddyAction: 'send-request', username: 'bola' }));
  await flush();
  assert.match(controller.render('buddies', { tab: 'find' }), /another request in a few days/);
});

test('unread notification count loads for the nav badge', async () => {
  const controller = createBuddiesController({ buddiesApi: fakeApi(), getUser: () => ada });
  await controller.refreshCounts();
  assert.equal(controller.counts().notifications, 3);
});

test('notifications describe themselves and link to the right page', () => {
  assert.deepEqual(describeNotification({ type: 'friend_request', actor: bola }), {
    text: 'Bola sent you a friend request.', href: '#/buddies?tab=requests',
  });
  const html = renderNotificationsPage({
    items: [{ id: 'n1', type: 'friend_accepted', actor: bola, read: false, created_at: new Date().toISOString() }],
    unread: 1, prefs: { preferences: [{ type: 'friend_request', label: 'Friend requests', in_app: true }], buddy_reminder_24h: true },
  });
  assert.match(html, /is-unread/);
  assert.match(html, /Mark all as read/);
  assert.match(html, /name="buddy_reminder_24h" checked/);
});

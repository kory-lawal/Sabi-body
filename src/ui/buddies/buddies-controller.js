/**
 * SabiBody Buddies pages (#/buddies, #/notifications, …). Plugs into the
 * account controller: it renders inside the same page shell, uses the same
 * authenticated API client and asks the shell to re-render through changed().
 */
import { FRIEND_TABS, renderFriendsPage } from './friends-page.js';
import { CALENDAR_VIEWS, isoDate, monthGridRange, parseIsoDate, renderCalendarPage, weekRange } from './calendar-page.js';
import { deadlineFromPreset, renderChallengesPage } from './challenges-page.js';
import { renderBuddiesDashboard } from './dashboard-page.js';
import { renderMessagesPage } from './messages-page.js';
import { renderNotificationsPage } from './notifications-page.js';

export const BUDDY_ROUTES = new Set(['buddies', 'notifications', 'messages', 'calendar', 'challenges']);

function emptyCalendar() {
  return {
    view: 'month', date: '', range: { key: '', sessions: null, error: '' },
    lists: { upcoming: null, pending: null, past: null, cancelled: null },
    selected: null, form: { open: false, values: {}, error: '' },
  };
}

function localDateTimeIso(date, time) {
  const [y, m, d] = String(date).split('-').map(Number);
  const [hh, mm] = String(time).split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

function clientId() {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `c${random.replaceAll('-', '')}`.slice(0, 40);
}

function describe(error) {
  return error?.message || 'Something went wrong. Please try again.';
}

export function createBuddiesController({ buddiesApi, getUser, refreshUser = async () => {}, view = globalThis,
  features = {}, realtime = null }) {
  let changed = () => {};
  let route = { name: '', params: {} };
  let searchTimer = null;
  let searchSeq = 0;

  const state = {
    friends: { data: null, loading: false, error: '' },
    search: { q: '', results: null, loading: false, error: '' },
    profile: null,
    notifications: { items: null, unread: 0, loading: false, error: '', prefs: null, hasMore: false },
    counts: { notifications: 0, requests: 0, messages: 0, invites: 0, challenges: 0 },
    calendar: emptyCalendar(),
    streaks: { streaks: null, error: '' },
    dashboard: { data: null, error: '' },
    waiting: null,
    challenges: { data: null, error: '', form: { open: false, values: {}, error: '' } },
    chat: { conversations: null, unread: 0, loading: false, error: '', thread: null },
    share: null,
    online: new Set(),
    connection: 'idle',
    confirm: '',
    pending: '',
    message: '',
    failure: '',
  };

  function setMessage(message = '', failure = '') {
    state.message = message;
    state.failure = failure;
  }

  // ------------------------------------------------------------ loading
  async function loadFriends({ quiet = false } = {}) {
    const page = state.friends;
    if (!quiet) {
      page.loading = true;
      page.error = '';
      changed();
    }
    try {
      page.data = await buddiesApi.friends();
      state.counts.requests = page.data.incoming.length;
    } catch (error) {
      page.error = describe(error);
    } finally {
      page.loading = false;
      changed();
    }
  }

  async function loadProfile(username) {
    if (!username) {
      state.profile = null;
      return;
    }
    try {
      state.profile = await buddiesApi.profile(username);
    } catch {
      state.profile = null;
    }
    changed();
  }

  async function runSearch(q) {
    const search = state.search;
    search.q = q;
    const seq = ++searchSeq;
    if (q.trim().replace(/^@/, '').length < 2) {
      Object.assign(search, { results: q.trim() ? [] : null, loading: false, error: '' });
      changed();
      return;
    }
    search.loading = true;
    changed();
    try {
      const { results } = await buddiesApi.search(q.trim());
      if (seq === searchSeq) {
        Object.assign(search, { results, error: '' });
      }
    } catch (error) {
      if (seq === searchSeq) {
        search.error = describe(error);
      }
    } finally {
      if (seq === searchSeq) {
        search.loading = false;
        changed();
      }
    }
  }

  async function loadNotifications({ append = false } = {}) {
    const page = state.notifications;
    page.loading = true;
    page.error = '';
    changed();
    try {
      const before = append ? page.items?.at(-1)?.created_at : undefined;
      const result = await buddiesApi.notifications(before);
      page.items = append ? [...(page.items ?? []), ...result.notifications] : result.notifications;
      page.unread = result.unread;
      page.hasMore = Boolean(result.next_before);
      state.counts.notifications = result.unread;
    } catch (error) {
      page.error = describe(error);
    } finally {
      page.loading = false;
      changed();
    }
    if (!page.prefs) {
      try {
        page.prefs = await buddiesApi.notificationPreferences();
        changed();
      } catch {
        /* the list is still usable without preferences */
      }
    }
  }

  async function refreshCounts() {
    // Each count is best effort and independent of the other.
    const [notes, messages] = await Promise.allSettled([buddiesApi.unreadCount(), buddiesApi.unreadMessages?.()]);
    if (notes.status === 'fulfilled') state.counts.notifications = notes.value.unread;
    if (messages.status === 'fulfilled' && messages.value) state.counts.messages = messages.value.unread;
    void loadInvites();
    if (buddiesApi.challenges) void loadChallenges();
    changed();
  }

  async function loadChallenges() {
    try {
      state.challenges.data = await buddiesApi.challenges();
      state.challenges.error = '';
      state.counts.challenges = state.challenges.data.pending.filter((c) => c.awaiting_me).length;
    } catch (error) {
      state.challenges.error = describe(error);
    }
    changed();
  }

  async function loadDashboard() {
    if (!buddiesApi.dashboard) return;
    try {
      const data = await buddiesApi.dashboard();
      state.dashboard = { data, error: '' };
      state.counts.requests = data.requests.incoming.length;
      state.counts.invites = data.invitations.length;
      state.counts.messages = data.unread.messages;
      state.counts.notifications = data.unread.notifications;
      state.counts.challenges = data.challenges.received.length;
    } catch (error) {
      state.dashboard.error = describe(error);
    }
    changed();
  }

  function onDashboard() {
    return route.name === 'buddies' && !route.params.tab;
  }

  async function loadStreaks() {
    try {
      const { streaks } = await buddiesApi.streaks();
      state.streaks = { streaks, error: '' };
    } catch (error) {
      state.streaks.error = describe(error);
    }
    changed();
  }

  // ------------------------------------------------------------ calendar
  async function loadInvites() {
    try {
      const { sessions } = await buddiesApi.sessions?.({ view: 'pending' }) ?? { sessions: null };
      if (!sessions) return;
      state.calendar.lists.pending = sessions;
      state.counts.invites = sessions.filter((s) => s.awaiting_me).length;
      changed();
    } catch {
      /* best effort */
    }
  }

  async function loadCalendarData() {
    const cal = state.calendar;
    if (cal.view === 'month' || cal.view === 'week') {
      const anchor = parseIsoDate(cal.date);
      const { start, end } = cal.view === 'month' ? monthGridRange(anchor) : weekRange(anchor);
      const key = `${start.toISOString()}|${end.toISOString()}`;
      if (cal.range.key !== key) cal.range = { key, sessions: null, error: '' };
      changed();
      try {
        const { sessions } = await buddiesApi.sessions({ from: start.toISOString(), to: end.toISOString() });
        if (cal.range.key === key) cal.range.sessions = sessions;
      } catch (error) {
        if (cal.range.key === key) cal.range.error = describe(error);
      }
    } else {
      try {
        const { sessions } = await buddiesApi.sessions({ view: cal.view });
        cal.lists[cal.view] = sessions;
      } catch (error) {
        setMessage('', describe(error));
      }
    }
    changed();
  }

  async function loadSelected(sessionId) {
    const cal = state.calendar;
    if (!sessionId) {
      cal.selected = null;
      return;
    }
    if (cal.selected?.id !== sessionId) cal.selected = { id: sessionId, session: null, error: '' };
    changed();
    try {
      const { session } = await buddiesApi.session(sessionId);
      if (cal.selected?.id === sessionId) cal.selected.session = session;
    } catch (error) {
      if (cal.selected?.id === sessionId) cal.selected.error = describe(error);
    }
    changed();
  }

  function refreshCalendar() {
    void loadInvites();
    if (onDashboard()) void loadDashboard();
    if (route.name === 'calendar') {
      void loadCalendarData();
      if (state.calendar.selected) void loadSelected(state.calendar.selected.id);
    }
  }

  async function sessionAction(sessionId, work, success) {
    await act(`session:${sessionId}`, async () => {
      const { session } = await work();
      if (state.calendar.selected?.id === sessionId) state.calendar.selected.session = session;
      refreshCalendar();
      return session;
    }, success);
  }

  // ------------------------------------------------------------ chat
  async function loadConversations({ quiet = false } = {}) {
    const chat = state.chat;
    if (!quiet) {
      chat.loading = true;
      chat.error = '';
      changed();
    }
    try {
      const result = await buddiesApi.conversations();
      chat.conversations = result.conversations;
      state.counts.messages = result.unread;
    } catch (error) {
      chat.error = describe(error);
    } finally {
      chat.loading = false;
      changed();
    }
  }

  async function resolveFriend(username) {
    const fromFriends = state.friends.data?.friends?.find((f) => f.username === username);
    if (fromFriends) return fromFriends;
    const fromChats = state.chat.conversations?.find((c) => c.with_user.username === username)?.with_user;
    if (fromChats) return fromChats;
    return (await buddiesApi.profile(username)).user;
  }

  let scrollThread = false;

  async function openThread(username) {
    const chat = state.chat;
    if (chat.thread?.username === username && chat.thread.friend) {
      markThreadRead();
      return;
    }
    chat.thread = { username, friend: null, messages: [], canSend: false, otherReadAt: null, hasMore: false,
      loading: true, error: '', typingUntil: 0 };
    changed();
    try {
      const friend = await resolveFriend(username);
      const result = await buddiesApi.messages(friend.id);
      if (chat.thread?.username !== username) return;
      Object.assign(chat.thread, {
        friend: result.with_user, messages: result.messages, canSend: result.can_send,
        otherReadAt: result.other_read_at, hasMore: result.has_more, loading: false,
      });
      scrollThread = true;
      markThreadRead();
    } catch (error) {
      if (chat.thread?.username === username) {
        Object.assign(chat.thread, { loading: false, error: describe(error) });
      }
    }
    changed();
  }

  async function olderMessages() {
    const thread = state.chat.thread;
    if (!thread?.friend || thread.loading) return;
    thread.loading = true;
    changed();
    try {
      const result = await buddiesApi.messages(thread.friend.id, thread.messages[0]?.created_at);
      thread.messages = [...result.messages, ...thread.messages];
      thread.hasMore = result.has_more;
    } catch (error) {
      setMessage('', describe(error));
    } finally {
      thread.loading = false;
      changed();
    }
  }

  let readTimer = null;
  function markThreadRead() {
    const thread = state.chat.thread;
    if (!thread?.friend || route.name !== 'messages' || view?.document?.visibilityState === 'hidden') return;
    clearTimeout(readTimer);
    readTimer = setTimeout(async () => {
      const convo = state.chat.conversations?.find((c) => c.with_user.id === thread.friend.id);
      if (convo) convo.unread = 0;
      try {
        const result = realtime?.status() === 'open'
          ? await realtime.request('chat.read', { friend_id: thread.friend.id })
          : await buddiesApi.markConversationRead(thread.friend.id);
        state.counts.messages = result.unread ?? state.counts.messages;
      } catch {
        /* read receipts are best effort */
      }
      changed();
    }, 150);
  }

  async function deliver(friendId, payload) {
    if (realtime?.status() === 'open') {
      return realtime.request('chat.send', { friend_id: friendId, ...payload });
    }
    return buddiesApi.sendMessage(friendId, payload);
  }

  function mergeMessage(thread, message) {
    const index = thread.messages.findIndex((m) => m.id === message.id
      || (m.client_msg_id && m.client_msg_id === message.client_msg_id));
    if (index >= 0) thread.messages[index] = message;
    else thread.messages.push(message);
  }

  async function sendChat(payload) {
    const thread = state.chat.thread;
    if (!thread?.friend) return;
    const me = getUser();
    const optimistic = {
      id: `tmp-${payload.client_msg_id}`, client_msg_id: payload.client_msg_id, sender_id: me?.id, kind: payload.kind,
      body: payload.body, payload: payload.payload ?? {}, created_at: new Date().toISOString(), pending: true,
    };
    mergeMessage(thread, optimistic);
    scrollThread = true;
    changed();
    try {
      const result = await deliver(thread.friend.id, payload);
      mergeMessage(thread, result.message);
    } catch (error) {
      mergeMessage(thread, { ...optimistic, pending: false, failed: true, retry: payload });
      setMessage('', describe(error));
    }
    changed();
  }

  function onChatMessage(data) {
    const message = data.message;
    const me = getUser();
    const withUser = data.with_user;
    const thread = state.chat.thread;
    const fromFriend = message.sender_id !== me?.id;
    const threadOpen = thread?.friend?.id === withUser && route.name === 'messages';
    if (thread?.friend && thread.friend.id === withUser) {
      mergeMessage(thread, message);
      thread.typingUntil = 0;
      scrollThread = true;
      if (fromFriend) markThreadRead();
    }
    if (fromFriend && !threadOpen) {
      state.counts.messages += 1;
    }
    const convo = state.chat.conversations?.find((c) => c.with_user.id === withUser);
    if (convo) {
      convo.last_message = message;
      if (fromFriend && !threadOpen) convo.unread += 1;
      state.chat.conversations = [convo, ...state.chat.conversations.filter((c) => c !== convo)];
    } else if (state.chat.conversations) {
      void loadConversations({ quiet: true });
    }
    changed();
  }

  function load(nextRoute) {
    const previous = route;
    route = nextRoute;
    if (previous.name !== route.name) {
      setMessage();
      state.confirm = '';
    }
    switch (route.name) {
      case 'buddies': {
        void loadFriends({ quiet: Boolean(state.friends.data) });
        if (!route.params.tab) void loadDashboard();
        if (route.params.tab === 'streaks') void loadStreaks();
        if (route.params.tab === 'find') {
          void loadProfile(route.params.view);
        }
        break;
      }
      case 'notifications':
        void loadNotifications();
        break;
      case 'calendar': {
        const cal = state.calendar;
        cal.view = CALENDAR_VIEWS.includes(route.params.view) ? route.params.view : 'month';
        cal.date = route.params.date || isoDate(new Date());
        if (route.params.new) {
          const keep = cal.form.open ? cal.form.values : {};
          cal.form = {
            open: true, error: '',
            values: { ...keep, mode: route.params.new === 'scheduled' ? 'scheduled' : 'instant', with: route.params.with,
              exercise_id: route.params.exercise ?? keep.exercise_id, target: route.params.target ?? keep.target },
          };
        } else {
          cal.form = { open: false, values: {}, error: '' };
        }
        if (!state.friends.data) void loadFriends({ quiet: true });
        void loadSelected(route.params.session);
        void loadCalendarData();
        void loadInvites();
        break;
      }
      case 'challenges': {
        const page = state.challenges;
        if (route.params.new) {
          page.form = { open: true, error: '', values: { ...page.form.values, with: route.params.with, metric: route.params.metric } };
        } else {
          page.form = { open: false, values: {}, error: '' };
        }
        if (!state.friends.data) void loadFriends({ quiet: true });
        void loadChallenges();
        break;
      }
      case 'messages': {
        void loadConversations({ quiet: Boolean(state.chat.conversations) });
        if (!state.friends.data) void loadFriends({ quiet: true });
        const shareId = route.params.share;
        state.share = shareId ? { exerciseId: shareId, target: Number(route.params.target) || 20 } : null;
        if (route.params.with) void openThread(route.params.with);
        else state.chat.thread = null;
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------ actions
  async function act(key, action, success) {
    if (state.pending) {
      return;
    }
    state.pending = key;
    setMessage();
    changed();
    try {
      const result = await action();
      setMessage(typeof success === 'function' ? success(result) : success ?? '', '');
      state.confirm = '';
    } catch (error) {
      setMessage('', describe(error));
    } finally {
      state.pending = '';
      changed();
    }
  }

  function needsConfirm(target, key) {
    if (target.dataset.confirmed === 'true') {
      return false;
    }
    state.confirm = key;
    changed();
    return true;
  }

  async function afterFriendChange() {
    await loadFriends({ quiet: true });
    if (state.search.results) {
      await runSearch(state.search.q);
    }
  }

  function handleClick(event) {
    const target = event.target.closest?.('[data-buddy-action]');
    if (!target) {
      return false;
    }
    const { buddyAction: action, id, username } = target.dataset;
    switch (action) {
      case 'retry':
        load(route);
        return true;
      case 'cancel-confirm':
        state.confirm = '';
        changed();
        return true;
      case 'send-request':
        void act(`send:${username}`, async () => {
          const result = await buddiesApi.sendRequest(username);
          await afterFriendChange();
          return result;
        }, (result) => result.status === 'accepted'
          ? `You and ${result.user.first_name} are now friends!`
          : `Friend request sent to @${result.user.username}.`);
        return true;
      case 'accept-request':
      case 'decline-request':
      case 'cancel-request': {
        const verb = action.split('-')[0];
        void act(`request:${id}`, async () => {
          await buddiesApi.respondRequest(id, verb);
          await afterFriendChange();
        }, verb === 'accept' ? 'Friend request accepted. Say hello and plan your first workout!'
          : verb === 'decline' ? 'Request declined.' : 'Request cancelled.');
        return true;
      }
      case 'remove-friend':
        if (needsConfirm(target, `remove-friend:${id}`)) return true;
        void act(`remove-friend:${id}`, async () => {
          await buddiesApi.removeFriend(id);
          await afterFriendChange();
        }, 'Friend removed. Any open invitations between you were cancelled.');
        return true;
      case 'block':
        if (needsConfirm(target, `block:${id}`)) return true;
        void act(`block:${id}`, async () => {
          await buddiesApi.block(id);
          await afterFriendChange();
        }, `@${id} is blocked. They can’t find, message or invite you.`);
        return true;
      case 'unblock':
        void act(`unblock:${id}`, async () => {
          await buddiesApi.unblock(id);
          await afterFriendChange();
        }, 'Unblocked.');
        return true;
      case 'mute':
      case 'unmute':
        void act(`mute:${id}`, async () => {
          await (action === 'mute' ? buddiesApi.mute(id) : buddiesApi.unmute(id));
          await loadFriends({ quiet: true });
        }, action === 'mute' ? 'Notifications from this friend are muted.' : 'Notifications unmuted.');
        return true;
      case 'open-notification': {
        const item = state.notifications.items?.find((n) => n.id === id);
        if (item && !item.read) {
          item.read = true;
          state.counts.notifications = Math.max(0, state.counts.notifications - 1);
          state.notifications.unread = state.counts.notifications;
          void buddiesApi.markRead([id]).catch(() => {});
        }
        return false; // let the link navigate
      }
      case 'read-all':
        void act('read-all', async () => {
          await buddiesApi.markAllRead();
          for (const n of state.notifications.items ?? []) n.read = true;
          state.notifications.unread = 0;
          state.counts.notifications = 0;
        }, 'All caught up.');
        return true;
      case 'more-notifications':
        void loadNotifications({ append: true });
        return true;
      case 'challenge-accept':
      case 'challenge-decline':
      case 'challenge-cancel': {
        const verb = action.split('-')[1];
        if (verb === 'cancel' && needsConfirm(target, `challenge-cancel:${id}`)) return true;
        void act(`challenge:${id}`, async () => {
          await buddiesApi.respondChallenge(id, verb);
          await loadChallenges();
        }, verb === 'accept' ? 'Challenge accepted — game on!' : verb === 'decline' ? 'Challenge declined.' : 'Challenge cancelled.');
        return true;
      }
      case 'retry-session':
        if (state.calendar.selected) void loadSelected(state.calendar.selected.id);
        return true;
      case 'session-accept':
        void sessionAction(id, () => buddiesApi.respondSession(id, 'accept'), 'Workout accepted — it’s in both your calendars.');
        return true;
      case 'session-decline':
        void sessionAction(id, () => buddiesApi.respondSession(id, 'decline'), 'Invitation declined.');
        return true;
      case 'session-cancel':
        if (needsConfirm(target, `session-cancel:${id}`)) {
          return true;
        }
        void sessionAction(id, () => buddiesApi.respondSession(id, 'cancel'), 'Workout cancelled. Your friend has been told.');
        return true;
      case 'retry-thread':
        if (state.chat.thread) {
          const { username: name } = state.chat.thread;
          state.chat.thread = null;
          void openThread(name);
        }
        return true;
      case 'older-messages':
        void olderMessages();
        return true;
      case 'retry-message': {
        const failed = state.chat.thread?.messages.find((m) => m.client_msg_id === id && m.failed);
        if (failed?.retry) void sendChat(failed.retry);
        return true;
      }
      case 'nudge': {
        const friend = state.chat.thread?.friend;
        if (!friend) return true;
        target.closest?.('details')?.removeAttribute?.('open');
        void act(`nudge:${id}`, async () => {
          const result = await buddiesApi.nudge(friend.id, id);
          mergeMessage(state.chat.thread, result.message);
          scrollThread = true;
        }, `Encouragement sent to ${friend.first_name}.`);
        return true;
      }
      case 'share-card': {
        const share = state.share;
        if (!share) return true;
        void act(`share:${id}`, async () => {
          const friend = state.friends.data?.friends?.find((f) => f.id === id);
          await deliver(id, { kind: 'exercise_card', body: '',
            payload: { exercise_id: share.exerciseId, target: share.target }, client_msg_id: clientId() });
          state.share = null;
          if (friend) {
            view?.history?.replaceState?.(view.history.state, '', `#/messages?with=${encodeURIComponent(friend.username)}`);
            route = { name: 'messages', params: { with: friend.username } };
            state.chat.thread = null;
            void openThread(friend.username);
          }
        }, 'Exercise sent!');
        return true;
      }
      default:
        return false;
    }
  }

  function formValues(form) {
    const values = {};
    for (const element of form.elements ?? []) {
      if (element.name) {
        values[element.name] = element.type === 'checkbox' ? element.checked : element.value;
      }
    }
    return values;
  }

  function handleSubmit(event) {
    const form = event.target;
    const name = form?.dataset?.buddyForm;
    if (!name) {
      return false;
    }
    event.preventDefault();
    const values = formValues(form);
    switch (name) {
      case 'search':
        clearTimeout(searchTimer);
        void runSearch(values.q ?? '');
        break;
      case 'report':
        void act(`report:${values.username}`, async () => {
          await buddiesApi.report({ username: values.username, reason: values.reason, details: values.details || null,
            also_block: Boolean(values.alsoBlock) });
          await afterFriendChange();
        }, 'Thanks — our team will review your report.');
        break;
      case 'create-challenge': {
        const page = state.challenges;
        page.form.values = { ...page.form.values, ...values };
        const deadline = deadlineFromPreset(values.preset, values.custom);
        const targetValue = Number(values.target);
        if (!deadline || Number.isNaN(deadline.getTime()) || deadline.getTime() < Date.now() + 3_600_000) {
          page.form.error = 'Choose a deadline at least an hour from now.';
          changed();
          return true;
        }
        if (!Number.isInteger(targetValue) || targetValue < 1) {
          page.form.error = 'Choose a target of at least 1.';
          changed();
          return true;
        }
        page.form.error = '';
        void act('create-challenge', async () => {
          const { challenge } = await buddiesApi.createChallenge({
            friend_id: values.friend_id, metric: values.metric, exercise_id: values.metric === 'seconds' ? 'plank' : (values.exercise_id || 'any'),
            target: targetValue, deadline: deadline.toISOString(), message: values.message || null,
          });
          page.form = { open: false, values: {}, error: '' };
          view?.history?.replaceState?.(view.history.state, '', '#/challenges');
          route = { name: 'challenges', params: {} };
          await loadChallenges();
          return challenge;
        }, (challenge) => `Challenge sent to ${challenge.friend?.first_name ?? 'your friend'}.`);
        break;
      }
      case 'create-session': {
        const cal = state.calendar;
        cal.form.values = { ...cal.form.values, ...values };
        const target = Number(values.target);
        let scheduledAt = null;
        if (values.mode === 'scheduled') {
          scheduledAt = localDateTimeIso(values.date, values.time);
          if (!scheduledAt || new Date(scheduledAt).getTime() < Date.now() + 5 * 60_000) {
            cal.form.error = 'Choose a date and time at least 5 minutes from now.';
            changed();
            return true;
          }
        }
        if (!Number.isInteger(target) || target < 1) {
          cal.form.error = 'Choose a target of at least 1.';
          changed();
          return true;
        }
        cal.form.error = '';
        void act('create-session', async () => {
          const { session } = await buddiesApi.createSession({
            friend_id: values.friend_id, exercise_id: values.exercise_id, target, mode: values.mode,
            scheduled_at: scheduledAt, message: values.message || null,
          });
          cal.form = { open: false, values: {}, error: '' };
          view?.history?.replaceState?.(view.history.state, '', `#/calendar?session=${session.id}&view=${values.mode === 'scheduled' ? 'month' : 'pending'}`);
          route = { name: 'calendar', params: { session: session.id } };
          cal.selected = { id: session.id, session, error: '' };
          refreshCalendar();
          return session;
        }, (session) => `Invitation sent to ${session.partner?.first_name ?? 'your friend'}.`);
        break;
      }
      case 'reschedule': {
        const when = localDateTimeIso(values.date, values.time);
        if (!when) return true;
        void sessionAction(values.session_id, () => buddiesApi.rescheduleSession(values.session_id, when),
          'New time sent. Your friend needs to accept it.');
        break;
      }
      case 'send-message': {
        const text = String(values.body ?? '').trim();
        if (!text) return true;
        const input = form.querySelector?.('[data-chat-input]');
        if (input) input.value = '';
        void sendChat({ kind: 'text', body: text, payload: {}, client_msg_id: clientId() });
        input?.focus?.();
        break;
      }
      case 'share-exercise':
        form.closest?.('details')?.removeAttribute?.('open');
        void sendChat({ kind: 'exercise_card', body: '',
          payload: { exercise_id: values.exercise_id, target: Number(values.target) || 20 }, client_msg_id: clientId() });
        break;
      case 'notification-preferences': {
        const prefs = state.notifications.prefs?.preferences ?? [];
        const body = {
          preferences: prefs.map((p) => ({
            type: p.type,
            in_app: Boolean(values[`inapp:${p.type}`]),
            email: p.type === 'workout_reminder' ? Boolean(values['email:workout_reminder']) : p.email,
          })),
          buddy_reminder_24h: Boolean(values.buddy_reminder_24h),
        };
        void act('notification-preferences', async () => {
          state.notifications.prefs = await buddiesApi.saveNotificationPreferences(body);
        }, 'Notification settings saved.');
        break;
      }
      default:
        return false;
    }
    return true;
  }

  function handleChange(event) {
    const input = event.target;
    if (input?.dataset && 'buddyMetric' in input.dataset) {
      const values = input.form ? formValues(input.form) : {};
      state.challenges.form.values = { ...state.challenges.form.values, ...values, metric: input.value, target: undefined,
        exercise_id: undefined };
      changed();
      return true;
    }
    if (input?.dataset && 'buddyMode' in input.dataset) {
      const form = input.form;
      const values = form ? formValues(form) : {};
      state.calendar.form.values = { ...state.calendar.form.values, ...values, mode: input.value };
      changed();
      return true;
    }
    return false;
  }

  let typingSentAt = 0;
  function handleKeydown(event) {
    const input = event.target;
    if (!input?.dataset || !('chatInput' in input.dataset)) return false;
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      input.form?.requestSubmit?.();
      return true;
    }
    return false;
  }

  function handleInput(event) {
    const input = event.target;
    if (input?.dataset && 'chatInput' in input.dataset) {
      const friend = state.chat.thread?.friend;
      if (friend && realtime?.status() === 'open' && Date.now() - typingSentAt > 2500 && input.value.trim()) {
        typingSentAt = Date.now();
        realtime.send('chat.typing', { friend_id: friend.id });
      }
      return true;
    }
    if (input?.dataset && 'buddySearch' in input.dataset) {
      clearTimeout(searchTimer);
      const value = input.value;
      searchTimer = setTimeout(() => void runSearch(value), 300);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ realtime
  if (realtime) {
    realtime.onStatus((status) => {
      state.connection = status;
      changed();
    });
    realtime.on('ready', (data) => {
      state.online = new Set(data.online_friends ?? []);
      state.counts.notifications = data.unread ?? state.counts.notifications;
      changed();
    });
    realtime.on('presence.update', (data) => {
      if (data.online) state.online.add(data.user_id);
      else state.online.delete(data.user_id);
      changed();
    });
    realtime.on('notification.new', (data) => {
      state.counts.notifications = data.unread ?? state.counts.notifications + 1;
      const page = state.notifications;
      if (page.items && data.notification) {
        page.items = [data.notification, ...page.items.filter((n) => n.id !== data.notification.id)];
        page.unread = state.counts.notifications;
      }
      changed();
    });
    realtime.on('notification.read', (data) => {
      state.counts.notifications = data.unread ?? 0;
      state.notifications.unread = state.counts.notifications;
      changed();
    });
    realtime.on('friends.changed', () => {
      void loadFriends({ quiet: true });
      if (onDashboard()) void loadDashboard();
    });
    realtime.on('chat.message', onChatMessage);
    realtime.on('session.updated', () => refreshCalendar());
    realtime.on('challenge.updated', () => {
      void loadChallenges();
      if (onDashboard()) void loadDashboard();
    });
    realtime.on('room.waiting', (data) => {
      state.waiting = { sessionId: data.session_id, name: data.user?.first_name ?? 'Your friend', at: Date.now() };
      changed();
      setTimeout(() => {
        if (state.waiting?.sessionId === data.session_id) {
          state.waiting = null;
          changed();
        }
      }, 10 * 60_000);
    });
    realtime.on('streaks.changed', () => {
      void loadFriends({ quiet: true });
      if (onDashboard()) void loadDashboard();
      if (route.name === 'buddies' && route.params.tab === 'streaks') void loadStreaks();
    });
    realtime.on('chat.read', (data) => {
      const thread = state.chat.thread;
      if (thread?.friend?.id === data.reader_id) {
        thread.otherReadAt = data.read_at;
        changed();
      }
    });
    realtime.on('chat.typing', (data) => {
      const thread = state.chat.thread;
      if (thread?.friend?.id === data.user_id) {
        thread.typingUntil = Date.now() + 4000;
        changed();
        setTimeout(changed, 4100);
      }
    });
    realtime.on('chat.unread', (data) => {
      state.counts.messages = data.unread ?? state.counts.messages;
      if (typeof data.notifications === 'number') state.counts.notifications = data.notifications;
      changed();
    });
  }

  // ------------------------------------------------------------ rendering
  function render(name, params) {
    const shared = { pending: state.pending, message: state.message, failure: state.failure };
    if (name === 'buddies' && !params.tab) {
      return renderBuddiesDashboard({ me: getUser(), ...state.dashboard, dashboard: state.dashboard.data,
        counts: state.counts, online: state.online, ...shared });
    }
    if (name === 'buddies') {
      const tab = FRIEND_TABS.includes(params.tab) ? params.tab : 'friends';
      return renderFriendsPage({
        me: getUser(), tab, ...state.friends, search: state.search, profile: state.profile, confirm: state.confirm,
        features, online: state.online, connection: state.connection, streaks: state.streaks, ...shared,
      });
    }
    if (name === 'notifications') {
      return renderNotificationsPage({ ...state.notifications, ...shared });
    }
    if (name === 'challenges') {
      return renderChallengesPage({ ...state.challenges, friends: state.friends.data?.friends ?? [], confirm: state.confirm, ...shared });
    }
    if (name === 'calendar') {
      return renderCalendarPage({ calendar: state.calendar, friends: state.friends.data?.friends ?? [],
        connection: state.connection, features, confirm: state.confirm, ...shared });
    }
    if (name === 'messages') {
      return renderMessagesPage({
        me: getUser(), chat: state.chat, friends: state.friends.data?.friends ?? [], online: state.online,
        connection: state.connection, share: state.share, features, ...shared,
      });
    }
    return '';
  }

  function afterRender(root, currentRoute) {
    if (currentRoute?.name !== 'messages') return;
    const list = root.querySelector?.('[data-chat-thread]');
    if (list && scrollThread) {
      list.scrollTop = list.scrollHeight;
      scrollThread = false;
    }
  }

  function reset() {
    state.friends = { data: null, loading: false, error: '' };
    state.search = { q: '', results: null, loading: false, error: '' };
    state.profile = null;
    state.notifications = { items: null, unread: 0, loading: false, error: '', prefs: null, hasMore: false };
    state.counts = { notifications: 0, requests: 0, messages: 0, invites: 0, challenges: 0 };
    state.dashboard = { data: null, error: '' };
    state.waiting = null;
    state.challenges = { data: null, error: '', form: { open: false, values: {}, error: '' } };
    state.calendar = emptyCalendar();
    state.chat = { conversations: null, unread: 0, loading: false, error: '', thread: null };
    state.share = null;
    state.online = new Set();
  }

  return {
    handles: (name) => BUDDY_ROUTES.has(name),
    setChangeListener(listener) {
      changed = listener;
    },
    load,
    render,
    handleClick,
    handleSubmit,
    handleInput,
    handleKeydown,
    handleChange,
    afterRender,
    refreshCounts,
    loadFriends,
    counts: () => ({ ...state.counts, waiting: state.waiting }),
    clearWaiting(sessionId) {
      if (state.waiting && (!sessionId || state.waiting.sessionId === sessionId)) {
        state.waiting = null;
        changed();
      }
    },
    reset,
    // Exposed for the realtime layer (phase 2) and tests.
    state,
    refreshUser,
    view,
  };
}

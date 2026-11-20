/**
 * SabiBody Buddies pages (#/buddies, #/notifications, …). Plugs into the
 * account controller: it renders inside the same page shell, uses the same
 * authenticated API client and asks the shell to re-render through changed().
 */
import { FRIEND_TABS, renderFriendsPage } from './friends-page.js';
import { renderNotificationsPage } from './notifications-page.js';

export const BUDDY_ROUTES = new Set(['buddies', 'notifications']);

function describe(error) {
  return error?.message || 'Something went wrong. Please try again.';
}

export function createBuddiesController({ buddiesApi, getUser, refreshUser = async () => {}, view = globalThis,
  features = {} }) {
  let changed = () => {};
  let route = { name: '', params: {} };
  let searchTimer = null;
  let searchSeq = 0;

  const state = {
    friends: { data: null, loading: false, error: '' },
    search: { q: '', results: null, loading: false, error: '' },
    profile: null,
    notifications: { items: null, unread: 0, loading: false, error: '', prefs: null, hasMore: false },
    counts: { notifications: 0, requests: 0 },
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
    try {
      const { unread } = await buddiesApi.unreadCount();
      state.counts.notifications = unread;
      changed();
    } catch {
      /* counts are best effort */
    }
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
        if (route.params.tab === 'find') {
          void loadProfile(route.params.view);
        }
        break;
      }
      case 'notifications':
        void loadNotifications();
        break;
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

  function handleInput(event) {
    const input = event.target;
    if (input?.dataset && 'buddySearch' in input.dataset) {
      clearTimeout(searchTimer);
      const value = input.value;
      searchTimer = setTimeout(() => void runSearch(value), 300);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ rendering
  function render(name, params) {
    const shared = { pending: state.pending, message: state.message, failure: state.failure };
    if (name === 'buddies') {
      const tab = FRIEND_TABS.includes(params.tab) ? params.tab : 'friends';
      return renderFriendsPage({
        me: getUser(), tab, ...state.friends, search: state.search, profile: state.profile, confirm: state.confirm,
        features, ...shared,
      });
    }
    if (name === 'notifications') {
      return renderNotificationsPage({ ...state.notifications, ...shared });
    }
    return '';
  }

  function reset() {
    state.friends = { data: null, loading: false, error: '' };
    state.search = { q: '', results: null, loading: false, error: '' };
    state.profile = null;
    state.notifications = { items: null, unread: 0, loading: false, error: '', prefs: null, hasMore: false };
    state.counts = { notifications: 0, requests: 0 };
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
    refreshCounts,
    loadFriends,
    counts: () => ({ ...state.counts }),
    reset,
    // Exposed for the realtime layer (phase 2) and tests.
    state,
    refreshUser,
    view,
  };
}

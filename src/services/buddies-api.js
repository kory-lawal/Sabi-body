/** REST wrappers for SabiBody Buddies (friends, notifications, chat, shared workouts, challenges). */

function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function createBuddiesApi(api) {
  const auth = { auth: true };
  const id = (value) => encodeURIComponent(value);
  return {
    // usernames & people
    usernameAvailable: (username) => api.get(`/api/account/username/available${query({ u: username })}`, auth),
    setUsername: (username) => api.put('/api/account/username', { username }, auth),
    search: (q) => api.get(`/api/users/search${query({ q })}`, auth),
    profile: (username) => api.get(`/api/users/${id(username)}`, auth),

    // friends
    friends: () => api.get('/api/friends', auth),
    sendRequest: (username) => api.post('/api/friends/requests', { username }, auth),
    respondRequest: (requestId, action) => api.post(`/api/friends/requests/${id(requestId)}/${action}`, {}, auth),
    removeFriend: (userId) => api.delete(`/api/friends/${id(userId)}`, auth),
    mute: (userId) => api.post(`/api/friends/${id(userId)}/mute`, {}, auth),
    unmute: (userId) => api.delete(`/api/friends/${id(userId)}/mute`, auth),
    block: (username) => api.post('/api/blocks', { username }, auth),
    unblock: (userId) => api.delete(`/api/blocks/${id(userId)}`, auth),
    report: (body) => api.post('/api/reports', body, auth),

    // notifications
    notifications: (before) => api.get(`/api/notifications${query({ before })}`, auth),
    unreadCount: () => api.get('/api/notifications/unread-count', auth),
    markRead: (ids) => api.post('/api/notifications/read', { ids }, auth),
    markAllRead: () => api.post('/api/notifications/read-all', {}, auth),
    notificationPreferences: () => api.get('/api/notification-preferences', auth),
    saveNotificationPreferences: (body) => api.put('/api/notification-preferences', body, auth),
  };
}

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

    // chat
    conversations: () => api.get('/api/conversations', auth),
    unreadMessages: () => api.get('/api/conversations/unread', auth),
    messages: (friendId, before) => api.get(`/api/conversations/${id(friendId)}/messages${query({ before })}`, auth),
    sendMessage: (friendId, body) => api.post(`/api/conversations/${id(friendId)}/messages`, body, auth),
    markConversationRead: (friendId) => api.post(`/api/conversations/${id(friendId)}/read`, {}, auth),
    nudge: (friendId, preset) => api.post(`/api/friends/${id(friendId)}/nudge`, { preset }, auth),

    // shared workouts & calendar
    sessions: (params) => api.get(`/api/shared-sessions${query(params)}`, auth),
    session: (sessionId) => api.get(`/api/shared-sessions/${id(sessionId)}`, auth),
    createSession: (body) => api.post('/api/shared-sessions', body, auth),
    respondSession: (sessionId, action) => api.post(`/api/shared-sessions/${id(sessionId)}/${action}`, {}, auth),
    rescheduleSession: (sessionId, scheduledAt) => api.post(`/api/shared-sessions/${id(sessionId)}/reschedule`, { scheduled_at: scheduledAt }, auth),

    sessionSummary: (sessionId) => api.get(`/api/shared-sessions/${id(sessionId)}/summary`, auth),
    iceServers: () => api.get('/api/rtc/ice-servers', auth),

    // notifications
    notifications: (before) => api.get(`/api/notifications${query({ before })}`, auth),
    unreadCount: () => api.get('/api/notifications/unread-count', auth),
    markRead: (ids) => api.post('/api/notifications/read', { ids }, auth),
    markAllRead: () => api.post('/api/notifications/read-all', {}, auth),
    notificationPreferences: () => api.get('/api/notification-preferences', auth),
    saveNotificationPreferences: (body) => api.put('/api/notification-preferences', body, auth),
  };
}

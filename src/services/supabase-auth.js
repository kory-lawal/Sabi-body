function throwOnError(error) {
  if (error) {
    throw error;
  }
}

export function createSupabaseAuthService(client) {
  if (!client?.auth) {
    throw new TypeError('A configured Supabase Auth client is required.');
  }

  return {
    async getSession() {
      const { data, error } = await client.auth.getSession();
      throwOnError(error);
      return data.session;
    },

    async getUser() {
      const { data, error } = await client.auth.getUser();
      throwOnError(error);
      return data.user;
    },

    subscribe(callback) {
      if (typeof callback !== 'function') {
        throw new TypeError('An auth-state callback is required.');
      }
      const { data, error } = client.auth.onAuthStateChange((event, session) => {
        callback({ event, session });
      });
      throwOnError(error);
      const subscription = data?.subscription;
      if (!subscription?.unsubscribe) {
        throw new Error('Supabase Auth did not return a session subscription.');
      }
      return () => subscription.unsubscribe();
    },

    async signUp({ fullName, email, password }) {
      const { data, error } = await client.auth.signUp({
        email: String(email ?? '').trim(),
        password,
        options: { data: { full_name: String(fullName ?? '').trim() } },
      });
      throwOnError(error);
      return {
        user: data.user,
        session: data.session,
        confirmationRequired: data.session === null,
      };
    },

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({
        email: String(email ?? '').trim(),
        password,
      });
      throwOnError(error);
      return { user: data.user, session: data.session };
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      throwOnError(error);
    },

    async requestPasswordReset(email, redirectTo) {
      const options = redirectTo ? { redirectTo } : {};
      const { error } = await client.auth.resetPasswordForEmail(
        String(email ?? '').trim(),
        options,
      );
      throwOnError(error);
    },

    async updatePassword(password) {
      const { data, error } = await client.auth.updateUser({ password });
      throwOnError(error);
      return data.user;
    },
  };
}

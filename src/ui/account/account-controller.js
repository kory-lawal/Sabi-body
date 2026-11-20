import { ApiError } from '../../services/api-client.js';
import { browserTimeZone } from '../../services/account-data.js';
import { AUTH_ONLY_ROUTES, PROTECTED_ROUTES, isAccountRoute, parseRoute, routeHref } from '../router.js';
import {
  isValidEmail,
  passwordRuleState,
  renderForgotPassword,
  renderLogin,
  renderRegister,
  renderResetPassword,
  renderVerifyEmail,
} from './auth-pages.js';
import { escapeHtml } from './format.js';
import {
  loadingState,
  renderAdmin,
  renderDashboard,
  renderHistory,
  renderProfile,
  renderSettings,
} from './member-pages.js';

function todayIso(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function passwordErrors(password, confirm) {
  const errors = {};
  const unmet = passwordRuleState(password).filter((rule) => !rule.met);
  if (unmet.length) {
    errors.password = `Password needs: ${unmet.map((rule) => rule.label.toLowerCase()).join(', ')}.`;
  }
  if (confirm !== undefined && password !== confirm) {
    errors.confirmPassword = 'The passwords don’t match.';
  }
  return errors;
}

/**
 * Owns the account pages (#/login, #/dashboard, ...). The workout experience is
 * untouched: this controller only renders when an account route is active and
 * no workout is in progress.
 */
export function createAccountController({
  authService,
  accountData,
  view = globalThis,
  requestRender = () => {},
  timeZone = browserTimeZone,
  buddies = null,
}) {
  let route = parseRoute(view?.location?.hash);
  let version = 0;
  let lastFocusedRoute = '';
  const forms = {};
  const pages = {
    dashboard: { summary: null, error: '', weekOffset: 0, loading: false },
    history: { items: null, total: 0, filters: { status: 'all' }, error: '', loading: false, loadingMore: false },
    profile: { summary: null },
    settings: { reminders: null, sessions: null, emailDelivery: null, sectionMessage: {} },
    admin: { overview: null, error: '', loading: false, days: 30 },
    verify: { token: null, status: undefined, message: '' },
  };
  let flash = { message: '', error: '' };
  let pending = '';
  let resetFormName = '';
  let saveState = { status: 'idle', attempt: null, message: '' };

  const auth = () => authService.getState();
  const user = () => auth().user;

  function changed() {
    version += 1;
    requestRender();
  }
  buddies?.setChangeListener(changed);

  function navigate(name, params = {}, { replace = false } = {}) {
    const href = routeHref(name, params);
    if (replace && typeof view?.history?.replaceState === 'function') {
      view.history.replaceState(view.history.state, '', href);
      handleRouteChange();
    } else if (view?.location) {
      view.location.hash = href.slice(1);
    }
  }

  function form(name) {
    forms[name] ??= { values: {}, errors: {}, pending: false, error: '', notice: '' };
    return forms[name];
  }

  function setFlash(message = '', error = '') {
    flash = { message, error };
  }

  // ------------------------------------------------------------ routing / guards
  function guard() {
    const { status } = auth();
    if (PROTECTED_ROUTES.has(route.name) && status === 'anonymous') {
      navigate('login', { next: route.name }, { replace: true });
      return false;
    }
    if (AUTH_ONLY_ROUTES.has(route.name) && status === 'authenticated') {
      navigate(route.params.next && PROTECTED_ROUTES.has(route.params.next) ? route.params.next : 'dashboard', {}, { replace: true });
      return false;
    }
    return true;
  }

  function loadForRoute() {
    if (auth().status !== 'authenticated') {
      if (route.name === 'verify-email') {
        void verifyEmail();
      }
      return;
    }
    switch (route.name) {
      case 'dashboard':
        void loadDashboard();
        break;
      case 'history':
        void loadHistory();
        break;
      case 'profile':
        void loadProfile();
        break;
      case 'settings':
        void loadSettings();
        break;
      case 'admin':
        if (user()?.is_admin) {
          void loadAdmin();
        }
        break;
      case 'verify-email':
        void verifyEmail();
        break;
      default:
        if (buddies?.handles(route.name)) {
          buddies.load(route);
        }
        break;
    }
  }

  function handleRouteChange() {
    const previous = route.name;
    route = parseRoute(view?.location?.hash);
    if (previous !== route.name) {
      setFlash();
    }
    if (guard()) {
      loadForRoute();
    }
    changed();
  }

  let countsLoadedFor = null;
  authService.subscribe((state) => {
    if (state.status === 'authenticated' && buddies && countsLoadedFor !== state.user?.id) {
      countsLoadedFor = state.user?.id;
      void buddies.refreshCounts();
      void buddies.loadFriends({ quiet: true });
    }
    if (state.status === 'anonymous') {
      countsLoadedFor = null;
      buddies?.reset();
      for (const key of ['dashboard', 'history', 'profile', 'settings', 'admin']) {
        if (key === 'history') {
          Object.assign(pages.history, { items: null, total: 0 });
        } else {
          for (const field of ['summary', 'overview', 'reminders', 'sessions']) {
            if (field in pages[key]) {
              pages[key][field] = null;
            }
          }
        }
      }
    }
    if (guard()) {
      loadForRoute();
    }
    changed();
  });

  view?.addEventListener?.('hashchange', handleRouteChange);

  // ------------------------------------------------------------ data loading
  function describe(error) {
    return error?.message || 'Something went wrong. Please try again.';
  }

  async function loadDashboard() {
    const page = pages.dashboard;
    page.loading = true;
    page.error = '';
    changed();
    try {
      page.summary = await accountData.summary(page.weekOffset);
    } catch (error) {
      page.error = describe(error);
    } finally {
      page.loading = false;
      changed();
    }
  }

  async function loadHistory({ append = false } = {}) {
    const page = pages.history;
    if (append) {
      page.loadingMore = true;
    } else {
      page.loading = true;
    }
    page.error = '';
    changed();
    try {
      const result = await accountData.history({ ...page.filters, limit: 20, offset: append ? page.items?.length ?? 0 : 0 });
      page.items = append ? [...(page.items ?? []), ...result.items] : result.items;
      page.total = result.total;
    } catch (error) {
      page.error = describe(error);
    } finally {
      page.loading = false;
      page.loadingMore = false;
      changed();
    }
  }

  async function loadProfile() {
    try {
      pages.profile.summary = await accountData.summary(0);
    } catch (error) {
      setFlash('', describe(error));
    }
    changed();
  }

  async function loadSettings() {
    const page = pages.settings;
    const [reminders, sessions, health] = await Promise.allSettled([
      accountData.reminders(),
      accountData.sessions(),
      authService.api.get('/api/health/db'),
    ]);
    if (reminders.status === 'fulfilled') {
      page.reminders = reminders.value;
    } else {
      setFlash('', describe(reminders.reason));
    }
    page.sessions = sessions.status === 'fulfilled' ? sessions.value.active_sessions : page.sessions;
    page.emailDelivery = health.status === 'fulfilled' ? health.value.email_provider : null;
    changed();
    const section = route.params.section;
    if (section) {
      queueMicrotask(() => view?.document?.getElementById?.(`settings-${section}`)?.scrollIntoView?.({ block: 'start' }));
    }
  }

  async function loadAdmin() {
    const page = pages.admin;
    page.loading = true;
    page.error = '';
    changed();
    try {
      page.overview = await accountData.adminOverview(page.days);
    } catch (error) {
      page.error = error instanceof ApiError && error.status === 403 ? 'You do not have access to the admin dashboard.' : describe(error);
    } finally {
      page.loading = false;
      changed();
    }
  }

  async function verifyEmail() {
    const page = pages.verify;
    const token = route.params.token;
    if (!token) {
      Object.assign(page, { token: null, status: 'error', message: 'This confirmation link is incomplete.' });
      changed();
      return;
    }
    if (page.token === token) {
      return;
    }
    Object.assign(page, { token, status: 'pending', message: '' });
    changed();
    try {
      const result = await authService.verifyEmail(token);
      Object.assign(page, { status: 'success', message: result.message });
      if (auth().status === 'authenticated') {
        await authService.refreshUser().catch(() => {});
      }
    } catch (error) {
      Object.assign(page, { status: 'error', message: describe(error) });
    }
    changed();
  }

  // ------------------------------------------------------------ workout saving
  async function saveWorkoutAttempt(attempt) {
    if (auth().status !== 'authenticated') {
      saveState = { status: attempt.completed ? 'guest' : 'idle', attempt: null, message: '' };
      changed();
      return null;
    }
    saveState = { status: 'saving', attempt, message: '' };
    changed();
    try {
      const result = await accountData.saveWorkout(attempt);
      saveState = { status: 'saved', attempt: null, message: '' };
      pages.dashboard.summary = null;
      pages.profile.summary = null;
      pages.history.items = null;
      return result;
    } catch (error) {
      saveState = { status: 'error', attempt, message: describe(error) };
      return null;
    } finally {
      changed();
    }
  }

  // ------------------------------------------------------------ form handlers
  async function submitLogin(values) {
    const state = form('login');
    state.values = { email: values.email, remember: values.remember };
    state.errors = {};
    state.error = '';
    state.notice = '';
    state.needsVerification = false;
    if (!isValidEmail(values.email)) {
      state.errors.email = 'Enter a valid email address.';
    }
    if (!values.password) {
      state.errors.password = 'Enter your password.';
    }
    if (Object.keys(state.errors).length) {
      return changed();
    }
    state.pending = true;
    changed();
    try {
      await authService.login({ email: values.email.trim(), password: values.password, remember: values.remember });
      state.pending = false;
      forms.login = undefined;
      const next = PROTECTED_ROUTES.has(values.next) ? values.next : 'dashboard';
      navigate(next, {}, { replace: true });
    } catch (error) {
      state.pending = false;
      state.error = describe(error);
      state.needsVerification = error?.code === 'email_not_verified';
      changed();
    }
  }

  async function submitRegister(values) {
    const state = form('register');
    state.values = { fullName: values.fullName, email: values.email, password: values.password, confirmPassword: values.confirmPassword };
    state.errors = {};
    state.error = '';
    if (!values.fullName?.trim()) {
      state.errors.fullName = 'Enter your full name.';
    }
    if (!isValidEmail(values.email)) {
      state.errors.email = 'Enter a valid email address.';
    }
    Object.assign(state.errors, passwordErrors(values.password ?? '', values.confirmPassword ?? ''));
    if (Object.keys(state.errors).length) {
      return changed();
    }
    state.pending = true;
    changed();
    try {
      const result = await authService.register({ fullName: values.fullName.trim(), email: values.email.trim(), password: values.password });
      state.done = {
        email: values.email.trim(),
        verificationRequired: result.email_verification_required,
        emailSent: result.verification_email_sent,
      };
      state.values = {};
    } catch (error) {
      state.error = describe(error);
      if (error?.code === 'email_taken') {
        state.errors.email = 'This email is already registered.';
      } else if (error?.code === 'weak_password') {
        state.errors.password = describe(error);
      }
    } finally {
      state.pending = false;
      changed();
    }
  }

  async function submitForgot(values) {
    const state = form('forgot-password');
    state.values = { email: values.email };
    state.errors = {};
    state.error = '';
    state.notice = '';
    if (!isValidEmail(values.email)) {
      state.errors.email = 'Enter a valid email address.';
      return changed();
    }
    state.pending = true;
    changed();
    try {
      const result = await authService.forgotPassword(values.email.trim());
      state.notice = `${result.message} Check your inbox (and spam folder).`;
    } catch (error) {
      state.error = describe(error);
    } finally {
      state.pending = false;
      changed();
    }
  }

  async function submitReset(values) {
    const state = form('reset-password');
    state.values = { password: values.password, confirmPassword: values.confirmPassword };
    state.errors = passwordErrors(values.password ?? '', values.confirmPassword ?? '');
    state.error = '';
    if (Object.keys(state.errors).length) {
      return changed();
    }
    state.pending = true;
    changed();
    try {
      await authService.resetPassword(route.params.token, values.password);
      state.done = true;
      state.values = {};
      if (auth().status === 'authenticated') {
        await authService.logout().catch(() => {});
      }
    } catch (error) {
      state.error = describe(error);
    } finally {
      state.pending = false;
      changed();
    }
  }

  async function resendVerification() {
    const email = forms.register?.done?.email || forms.login?.values?.email;
    const target = forms.register?.done ? form('register') : form('login');
    if (!email) {
      target.error = 'Enter your email address first.';
      return changed();
    }
    try {
      const result = await authService.resendVerification(email);
      target.notice = result.message;
      target.error = '';
    } catch (error) {
      target.error = describe(error);
    }
    changed();
  }

  async function runMemberAction(name, action, successMessage, { resetForm = false } = {}) {
    if (pending) {
      return false;
    }
    pending = name;
    setFlash();
    changed();
    try {
      const result = await action();
      setFlash(typeof successMessage === 'function' ? successMessage(result) : successMessage, '');
      return true;
    } catch (error) {
      setFlash('', describe(error));
      return false;
    } finally {
      pending = '';
      if (resetForm) {
        resetFormName = name;
      }
      changed();
      view?.scrollTo?.({ top: 0, behavior: 'smooth' });
    }
  }


  async function submitMemberForm(name, values) {
    switch (name) {
      case 'update-username':
        if (!values.username?.trim()) {
          setFlash('', 'Enter a username.');
          return changed();
        }
        return runMemberAction(name, async () => {
          await authService.api.put('/api/account/username', { username: values.username.trim() }, { auth: true });
          await authService.refreshUser();
        }, 'Your username has been updated.');
      case 'update-name':
        if (!values.fullName?.trim()) {
          setFlash('', 'Enter your full name.');
          return changed();
        }
        return runMemberAction(name, () => authService.updateName(values.fullName.trim()), 'Your name has been updated.');
      case 'change-password': {
        if (!values.currentPassword) {
          setFlash('', 'Enter your current password.');
          return changed();
        }
        const errors = passwordErrors(values.newPassword ?? '', values.confirmPassword ?? '');
        if (Object.keys(errors).length) {
          setFlash('', Object.values(errors).join(' '));
          return changed();
        }
        return runMemberAction(name, () => authService.changePassword(values.currentPassword, values.newPassword),
          (result) => result.message, { resetForm: true });
      }
      case 'change-email':
        if (!isValidEmail(values.newEmail)) {
          setFlash('', 'Enter a valid new email address.');
          return changed();
        }
        return runMemberAction(name, () => authService.changeEmail(values.newEmail.trim(), values.password),
          (result) => result.message, { resetForm: true });
      case 'reminders': {
        const body = {
          email_reminders_enabled: Boolean(values.email_reminders_enabled),
          morning_reminder_enabled: Boolean(values.morning_reminder_enabled),
          morning_reminder_time: values.morning_reminder_time || pages.settings.reminders?.morning_reminder_time,
          evening_reminder_enabled: Boolean(values.evening_reminder_enabled),
          evening_reminder_time: values.evening_reminder_time || pages.settings.reminders?.evening_reminder_time,
          timezone: values.timezone || timeZone(),
        };
        if (body.email_reminders_enabled && !body.morning_reminder_enabled && !body.evening_reminder_enabled) {
          setFlash('', 'Turn on a morning or evening reminder, or switch email reminders off.');
          return changed();
        }
        pages.settings.sectionMessage = {};
        const ok = await runMemberAction(name, async () => {
          pages.settings.reminders = await accountData.saveReminders(body);
        }, 'Reminder settings saved.');
        if (ok) {
          pages.settings.sectionMessage = { reminders: 'Saved.' };
          changed();
        }
        return ok;
      }
      case 'delete-account':
        if (!values.password) {
          setFlash('', 'Enter your password to delete your account.');
          return changed();
        }
        if (!view?.confirm?.('Delete your SabiBody account and all workout history? This cannot be undone.')) {
          return false;
        }
        return runMemberAction(name, async () => {
          await authService.deleteAccount(values.password);
          navigate('home');
        }, 'Your account has been deleted.');
      case 'history-filters': {
        if (values.from && values.to && values.from > values.to) {
          pages.history.error = 'The “From” date must be before the “To” date.';
          return changed();
        }
        pages.history.filters = {
          exercise: values.exercise || '',
          status: values.status || 'all',
          from: values.from || '',
          to: values.to || '',
        };
        return loadHistory();
      }
      default:
        return false;
    }
  }

  function formValues(formElement) {
    const values = {};
    for (const element of formElement.elements ?? []) {
      if (!element.name) {
        continue;
      }
      values[element.name] = element.type === 'checkbox' ? element.checked : element.value;
    }
    return values;
  }

  // ------------------------------------------------------------ DOM events
  function handleSubmit(event) {
    if (buddies?.handleSubmit(event)) {
      return true;
    }
    const formElement = event.target;
    const name = formElement?.dataset?.acctForm;
    if (!name) {
      return false;
    }
    event.preventDefault();
    const values = formValues(formElement);
    switch (name) {
      case 'login':
        void submitLogin(values);
        break;
      case 'register':
        if (!form('register').pending) {
          void submitRegister(values);
        }
        break;
      case 'forgot-password':
        void submitForgot(values);
        break;
      case 'reset-password':
        void submitReset(values);
        break;
      default:
        void submitMemberForm(name, values);
    }
    return true;
  }

  function handleClick(event) {
    if (buddies?.handleClick(event)) {
      return true;
    }
    const target = event.target.closest?.('[data-acct-action]');
    if (!target) {
      return false;
    }
    const action = target.dataset.acctAction;
    switch (action) {
      case 'toggle-password': {
        const input = view?.document?.getElementById?.(target.dataset.target);
        if (input) {
          const reveal = input.type === 'password';
          input.type = reveal ? 'text' : 'password';
          target.textContent = reveal ? 'Hide' : 'Show';
          target.setAttribute('aria-pressed', String(reveal));
          target.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
        }
        return true;
      }
      case 'resend-verification':
        void resendVerification();
        return true;
      case 'register-again':
        forms.register = undefined;
        changed();
        return true;
      case 'previous-week':
        pages.dashboard.weekOffset -= 1;
        void loadDashboard();
        return true;
      case 'next-week':
        if (pages.dashboard.weekOffset < 0) {
          pages.dashboard.weekOffset += 1;
          void loadDashboard();
        }
        return true;
      case 'clear-filters':
        pages.history.filters = { status: 'all' };
        void loadHistory();
        return true;
      case 'load-more':
        void loadHistory({ append: true });
        return true;
      case 'retry':
        loadForRoute();
        return true;
      case 'logout':
        void (async () => {
          await authService.logout().catch(() => {});
          setFlash();
          navigate('home');
        })();
        return true;
      case 'revoke-others':
        void runMemberAction('revoke-others', async () => {
          const result = await authService.revokeOtherSessions();
          pages.settings.sessions = 1;
          return result;
        }, (result) => result.message);
        return true;
      case 'send-reset-email':
        void runMemberAction('send-reset-email', () => authService.forgotPassword(user().email),
          `We’ve emailed a password reset link to ${user().email}.`);
        return true;
      case 'retry-save':
        if (saveState.attempt) {
          void saveWorkoutAttempt(saveState.attempt);
        }
        return true;
      default:
        return false;
    }
  }

  function handleInput(event) {
    if (buddies?.handleInput(event)) {
      return true;
    }
    const input = event.target;
    if (input?.dataset && 'passwordRules' in input.dataset) {
      const list = view?.document?.querySelector?.(`[data-rules-for="${input.id}"]`);
      for (const rule of passwordRuleState(input.value)) {
        const item = list?.querySelector?.(`[data-rule="${rule.id}"]`);
        if (item) {
          item.classList.toggle('is-met', rule.met);
          item.firstElementChild.textContent = rule.met ? '✓' : '•';
          item.lastElementChild.textContent = rule.met ? ' (met)' : ' (not met yet)';
        }
      }
      return true;
    }
    return false;
  }

  function handleChange(event) {
    const control = event.target;
    if (control?.dataset?.reminderToggle === 'email_reminders_enabled') {
      const slots = control.form?.querySelector?.('[data-reminder-slots]');
      if (slots) {
        slots.disabled = !control.checked;
      }
      return true;
    }
    if (control?.dataset?.acctAction === 'admin-range') {
      pages.admin.days = Number(control.value) || 30;
      void loadAdmin();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ rendering
  function renderContent() {
    const { status } = auth();
    const name = route.name;
    if (PROTECTED_ROUTES.has(name)) {
      if (status !== 'authenticated') {
        return `<main class="page" id="main">${loadingState('Checking your account…')}</main>`;
      }
      const current = user();
      const flashArgs = { message: flash.message, error: flash.error, pending };
      let inner;
      switch (name) {
        case 'dashboard':
          inner = renderDashboard({ user: current, ...pages.dashboard, todayIso: todayIso(timeZone()) });
          break;
        case 'history':
          inner = renderHistory(pages.history);
          break;
        case 'profile':
          inner = renderProfile({ user: current, summary: pages.profile.summary, ...flashArgs });
          break;
        case 'settings':
          inner = renderSettings({ user: current, ...pages.settings, ...flashArgs });
          break;
        case 'admin':
          inner = current.is_admin
            ? renderAdmin(pages.admin)
            : `<div class="state-panel state-panel--error" role="alert"><h1 id="page-title" tabindex="-1">Not available</h1><p>The admin dashboard is only for SabiBody administrators.</p><a class="button button--quiet" href="#/dashboard">Go to your dashboard</a></div>`;
          break;
        default:
          inner = buddies?.handles(name) ? buddies.render(name, route.params) : '';
      }
      return `<main class="page page--${name}" id="main">${inner}</main>`;
    }
    switch (name) {
      case 'login':
        return renderLogin({ ...form('login'), next: route.params.next });
      case 'register':
        return renderRegister(form('register'));
      case 'forgot-password':
        return renderForgotPassword(form('forgot-password'));
      case 'reset-password':
        return renderResetPassword({ ...form('reset-password'), token: route.params.token });
      case 'verify-email':
        return renderVerifyEmail({ ...pages.verify, authenticated: status === 'authenticated' });
      default:
        return '';
    }
  }

  function snapshotFields(root) {
    const fields = new Map();
    for (const element of root.querySelectorAll?.('input[id], select[id], textarea[id]') ?? []) {
      if (resetFormName && element.form?.dataset?.acctForm === resetFormName) {
        continue;
      }
      fields.set(element.id, element.type === 'checkbox'
        ? { checked: element.checked, initial: renderedDefault(element) }
        : { value: element.value, initial: renderedDefault(element) });
    }
    const active = root.ownerDocument?.activeElement;
    return { fields, activeId: active && root.contains?.(active) ? active.id : '' };
  }

  // The value the markup itself specified, as opposed to what the user typed.
  function renderedDefault(element) {
    if (element.type === 'checkbox') {
      return String(element.defaultChecked);
    }
    if (element.tagName === 'SELECT') {
      return [...(element.options ?? [])].find((option) => option.defaultSelected)?.value ?? '';
    }
    return element.defaultValue ?? '';
  }

  // Keep the user's in-progress edits across a re-render, but only where the
  // app did not deliberately change the field (e.g. "Clear filters").
  function restoreFields(root, snapshot) {
    for (const [id, saved] of snapshot.fields) {
      const element = root.ownerDocument?.getElementById?.(id);
      if (!element || element.type === 'hidden' || renderedDefault(element) !== saved.initial) {
        continue;
      }
      if ('checked' in saved) {
        element.checked = saved.checked;
      } else if (element.value !== saved.value) {
        element.value = saved.value;
      }
    }
    if (snapshot.activeId) {
      root.ownerDocument?.getElementById?.(snapshot.activeId)?.focus?.({ preventScroll: true });
    }
  }

  function render(root, headerMarkup) {
    const routeKey = `${route.name}?${new URLSearchParams(route.params)}`;
    const sameRoute = routeKey === lastFocusedRoute;
    const snapshot = sameRoute ? snapshotFields(root) : { fields: new Map(), activeId: '' };
    root.innerHTML = `<div class="app-shell app-shell--account">${headerMarkup}${renderContent()}</div>`;
    if (sameRoute) {
      restoreFields(root, snapshot);
    } else {
      lastFocusedRoute = routeKey;
      root.querySelector?.('#page-title, #auth-title')?.focus?.({ preventScroll: true });
      view?.scrollTo?.({ top: 0 });
    }
    resetFormName = '';
    buddies?.afterRender?.(root, route);
  }

  return {
    isActive: () => isAccountRoute(route),
    route: () => route,
    version: () => version,
    authStatus: () => auth().status,
    user,
    saveState: () => saveState,
    badges: () => buddies?.counts() ?? null,
    clearSaveState() {
      saveState = { status: 'idle', attempt: null, message: '' };
    },
    saveWorkoutAttempt,
    navigate,
    render,
    handleClick,
    handleSubmit,
    handleInput,
    handleChange,
    handleKeydown: (event) => buddies?.handleKeydown?.(event) ?? false,
    start() {
      void authService.restore();
      if (guard()) {
        loadForRoute();
      }
    },
  };
}

export { escapeHtml };

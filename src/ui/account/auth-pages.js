import { escapeHtml } from './format.js';

export const PASSWORD_RULES = [
  { id: 'length', label: 'At least 10 characters', test: (value) => value.length >= 10 },
  { id: 'letter', label: 'At least one letter', test: (value) => /[A-Za-z]/.test(value) },
  { id: 'number', label: 'At least one number', test: (value) => /\d/.test(value) },
];

export function passwordRuleState(value = '') {
  return PASSWORD_RULES.map((rule) => ({ ...rule, met: rule.test(value) }));
}

export function isValidEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value).trim());
}

function alert(message, tone = 'error') {
  if (!message) {
    return '';
  }
  const role = tone === 'error' ? 'alert' : 'status';
  return `<div class="notice notice--${tone}" role="${role}">${escapeHtml(message)}</div>`;
}

function field({ id, name, label, type = 'text', autocomplete, value = '', hint = '', error = '', attrs = '' }) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ');
  return `
    <div class="field${error ? ' field--invalid' : ''}">
      <label class="field__label" for="${id}">${label}</label>
      <input class="field__input" id="${id}" name="${name}" type="${type}" ${autocomplete ? `autocomplete="${autocomplete}"` : ''}
        value="${escapeHtml(value)}" ${describedBy ? `aria-describedby="${describedBy}"` : ''} ${error ? 'aria-invalid="true"' : ''} ${attrs} />
      ${hint ? `<p class="field__hint" id="${id}-hint">${hint}</p>` : ''}
      ${error ? `<p class="field__error" id="${id}-error">${escapeHtml(error)}</p>` : ''}
    </div>`;
}

export function passwordField({ id, name = 'password', label = 'Password', autocomplete = 'current-password', error = '', rules = false, value = '' }) {
  const describedBy = [rules ? `${id}-rules` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ');
  return `
    <div class="field${error ? ' field--invalid' : ''}">
      <label class="field__label" for="${id}">${label}</label>
      <div class="field__password">
        <input class="field__input" id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" value="${escapeHtml(value)}"
          ${describedBy ? `aria-describedby="${describedBy}"` : ''} ${error ? 'aria-invalid="true"' : ''} ${rules ? 'data-password-rules' : ''} required />
        <button class="field__reveal" type="button" data-acct-action="toggle-password" data-target="${id}" aria-controls="${id}" aria-pressed="false">Show</button>
      </div>
      ${rules ? `<ul class="password-rules" id="${id}-rules" data-rules-for="${id}">${passwordRuleState(value).map((rule) => `
        <li data-rule="${rule.id}" class="${rule.met ? 'is-met' : ''}"><span aria-hidden="true">${rule.met ? '✓' : '•'}</span> ${rule.label}<span class="visually-hidden">${rule.met ? ' (met)' : ' (not met yet)'}</span></li>`).join('')}
      </ul>` : ''}
      ${error ? `<p class="field__error" id="${id}-error">${escapeHtml(error)}</p>` : ''}
    </div>`;
}

function submitButton(label, pendingLabel, pending) {
  return `<button class="button button--primary button--block" type="submit" ${pending ? 'disabled aria-busy="true"' : ''}>
    ${pending ? `<span class="spinner" aria-hidden="true"></span>${pendingLabel}` : label}
  </button>`;
}

function card({ eyebrow = 'SabiBody account', title, intro = '', body }) {
  return `
    <main class="auth-layout" id="main">
      <section class="auth-card" aria-labelledby="auth-title">
        <p class="eyebrow">${eyebrow}</p>
        <h1 id="auth-title" tabindex="-1">${title}</h1>
        ${intro ? `<p class="auth-card__intro">${intro}</p>` : ''}
        ${body}
      </section>
      <aside class="auth-aside" aria-hidden="true">
        <p class="auth-aside__quote">“A little movement goes a long way.”</p>
        <ul class="auth-aside__points">
          <li>Rep counting with your camera</li>
          <li>Friendly voice coaching</li>
          <li>Your progress, saved securely</li>
        </ul>
      </aside>
    </main>`;
}

export function renderLogin(view) {
  const { values = {}, errors = {}, pending, error, notice, needsVerification, next } = view;
  return card({
    title: 'Welcome back',
    intro: 'Log in to see your dashboard and save your workouts.',
    body: `
      ${alert(notice, 'success')}
      ${alert(error)}
      ${needsVerification ? `<button class="button button--quiet button--block" type="button" data-acct-action="resend-verification">Send a new confirmation link</button>` : ''}
      <form class="form" data-acct-form="login" novalidate>
        <input type="hidden" name="next" value="${escapeHtml(next ?? '')}" />
        ${field({ id: 'login-email', name: 'email', label: 'Email address', type: 'email', autocomplete: 'email', value: values.email, error: errors.email, attrs: 'required inputmode="email"' })}
        ${passwordField({ id: 'login-password', error: errors.password })}
        <div class="form__row">
          <label class="checkbox"><input type="checkbox" name="remember" ${values.remember === false ? '' : 'checked'} /> <span>Keep me logged in</span></label>
          <a class="text-link" href="#/forgot-password">Forgot password?</a>
        </div>
        ${submitButton('Log in', 'Logging in…', pending)}
      </form>
      <p class="auth-card__switch">New to SabiBody? <a class="text-link" href="#/register">Create an account</a></p>`,
  });
}

export function renderRegister(view) {
  const { values = {}, errors = {}, pending, error, done } = view;
  if (done) {
    return card({
      eyebrow: 'Account created',
      title: done.verificationRequired ? 'Check your email' : 'You’re all set',
      intro: done.verificationRequired
        ? `We sent a confirmation link to <strong>${escapeHtml(done.email)}</strong>. Open it to activate your account, then log in.`
        : 'Your account is ready. Log in to start saving your workouts.',
      body: `
        ${alert(view.notice, 'success')}
        ${alert(error)}
        ${done.verificationRequired && !done.emailSent ? alert('We could not send the email just now. Use the button below to try again.', 'warning') : ''}
        <a class="button button--primary button--block" href="#/login">Go to login</a>
        ${done.verificationRequired ? '<button class="button button--quiet button--block" type="button" data-acct-action="resend-verification">Resend the link</button>' : ''}
        <p class="auth-card__switch">Wrong address? <a class="text-link" href="#/register" data-acct-action="register-again">Register again</a></p>`,
    });
  }
  return card({
    title: 'Create your account',
    intro: 'It’s free. Save every workout and watch your progress grow.',
    body: `
      ${alert(error)}
      <form class="form" data-acct-form="register" novalidate>
        ${field({ id: 'register-name', name: 'fullName', label: 'Full name', autocomplete: 'name', value: values.fullName, error: errors.fullName, attrs: 'required maxlength="120"' })}
        ${field({ id: 'register-email', name: 'email', label: 'Email address', type: 'email', autocomplete: 'email', value: values.email, error: errors.email, attrs: 'required inputmode="email"' })}
        ${passwordField({ id: 'register-password', label: 'Password', autocomplete: 'new-password', error: errors.password, rules: true, value: values.password })}
        ${passwordField({ id: 'register-confirm', name: 'confirmPassword', label: 'Confirm password', autocomplete: 'new-password', error: errors.confirmPassword, value: values.confirmPassword })}
        ${submitButton('Create account', 'Creating your account…', pending)}
      </form>
      <p class="auth-card__switch">Already have an account? <a class="text-link" href="#/login">Log in</a></p>`,
  });
}

export function renderForgotPassword(view) {
  const { values = {}, errors = {}, pending, error, notice } = view;
  return card({
    title: 'Reset your password',
    intro: 'Enter the email you registered with and we’ll send you a reset link.',
    body: `
      ${alert(notice, 'success')}
      ${alert(error)}
      <form class="form" data-acct-form="forgot-password" novalidate>
        ${field({ id: 'forgot-email', name: 'email', label: 'Email address', type: 'email', autocomplete: 'email', value: values.email, error: errors.email, attrs: 'required inputmode="email"' })}
        ${submitButton('Send reset link', 'Sending…', pending)}
      </form>
      <p class="auth-card__switch"><a class="text-link" href="#/login">Back to login</a></p>`,
  });
}

export function renderResetPassword(view) {
  const { values = {}, errors = {}, pending, error, done, token } = view;
  if (!token) {
    return card({ title: 'Link not valid', intro: 'This reset link is incomplete. Request a new one.', body: '<a class="button button--primary button--block" href="#/forgot-password">Request a new link</a>' });
  }
  if (done) {
    return card({ eyebrow: 'Password updated', title: 'Your password has been reset', intro: 'For your security, you were signed out on every device. Log in with your new password.', body: '<a class="button button--primary button--block" href="#/login">Log in</a>' });
  }
  return card({
    title: 'Choose a new password',
    body: `
      ${alert(error)}
      ${error ? '<p class="auth-card__switch"><a class="text-link" href="#/forgot-password">Request a new reset link</a></p>' : ''}
      <form class="form" data-acct-form="reset-password" novalidate>
        ${passwordField({ id: 'reset-password', label: 'New password', autocomplete: 'new-password', error: errors.password, rules: true, value: values.password })}
        ${passwordField({ id: 'reset-confirm', name: 'confirmPassword', label: 'Confirm new password', autocomplete: 'new-password', error: errors.confirmPassword, value: values.confirmPassword })}
        ${submitButton('Save new password', 'Saving…', pending)}
      </form>`,
  });
}

export function renderVerifyEmail(view) {
  const { status, message, authenticated } = view;
  if (status === 'pending' || status === undefined) {
    return card({ title: 'Confirming your email…', body: '<p class="loading-line"><span class="spinner" aria-hidden="true"></span> One moment.</p>' });
  }
  if (status === 'success') {
    return card({
      eyebrow: 'Email confirmed',
      title: 'Thanks — you’re confirmed',
      intro: escapeHtml(message),
      body: authenticated
        ? '<a class="button button--primary button--block" href="#/settings">Back to settings</a>'
        : '<a class="button button--primary button--block" href="#/login">Log in</a>',
    });
  }
  return card({
    title: 'We couldn’t confirm that link',
    intro: escapeHtml(message || 'The link is invalid or has expired.'),
    body: '<a class="button button--primary button--block" href="#/login">Go to login</a><p class="auth-card__switch">From the login page you can request a new confirmation link.</p>',
  });
}

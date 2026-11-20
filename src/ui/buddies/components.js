/** Small building blocks shared by the Buddies pages (cards, avatars, notices, tabs). */
import { escapeHtml } from '../account/format.js';

export { escapeHtml };

export function notice(message, tone = 'error') {
  if (!message) {
    return '';
  }
  return `<div class="notice notice--${tone}" role="${tone === 'error' ? 'alert' : 'status'}">${escapeHtml(message)}</div>`;
}

export function pageHeader({ eyebrow = 'SabiBody Buddies', title, intro = '', actions = '' }) {
  return `
    <header class="page-header">
      <div>
        ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
        <h1 id="page-title" tabindex="-1">${escapeHtml(title)}</h1>
        ${intro ? `<p class="page-header__intro">${intro}</p>` : ''}
      </div>
      ${actions ? `<div class="page-header__actions">${actions}</div>` : ''}
    </header>`;
}

export function loadingState(label = 'Loading…') {
  return `<div class="state-panel" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><p>${escapeHtml(label)}</p></div>`;
}

export function errorState(message, retryAction = 'retry') {
  return `
    <div class="state-panel state-panel--error" role="alert">
      <p><strong>We couldn’t load this.</strong></p>
      <p>${escapeHtml(message || 'Please check your connection and try again.')}</p>
      <button class="button button--quiet" type="button" data-buddy-action="${retryAction}">Try again</button>
    </div>`;
}

export function emptyState({ title, body = '', action = '' }) {
  return `
    <div class="buddy-empty">
      <p class="buddy-empty__title">${escapeHtml(title)}</p>
      ${body ? `<p class="buddy-empty__body">${body}</p>` : ''}
      ${action}
    </div>`;
}

export function avatar(person, size = '') {
  const initials = person?.initials || String(person?.display_name ?? '?').slice(0, 2).toUpperCase();
  return `<span class="avatar${size ? ` avatar--${size}` : ''}" aria-hidden="true">${escapeHtml(initials)}</span>`;
}

export function personLine(person) {
  return `
    <span class="person-line">
      ${avatar(person, 'sm')}
      <span class="person-line__text">
        <span class="person-line__name">${escapeHtml(person?.display_name ?? 'SabiBody member')}</span>
        <span class="person-line__handle">@${escapeHtml(person?.username ?? '')}</span>
      </span>
    </span>`;
}

export function tabs(items, active, label) {
  return `
    <nav class="buddy-tabs" aria-label="${escapeHtml(label)}">
      ${items.map(({ id, title, href, count }) => `
        <a class="buddy-tabs__tab${id === active ? ' is-active' : ''}" href="${href}"${id === active ? ' aria-current="page"' : ''}>
          ${escapeHtml(title)}${count ? ` <span class="count-pill" aria-label="${count} new">${count}</span>` : ''}
        </a>`).join('')}
    </nav>`;
}

export function busyAttrs(isBusy) {
  return isBusy ? ' disabled aria-busy="true"' : '';
}

export function relativeTime(iso, now = Date.now()) {
  if (!iso) {
    return '';
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(iso));
}

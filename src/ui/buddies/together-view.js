/**
 * The Workout Together screen: both people side by side (stacked on phones),
 * each with their own counter. Rendered once per room, then patched in place
 * so the live <video> elements are never recreated mid-workout.
 */
import { EXERCISES } from '../exercise-content.js';
import { escapeHtml } from '../account/format.js';
import { CHEERS } from '../../buddies/shared-workout.js';

function unitFor(exerciseId) {
  return exerciseId === 'plank' ? 'seconds' : 'reps';
}

function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function completedOf(progress, exerciseId) {
  if (!progress) return 0;
  return exerciseId === 'plank' ? Math.floor((progress.elapsed_ms ?? 0) / 1000) : (progress.count ?? 0);
}

export function togetherScreenKey(shared) {
  const s = shared.getState();
  return `together:${s.sessionId}:${s.phase === 'error' ? 'error' : s.session ? 'room' : 'loading'}`;
}

export function renderTogether(root, appState, shared) {
  const s = shared.getState();
  if (s.phase === 'error') {
    root.innerHTML = `
      <main class="duo-page duo-page--message" id="main">
        <div class="state-panel state-panel--error" role="alert">
          <h1 id="page-title" tabindex="-1">Can’t open this workout</h1>
          <p>${escapeHtml(s.error)}</p>
          <button class="button button--primary" type="button" data-action="duo-leave">Back to calendar</button>
        </div>
      </main>`;
    return;
  }
  if (!s.session) {
    root.innerHTML = `
      <main class="duo-page duo-page--message" id="main">
        <div class="state-panel" role="status"><span class="spinner" aria-hidden="true"></span><p>Opening your shared workout…</p></div>
      </main>`;
    return;
  }
  const session = s.session;
  const partner = session.partner ?? {};
  const unit = unitFor(session.exercise_id);
  const exercise = EXERCISES[session.exercise_id];
  root.innerHTML = `
    <main class="duo-page" id="main" data-duo>
      <header class="duo-top">
        <div class="duo-title">
          <p class="duo-eyebrow">Working out with ${escapeHtml(partner.first_name ?? 'your friend')}</p>
          <h1 id="page-title" tabindex="-1">${escapeHtml(session.exercise_name)} · ${escapeHtml(session.target)} ${unit}</h1>
        </div>
        <div class="duo-meta">
          <span class="duo-chip" data-duo-connection role="status">Connecting…</span>
          <span class="duo-chip duo-chip--timer" data-duo-timer aria-label="Workout time">00:00</span>
          <span class="duo-live" data-duo-live title="Your camera and microphone are on while you’re in this room. Nothing is recorded."><span class="duo-live__dot" aria-hidden="true"></span><span data-duo-live-text>Camera &amp; mic on</span></span>
        </div>
      </header>

      <div class="duo-stage">
        <section class="duo-tile duo-tile--me" aria-label="You">
          <video class="duo-video duo-video--local" data-local-video autoplay muted playsinline aria-label="Your camera (mirrored)"></video>
          <canvas class="duo-canvas" data-local-canvas aria-hidden="true"></canvas>
          <div class="duo-tile__name"><span>You</span><span class="duo-tile__icons" data-duo-me-media></span></div>
          <div class="duo-tile__panel">
            <p class="duo-count"><strong data-duo-me-count>0</strong><span> / ${escapeHtml(session.target)} ${unit}</span></p>
            <div class="duo-bar" aria-hidden="true"><span data-duo-me-bar></span></div>
            <p class="duo-tile__state" data-duo-me-state>Getting ready</p>
          </div>
        </section>
        <section class="duo-tile duo-tile--partner" aria-label="${escapeHtml(partner.display_name ?? 'Your partner')}">
          <div class="duo-remote-slot" data-remote-slot></div>
          <div class="duo-tile__placeholder" data-duo-partner-placeholder>
            <span class="avatar" aria-hidden="true">${escapeHtml(partner.initials ?? '')}</span>
            <p data-duo-partner-wait>Waiting for ${escapeHtml(partner.first_name ?? 'your friend')} to join…</p>
          </div>
          <div class="duo-tile__name"><span>${escapeHtml(partner.first_name ?? 'Partner')}</span><span class="duo-tile__icons" data-duo-partner-media></span></div>
          <div class="duo-tile__panel">
            <p class="duo-count"><strong data-duo-partner-count>0</strong><span> / ${escapeHtml(session.target)} ${unit}</span></p>
            <div class="duo-bar duo-bar--partner" aria-hidden="true"><span data-duo-partner-bar></span></div>
            <p class="duo-tile__state" data-duo-partner-state>Not here yet</p>
          </div>
        </section>
        <div class="duo-countdown" data-duo-countdown hidden aria-live="assertive"></div>
        <div class="duo-cheers" data-duo-cheers aria-live="polite"></div>
      </div>

      <p class="duo-banner" data-duo-banner role="status" hidden></p>
      <p class="duo-coach" data-duo-coach aria-live="polite"></p>

      <div class="duo-controls" role="toolbar" aria-label="Workout controls">
        <button class="button button--primary duo-ready" type="button" data-action="duo-ready">I’m ready</button>
        <button class="duo-toggle" type="button" data-action="duo-mic" aria-pressed="true"><span aria-hidden="true">🎙️</span> <span data-duo-mic-label>Mic on</span></button>
        <button class="duo-toggle" type="button" data-action="duo-cam" aria-pressed="true"><span aria-hidden="true">📷</span> <span data-duo-cam-label>Camera on</span></button>
        <button class="duo-toggle" type="button" data-action="duo-counts" aria-pressed="true"><span aria-hidden="true">🔢</span> <span data-duo-counts-label>Rep counts on</span></button>
        <details class="duo-cheer-menu">
          <summary>Cheer</summary>
          <div class="duo-cheer-menu__panel">
            ${Object.entries(CHEERS).map(([id, label]) => `<button class="chip" type="button" data-action="duo-cheer" data-cheer="${id}">${escapeHtml(label)}</button>`).join('')}
          </div>
        </details>
        <a class="duo-toggle" href="#/messages?with=${encodeURIComponent(partner.username ?? '')}" target="_blank" rel="noopener">💬 <span>Chat</span></a>
        <button class="button button--end duo-leave" type="button" data-action="duo-leave">Leave workout</button>
      </div>
      <p class="duo-hint" data-duo-hint>Tip: headphones stop the coach’s voice echoing to your friend.</p>

      <section class="duo-panel" data-duo-panel hidden aria-live="polite"></section>
      ${exercise ? `<p class="duo-instructions"><strong>${escapeHtml(exercise.name)}:</strong> ${escapeHtml(exercise.cameraInstruction)}</p>` : ''}
    </main>`;
  root.querySelector('#page-title')?.focus?.({ preventScroll: true });
}

function setText(root, selector, text) {
  const el = root.querySelector(selector);
  if (el && el.textContent !== text) el.textContent = text;
}

function setPressed(root, selector, pressed) {
  const el = root.querySelector(selector);
  if (el) el.setAttribute('aria-pressed', String(pressed));
}

function connectionLabel(s, partnerMember) {
  if (s.phase === 'joining') return ['Joining…', 'pending'];
  if (!partnerMember?.connected) {
    if (partnerMember?.left) return ['Partner left', 'muted'];
    if (partnerMember?.reconnectDeadline && partnerMember.reconnectDeadline > Date.now()) return ['Partner reconnecting…', 'warning'];
    return ['Waiting for partner', 'pending'];
  }
  switch (s.connection) {
    case 'connected': return ['Connected', 'ok'];
    case 'failed': return ['Video unavailable', 'warning'];
    case 'disconnected': return ['Reconnecting video…', 'warning'];
    default: return ['Connecting video…', 'pending'];
  }
}

function partnerStateText(member, exerciseId, firstName) {
  if (!member) return 'Not here yet';
  if (member.finished) return `${firstName} finished!`;
  if (!member.connected) {
    if (member.left) return `${firstName} left the workout`;
    if (member.reconnectDeadline) return `Reconnecting… (${formatClock((member.reconnectDeadline - Date.now()) / 1000)})`;
    return 'Not here yet';
  }
  switch (member.progress?.status) {
    case 'running': return exerciseId === 'plank' ? 'Holding the plank' : 'Working out';
    case 'positioning': return 'Getting into position';
    case 'paused': return 'Paused';
    default: return member.ready ? 'Ready' : 'Getting ready';
  }
}

function panelKey(s) {
  return JSON.stringify([s.phase, s.summary?.session_id, s.summary?.status, s.roundProposal, s.myFinished]);
}

function summaryMarkup(summary, s, saveState) {
  const unit = unitFor(summary.exercise_id);
  const rows = summary.participants.map((p) => {
    const result = p.result;
    const value = !result ? 'No result saved'
      : summary.exercise_id === 'plank' ? `${result.duration_seconds} seconds` : `${result.completed_reps} reps`;
    return `
      <li class="duo-summary__person">
        <span class="avatar avatar--sm" aria-hidden="true">${escapeHtml(p.user?.initials ?? '')}</span>
        <span><strong>${p.is_me ? 'You' : escapeHtml(p.user?.first_name ?? 'Partner')}</strong><br />${escapeHtml(value)}</span>
        <span class="badge badge--${result?.completed ? 'success' : 'muted'}">${result?.completed ? 'Completed' : 'Not completed'}</span>
      </li>`;
  }).join('');
  const partnerName = summary.participants.find((p) => !p.is_me)?.user?.first_name ?? 'your friend';
  const headline = summary.both_completed
    ? `Great work! You and ${escapeHtml(partnerName)} completed your ${escapeHtml(summary.exercise_name.toLowerCase())} workout.`
    : `Workout finished. Every rep counts — plan the next one together.`;
  const streak = summary.streaks
    ? `<p class="duo-summary__streak">🔥 Buddy streak: <strong>${summary.streaks.buddy?.current ?? 0}</strong> · ${escapeHtml(summary.exercise_name)} streak: <strong>${summary.streaks.exercise?.current ?? 0}</strong>${summary.streaks.milestone ? ` · 🎉 ${summary.streaks.milestone} shared workouts!` : ''}</p>`
    : '';
  const proposal = s.roundProposal;
  const myId = summary.participants.find((p) => p.is_me)?.user?.id;
  const proposedByMe = proposal && proposal.by === myId;
  let rounds;
  if (proposal && !proposedByMe) {
    rounds = `<div class="duo-round"><p><strong>${escapeHtml(partnerName)}</strong> wants another round: ${escapeHtml(EXERCISES[proposal.exercise_id]?.name ?? proposal.exercise_id)} · ${escapeHtml(proposal.target)} ${unitFor(proposal.exercise_id)}</p>
      <button class="button button--primary button--small" type="button" data-action="duo-round-accept">Let’s go</button>
      <button class="button button--quiet button--small" type="button" data-action="duo-round-decline">Not now</button></div>`;
  } else if (proposal) {
    rounds = `<p class="muted">Waiting for ${escapeHtml(partnerName)} to agree to another round…</p>`;
  } else {
    rounds = `
      <form class="duo-round-form" data-duo-round-form>
        <button class="button button--primary button--small" type="button" data-action="duo-round-repeat" data-exercise="${escapeHtml(summary.exercise_id)}" data-target="${escapeHtml(summary.target)}">Repeat ${escapeHtml(summary.exercise_name)}</button>
        <label class="visually-hidden" for="duo-next-exercise">Choose another exercise</label>
        <select id="duo-next-exercise" class="field__input" data-duo-next-exercise>
          ${Object.entries(EXERCISES).map(([id, ex]) => `<option value="${id}"${id === summary.exercise_id ? ' selected' : ''}>${escapeHtml(ex.name)}</option>`).join('')}
        </select>
        <input class="field__input" type="number" min="1" max="3600" value="${escapeHtml(summary.target)}" data-duo-next-target aria-label="Target" />
        <button class="button button--quiet button--small" type="button" data-action="duo-round-other">Choose this exercise</button>
      </form>`;
  }
  return `
    <h2>${summary.both_completed ? '🎉 ' : ''}${headline}</h2>
    <ul class="duo-summary__list">${rows}</ul>
    <p class="muted">${escapeHtml(summary.exercise_name)} · target ${escapeHtml(summary.target)} ${unit}${summary.session_duration_seconds ? ` · ${formatClock(summary.session_duration_seconds)} together` : ''}</p>
    ${streak}
    ${saveState?.status === 'error' ? `<p class="notice notice--error">Your result wasn’t saved: ${escapeHtml(saveState.message)} <button class="text-button" type="button" data-acct-action="retry-save">Try again</button></p>` : ''}
    <div class="duo-summary__next">
      ${rounds}
      <a class="button button--quiet button--small" href="#/calendar?new=scheduled&amp;with=${encodeURIComponent(summary.participants.find((p) => !p.is_me)?.user?.username ?? '')}&amp;exercise=${encodeURIComponent(summary.exercise_id)}">Schedule another workout</a>
      <button class="button button--quiet button--small" type="button" data-action="duo-dashboard">Back to dashboard</button>
    </div>`;
}

export function updateTogether(root, appState, shared) {
  const s = shared.getState();
  if (!s.session || s.phase === 'error') return;
  const session = s.session;
  const exerciseId = session.exercise_id;
  const target = session.target;
  const partner = session.partner ?? {};
  const partnerMember = s.members[partner.id];
  const workoutStatus = appState.workoutStatus;

  // Local video preview and remote video element (moved, never recreated).
  shared.attachLocalVideo(root.querySelector('[data-local-video]'));
  const slot = root.querySelector('[data-remote-slot]');
  const remote = shared.remoteVideo();
  if (slot && remote && remote.parentNode !== slot) {
    slot.appendChild(remote);
    void remote.play?.()?.catch?.(() => {});
  }
  const hasRemote = Boolean(remote?.srcObject) && partnerMember?.connected && partnerMember?.media?.cam !== false;
  const placeholder = root.querySelector('[data-duo-partner-placeholder]');
  if (placeholder) placeholder.hidden = hasRemote;
  const reconnecting = partnerMember?.reconnectDeadline && partnerMember.reconnectDeadline > Date.now();
  setText(root, '[data-duo-partner-wait]', !partnerMember?.connected
    ? (partnerMember?.left ? `${partner.first_name} left the workout.`
      : reconnecting ? `${partner.first_name}’s connection dropped. Waiting for them to reconnect — this won’t count against either of you.`
        : `Waiting for ${partner.first_name ?? 'your friend'} to join…`)
    : partnerMember?.media?.cam === false ? `${partner.first_name}’s camera is off` : 'Connecting video…');

  // My progress (from this device's own tracking).
  const myCompleted = exerciseId === 'plank' ? Math.floor((appState.elapsedMs ?? 0) / 1000) : (appState.count ?? 0);
  setText(root, '[data-duo-me-count]', String(Math.min(myCompleted, target)));
  const myBar = root.querySelector('[data-duo-me-bar]');
  if (myBar) myBar.style.width = `${Math.min(100, (myCompleted / target) * 100)}%`;
  const myState = s.myFinished ? 'Done! 🎉'
    : workoutStatus === 'running' ? (exerciseId === 'plank' ? 'Hold steady' : 'Go!')
      : workoutStatus === 'loading' ? 'Get into position — counting starts when you’re in view'
        : workoutStatus === 'paused' ? 'Paused'
          : s.ready ? 'Ready' : 'Press “I’m ready” when you’re set';
  setText(root, '[data-duo-me-state]', myState);
  setText(root, '[data-duo-me-media]', `${s.media.mic ? '' : '🔇'}${s.media.cam ? '' : ' 📷✕'}`);

  // Partner progress (numbers relayed from their device).
  const partnerCompleted = completedOf(partnerMember?.progress, exerciseId);
  setText(root, '[data-duo-partner-count]', String(Math.min(partnerCompleted, target)));
  const partnerBar = root.querySelector('[data-duo-partner-bar]');
  if (partnerBar) partnerBar.style.width = `${Math.min(100, (partnerCompleted / target) * 100)}%`;
  setText(root, '[data-duo-partner-state]', partnerStateText(partnerMember, exerciseId, partner.first_name ?? 'Partner'));
  setText(root, '[data-duo-partner-media]', partnerMember?.connected ? `${partnerMember.media?.mic === false ? '🔇' : ''}` : '');

  // Header: connection + timer + live indicator.
  const [label, tone] = connectionLabel(s, partnerMember);
  const chip = root.querySelector('[data-duo-connection]');
  if (chip) {
    chip.textContent = label;
    chip.dataset.tone = tone;
  }
  const elapsed = s.startedAtMs ? (Date.now() - s.startedAtMs) / 1000 : 0;
  setText(root, '[data-duo-timer]', formatClock(s.summary?.session_duration_seconds ?? elapsed));
  const live = root.querySelector('[data-duo-live]');
  const camOn = s.media.status === 'ready';
  if (live) live.hidden = !camOn;
  setText(root, '[data-duo-live-text]', s.media.mic ? 'Camera & mic on' : 'Camera on · mic off');

  // Countdown overlay.
  const countdown = root.querySelector('[data-duo-countdown]');
  if (countdown) {
    countdown.hidden = s.phase !== 'countdown';
    countdown.textContent = s.phase === 'countdown' ? (s.countdown > 0 ? String(s.countdown) : 'Go!') : '';
  }

  // Cheers.
  const cheers = root.querySelector('[data-duo-cheers]');
  if (cheers) {
    const html = s.cheers.map((c) => `<span class="duo-cheer">${escapeHtml(c.from === partner.id ? `${partner.first_name}: ` : 'You: ')}${escapeHtml(CHEERS[c.cheer] ?? '')}</span>`).join('');
    if (cheers.innerHTML !== html) cheers.innerHTML = html;
  }

  // Banner: the single most important message right now.
  let banner = '';
  if (s.media.status === 'requesting') banner = 'Allow camera and microphone access to join your friend.';
  else if (s.media.status === 'denied' || s.media.status === 'error') banner = s.media.error;
  else if (s.media.error && s.phase !== 'summary') banner = s.media.error;
  else if (s.phase === 'summary') banner = '';
  else if (s.myFinished && partnerMember && !partnerMember.finished && partnerMember.connected) banner = 'You’re done! Your workout partner is still going. Keep cheering them on!';
  else if (s.myFinished) banner = partnerMember?.finished ? 'You both finished! Saving your results…' : 'You’re done! Waiting for your partner to finish.';
  else if (partnerMember?.finished && !s.myFinished && workoutStatus === 'running') banner = `${partner.first_name} finished — you’ve got this, keep going!`;
  else if (s.remoteAudioBlocked) banner = 'Tap “Enable sound” to hear your friend.';
  else if (s.phase === 'waiting' && s.ready && !partnerMember?.ready) banner = partnerMember?.connected ? `Waiting for ${partner.first_name} to be ready…` : `You’re ready. We’ll start when ${partner.first_name} joins and is ready.`;
  else if (s.connection === 'failed') banner = 'Video couldn’t connect on this network, but your counters still update live.';
  const bannerEl = root.querySelector('[data-duo-banner]');
  if (bannerEl) {
    bannerEl.hidden = !banner;
    if (bannerEl.textContent !== banner) bannerEl.textContent = banner;
  }
  setText(root, '[data-duo-coach]', workoutStatus === 'running' || workoutStatus === 'loading' ? (appState.feedback ?? '') : '');

  // Controls.
  const readyBtn = root.querySelector('.duo-ready');
  // Rejoined a workout that's already underway (page reload, lost connection): let me start counting again.
  const needsRestart = s.phase === 'active' && !s.myFinished && ['idle', 'error'].includes(workoutStatus);
  if (readyBtn && needsRestart && s.media.status === 'ready') {
    readyBtn.hidden = false;
    readyBtn.disabled = false;
    readyBtn.dataset.action = 'duo-start';
    readyBtn.textContent = 'Start counting';
  } else if (readyBtn) {
    const showReady = ['waiting', 'joining'].includes(s.phase);
    readyBtn.hidden = !showReady;
    readyBtn.disabled = s.media.status !== 'ready' || s.phase === 'joining';
    readyBtn.textContent = s.media.status === 'denied' || s.media.status === 'error' ? 'Camera needed' : s.ready ? 'Ready ✓ (tap to undo)' : 'I’m ready';
    if (s.media.status === 'denied' || s.media.status === 'error') {
      readyBtn.dataset.action = 'duo-retry-media';
      readyBtn.disabled = false;
      readyBtn.textContent = 'Try camera again';
    } else {
      readyBtn.dataset.action = 'duo-ready';
    }
  }
  setPressed(root, '[data-action="duo-mic"]', s.media.mic);
  setText(root, '[data-duo-mic-label]', s.media.micAvailable ? (s.media.mic ? 'Mic on' : 'Mic off') : 'No mic');
  const micBtn = root.querySelector('[data-action="duo-mic"]');
  if (micBtn) micBtn.disabled = !s.media.micAvailable;
  setPressed(root, '[data-action="duo-cam"]', s.media.cam);
  setText(root, '[data-duo-cam-label]', s.media.cam ? 'Camera on' : 'Camera hidden');
  setPressed(root, '[data-action="duo-counts"]', s.announceCounts);
  setText(root, '[data-duo-counts-label]', s.announceCounts ? 'Rep counts on' : 'Rep counts off');
  const hint = root.querySelector('[data-duo-hint]');
  if (hint) {
    hint.innerHTML = s.remoteAudioBlocked
      ? '<button class="button button--primary button--small" type="button" data-action="duo-enable-audio">Enable sound</button>'
      : 'Tip: headphones stop the coach’s voice echoing to your friend. Camera hidden still counts your reps.';
  }

  // Summary / rounds panel (rewritten only when it changes).
  const panel = root.querySelector('[data-duo-panel]');
  if (panel) {
    const key = panelKey(s) + JSON.stringify(appState.account?.save?.status ?? '');
    if (panel.dataset.key !== key) {
      panel.dataset.key = key;
      if (s.phase === 'summary' && s.summary) {
        panel.hidden = false;
        panel.innerHTML = summaryMarkup(s.summary, s, appState.account?.save);
      } else {
        panel.hidden = true;
        panel.innerHTML = '';
      }
    }
  }
}

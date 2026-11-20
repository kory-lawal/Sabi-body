import { calendarDateLabel, escapeHtml, formatDuration, weekdayLabel } from './format.js';

/** Seven columns of bars; heights are relative to the busiest day (min scale 3). */
export function weeklyActivityChart(days = [], { todayIso = '' } = {}) {
  const max = Math.max(3, ...days.map((day) => day.workouts));
  const total = days.reduce((sum, day) => sum + day.workouts, 0);
  const columns = days.map((day) => {
    const height = day.workouts ? Math.max(8, Math.round((day.workouts / max) * 100)) : 0;
    const label = `${weekdayLabel(day.date, 'long')} ${calendarDateLabel(day.date)}: ${day.workouts} ${day.workouts === 1 ? 'workout' : 'workouts'}${day.workouts ? `, ${day.reps} reps, ${formatDuration(day.seconds)}` : ''}`;
    return `
      <li class="week-chart__day${day.date === todayIso ? ' is-today' : ''}" aria-label="${escapeHtml(label)}">
        <span class="week-chart__value" aria-hidden="true">${day.workouts || ''}</span>
        <span class="week-chart__track" aria-hidden="true"><span class="week-chart__bar" style="height:${height}%"></span></span>
        <span class="week-chart__label" aria-hidden="true">${escapeHtml(weekdayLabel(day.date).slice(0, 3))}</span>
      </li>`;
  }).join('');
  return `
    <figure class="week-chart">
      <ol class="week-chart__days" aria-label="Workouts per day">${columns}</ol>
      <figcaption class="visually-hidden">${total} completed ${total === 1 ? 'workout' : 'workouts'} this week.</figcaption>
    </figure>`;
}

/** Daily new registrations as bars with the cumulative total as a line. */
export function growthChart(series = []) {
  if (!series.length) {
    return '<p class="empty-note">No registration data yet.</p>';
  }
  const width = 600;
  const height = 200;
  const pad = { top: 12, right: 4, bottom: 4, left: 4 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxNew = Math.max(1, ...series.map((point) => point.new_users));
  const minTotal = Math.min(...series.map((point) => point.total_users));
  const maxTotal = Math.max(minTotal + 1, ...series.map((point) => point.total_users));
  const step = innerW / series.length;
  const bars = series.map((point, index) => {
    const barHeight = (point.new_users / maxNew) * innerH * 0.55;
    const x = pad.left + index * step + step * 0.18;
    return `<rect class="growth-chart__bar" x="${x.toFixed(1)}" y="${(pad.top + innerH - barHeight).toFixed(1)}" width="${(step * 0.64).toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2"><title>${escapeHtml(calendarDateLabel(point.date))}: ${point.new_users} new</title></rect>`;
  }).join('');
  const line = series.map((point, index) => {
    const x = pad.left + index * step + step / 2;
    const y = pad.top + innerH - ((point.total_users - minTotal) / (maxTotal - minTotal)) * innerH;
    return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const labelEvery = Math.max(1, Math.round((series.length - 1) / 4));
  const labels = series.filter((_, index) => index % labelEvery === 0)
    .map((point) => `<span>${escapeHtml(calendarDateLabel(point.date))}</span>`).join('');
  const first = series[0];
  const last = series.at(-1);
  const newTotal = series.reduce((sum, point) => sum + point.new_users, 0);
  return `
    <figure class="growth-chart">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(`${newTotal} new registrations between ${calendarDateLabel(first.date)} and ${calendarDateLabel(last.date)}; total users grew from ${first.total_users} to ${last.total_users}.`)}">
        <line class="growth-chart__axis" vector-effect="non-scaling-stroke" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + innerH}" y2="${pad.top + innerH}" />
        ${bars}
        <path class="growth-chart__line" vector-effect="non-scaling-stroke" d="${line}" />
      </svg>
      <div class="growth-chart__labels" aria-hidden="true">${labels}</div>
      <figcaption class="growth-chart__legend"><span class="legend-swatch legend-swatch--bar"></span>New users per day <span class="legend-swatch legend-swatch--line"></span>Total users</figcaption>
    </figure>`;
}

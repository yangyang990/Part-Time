// Small UI toolkit: safe HTML templates, toasts, modals, formatting, files and GPS.

export const state = { user: null, profile: null, profileComplete: false, stats: null, meta: { currency: '$', ranks: [] } };

// ---- safe templating: values are escaped unless wrapped in raw() / produced by html`` ----
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const val = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(val).join('')
  : v === null || v === undefined || v === false ? '' : esc(v));
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += val(v) + strings[i + 1]; });
  return new Safe(out);
}
export function mount(el, content) { el.innerHTML = val(content); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---- API ----
export async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---- toasts ----
export function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), type === 'error' ? 5000 : 3000);
  setTimeout(() => el.remove(), type === 'error' ? 5400 : 3400);
}

/** Run an async action with a busy button and toast any error. */
export async function busy(button, fn) {
  const label = button?.innerHTML;
  if (button) { button.disabled = true; button.classList.add('loading'); }
  try { return await fn(); }
  catch (err) { toast(err.message, 'error'); }
  finally { if (button) { button.disabled = false; button.classList.remove('loading'); button.innerHTML = label; } }
}

// ---- modal ----
export function modal(content, { wide = false, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
    <button class="modal-x" aria-label="Close">${icons.x}</button><div class="modal-body"></div></div>`;
  mount(wrap.querySelector('.modal-body'), content);
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => e.key === 'Escape' && close();
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.modal-x')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(wrap);
  return { el: wrap.querySelector('.modal-body'), close };
}

export function confirmDialog(message, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(html`<p class="confirm-msg">${message}</p>
      <div class="row-end"><button class="btn btn-ghost" data-no>Cancel</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${okLabel}</button></div>`,
    { onClose: () => !done && resolve(false) });
    m.el.querySelector('[data-no]').onclick = () => m.close();
    m.el.querySelector('[data-yes]').onclick = () => { done = true; m.close(); resolve(true); };
  });
}

// ---- formatting ----
const dFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const tFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
export const fmtDate = (iso) => dFmt.format(new Date(iso));
export const fmtTime = (iso) => tFmt.format(new Date(iso));
export const fmtDateTime = (iso) => `${fmtDate(iso)}, ${fmtTime(iso)}`;
export function fmtRange(start, end) {
  const s = new Date(start), e = new Date(end);
  return s.toDateString() === e.toDateString()
    ? `${fmtDate(start)} · ${fmtTime(start)} – ${fmtTime(end)}`
    : `${fmtDateTime(start)} – ${fmtDateTime(end)}`;
}
export const money = (n) => `${state.meta.currency}${Number(n).toLocaleString(undefined, { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const payLabel = (e) => `${money(e.pay)} / ${e.pay_unit}`;
export const fmtDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function relTime(iso) {
  const diff = new Date(iso) - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 36e5) return rtf.format(Math.round(diff / 6e4), 'minute');
  if (abs < 864e5) return rtf.format(Math.round(diff / 36e5), 'hour');
  return rtf.format(Math.round(diff / 864e5), 'day');
}
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// ---- bits of UI used everywhere ----
export const icons = {
  x: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  cash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
  shirt: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z"/></svg>',
  users: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></svg>',
  camera: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  file: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  image: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  task: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>',
};

const RANK_ICONS = {
  rookie: '<circle cx="12" cy="12" r="4.5" fill="currentColor"/>',
  trooper: '<path d="M5 14l7-5 7 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  ranger: '<path d="M5 11l7-5 7 5M5 17l7-5 7 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  elite: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" fill="currentColor"/>',
};
export const rankIcon = (key, size = 16) =>
  raw(`<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${RANK_ICONS[key] || RANK_ICONS.rookie}</svg>`);
export const rankBadge = (rank, big = false) =>
  html`<span class="rank rank-${rank.key} ${big ? 'rank-big' : ''}">${rankIcon(rank.key, big ? 22 : 14)}${rank.name}</span>`;
export const rankByKey = (key) => state.meta.ranks.find((r) => r.key === key) || { key, name: key };

export function stars(value, max = 5) {
  const pct = Math.max(0, Math.min(1, (value || 0) / max)) * 100;
  return html`<span class="stars" title="${(value || 0).toFixed(1)} / ${max}" aria-label="${(value || 0).toFixed(1)} out of ${max} stars">
    <span class="stars-bg">★★★★★</span><span class="stars-fg" style="width:${pct}%">★★★★★</span></span>`;
}

export function avatar(src, name, size = 40) {
  return src
    ? html`<img class="avatar" src="${src}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px">`
    : html`<span class="avatar avatar-ph" style="width:${size}px;height:${size}px;font-size:${size * 0.4}px">${initials(name)}</span>`;
}

export const statusChip = (s) => {
  const labels = { pending: 'Pending', approved: 'Approved', rejected: 'Not selected', cancelled: 'Cancelled', open: 'Open', closed: 'Closed' };
  return html`<span class="chip chip-${s}">${labels[s] || s}</span>`;
};

export const empty = (title, body = '', action = '') =>
  html`<div class="empty"><div class="empty-title">${title}</div>${body ? html`<p>${body}</p>` : ''}${action}</div>`;

// ---- files ----
export const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('Could not read that file.'));
  r.readAsDataURL(file);
});

/** Shrink a photo before upload so it is fast on mobile data. */
export async function compressImage(file, max = 1280, quality = 0.82) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a photo.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not open that photo.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---- GPS ----
export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device cannot share its location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1
        ? 'Location permission is blocked. Allow location for this site in your browser settings.'
        : 'Could not get your location. Move to an open area and try again.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

// ---- event requirements & terms ----
export const splitTags = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

/** Does free text (e.g. a profile's "English, Mandarin") cover this tag (e.g. "Chinese (Mandarin)")? */
export function tagMatches(tag, text) {
  const hay = String(text || '').toLowerCase();
  if (!hay) return false;
  return tag.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2).some((w) => hay.includes(w));
}

/** Chips for a comma list. With `against`, chips the person has are ticked. */
export function tagChips(list, against) {
  const tags = splitTags(list);
  if (!tags.length) return '';
  return html`<span class="tags">${tags.map((t) => {
    const hit = against !== undefined && tagMatches(t, against);
    return html`<span class="tag ${against !== undefined ? (hit ? 'tag-hit' : 'tag-miss') : ''}">${hit ? '✓ ' : ''}${t}</span>`;
  })}</span>`;
}

export const payDueDate = (e) => new Date(new Date(e.end_at).getTime() + (e.payment_days ?? 14) * 864e5);

/** Payment line + rules list, shown to both organiser and part-timer. */
export function termsBlock(e) {
  const rules = String(e.terms || '').split('\n').map((s) => s.replace(/^[\s•\-*]+/, '').trim()).filter(Boolean);
  return html`<div class="terms">
    <p class="terms-pay">${raw(icons.cash)} <span>Payment <b>${e.payment_days ?? 14} days</b> after the event — by <b>${fmtDate(payDueDate(e).toISOString())}</b></span></p>
    ${rules.length ? html`<ol class="terms-rules">${rules.map((r) => html`<li>${r}</li>`)}</ol>` : html`<p class="muted small">No extra rules for this event.</p>`}
  </div>`;
}

// ---- photo tasks ----
/** When a task is due (Date), or null if it can be done any time during the shift. */
export const taskDueAt = (t, e) => (t.due_min == null ? null : new Date(new Date(e.start_at).getTime() + t.due_min * 6e4));
export function taskDueLabel(t, e) {
  if (t.due_min == null) return 'Any time during the shift';
  const at = fmtTime(taskDueAt(t, e).toISOString());
  if (t.due_min === 0) return `At the start (${at})`;
  const span = t.due_min % 60 === 0 ? `${t.due_min / 60} h` : `${t.due_min} min`;
  return `Within the first ${span} · by ${at}`;
}
/** Was this submission sent after the task's deadline? */
export const taskLate = (t, e, s) => !!(s && t.due_min != null && new Date(s.created_at) > taskDueAt(t, e));

export const lateMinutes = (a, e) => (a.checkin_at ? Math.round((new Date(a.checkin_at) - new Date(e.start_at)) / 6e4) : 0);

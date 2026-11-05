import { state, api, html, mount, $, $$, avatar, rankBadge, toast } from './ui.js';
import { renderAuth } from './auth.js';
import * as admin from './admin.js';
import * as worker from './worker.js';

const NAV = {
  admin: [
    { href: '#/events', label: 'Events', match: /^\/events/ },
    { href: '#/crew', label: 'Crew & ranks', match: /^\/crew/ },
  ],
  worker: [
    { href: '#/jobs', label: 'Find jobs', match: /^\/jobs/ },
    { href: '#/shifts', label: 'My shifts', match: /^\/shifts/ },
    { href: '#/rank', label: 'My rank', match: /^\/rank/ },
    { href: '#/profile', label: 'Profile', match: /^\/profile/ },
  ],
};

export async function refreshMe() {
  const me = await api('/api/me');
  Object.assign(state, { user: me.user, meta: me.meta, profile: me.profile || null,
    profileComplete: !!me.profileComplete, stats: me.stats || null });
}

function shell() {
  const role = state.user.role;
  const who = role === 'worker'
    ? html`${avatar(state.profile?.avatar, state.user.name, 30)}<span class="who-name">${state.user.name}</span>${state.stats ? rankBadge(state.stats.rank) : ''}`
    : html`<span class="who-role">Organiser</span><span class="who-name">${state.user.name}</span>`;
  mount($('#app'), html`
    <header class="topbar">
      <a class="brand" href="#/">ShiftCrew</a>
      <nav class="nav nav-top">${NAV[role].map((n) => html`<a href="${n.href}" data-nav="${n.href}">${n.label}</a>`)}</nav>
      <div class="who">${who}
        ${state.user.can_organise ? html`<button class="btn btn-ghost btn-sm switch" id="switch-role">${role === 'admin' ? 'Part-timer view' : 'Organiser view'}</button>` : ''}
        <button class="btn btn-ghost btn-sm" id="logout">Log out</button></div>
    </header>
    <main id="view" class="view"></main>
    <nav class="nav nav-bottom">${NAV[role].map((n) => html`<a href="${n.href}" data-nav="${n.href}">${n.label}</a>`)}</nav>`);
  const sw = $('#switch-role');
  if (sw) sw.onclick = () => switchRole(role === 'admin' ? 'worker' : 'admin');
  $('#logout').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null;
    location.hash = '';
    render();
  };
}

/** Flip this account between organiser and part-timer mode. */
export async function switchRole(role) {
  await api('/api/auth/role', { method: 'POST', body: { role } });
  await refreshMe();
  toast(role === 'admin' ? 'Switched to organiser view' : 'Switched to part-timer view');
  if (location.hash === '#/') render();
  else location.hash = '#/';
}

let shellFor = null;
export async function render() {
  if (!state.user) { shellFor = null; return renderAuth(); }
  const key = `${state.user.id}:${state.user.role}:${state.user.can_organise}:${state.user.name}:${state.profile?.avatar}:${state.stats?.rank.key}`;
  if (shellFor !== key) { shell(); shellFor = key; }

  const path = location.hash.replace(/^#/, '') || '/';
  const role = state.user.role;
  for (const a of $$('[data-nav]')) {
    a.classList.toggle('active', NAV[role].find((n) => n.href === a.dataset.nav).match.test(path));
  }
  const view = $('#view');
  view.scrollTop = 0;
  window.scrollTo(0, 0);
  try {
    if (role === 'admin') await admin.route(path, view);
    else {
      // New part-timers fill in their profile once before anything else.
      if (!state.profileComplete && !path.startsWith('/profile')) { location.replace('#/profile'); return; }
      await worker.route(path, view);
    }
  } catch (err) {
    // Session expired or changed in another tab: reload who we are and try once more.
    if ((err.status === 401 || err.status === 403) && !render.retrying) {
      render.retrying = true;
      try { await refreshMe(); return await render(); } finally { render.retrying = false; }
    }
    mount(view, html`<div class="empty"><div class="empty-title">Something went wrong</div><p>${err.message}</p></div>`);
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Something went wrong', 'error'));

refreshMe().then(render).catch(() => mount($('#app'), html`<div class="boot">Cannot reach the server. Is it running?</div>`));

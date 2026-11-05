import { api, html, mount, $, $$, busy } from './ui.js';
import { refreshMe, render } from './main.js';

export function renderAuth(mode = 'login', role = 'worker') {
  const isLogin = mode === 'login';
  mount($('#app'), html`
    <div class="auth">
      <section class="auth-hero">
        <div class="brand brand-lg">ShiftCrew</div>
        <h1>Run your part-time crew without the <em>group-chat chaos.</em></h1>
        <ul class="hero-points">
          <li><b>Organisers</b> post events with location, time, pay and dress code, pick crew, and rate them after.</li>
          <li><b>Part-timers</b> set up a profile once, apply in one tap, and check in with GPS + photo proof.</li>
          <li><b>Ranks</b> — Rookie → Trooper → Ranger → Elite — reward people who show up and do great work.</li>
        </ul>
      </section>
      <section class="auth-card card">
        <div class="tabs">
          <button class="tab ${isLogin ? 'active' : ''}" data-mode="login">Log in</button>
          <button class="tab ${!isLogin ? 'active' : ''}" data-mode="register">Sign up</button>
        </div>
        <form id="auth-form" class="form" novalidate>
          ${isLogin ? '' : html`
            <div class="field">
              <span class="label">I am a…</span>
              <div class="role-pick">
                <label class="role-opt"><input type="radio" name="role" value="worker" ${role === 'worker' ? 'checked' : ''}>
                  <span><b>Part-timer</b><small>Find and work shifts</small></span></label>
                <label class="role-opt"><input type="radio" name="role" value="admin" ${role === 'admin' ? 'checked' : ''}>
                  <span><b>Organiser</b><small>Post events, manage crew</small></span></label>
              </div>
            </div>
            <label class="field"><span class="label">Full name</span><input name="name" autocomplete="name" required></label>`}
          <label class="field"><span class="label">Email</span><input name="email" type="email" autocomplete="email" required></label>
          <label class="field"><span class="label">Password</span>
            <input name="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" minlength="6" required></label>
          ${!isLogin && role === 'admin' ? html`
            <label class="field"><span class="label">Organiser code</span>
              <input name="organiserCode" autocomplete="off" required>
              <span class="hint">Ask the site owner for this code. It stops random people creating organiser accounts.</span></label>` : ''}
          <button class="btn btn-primary btn-block" type="submit">${isLogin ? 'Log in' : 'Create account'}</button>
        </form>
      </section>
    </div>`);

  // Keep what was typed when switching tab / role.
  const keep = (values) => {
    for (const [k, v] of Object.entries(values)) { const el = $(`#auth-form [name=${k}]`); if (el && el.type !== 'radio') el.value = v; }
  };
  const typed = () => Object.fromEntries(new FormData($('#auth-form')));
  for (const t of $$('[data-mode]')) t.onclick = () => { const v = typed(); renderAuth(t.dataset.mode, role); keep(v); };
  for (const r of $$('input[name=role]')) r.onchange = () => { const v = typed(); renderAuth('register', r.value); keep(v); };

  $('#auth-form').onsubmit = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    busy(e.submitter, async () => {
      await api(isLogin ? '/api/auth/login' : '/api/auth/register', { method: 'POST', body });
      await refreshMe();
      if (location.hash === '#/') render();
      else location.hash = '#/'; // hashchange renders
    });
  };
}

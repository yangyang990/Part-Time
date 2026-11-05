import {
  state, api, html, raw, mount, $, $$, busy, toast, modal, confirmDialog, icons,
  fmtRange, fmtDateTime, fmtTime, fmtDate, payLabel, money, fmtDistance, relTime,
  rankBadge, rankByKey, stars, avatar, statusChip, empty,
  fileToDataUrl, compressImage, getPosition, distanceMeters, tagChips, termsBlock, payDueDate, splitTags, tagMatches,
  taskDueLabel, taskDueAt, taskLate,
  expectedPay, shiftHours, fmtHours, payEstimate, bindPayEstimate,
} from './ui.js';
import { chatPage } from './chat.js';
import { siteMap } from './map.js';
import { refreshMe, render } from './main.js';

export async function route(path, view) {
  if (path === '/' || path === '/jobs') return jobs(view);
  if (path === '/shifts') return shifts(view);
  const chat = path.match(/^\/shifts\/chat\/(\d+)$/);
  if (chat) return chatPage(view, Number(chat[1]), '#/shifts', 'My shifts');
  if (path === '/rank') return rank(view);
  if (path === '/profile') return profile(view);
  location.replace('#/jobs');
}

const myLevel = () => state.stats?.rank.level ?? 0;
const levelOf = (key) => { const i = state.meta.ranks.findIndex((r) => r.key === key); return state.meta.ranks.length - 1 - i; };

// ---------------------------------------------------------------- find jobs

async function jobs(view) {
  const { events } = await api('/api/events');
  const card = (e) => {
    const left = e.slots - e.approved_count;
    const locked = levelOf(e.min_rank) > myLevel();
    return html`
      <button class="card event-card job-card ${locked ? 'locked' : ''}" data-ev="${e.id}">
        <div class="event-card-head"><h3>${e.title}</h3>
          ${e.my_status && e.my_status !== 'cancelled' ? statusChip(e.my_status) : html`<span class="pay-tag">${payLabel(e)}</span>`}</div>
        <div class="muted small">${e.organiser}</div>
        <div class="meta">
          <span>${raw(icons.clock)}${fmtRange(e.start_at, e.end_at)}</span>
          <span>${raw(icons.pin)}${e.location_name}</span>
          <span>${raw(icons.cash)}<b>${money(expectedPay(e))}</b>&nbsp;for this shift</span>
          ${e.dress_code ? html`<span>${raw(icons.shirt)}${e.dress_code}</span>` : ''}
        </div>
        ${e.skills || e.languages ? html`<div class="card-tags">${tagChips(e.skills)}${tagChips(e.languages, state.profile?.languages)}</div>` : ''}
        <div class="event-card-foot">
          <span class="${left <= 0 ? 'warn' : 'muted'}">${raw(icons.users)} ${left > 0 ? `${left} of ${e.slots} spots left` : 'Full'}</span>
          ${e.min_rank !== 'rookie' ? html`<span class="${locked ? 'lock' : ''}">${rankBadge(rankByKey(e.min_rank))}${locked ? ' required' : '+'}</span>` : ''}
        </div>
      </button>`;
  };

  mount(view, html`
    <div class="page-head"><div><h1>Find jobs</h1><p class="muted">${events.length} open event${events.length === 1 ? '' : 's'}. Tap one for details.</p></div></div>
    ${events.length ? html`<div class="grid">${events.map(card)}</div>`
      : empty('No open jobs right now', 'New events from organisers will show up here. Check back soon.')}`);

  for (const b of $$('[data-ev]')) b.onclick = () => jobModal(events.find((e) => e.id === Number(b.dataset.ev)), () => jobs(view));
}

function jobModal(e, onDone) {
  const left = e.slots - e.approved_count;
  const locked = levelOf(e.min_rank) > myLevel();
  const applied = e.my_status && e.my_status !== 'cancelled';
  const m = modal(html`
    <h2>${e.title}</h2>
    <p class="muted">${e.organiser}</p>
    <dl class="facts">
      <div><dt>${raw(icons.clock)} When</dt><dd>${fmtRange(e.start_at, e.end_at)}<small>${relTime(e.start_at)}</small></dd></div>
      <div><dt>${raw(icons.pin)} Where</dt><dd>${e.location_name}</dd></div>
      <div><dt>${raw(icons.cash)} Pay</dt><dd>${payLabel(e)}<small>${money(expectedPay(e))} in total for ${fmtHours(shiftHours(e))}</small></dd></div>
      <div><dt>${raw(icons.shirt)} Wear</dt><dd>${e.dress_code || 'No dress code given'}</dd></div>
      <div><dt>${raw(icons.users)} Spots</dt><dd>${left > 0 ? `${left} of ${e.slots} left` : 'Full'}${e.min_rank !== 'rookie' ? html` · ${rankBadge(rankByKey(e.min_rank))}+ only` : ''}</dd></div>
    </dl>
    ${e.description ? html`<p class="desc">${e.description}</p>` : ''}
    ${e.skills || e.languages ? html`<div class="reqs">
      ${e.skills ? html`<div><span class="label">Looking for</span>${tagChips(e.skills)}</div>` : ''}
      ${e.languages ? html`<div><span class="label">Must speak</span>${tagChips(e.languages, state.profile?.languages)}</div>` : ''}
    </div>` : ''}
    <div id="job-map" class="map"></div>
    <h3 class="terms-title">What you'll earn</h3>
    ${payEstimate(e)}
    <h3 class="terms-title">Payment &amp; rules</h3>
    ${termsBlock(e)}
    ${applied ? html`
      <div class="callout">You applied — status: ${statusChip(e.my_status)}${e.my_roles ? html`<br><small>Your role: <b>${e.my_roles}</b></small>` : ''}</div>
      ${['pending', 'approved'].includes(e.my_status) ? html`<button class="btn btn-ghost btn-block" id="cancel">Withdraw application</button>` : ''}`
    : locked ? html`<div class="callout callout-warn">This event is for ${rankByKey(e.min_rank).name} rank and above. You are ${state.stats.rank.name}. Do great shifts to rank up!</div>`
    : left <= 0 ? html`<div class="callout callout-warn">All spots are filled.</div>`
    : html`<form id="apply" class="form">
        ${e.skills ? html`<div class="field"><span class="label">Which role do you want? <small class="muted">(pick one or more)</small></span>
          <div class="tag-pick">${splitTags(e.skills).map((s) => html`<label class="tag-opt"><input type="checkbox" name="role" value="${s}"><span>${s}</span></label>`)}</div></div>` : ''}
        ${e.languages ? html`<div class="field"><span class="label">Which of these languages can you speak?</span>
          <div class="tag-pick">${splitTags(e.languages).map((s) => html`<label class="tag-opt"><input type="checkbox" name="lang" value="${s}" ${tagMatches(s, state.profile?.languages) ? 'checked' : ''}><span>${s}</span></label>`)}</div></div>` : ''}
        <label class="field"><span class="label">Message to organiser (optional)</span>
          <input name="note" maxlength="500" placeholder="e.g. I've done 3 roadshows before, can arrive early"></label>
        <label class="agree"><input type="checkbox" name="agree" required>
          <span>I have read and agree to the payment terms and rules above, including deductions for being late or not doing the job properly.</span></label>
        <button class="btn btn-primary btn-block" type="submit">Apply for this job</button>
      </form>`}`, { wide: true });

  siteMap($('#job-map', m.el), e);
  bindPayEstimate(m.el, e);
  $('#apply', m.el)?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(ev.submitter, async () => {
      const f = ev.target;
      const picked = (name) => [...f.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
      const roles = picked('role');
      const languages = picked('lang');
      if (e.skills && !roles.length) throw new Error('Pick at least one role you want to do.');
      if (e.languages && !languages.length) throw new Error('Tick the languages you can speak.');
      if (!f.elements.agree.checked) throw new Error('Please tick that you agree to the terms first.');
      await api(`/api/events/${e.id}/apply`, { method: 'POST', body: { note: f.elements.note.value, roles, languages, acceptTerms: true } });
      m.close();
      toast('Applied! You’ll see it under My shifts once the organiser replies.');
      onDone();
    });
  });
  $('#cancel', m.el)?.addEventListener('click', async (ev) => {
    if (!(await confirmDialog('Withdraw your application for this job?', 'Withdraw', true))) return;
    await busy(ev.target, () => api(`/api/applications/${e.my_app_id}/cancel`, { method: 'POST' }));
    m.close();
    onDone();
  });
}

// ---------------------------------------------------------------- my shifts + check in/out

async function shifts(view) {
  const { shifts: all } = await api('/api/my/shifts');
  const now = Date.now();
  const opensMs = state.meta.checkinOpensMin * 6e4;
  const active = all.filter((s) => s.status === 'approved' && !s.checkout_at && new Date(s.end_at) > now)
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  const waiting = all.filter((s) => s.status === 'pending' && new Date(s.end_at) > now);
  const history = all.filter((s) => !active.includes(s) && !waiting.includes(s) && s.status !== 'cancelled');
  const reload = () => shifts(view);

  const activeCard = (s) => {
    const opens = new Date(s.start_at).getTime() - opensMs;
    let action;
    if (s.checkin_at) {
      action = html`<div class="checked">Checked in ${fmtTime(s.checkin_at)}</div>
        <button class="btn btn-primary btn-lg btn-block" data-out="${s.id}">${raw(icons.camera)} Check out</button>`;
    } else if (now >= opens) {
      action = html`<button class="btn btn-primary btn-lg btn-block" data-in="${s.id}">${raw(icons.camera)} Check in</button>`;
    } else {
      action = html`<button class="btn btn-ghost btn-block" disabled>Check-in opens ${relTime(new Date(opens).toISOString())}</button>
        <button class="btn btn-ghost btn-sm btn-danger-text" data-cancel="${s.id}">Can't make it</button>`;
    }
    return html`<div class="card shift-card ${s.checkin_at ? 'on-shift' : ''}">
      <div class="event-card-head"><h3>${s.title}</h3>${s.checkin_at ? html`<span class="chip chip-live">On shift</span>` : statusChip('approved')}</div>
      <div class="meta">
        <span>${raw(icons.clock)}${fmtRange(s.start_at, s.end_at)}</span>
        <span>${raw(icons.pin)}${s.location_name} · <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener">Directions</a></span>
        <span>${raw(icons.cash)}${payLabel(s)} · <b>${money(expectedPay(s))}</b>&nbsp;for the shift</span>
        ${s.dress_code ? html`<span>${raw(icons.shirt)}${s.dress_code}</span>` : ''}
      </div>
      <button class="link-btn small" data-terms="${s.id}">Pay calculator, payment &amp; rules</button>
      ${s.tasks.length ? taskList(s) : ''}
      <div class="shift-action">${action}
        <a class="btn btn-ghost btn-block" href="#/shifts/chat/${s.event_id}">${raw(icons.chat)} Group chat</a></div>
    </div>`;
  };

  const taskList = (s) => {
    const done = s.tasks.filter((t) => t.submission).length;
    return html`<div class="tasks">
      <div class="tasks-head"><b>${raw(icons.task)} Photo tasks</b><small class="muted">${done}/${s.tasks.length} done</small></div>
      ${s.tasks.map((t) => {
        const sub = t.submission;
        const due = taskDueAt(t, s);
        const overdue = !sub && due && due < now;
        return html`<div class="task ${sub ? 'task-done' : ''}">
          ${sub ? html`<img class="task-thumb" src="${sub.photo}" alt="">` : html`<span class="task-dot"></span>`}
          <span class="task-text"><b>${t.title}</b>
            <small class="${overdue ? 'warn' : 'muted'}">${sub ? `Sent ${fmtTime(sub.created_at)}${taskLate(t, s, sub) ? ' (late)' : ''}` : `${taskDueLabel(t, s)}${overdue ? ' · overdue' : ''}`}</small>
            ${t.instructions && !sub ? html`<small>${t.instructions}</small>` : ''}</span>
          ${s.checkin_at ? html`<button class="btn ${sub ? 'btn-ghost' : 'btn-primary'} btn-sm" data-task="${s.id}:${t.id}">${sub ? 'Retake' : html`${raw(icons.camera)} Photo`}</button>`
            : html`<small class="muted">After check-in</small>`}
        </div>`;
      })}
    </div>`;
  };

  const totalEarned = history.reduce((n, s) => n + (s.earnings?.amount || 0), 0);
  const deductionLines = (s) => {
    let items = [];
    try { items = JSON.parse(s.deduction_items || '[]'); } catch { items = []; }
    if (!items.length) items = [{ label: s.deduction_reason || 'Deduction', amount: s.earnings.deduction }];
    return items.map((i) => html`<small class="warn">−${money(i.amount)} ${i.label}</small>`);
  };
  const needsPayDetails = !state.profile?.pay_method && all.some((s) => s.status === 'approved');

  mount(view, html`
    <div class="page-head"><div><h1>My shifts</h1>
      <p class="muted">${active.length} upcoming${totalEarned ? ` · ${money(totalEarned)} earned so far` : ''}</p></div></div>
    ${needsPayDetails ? html`<div class="callout callout-warn pay-callout">${raw(icons.cash)}
      <span>Add your bank or e-wallet details so organisers can pay you. <a href="#/profile">Add payment details</a></span></div>` : ''}
    ${active.length ? html`<div class="grid">${active.map(activeCard)}</div>`
      : empty('No confirmed shifts yet', 'Apply for jobs and they will appear here once an organiser approves you.',
        html`<a class="btn btn-primary" href="#/jobs">Find jobs</a>`)}
    ${waiting.length ? html`<h2 class="section-title">Waiting for reply</h2><div class="card list">${waiting.map((s) => html`
      <div class="list-row"><span class="person-text"><b>${s.title}</b><span class="muted">${fmtRange(s.start_at, s.end_at)}</span></span>
        ${statusChip('pending')}<button class="btn btn-ghost btn-sm" data-cancel="${s.id}">Withdraw</button></div>`)}</div>` : ''}
    ${history.length ? html`<h2 class="section-title">History</h2><div class="card list">${history.map((s) => html`
      <div class="list-row hist-row">
        <span class="person-text"><b>${s.title}</b><span class="muted">${fmtDate(s.start_at)} · ${s.location_name}</span></span>
        ${s.status !== 'approved' ? statusChip(s.status)
          : s.earnings ? html`<span class="dir-stat"><b>${money(s.earnings.amount)}</b>
              <small>${s.paid_at ? html`<span class="chip chip-approved">Paid ${fmtDate(s.paid_at)}</span>` : `${s.earnings.hours} h · paid by ${fmtDate(payDueDate(s).toISOString())}`}</small>
              ${s.earnings.deduction ? deductionLines(s) : ''}</span>`
          : html`<span class="muted small">No check-out</span>`}
        ${s.stars != null ? html`<span class="dir-stat">${stars(s.stars)}<small>${s.stars.toFixed(1)}</small></span>`
          : s.status === 'approved' ? html`<small class="muted">Not rated yet</small>` : html`<span></span>`}
      </div>`)}</div>` : ''}`);

  for (const b of $$('[data-terms]')) {
    b.onclick = () => {
      const s = all.find((x) => x.id === Number(b.dataset.terms));
      const m = modal(html`<h2>${s.title}</h2><h3 class="terms-title">What you'll earn</h3>${payEstimate(s)}
        <h3 class="terms-title">Payment &amp; rules</h3>${termsBlock(s)}`);
      bindPayEstimate(m.el, s);
    };
  }
  for (const b of $$('[data-task]')) {
    b.onclick = () => {
      const [sid, tid] = b.dataset.task.split(':').map(Number);
      const s = all.find((x) => x.id === sid);
      taskFlow(s, s.tasks.find((t) => t.id === tid), reload);
    };
  }
  for (const b of $$('[data-in]')) b.onclick = () => proofFlow(all.find((s) => s.id === Number(b.dataset.in)), 'checkin', reload);
  for (const b of $$('[data-out]')) b.onclick = () => proofFlow(all.find((s) => s.id === Number(b.dataset.out)), 'checkout', reload);
  for (const b of $$('[data-cancel]')) {
    b.onclick = async () => {
      if (!(await confirmDialog('Cancel this shift? The organiser will see you withdrew.', 'Yes, cancel', true))) return;
      await busy(b, () => api(`/api/applications/${b.dataset.cancel}/cancel`, { method: 'POST' }));
      reload();
    };
  }
}

/** Photo for one of the organiser's tasks. Location is attached when available but never required. */
function taskFlow(s, t, onDone) {
  let photo = null;
  let fix = null;
  const m = modal(html`
    <h2>${t.title}</h2>
    <p class="muted">${t.instructions || 'Take a photo for the organiser.'}</p>
    <p class="small ${taskDueAt(t, s) && taskDueAt(t, s) < new Date() && !t.submission ? 'warn' : 'muted'}">${raw(icons.clock)} ${taskDueLabel(t, s)}</p>
    <label class="photo-drop" id="task-drop">
      <input type="file" accept="image/*" capture="environment" id="task-in" hidden>
      <span class="photo-ph">${raw(icons.camera)}<b>Take photo</b><small>Tap to open camera</small></span>
    </label>
    <label class="field task-note"><span class="label">Note <small class="muted">(optional)</small></span>
      <input name="note" maxlength="300" placeholder="e.g. Booth B, near the entrance"></label>
    <button class="btn btn-primary btn-lg btn-block" id="task-send" disabled>Send to organiser</button>`);
  const send = $('#task-send', m.el);
  m.el.addEventListener('change', async (ev) => {
    if (ev.target.id !== 'task-in') return;
    const file = ev.target.files[0];
    if (!file) return;
    try {
      photo = await compressImage(file);
      mount($('#task-drop', m.el), html`<input type="file" accept="image/*" capture="environment" id="task-in" hidden>
        <img src="${photo}" alt="Your photo"><span class="retake">Retake</span>`);
      send.disabled = false;
    } catch (err) { toast(err.message, 'error'); }
  });
  getPosition().then((p) => { fix = p; }).catch(() => {});
  send.onclick = () => busy(send, async () => {
    await api(`/api/applications/${s.id}/tasks/${t.id}`, {
      method: 'POST', body: { photo, note: $('input[name=note]', m.el).value, lat: fix?.lat ?? null, lng: fix?.lng ?? null },
    });
    m.close();
    toast('Photo sent to the organiser');
    onDone();
  });
}

/** Selfie + GPS proof for check-in or check-out. */
function proofFlow(s, kind, onDone) {
  const isIn = kind === 'checkin';
  let photo = null, fix = null, map = null;

  const m = modal(html`
    <h2>${isIn ? 'Check in' : 'Check out'} · ${s.title}</h2>
    <p class="muted">${isIn ? 'Take a clear selfie at the location. Your GPS position is recorded as proof.'
      : 'Take a selfie before you leave. Your GPS position is recorded.'}</p>
    <div class="proof-steps">
      <label class="photo-drop" id="photo-drop">
        <input type="file" accept="image/*" capture="user" id="photo-in" hidden>
        <span class="photo-ph">${raw(icons.camera)}<b>Take selfie</b><small>Tap to open camera</small></span>
      </label>
      <div class="gps">
        <div id="gps-status" class="gps-status">Finding your location…</div>
        <div id="gps-map" class="map map-sm"></div>
        <button class="btn btn-ghost btn-sm" id="gps-retry" type="button">Refresh location</button>
      </div>
    </div>
    <button class="btn btn-primary btn-lg btn-block" id="submit" disabled>${isIn ? 'Check in now' : 'Check out now'}</button>`, { wide: true });

  const submit = $('#submit', m.el);
  const ready = () => {
    const inside = fix && fix.distance <= s.radius_m + Math.min(fix.accuracy, 100);
    submit.disabled = !(photo && fix && (inside || !isIn));
  };

  // Delegated so it keeps working after the preview replaces the input.
  m.el.addEventListener('change', async (ev) => {
    if (ev.target.id !== 'photo-in') return;
    const file = ev.target.files[0];
    if (!file) return;
    try {
      photo = await compressImage(file);
      mount($('#photo-drop', m.el), html`<input type="file" accept="image/*" capture="user" id="photo-in" hidden>
        <img src="${photo}" alt="Your selfie"><span class="retake">Retake</span>`);
    } catch (err) { toast(err.message, 'error'); }
    ready();
  });

  const locate = async () => {
    const status = $('#gps-status', m.el);
    status.className = 'gps-status';
    status.textContent = 'Finding your location…';
    try {
      const p = await getPosition();
      const distance = distanceMeters(p.lat, p.lng, s.lat, s.lng);
      fix = { ...p, distance };
      const inside = distance <= s.radius_m + Math.min(p.accuracy, 100);
      status.className = `gps-status ${inside ? 'ok' : 'bad'}`;
      status.textContent = inside
        ? `✓ You're at the location (${fmtDistance(distance)} from the pin, ±${Math.round(p.accuracy)} m)`
        : isIn
          ? `You're ${fmtDistance(distance)} away. Get within ${s.radius_m} m of ${s.location_name} to check in.`
          : `You're ${fmtDistance(distance)} from the site. You can still check out, but the organiser will see this.`;
      if (map) map.remove();
      map = siteMap($('#gps-map', m.el), s, [{ lat: p.lat, lng: p.lng, label: 'You' }]);
    } catch (err) {
      fix = null;
      status.className = 'gps-status bad';
      status.textContent = err.message;
    }
    ready();
  };
  $('#gps-retry', m.el).onclick = locate;
  locate();

  submit.onclick = () => busy(submit, async () => {
    const res = await api(`/api/applications/${s.id}/${kind}`, {
      method: 'POST', body: { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, photo },
    });
    m.close();
    toast(isIn ? 'Checked in. Have a great shift!' : res.outside ? 'Checked out (outside the area — organiser notified).' : 'Checked out. Thanks for your work!');
    onDone();
  });
}

// ---------------------------------------------------------------- rank

async function rank(view) {
  await refreshMe();
  const { feedback } = await api('/api/my/shifts');
  const st = state.stats;
  const r = st.rank;
  const ranks = state.meta.ranks;
  const nextDef = r.next && ranks.find((x) => x.key === r.next.key);
  const jobPct = nextDef ? Math.min(100, (st.ratedJobs / nextDef.minJobs) * 100) : 100;

  mount(view, html`
    <div class="page-head"><h1>My rank</h1></div>
    <section class="card rank-hero rank-hero-${r.key}">
      ${rankBadge(r, true)}
      <div class="rank-stats">
        <div><b>${st.avgStars ? st.avgStars.toFixed(2) : '—'}</b><small>avg rating</small></div>
        <div><b>${st.ratedJobs}</b><small>rated shifts</small></div>
        <div><b>${st.completed}</b><small>completed</small></div>
      </div>
      ${r.next ? html`
        <div class="next">
          <div class="next-head">Next: ${rankBadge(rankByKey(r.next.key))}</div>
          <div class="progress"><span style="width:${jobPct}%"></span></div>
          <p class="small">${r.next.jobsNeeded > 0 ? `${r.next.jobsNeeded} more rated shift${r.next.jobsNeeded > 1 ? 's' : ''}` : 'Enough shifts ✓'}
            · average ${r.next.minAvg.toFixed(1)}★ or higher ${r.next.avgOk ? '✓' : `(you have ${st.avgStars.toFixed(2)})`}</p>
        </div>` : html`<p class="next">You've reached the top rank. Legend.</p>`}
    </section>

    <h2 class="section-title">The ladder</h2>
    <div class="ladder">${ranks.map((x) => html`
      <div class="ladder-step ladder-${x.key} ${x.key === r.key ? 'current' : ''}">
        ${rankBadge(x, true)}
        <small>${x.minJobs ? `${x.minJobs}+ rated shifts & ${x.minAvg.toFixed(1)}★ avg` : 'Everyone starts here'}</small>
        <small class="muted">${x.blurb}</small>
      </div>`)}</div>
    <p class="muted small">Organisers rate you after each shift on punctuality, attitude and performance. Higher ranks unlock better-paid events.</p>

    <h2 class="section-title">Feedback from organisers</h2>
    ${feedback.length ? html`<div class="feedback">${feedback.map((f) => html`
      <div class="card fb"><div class="fb-head"><b>${f.title}</b><span class="muted">${fmtDate(f.created_at)}</span></div>
        <div>${stars(f.stars)} <small class="muted">Punctuality ${f.punctuality} · Attitude ${f.attitude} · Performance ${f.performance}</small></div>
        ${f.comment ? html`<p>“${f.comment}”</p>` : ''}</div>`)}</div>`
      : html`<p class="muted">No ratings yet. Finish a shift and your organiser will rate you.</p>`}`);
}

// ---------------------------------------------------------------- profile / resume

async function profile(view) {
  const p = state.profile || {};
  const first = !state.profileComplete;
  let avatarData = null, resumeData = null, removeResume = false;

  mount(view, html`
    <div class="page-head"><div>
      <h1>${first ? 'Set up your profile' : 'My profile'}</h1>
      <p class="muted">${first ? 'You only need to do this once. Organisers see this when you apply.' : 'Keep this up to date — organisers see it when you apply.'}</p>
    </div></div>
    <form id="pf" class="form form-cols" novalidate>
      <section class="card form-section">
        <h2>About you</h2>
        <div class="avatar-pick">
          <label class="avatar-drop" id="av-drop">${avatar(p.avatar, state.user.name, 96)}
            <input type="file" accept="image/*" id="av-in" hidden><span class="change">Change photo</span></label>
          <div><b>Profile photo *</b><p class="hint">A clear, recent photo of your face. Organisers compare it with your check-in selfie.</p></div>
        </div>
        <label class="field"><span class="label">Full name *</span><input name="name" value="${state.user.name}" required></label>
        <div class="field-row">
          <label class="field"><span class="label">Phone *</span><input name="phone" type="tel" value="${p.phone || ''}" required></label>
          <label class="field"><span class="label">City / area *</span><input name="city" value="${p.city || ''}" required></label>
        </div>
        <div class="field-row field-row-3">
          <label class="field"><span class="label">Date of birth</span><input name="birth_date" type="date" value="${p.birth_date || ''}"></label>
          <label class="field"><span class="label">Gender</span><select name="gender">
            ${['', 'Female', 'Male', 'Other', 'Prefer not to say'].map((g) => html`<option value="${g}" ${p.gender === g ? 'selected' : ''}>${g || '—'}</option>`)}</select></label>
          <label class="field"><span class="label">Height (cm)</span><input name="height_cm" type="number" min="100" max="230" value="${p.height_cm || ''}"></label>
        </div>
        <label class="field"><span class="label">Languages</span><input name="languages" value="${p.languages || ''}" placeholder="e.g. English, Malay, Mandarin"></label>
      </section>
      <section class="card form-section">
        <h2>Experience &amp; resume</h2>
        <label class="field"><span class="label">Work experience</span>
          <textarea name="experience" rows="4" placeholder="e.g. Roadshow promoter for 2 years, usher at concerts, F&B crew">${p.experience || ''}</textarea></label>
        <label class="field"><span class="label">Skills</span><input name="skills" value="${p.skills || ''}" placeholder="e.g. MC, crowd control, sales, driving licence"></label>
        <label class="field"><span class="label">Short intro</span>
          <textarea name="about" rows="3" placeholder="A few lines about yourself">${p.about || ''}</textarea></label>
        <div class="field"><span class="label">Resume / CV (optional)</span>
          <div class="resume-box" id="resume-box"></div>
          <input type="file" id="cv-in" accept=".pdf,.doc,.docx,image/*" hidden>
          <span class="hint">PDF, Word or photo, up to 3 MB.</span></div>
      </section>
      <section class="card form-section pay-section" id="pay">
        <h2>Payment details</h2>
        <p class="hint">Where organisers send your pay. Only organisers of events you're approved for can see this.</p>
        <div class="field-row">
          <label class="field"><span class="label">Payment method</span><select name="pay_method">
            <option value="">— Not set —</option>
            ${state.meta.payMethods.map((x) => html`<option ${p.pay_method === x ? 'selected' : ''}>${x}</option>`)}</select></label>
          <label class="field" data-bank-only><span class="label">Bank</span><select name="bank_name">
            <option value="">Choose bank</option>
            ${state.meta.banks.map((x) => html`<option ${p.bank_name === x ? 'selected' : ''}>${x}</option>`)}</select></label>
        </div>
        <div class="field-row">
          <label class="field"><span class="label" id="acct-label">Account number</span>
            <input name="bank_account_no" inputmode="numeric" autocomplete="off" maxlength="40" value="${p.bank_account_no || ''}"></label>
          <label class="field"><span class="label">Name on the account</span>
            <input name="bank_account_name" maxlength="100" value="${p.bank_account_name || state.user.name}"></label>
        </div>
      </section>
      <div class="form-actions"><button class="btn btn-primary btn-lg" type="submit">${first ? 'Save and start finding jobs' : 'Save changes'}</button></div>
    </form>`);

  // Show the bank picker and the right label for the chosen payment method.
  const pf = $('#pf');
  const syncPay = () => {
    const method = pf.elements.pay_method.value;
    $('[data-bank-only]').hidden = method !== 'Bank transfer';
    $('#acct-label').textContent = method === 'DuitNow' ? 'DuitNow ID (phone, IC or account no.)'
      : method === "Touch 'n Go eWallet" ? "Touch 'n Go phone number" : 'Account number';
    for (const n of ['bank_account_no', 'bank_account_name']) pf.elements[n].disabled = !method;
  };
  pf.elements.pay_method.onchange = syncPay;
  syncPay();

  const drawResume = () => mount($('#resume-box'), resumeData
    ? html`<span>${raw(icons.file)} ${resumeData.name}</span><button type="button" class="btn btn-ghost btn-sm" data-cv>Change</button>`
    : p.resume && !removeResume
      ? html`<a href="${p.resume}" target="_blank" rel="noopener">${raw(icons.file)} ${p.resume_name}</a>
          <button type="button" class="btn btn-ghost btn-sm" data-cv>Replace</button><button type="button" class="btn btn-ghost btn-sm" data-cv-rm>Remove</button>`
      : html`<button type="button" class="btn btn-ghost" data-cv>${raw(icons.plus)} Upload resume</button>`);
  const bindResume = () => {
    drawResume();
    $('[data-cv]').onclick = () => $('#cv-in').click();
    const rm = $('[data-cv-rm]');
    if (rm) rm.onclick = () => { removeResume = true; bindResume(); };
  };
  bindResume();
  $('#cv-in').onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    if (!f.type.startsWith("image/") && f.size > 3 * 1024 * 1024) return toast("That file is over 3 MB. Try saving it as a smaller PDF.", "error");
    resumeData = { name: f.name, dataUrl: f.type.startsWith('image/') ? await compressImage(f, 2000, 0.85) : await fileToDataUrl(f) };
    removeResume = false;
    bindResume();
  };

  $('#av-in').onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    try {
      avatarData = await compressImage(f, 600, 0.85);
      $('#av-drop .avatar').outerHTML = `<img class="avatar" src="${avatarData}" alt="" style="width:96px;height:96px">`;
    } catch (err) { toast(err.message, 'error'); }
  };

  $('#pf').onsubmit = (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target));
    if (avatarData) body.avatar = avatarData;
    if (resumeData) body.resume = resumeData;
    if (removeResume) body.removeResume = true;
    busy(ev.submitter, async () => {
      await api('/api/profile', { method: 'PUT', body });
      await refreshMe();
      toast(first ? 'Profile saved — you can now apply for jobs!' : 'Profile updated');
      if (first) location.hash = '#/jobs';
      else render();
    });
  };
}

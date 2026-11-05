import {
  state, api, html, raw, mount, $, $$, busy, toast, modal, confirmDialog, icons,
  fmtRange, fmtDateTime, fmtTime, fmtDate, payLabel, money, fmtDistance, toLocalInput, relTime,
  rankBadge, rankByKey, stars, avatar, statusChip, empty, tagChips, termsBlock, lateMinutes,
  taskDueLabel, taskDueAt, taskLate,
  dedRules, ruleCharge, expectedPay, payEstimate, bindPayEstimate, fmtHours, payDueDate,
} from './ui.js';
import { chatPage } from './chat.js';
import { siteMap, pickerMap, geocode } from './map.js';
import { getPosition } from './ui.js';

export async function route(path, view) {
  let m;
  if (path === '/' || path === '/events') return eventsList(view);
  if (path === '/events/new') return eventForm(view);
  if ((m = path.match(/^\/events\/(\d+)\/edit$/))) return eventForm(view, Number(m[1]));
  if ((m = path.match(/^\/events\/(\d+)$/))) return eventManage(view, Number(m[1]));
  if ((m = path.match(/^\/events\/(\d+)\/chat$/))) return chatPage(view, Number(m[1]), `#/events/${m[1]}`, 'Back to event');
  if (path === '/crew') return crewList(view);
  if ((m = path.match(/^\/crew\/(\d+)$/))) return crewDetail(view, Number(m[1]));
  location.replace('#/events');
}

const isLive = (e) => new Date(e.start_at) <= new Date() && new Date(e.end_at) > new Date();

// ---------------------------------------------------------------- events list

async function eventsList(view) {
  const { events } = await api('/api/admin/events');
  const now = new Date();
  const upcoming = events.filter((e) => new Date(e.end_at) > now).reverse();
  const past = events.filter((e) => new Date(e.end_at) <= now);
  const pendingTotal = upcoming.reduce((n, e) => n + e.pending_count, 0);

  const card = (e) => html`
    <a class="card event-card" href="#/events/${e.id}">
      <div class="event-card-head">
        <h3>${e.title}</h3>
        ${isLive(e) ? html`<span class="chip chip-live">Live now</span>` : statusChip(e.status)}
      </div>
      <div class="meta">
        <span>${raw(icons.clock)}${fmtRange(e.start_at, e.end_at)}</span>
        <span>${raw(icons.pin)}${e.location_name}</span>
        <span>${raw(icons.cash)}${payLabel(e)}</span>
      </div>
      <div class="event-card-foot">
        <span class="fill"><span class="fill-bar"><span style="width:${Math.min(100, (e.approved_count / e.slots) * 100)}%"></span></span>
          ${e.approved_count}/${e.slots} crew</span>
        ${e.pending_count ? html`<span class="chip chip-pending">${e.pending_count} to review</span>` : ''}
        ${isLive(e) ? html`<span class="muted">${e.checked_in_count} checked in</span>` : ''}
        ${e.min_rank !== 'rookie' ? rankBadge(rankByKey(e.min_rank)) : ''}
      </div>
    </a>`;

  mount(view, html`
    <div class="page-head">
      <div><h1>Events</h1><p class="muted">${upcoming.length} upcoming${pendingTotal ? html` · <b>${pendingTotal} applications</b> waiting for you` : ''}</p></div>
      <a class="btn btn-primary" href="#/events/new">${raw(icons.plus)} New event</a>
    </div>
    ${events.length === 0 ? empty('No events yet', 'Create your first event: set the place, time, pay and dress code, then crew can apply.',
      html`<a class="btn btn-primary" href="#/events/new">${raw(icons.plus)} Create event</a>`) : ''}
    ${upcoming.length ? html`<h2 class="section-title">Upcoming &amp; live</h2><div class="grid">${upcoming.map(card)}</div>` : ''}
    ${past.length ? html`<h2 class="section-title">Past</h2><div class="grid grid-muted">${past.map(card)}</div>` : ''}`);
}

// ---------------------------------------------------------------- create / edit

export const SKILL_PRESETS = ['Sales', 'Promotion', 'Product sampling', 'Usher', 'Crowd control', 'Event setup',
  'MC / Host', 'Cashier', 'Customer service', 'Booth crew', 'Flyering', 'Driving'];
export const LANGUAGE_PRESETS = ['English', 'Malay', 'Chinese (Mandarin)', 'Cantonese', 'Hokkien', 'Tamil'];
const splitTags = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

/** Tick-box chips: the presets plus any custom tags already on the event (those come ticked). */
const tagOptions = (name, presets, current) => {
  const have = splitTags(current);
  const custom = have.filter((s) => !presets.includes(s));
  return [...presets, ...custom].map((s) => html`<label class="tag-opt"><input type="checkbox" name="${name}" value="${s}" ${have.includes(s) ? 'checked' : ''}><span>${s}</span></label>`);
};

const DRESS_PRESETS = ['Black T-shirt', 'All black', 'White shirt, black pants', 'Smart casual', 'Formal', 'Closed shoes', 'Uniform provided'];

async function eventForm(view, id) {
  let e;
  if (id) e = (await api(`/api/admin/events/${id}`)).event;
  else {
    const start = new Date(); start.setDate(start.getDate() + 1); start.setHours(10, 0, 0, 0);
    const end = new Date(start); end.setHours(18);
    e = { title: '', description: '', location_name: '', lat: null, lng: null, radius_m: 200,
      start_at: start.toISOString(), end_at: end.toISOString(), pay: '', pay_unit: 'hour',
      dress_code: '', slots: 5, min_rank: 'rookie', status: 'open',
      skills: '', languages: '', payment_days: 14, terms: state.meta.defaultTerms, deduction_rules: null };
  }

  mount(view, html`
    <a class="back" href="${id ? `#/events/${id}` : '#/events'}">${raw(icons.back)} Back</a>
    <div class="page-head"><h1>${id ? 'Edit event' : 'New event'}</h1></div>
    <form id="ev-form" class="form form-cols" novalidate>
      <section class="card form-section">
        <h2>Basics</h2>
        <label class="field"><span class="label">Event / campaign title</span>
          <input name="title" value="${e.title}" placeholder="e.g. Mall Roadshow — Product Sampling" required></label>
        <label class="field"><span class="label">Job description</span>
          <textarea name="description" rows="4" placeholder="What will crew do? Briefing time, meals, breaks…">${e.description}</textarea></label>
        <div class="field-row">
          <label class="field"><span class="label">Start</span><input type="datetime-local" name="start_at" value="${toLocalInput(e.start_at)}" required></label>
          <label class="field"><span class="label">End</span><input type="datetime-local" name="end_at" value="${toLocalInput(e.end_at)}" required></label>
        </div>
        <div class="field-row">
          <label class="field"><span class="label">Pay (${state.meta.currency})</span>
            <input type="number" name="pay" min="0" step="0.01" value="${e.pay}" placeholder="0.00" required></label>
          <label class="field"><span class="label">Paid per</span>
            <select name="pay_unit">${['hour', 'day', 'shift'].map((u) => html`<option value="${u}" ${e.pay_unit === u ? 'selected' : ''}>${u}</option>`)}</select></label>
        </div>
        <div class="field-row">
          <label class="field"><span class="label">Crew needed</span><input type="number" name="slots" min="1" max="1000" value="${e.slots}" required></label>
          <label class="field"><span class="label">Minimum rank</span>
            <select name="min_rank">${[...state.meta.ranks].reverse().map((r) =>
              html`<option value="${r.key}" ${e.min_rank === r.key ? 'selected' : ''}>${r.key === 'rookie' ? 'Anyone (Rookie+)' : `${r.name} and above`}</option>`)}</select></label>
        </div>
        <label class="field"><span class="label">Clothing / dress code</span>
          <textarea name="dress_code" rows="2" placeholder="e.g. Black T-shirt, black jeans, white sneakers">${e.dress_code}</textarea>
          <span class="presets">${DRESS_PRESETS.map((p) => html`<button type="button" class="preset" data-preset="${p}">+ ${p}</button>`)}</span></label>
        <label class="field field-inline"><input type="checkbox" name="open" ${e.status === 'open' ? 'checked' : ''}>
          <span>Open for applications</span></label>
      </section>

      <section class="card form-section">
        <h2>Location &amp; check-in area</h2>
        <label class="field"><span class="label">Location name / address</span>
          <input name="location_name" value="${e.location_name}" placeholder="e.g. Main Atrium, City Mall" required></label>
        <div class="search-row">
          <input id="geo-q" placeholder="Search an address to move the pin…">
          <button type="button" class="btn btn-ghost" id="geo-go">Search</button>
          <button type="button" class="btn btn-ghost" id="geo-me">Use my location</button>
        </div>
        <div id="geo-results" class="geo-results"></div>
        <div id="picker" class="map map-tall"></div>
        <p class="hint" id="pin-hint">${e.lat != null ? '' : 'Click the map to drop a pin where crew should check in.'}</p>
        <label class="field"><span class="label">Check-in radius: <b id="radius-val">${e.radius_m} m</b></span>
          <input type="range" name="radius_m" min="50" max="1000" step="10" value="${e.radius_m}">
          <span class="hint">Crew can only check in when their phone's GPS is inside this circle.</span></label>
      </section>

      <section class="card form-section">
        <h2>Who you need</h2>
        <div class="field"><span class="label">Skills / job type</span>
          <div class="tag-pick" id="pick-skill">${tagOptions('skill', SKILL_PRESETS, e.skills)}</div>
          <div class="add-row"><input name="skills_other" placeholder="Add another skill (e.g. Barista, Photography)">
            <button type="button" class="btn btn-ghost btn-sm" data-add="skill">+ Add</button></div></div>
        <div class="field"><span class="label">Languages they must speak</span>
          <div class="tag-pick" id="pick-language">${tagOptions('language', LANGUAGE_PRESETS, e.languages)}</div>
          <div class="add-row"><input name="languages_other" placeholder="Add another language (e.g. Japanese)">
            <button type="button" class="btn btn-ghost btn-sm" data-add="language">+ Add</button></div>
          <span class="hint">Leave everything unticked if any language is fine.</span></div>
      </section>

      <section class="card form-section">
        <h2>Payment &amp; rules</h2>
        <label class="field"><span class="label">Payment is made</span>
          <span class="inline-num"><input type="number" name="payment_days" min="0" max="120" value="${e.payment_days ?? 14}"> days after the event ends</span></label>
        <label class="field"><span class="label">Terms &amp; conditions (one rule per line)</span>
          <textarea name="terms" rows="8" placeholder="e.g. Late check-in: RM10 deducted for every 15 minutes late">${e.terms || ''}</textarea></label>
        <span class="hint">Part-timers must tick “I agree” to these before they can apply. <button type="button" class="link-btn" id="terms-default">Use the default rules</button></span>
        <div class="field"><span class="label">Deductions (${state.meta.currency})</span>
          <div class="ded-list" id="ded-list"></div>
          <div class="row"><button type="button" class="btn btn-ghost btn-sm" id="ded-add">${raw(icons.plus)} Add deduction</button>
            <button type="button" class="btn btn-ghost btn-sm" id="ded-late">${raw(icons.plus)} Add late rule</button></div>
          <span class="hint">Part-timers see these amounts in a pay calculator before applying. When you deduct pay, you pick from this list.</span></div>
      </section>

      <div class="form-actions">
        <a class="btn btn-ghost" href="${id ? `#/events/${id}` : '#/events'}">Cancel</a>
        <button class="btn btn-primary" type="submit">${id ? 'Save changes' : 'Create event'}</button>
      </div>
    </form>`);

  const form = $('#ev-form');
  let coords = e.lat != null ? { lat: e.lat, lng: e.lng } : null;
  const picker = pickerMap($('#picker'), {
    lat: e.lat, lng: e.lng, radius: e.radius_m,
    onChange: (lat, lng) => { coords = { lat, lng }; $('#pin-hint').textContent = `Pinned at ${lat.toFixed(5)}, ${lng.toFixed(5)} — drag the pin to adjust.`; },
  });
  form.elements.radius_m.oninput = () => { $('#radius-val').textContent = `${form.elements.radius_m.value} m`; picker.setRadius(Number(form.elements.radius_m.value)); };

  $('#terms-default').onclick = () => { form.elements.terms.value = state.meta.defaultTerms; };

  // Deduction rules: fixed amounts, plus at most one "per X minutes late" rule.
  const dedRow = (r) => html`<div class="ded-row" data-late-rule="${r.per_min ? 1 : ''}">
    <input class="ded-label" value="${r.label}" maxlength="60" placeholder="e.g. Wrong attire" aria-label="Deduction reason">
    <span class="inline-num"><input class="ded-amount" type="number" min="0" step="0.5" value="${r.amount}" aria-label="Amount"></span>
    <button type="button" class="btn btn-ghost btn-sm ded-rm" aria-label="Remove">${raw(icons.x)}</button>
    ${r.per_min ? html`<span class="inline-num ded-per">for every <input class="ded-per-min" type="number" min="1" max="240" value="${r.per_min}" aria-label="Minutes"> minutes late</span>` : ''}
  </div>`;
  const dedList = $('#ded-list');
  const syncLateBtn = () => { $('#ded-late').hidden = !!dedList.querySelector('[data-late-rule="1"]'); };
  mount(dedList, dedRules(e).map(dedRow));
  syncLateBtn();
  const addRow = (r) => { dedList.insertAdjacentHTML('beforeend', String(dedRow(r))); syncLateBtn(); dedList.lastElementChild.querySelector('input').focus(); };
  $('#ded-add').onclick = () => addRow({ label: '', amount: '' });
  $('#ded-late').onclick = () => addRow({ label: 'Late check-in', amount: 10, per_min: 15 });
  dedList.addEventListener('click', (ev) => { const b = ev.target.closest('.ded-rm'); if (b) { b.closest('.ded-row').remove(); syncLateBtn(); } });
  const readDedRows = () => [...dedList.querySelectorAll('.ded-row')].map((row) => ({
    label: row.querySelector('.ded-label').value.trim(),
    amount: Number(row.querySelector('.ded-amount').value) || 0,
    ...(row.dataset.lateRule ? { per_min: Number(row.querySelector('.ded-per-min').value) || 15 } : {}),
  })).filter((r) => r.label);

  // "+ Add" (or Enter) turns what was typed into a ticked chip.
  const other = { skill: 'skills_other', language: 'languages_other' };
  const addTags = (kind) => {
    const input = form.elements[other[kind]];
    for (const value of splitTags(input.value)) {
      const box = [...form.querySelectorAll(`input[name="${kind}"]`)].find((i) => i.value.toLowerCase() === value.toLowerCase());
      if (box) { box.checked = true; continue; }
      const label = document.createElement('label');
      label.className = 'tag-opt';
      const cb = Object.assign(document.createElement('input'), { type: 'checkbox', name: kind, value: value.slice(0, 40), checked: true });
      const span = document.createElement('span');
      span.textContent = cb.value;
      label.append(cb, span);
      $(`#pick-${kind}`).append(label);
    }
    input.value = '';
    input.focus();
  };
  for (const [kind, name] of Object.entries(other)) {
    form.querySelector(`[data-add="${kind}"]`).onclick = () => addTags(kind);
    form.elements[name].onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addTags(kind); } };
  }

  for (const b of $$('[data-preset]')) {
    b.onclick = () => {
      const t = form.elements.dress_code;
      t.value = t.value.trim() ? `${t.value.trim().replace(/[.,]$/, '')}, ${b.dataset.preset}` : b.dataset.preset;
    };
  }

  const search = () => busy($('#geo-go'), async () => {
    const q = $('#geo-q').value.trim();
    if (!q) return;
    const results = await geocode(q);
    mount($('#geo-results'), results.length
      ? results.map((r, i) => html`<button type="button" class="geo-hit" data-i="${i}">${r.name}</button>`)
      : html`<p class="hint">No matches. Try a shorter search or click the map.</p>`);
    for (const b of $$('.geo-hit')) {
      b.onclick = () => {
        const r = results[Number(b.dataset.i)];
        picker.set(r.lat, r.lng, true);
        if (!form.elements.location_name.value.trim()) form.elements.location_name.value = r.name.split(',').slice(0, 2).join(',');
        mount($('#geo-results'), '');
      };
    }
  });
  $('#geo-go').onclick = search;
  $('#geo-q').onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); search(); } };
  $('#geo-me').onclick = () => busy($('#geo-me'), async () => { const p = await getPosition(); picker.set(p.lat, p.lng, true); });

  form.onsubmit = (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const f = Object.fromEntries(fd);
    f.skills = [...fd.getAll('skill'), ...splitTags(f.skills_other)];
    f.languages = [...fd.getAll('language'), ...splitTags(f.languages_other)];
    if (!coords) return toast('Drop a pin on the map for the check-in location.', 'error');
    const body = {
      ...f, ...coords,
      start_at: f.start_at && new Date(f.start_at).toISOString(),
      end_at: f.end_at && new Date(f.end_at).toISOString(),
      status: form.elements.open.checked ? 'open' : 'closed',
      deduction_rules: JSON.stringify(readDedRows()),
    };
    busy(ev.submitter, async () => {
      const res = await api(id ? `/api/admin/events/${id}` : '/api/admin/events', { method: id ? 'PUT' : 'POST', body });
      toast(id ? 'Event updated' : 'Event created — crew can now apply');
      location.hash = `#/events/${id || res.id}`;
    });
  };
}

// ---------------------------------------------------------------- manage one event

async function eventManage(view, id) {
  const { event: e, applications, tasks, submissions, messageCount } = await api(`/api/admin/events/${id}`);
  const by = (s) => applications.filter((a) => a.status === s);
  const pending = by('pending'), crew = by('approved');
  const others = applications.filter((a) => ['rejected', 'cancelled'].includes(a.status));
  const ended = new Date(e.end_at) <= new Date();
  const reload = () => eventManage(view, id);

  const who = (a, withRole = false) => html`
    <button class="person" data-profile="${a.worker_id}">
      ${avatar(a.avatar, a.name, 44)}
      <span class="person-text"><b>${a.name}</b>
        <span class="person-sub">${a.stats ? rankBadge(a.stats.rank) : ''}
          ${a.stats?.ratedJobs ? html`${stars(a.stats.avgStars)} <span class="muted">${a.stats.avgStars.toFixed(1)} · ${a.stats.ratedJobs} rated</span>` : html`<span class="muted">No ratings yet</span>`}</span>
        ${withRole && a.chosen_roles ? roleChips(a.chosen_roles) : ''}
      </span>
    </button>`;
  // Event languages, ticked exactly where the applicant said they speak it.
  const speaks = (list, chosen) => {
    const have = new Set(splitTags(chosen).map((s) => s.toLowerCase()));
    return html`<span class="tags">${splitTags(list).map((l) => have.has(l.toLowerCase())
      ? html`<span class="tag tag-hit">✓ ${l}</span>` : html`<span class="tag tag-miss">✗ ${l}</span>`)}</span>`;
  };
  const roleChips = (list) => html`<span class="tags">${splitTags(list).map((r) => html`<span class="tag tag-role">${r}</span>`)}</span>`;

  const proof = (a, kind) => {
    const at = a[`${kind}_at`];
    if (!at) return html`<span class="muted">—</span>`;
    const flag = kind === 'checkout' && a.checkout_outside;
    const late = kind === 'checkin' ? lateMinutes(a, e) : 0;
    return html`<button class="proof" data-proof="${a.id}" data-kind="${kind}">
      <img src="${a[`${kind}_photo`]}" alt="${kind} photo">
      <span><b>${fmtTime(at)}${late > 0 ? html` <span class="chip chip-rejected">Late ${late} min</span>` : ''}</b>
        <small class="${flag ? 'warn' : ''}">${flag ? raw(icons.warn) : ''}${fmtDistance(a[`${kind}_distance`])} from site</small></span>
    </button>`;
  };

  const crewRow = (a) => html`
    <div class="crew-row">
      ${who(a, true)}
      <div class="crew-cell"><span class="cell-label">Check in</span>${proof(a, 'checkin')}</div>
      <div class="crew-cell"><span class="cell-label">Check out</span>${proof(a, 'checkout')}</div>
      <div class="crew-cell"><span class="cell-label">Pay</span>
        ${a.earnings ? html`<b>${money(a.earnings.amount)}</b><small>${a.earnings.hours} h${a.earnings.deduction ? html` · <span class="warn">−${money(a.earnings.deduction)}</span>` : ''}</small>` : html`<span class="muted">—</span>`}
        ${a.deduction ? html`<small class="warn" title="${a.deduction_reason}">${a.deduction_reason}</small>` : ''}
        ${a.checkin_at ? html`<button class="link-btn small" data-deduct="${a.id}">${a.deduction ? 'Edit deduction' : 'Deduct pay'}</button>` : ''}</div>
      <div class="crew-cell crew-actions">
        ${a.stars != null
          ? html`<button class="rated" data-rate="${a.id}" title="Edit rating">${stars(a.stars)}<small>${a.stars.toFixed(1)} · edit</small></button>`
          : a.checkout_at || ended
            ? html`<button class="btn btn-primary btn-sm" data-rate="${a.id}">Rate</button>`
            : !a.checkin_at ? html`<button class="btn btn-ghost btn-sm" data-status="${a.id}" data-to="pending">Remove</button>` : html`<span class="chip chip-live">On shift</span>`}
      </div>
    </div>`;

  // Everyone who worked (checked in) gets a payment line once they have checked out or the event is over.
  const payRows = crew.filter((a) => a.checkin_at && (a.checkout_at || ended));
  const netOf = (a) => (a.earnings ? a.earnings.amount : 0);
  const toPay = payRows.filter((a) => !a.paid_at).reduce((n, a) => n + netOf(a), 0);
  const payDetails = (a) => {
    if (!a.pay_method) return html`<span class="warn small">${raw(icons.warn)} No payment details in their profile yet</span>`;
    return html`<span class="pay-details"><b>${a.pay_method}${a.bank_name ? ` · ${a.bank_name}` : ''}</b>
      <span class="pay-acct"><code>${a.bank_account_no}</code><button type="button" class="link-btn small" data-copy="${a.bank_account_no}">Copy</button></span>
      <small class="muted">${a.bank_account_name}</small></span>`;
  };
  const payRow = (a) => html`<div class="pay-row ${a.paid_at ? 'is-paid' : ''}">
    ${who(a)}
    <div class="crew-cell"><span class="cell-label">To pay</span>
      ${a.earnings ? html`<b>${money(a.earnings.amount)}</b><small>${money(a.earnings.gross)} for ${fmtHours(a.earnings.hours)}${a.earnings.deduction ? html` · <span class="warn">−${money(a.earnings.deduction)}</span>` : ''}</small>`
        : html`<span class="muted">No check-out</span>`}</div>
    <div class="crew-cell">${payDetails(a)}</div>
    <div class="crew-cell crew-actions">${a.paid_at
      ? html`<span class="chip chip-approved">Paid ${fmtDate(a.paid_at)}</span><button class="link-btn small" data-paid="${a.id}" data-to="0">Undo</button>`
      : html`<button class="btn btn-primary btn-sm" data-paid="${a.id}" data-to="1">Mark paid</button>`}</div>
  </div>`;

  const taskRow = (t) => {
    const subs = submissions.filter((s) => s.task_id === t.id && crew.some((a) => a.id === s.application_id));
    const waiting = crew.filter((a) => !subs.some((s) => s.application_id === a.id));
    const due = taskDueAt(t, e);
    const overdue = due && due < new Date() && waiting.some((a) => a.checkin_at);
    return html`<div class="task-row">
      <div class="task-info"><b>${t.title}</b>
        <small class="${overdue ? 'warn' : 'muted'}">${raw(icons.clock)} ${taskDueLabel(t, e)}${overdue ? ' · overdue' : ''}</small>
        ${t.instructions ? html`<small class="task-instr">${t.instructions}</small>` : ''}</div>
      <div class="task-shots">
        <span class="chip ${crew.length && !waiting.length ? 'chip-approved' : ''}">${subs.length}/${crew.length} done</span>
        ${subs.map((s) => {
          const a = crew.find((x) => x.id === s.application_id);
          return html`<button class="shot ${taskLate(t, e, s) ? 'shot-late' : ''}" data-shot="${s.id}" title="${a.name} · ${fmtTime(s.created_at)}">
            <img src="${s.photo}" alt="${a.name}"><span>${a.name.split(' ')[0]}</span></button>`;
        })}
        ${waiting.length && crew.length ? html`<small class="muted task-waiting">Waiting for ${waiting.map((a) => a.name.split(' ')[0]).join(', ')}</small>` : ''}
      </div>
      <div class="row task-actions">
        <button class="btn btn-ghost btn-sm" data-edit-task="${t.id}">Edit</button>
        <button class="btn btn-ghost btn-sm btn-danger-text" data-del-task="${t.id}">Delete</button>
      </div>
    </div>`;
  };

  const checkPoints = crew.filter((a) => a.checkin_at).map((a) => ({ lat: a.checkin_lat, lng: a.checkin_lng, label: `${a.name} · in ${fmtTime(a.checkin_at)}` }));

  mount(view, html`
    <a class="back" href="#/events">${raw(icons.back)} All events</a>
    <div class="page-head">
      <div>
        <h1>${e.title}</h1>
        <p class="muted">${isLive(e) ? html`<span class="chip chip-live">Live now</span> ` : ''}${statusChip(e.status)} · ${fmtRange(e.start_at, e.end_at)}</p>
      </div>
      <div class="row">
        <a class="btn btn-primary" href="#/events/${id}/chat">${raw(icons.chat)} Group chat${messageCount ? html` <span class="count">${messageCount}</span>` : ''}</a>
        <a class="btn btn-ghost" href="#/events/${id}/edit">Edit</a>
        <button class="btn btn-ghost" id="toggle-open">${e.status === 'open' ? 'Close applications' : 'Reopen'}</button>
        <button class="btn btn-ghost btn-danger-text" id="del">Delete</button>
      </div>
    </div>

    <div class="detail-grid">
      <section class="card">
        <dl class="facts">
          <div><dt>${raw(icons.pin)} Where</dt><dd>${e.location_name}<small>Check-in radius ${e.radius_m} m</small></dd></div>
          <div><dt>${raw(icons.cash)} Pay</dt><dd>${payLabel(e)}</dd></div>
          <div><dt>${raw(icons.shirt)} Dress code</dt><dd>${e.dress_code || '—'}</dd></div>
          <div><dt>${raw(icons.users)} Crew</dt><dd>${crew.length} of ${e.slots} filled${e.min_rank !== 'rookie' ? html` · needs ${rankBadge(rankByKey(e.min_rank))}+` : ''}</dd></div>
        </dl>
        ${e.description ? html`<p class="desc">${e.description}</p>` : ''}
        ${e.skills || e.languages ? html`<div class="reqs">
          ${e.skills ? html`<div><span class="label">Skills</span>${tagChips(e.skills)}</div>` : ''}
          ${e.languages ? html`<div><span class="label">Languages</span>${tagChips(e.languages)}</div>` : ''}</div>` : ''}
      </section>
      <section class="card card-flush"><div id="ev-map" class="map"></div></section>
    </div>
    <details class="card terms-card"><summary><b>Payment &amp; rules</b> <span class="muted small">— part-timers agreed to these when applying</span></summary>
      ${termsBlock(e)}<h3 class="terms-title">Pay calculator</h3>${payEstimate(e)}</details>

    <h2 class="section-title">Applicants <span class="count">${pending.length}</span></h2>
    ${pending.length ? html`<div class="card list">${pending.map((a) => html`
      <div class="list-row">
        ${who(a)}
        <div class="app-mid">
          ${a.note ? html`<p class="note">“${a.note}”</p>` : ''}
          ${a.chosen_roles ? html`<div class="match"><small class="muted">Wants to do</small>${roleChips(a.chosen_roles)}</div>`
            : e.skills ? html`<div class="match"><small class="muted">Skills</small>${tagChips(e.skills, `${a.skills || ''} ${a.experience || ''}`)}</div>` : ''}
          ${e.languages ? html`<div class="match"><small class="muted">Speaks</small>${a.chosen_languages != null || a.chosen_roles ? speaks(e.languages, a.chosen_languages) : tagChips(e.languages, a.languages)}</div>` : ''}
          ${!e.languages && !e.skills && !a.note ? html`<small class="muted">${[a.languages, a.skills].filter(Boolean).join(' · ') || ''}</small>` : ''}
        </div>
        <div class="row">
          <button class="btn btn-ghost btn-sm" data-status="${a.id}" data-to="rejected">Decline</button>
          <button class="btn btn-primary btn-sm" data-status="${a.id}" data-to="approved" ${crew.length >= e.slots ? 'disabled title="All slots filled"' : ''}>Approve</button>
        </div>
      </div>`)}</div>` : html`<p class="muted">No applications waiting.</p>`}

    <h2 class="section-title">Crew &amp; attendance <span class="count">${crew.length}/${e.slots}</span></h2>
    ${crew.length ? html`<div class="card list crew-list">${crew.map(crewRow)}</div>`
      : html`<p class="muted">Approve applicants to build your crew. Their check-ins will show here with photo and GPS proof.</p>`}

    ${payRows.length ? html`<h2 class="section-title">Payments <span class="count">${payRows.filter((a) => a.paid_at).length}/${payRows.length} paid</span></h2>
      <p class="muted small">Pay by ${fmtDate(payDueDate(e).toISOString())} (${e.payment_days ?? 14} days after the event). Still to pay: <b>${money(toPay)}</b></p>
      <div class="card list">${payRows.map(payRow)}</div>` : ''}

    <h2 class="section-title">Photo tasks <span class="count">${tasks.length}</span>
      <button class="btn btn-ghost btn-sm push" id="add-task">${raw(icons.plus)} Add task</button></h2>
    ${tasks.length ? html`<div class="card list">${tasks.map(taskRow)}</div>`
      : html`<div class="card task-empty">
          <p class="muted">Ask the crew for photo updates during the shift, e.g. a selfie at their post 30 minutes in, or a photo with the store. They see these tasks after they check in.</p>
          <div class="tag-pick">${TASK_PRESETS.map((p, i) => html`<button type="button" class="btn btn-ghost btn-sm" data-preset-task="${i}">+ ${p.title}</button>`)}</div>
        </div>`}

    ${others.length ? html`<details class="others"><summary>Declined &amp; cancelled (${others.length})</summary>
      <div class="card list">${others.map((a) => html`<div class="list-row">${who(a)}${statusChip(a.status)}
        ${a.status === 'rejected' ? html`<button class="btn btn-ghost btn-sm" data-status="${a.id}" data-to="pending">Reconsider</button>` : html`<span></span>`}</div>`)}</div>
    </details>` : ''}`);

  siteMap($('#ev-map'), e, checkPoints);

  $('#toggle-open').onclick = (ev) => busy(ev.currentTarget, async () => {
    await api(`/api/admin/events/${id}`, { method: 'PUT', body: { ...e, status: e.status === 'open' ? 'closed' : 'open' } });
    reload();
  });
  $('#del').onclick = async () => {
    if (!(await confirmDialog(`Delete “${e.title}”? All applications, check-ins and ratings for it will be removed.`, 'Delete event', true))) return;
    await api(`/api/admin/events/${id}`, { method: 'DELETE' });
    toast('Event deleted');
    location.hash = '#/events';
  };
  for (const b of $$('[data-status]')) {
    b.onclick = () => busy(b, async () => {
      await api(`/api/admin/applications/${b.dataset.status}/status`, { method: 'POST', body: { status: b.dataset.to } });
      reload();
    });
  }
  for (const b of $$('[data-profile]')) b.onclick = () => profileModal(Number(b.dataset.profile));
  for (const b of $$('[data-proof]')) {
    b.onclick = () => proofModal(applications.find((a) => a.id === Number(b.dataset.proof)), b.dataset.kind, e);
  }
  for (const b of $$('[data-rate]')) {
    b.onclick = () => rateModal(applications.find((a) => a.id === Number(b.dataset.rate)), reload);
  }
  for (const b of $$('[data-deduct]')) {
    b.onclick = () => deductModal(applications.find((a) => a.id === Number(b.dataset.deduct)), e, reload);
  }

  bindPayEstimate(view, e);
  for (const b of $$('[data-copy]')) {
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Account number copied'); }
      catch { toast('Could not copy — select the number instead', 'error'); }
    };
  }
  for (const b of $$('[data-paid]')) {
    b.onclick = () => busy(b, async () => {
      await api(`/api/admin/applications/${b.dataset.paid}/paid`, { method: 'POST', body: { paid: b.dataset.to === '1' } });
      toast(b.dataset.to === '1' ? 'Marked as paid' : 'Payment mark removed');
      reload();
    });
  }
  $('#add-task').onclick = () => taskModal(e, null, reload);
  for (const b of $$('[data-preset-task]')) b.onclick = () => taskModal(e, TASK_PRESETS[Number(b.dataset.presetTask)], reload);
  for (const b of $$('[data-edit-task]')) b.onclick = () => taskModal(e, tasks.find((t) => t.id === Number(b.dataset.editTask)), reload);
  for (const b of $$('[data-del-task]')) {
    b.onclick = async () => {
      const t = tasks.find((x) => x.id === Number(b.dataset.delTask));
      if (!(await confirmDialog(`Delete the task “${t.title}”? Photos the crew sent for it are removed too.`, 'Delete task', true))) return;
      await busy(b, () => api(`/api/admin/tasks/${t.id}`, { method: 'DELETE' }));
      reload();
    };
  }
  for (const b of $$('[data-shot]')) {
    b.onclick = () => {
      const s = submissions.find((x) => x.id === Number(b.dataset.shot));
      shotModal(s, tasks.find((t) => t.id === s.task_id), crew.find((a) => a.id === s.application_id), e);
    };
  }
}

// ---------------------------------------------------------------- photo tasks

const TASK_PRESETS = [
  { title: 'Selfie at your post', due_min: 30, instructions: 'Take a selfie at your post so we can see you are set up and ready.' },
  { title: 'Photo with the store / booth', due_min: 60, instructions: 'Take a photo of yourself with the store front or booth clearly in the background.' },
  { title: 'Photo with your teammate', due_min: null, instructions: 'Take a photo with another part-timer working this event.' },
  { title: 'Booth / display ready', due_min: 15, instructions: 'Show the booth or display fully set up before customers arrive.' },
  { title: 'Crowd / activity update', due_min: null, instructions: 'Show what is happening at your area right now.' },
];

function taskModal(e, t, onDone) {
  const editing = !!t?.id;
  const timed = t ? t.due_min != null : true;
  const m = modal(html`
    <h2>${editing ? 'Edit photo task' : 'New photo task'}</h2>
    <p class="muted">Crew see this on their shift after they check in, and send a photo for it.</p>
    ${editing ? '' : html`<div class="tag-pick task-presets">${TASK_PRESETS.map((p, i) => html`<button type="button" class="btn btn-ghost btn-sm" data-p="${i}">${p.title}</button>`)}</div>`}
    <form id="task-form" class="form">
      <label class="field"><span class="label">Task</span>
        <input name="title" maxlength="120" required value="${t?.title || ''}" placeholder="e.g. Selfie at your post"></label>
      <label class="field"><span class="label">Instructions <small class="muted">(optional)</small></span>
        <textarea name="instructions" rows="3" maxlength="1000" placeholder="What should the photo show?">${t?.instructions || ''}</textarea></label>
      <div class="field"><span class="label">When</span>
        <label class="radio"><input type="radio" name="when" value="timed" ${timed ? 'checked' : ''}>
          <span class="inline-num">Within the first <input type="number" name="due_min" min="0" max="1440" step="5" value="${t?.due_min ?? 30}"> minutes of the start</span></label>
        <label class="radio"><input type="radio" name="when" value="any" ${timed ? '' : 'checked'}> Any time during the shift</label>
        <span class="hint">Event starts ${fmtDateTime(e.start_at)}.</span>
      </div>
      <button class="btn btn-primary btn-block" type="submit">${editing ? 'Save task' : 'Add task'}</button>
    </form>`);
  const f = $('#task-form', m.el);
  for (const b of $$('[data-p]', m.el)) {
    b.onclick = () => {
      const p = TASK_PRESETS[Number(b.dataset.p)];
      f.elements.title.value = p.title;
      f.elements.instructions.value = p.instructions;
      f.elements.when.value = p.due_min == null ? 'any' : 'timed';
      if (p.due_min != null) f.elements.due_min.value = p.due_min;
    };
  }
  f.elements.due_min.onfocus = () => { f.elements.when.value = 'timed'; };
  f.onsubmit = (ev) => {
    ev.preventDefault();
    const body = {
      title: f.elements.title.value,
      instructions: f.elements.instructions.value,
      due_min: f.elements.when.value === 'any' ? null : f.elements.due_min.value,
    };
    busy(ev.submitter, async () => {
      await api(editing ? `/api/admin/tasks/${t.id}` : `/api/admin/events/${e.id}/tasks`, { method: editing ? 'PUT' : 'POST', body });
      m.close();
      toast(editing ? 'Task updated' : 'Task added — crew will see it after checking in');
      onDone();
    });
  };
}

function shotModal(s, t, a, e) {
  const late = taskLate(t, e, s);
  modal(html`
    <h2>${t.title}</h2>
    <p class="muted">${a.name} · sent ${fmtDateTime(s.created_at)}
      ${late ? html` <span class="chip chip-rejected">After the deadline</span>` : t.due_min != null ? html` <span class="chip chip-approved">On time</span>` : ''}</p>
    <img class="proof-big" src="${s.photo}" alt="Photo from ${a.name}">
    ${s.note ? html`<p class="note">“${s.note}”</p>` : ''}
    <p class="small muted">${s.distance != null ? `${fmtDistance(s.distance)} from ${e.location_name}` : 'No location was shared with this photo.'}
      · ${taskDueLabel(t, e)}</p>`, { wide: true });
}

function deductModal(a, e, onDone) {
  const late = Math.max(0, lateMinutes(a, e));
  const rules = dedRules(e);
  const gross = a.earnings ? a.earnings.gross : expectedPay(e);
  // Rebuild what was saved before: items whose label starts with a rule's label tick that rule.
  let saved = [];
  try { saved = JSON.parse(a.deduction_items || '[]'); } catch { saved = []; }
  if (!saved.length && a.deduction) saved = [{ label: a.deduction_reason || 'Deduction', amount: a.deduction }];
  const used = new Set();
  const ruleState = rules.map((r, i) => {
    const hit = saved.findIndex((s, j) => !used.has(j) && s.label.startsWith(r.label));
    if (hit >= 0) used.add(hit);
    return { on: hit >= 0 || (!saved.length && !!r.per_min && late > 0), amount: hit >= 0 ? saved[hit].amount : ruleCharge(r, late), i };
  });
  const custom = saved.filter((_, j) => !used.has(j));

  const m = modal(html`
    <h2>Deduct pay · ${a.name}</h2>
    <p class="muted">Pick what applies from this event's deduction list. ${a.name.split(' ')[0]} sees each item in My shifts.</p>
    ${late > 0 ? html`<p class="callout callout-warn">Checked in ${late} minutes late${a.checkin_at ? ` (${fmtTime(a.checkin_at)})` : ''}.</p>` : ''}
    <form id="deduct-form" class="form">
      <div class="ded-pick">
        ${rules.map((r, i) => html`<label class="ded-opt">
          <input type="checkbox" data-rule="${i}" ${ruleState[i].on ? 'checked' : ''}>
          <span><b>${r.label}</b><small class="muted">${r.per_min ? `${money(r.amount)} per ${r.per_min} min late${late > 0 ? ` · ${late} min late` : ''}` : 'From the event rules'}</small></span>
          <span class="inline-num"><input type="number" min="0" step="0.5" data-amt="${i}" value="${ruleState[i].amount}"></span>
        </label>`)}
        <label class="ded-opt">
          <input type="checkbox" data-rule="other" ${custom.length ? 'checked' : ''}>
          <span><b>Other</b><input class="ded-other" maxlength="100" placeholder="Reason" value="${custom.map((c) => c.label).join(', ')}"></span>
          <span class="inline-num"><input type="number" min="0" step="0.5" data-amt="other" value="${custom.reduce((n, c) => n + c.amount, 0) || ''}"></span>
        </label>
      </div>
      <div class="ded-sum">
        <span>Pay ${a.earnings ? `for ${fmtHours(a.earnings.hours)}` : '(full shift)'}</span><b>${money(gross)}</b>
        <span>Deductions</span><b class="warn" id="ded-total">−${money(0)}</b>
        <span>They will receive</span><b id="ded-net">${money(gross)}</b>
      </div>
      <div class="row-end">
        ${a.deduction ? html`<button type="button" class="btn btn-ghost" id="deduct-clear">Remove all</button>` : ''}
        <button class="btn btn-primary" type="submit">Save deduction</button></div>
    </form>`);
  const form = $('#deduct-form', m.el);
  const items = () => {
    const out = [];
    rules.forEach((r, i) => {
      if (!form.querySelector(`[data-rule="${i}"]`).checked) return;
      const amount = Number(form.querySelector(`[data-amt="${i}"]`).value) || 0;
      out.push({ label: r.per_min && late > 0 ? `${r.label} (${late} min)` : r.label, amount });
    });
    if (form.querySelector('[data-rule="other"]').checked) {
      out.push({ label: form.querySelector('.ded-other').value.trim(), amount: Number(form.querySelector('[data-amt="other"]').value) || 0 });
    }
    return out.filter((x) => x.amount > 0);
  };
  const update = () => {
    const total = items().reduce((n, x) => n + x.amount, 0);
    $('#ded-total', m.el).textContent = `−${money(Math.min(total, gross))}`;
    $('#ded-net', m.el).textContent = money(Math.max(0, gross - total));
  };
  form.addEventListener('input', (ev) => {
    const key = ev.target.dataset.amt ?? (ev.target.classList.contains('ded-other') ? 'other' : null);
    if (key != null) form.querySelector(`[data-rule="${key}"]`).checked = true;
    update();
  });
  update();
  const save = (btn, list) => busy(btn, async () => {
    await api(`/api/admin/applications/${a.id}/deduct`, { method: 'POST', body: { items: list } });
    m.close();
    toast(list.length ? 'Deduction saved' : 'Deduction removed');
    onDone();
  });
  $('#deduct-clear', m.el)?.addEventListener('click', (ev) => save(ev.currentTarget, []));
  form.onsubmit = (ev) => {
    ev.preventDefault();
    const list = items();
    if (list.some((x) => !x.label)) return toast('Give a reason for the “Other” deduction.', 'error');
    save(ev.submitter, list);
  };
}

function proofModal(a, kind, e) {
  const lat = a[`${kind}_lat`], lng = a[`${kind}_lng`];
  const m = modal(html`
    <h2>${a.name} · ${kind === 'checkin' ? 'Check in' : 'Check out'}</h2>
    <img class="proof-big" src="${a[`${kind}_photo`]}" alt="Proof photo">
    <dl class="facts facts-compact">
      <div><dt>Time</dt><dd>${fmtDateTime(a[`${kind}_at`])}</dd></div>
      <div><dt>Distance from site</dt><dd>${fmtDistance(a[`${kind}_distance`])}
        ${kind === 'checkout' && a.checkout_outside ? html` <span class="chip chip-rejected">Outside check-in area</span>` : ''}</dd></div>
      <div><dt>GPS accuracy</dt><dd>${a[`${kind}_accuracy`] ? `± ${Math.round(a[`${kind}_accuracy`])} m` : '—'}</dd></div>
    </dl>
    <div id="proof-map" class="map"></div>`, { wide: true });
  siteMap($('#proof-map', m.el), e, [{ lat, lng, label: `${a.name}` }]);
}

function rateModal(a, onDone) {
  const cats = [
    ['punctuality', 'Punctuality', 'On time, follows the schedule'],
    ['attitude', 'Attitude', 'Friendly, cooperative, professional'],
    ['performance', 'Performance', 'Quality of work, initiative'],
  ];
  const starInput = (key, current) => html`<span class="star-input" role="radiogroup">
    ${[5, 4, 3, 2, 1].map((n) => html`<input type="radio" id="${key}-${n}" name="${key}" value="${n}" ${current === n ? 'checked' : ''}><label for="${key}-${n}" title="${n} star${n > 1 ? 's' : ''}">★</label>`)}</span>`;

  const m = modal(html`
    <h2>Rate ${a.name}</h2>
    <p class="muted">Ratings decide their rank. Be fair: 3 = did the job, 5 = outstanding.</p>
    <form id="rate-form" class="form">
      ${cats.map(([k, label, hint]) => html`<div class="rate-row"><div><b>${label}</b><small>${hint}</small></div>${starInput(k, a[k])}</div>`)}
      <label class="field"><span class="label">Feedback (they will see this)</span>
        <textarea name="comment" rows="3" placeholder="What went well? What to improve?">${a.rating_comment || ''}</textarea></label>
      <button class="btn btn-primary btn-block" type="submit">Save rating</button>
    </form>`);
  $('#rate-form', m.el).onsubmit = (ev) => {
    ev.preventDefault();
    busy(ev.submitter, async () => {
      const res = await api(`/api/admin/applications/${a.id}/rate`, { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) });
      m.close();
      toast(`Saved. ${a.name} is now ${res.stats.rank.name} (${res.stats.avgStars.toFixed(1)}★ avg)`);
      onDone();
    });
  };
}

// ---------------------------------------------------------------- crew directory

async function crewList(view) {
  const { workers } = await api('/api/admin/workers');
  const ranks = state.meta.ranks;
  const counts = Object.fromEntries(ranks.map((r) => [r.key, workers.filter((w) => w.stats.rank.key === r.key).length]));

  mount(view, html`
    <div class="page-head"><div><h1>Crew &amp; ranks</h1><p class="muted">${workers.length} part-timers, best first.</p></div></div>
    <div class="ladder">${ranks.map((r) => html`
      <div class="ladder-step ladder-${r.key}">
        ${rankBadge(r, true)}
        <b class="ladder-count">${counts[r.key]}</b>
        <small>${r.minJobs ? `${r.minJobs}+ rated shifts, ${r.minAvg.toFixed(1)}★+ avg` : 'Starting rank'}</small>
      </div>`)}</div>
    <div class="toolbar">
      <input id="q" type="search" placeholder="Search name, city or email">
      <select id="rank-f"><option value="">All ranks</option>${ranks.map((r) => html`<option value="${r.key}">${r.name}</option>`)}</select>
    </div>
    <div class="card list" id="crew"></div>`);

  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const rf = $('#rank-f').value;
    const rows = workers.filter((w) => (!rf || w.stats.rank.key === rf)
      && (!q || [w.name, w.email, w.city].some((s) => s?.toLowerCase().includes(q))));
    mount($('#crew'), rows.length ? rows.map((w, i) => html`
      <a class="list-row crew-dir" href="#/crew/${w.id}">
        <span class="pos">${i + 1}</span>
        ${avatar(w.avatar, w.name, 44)}
        <span class="person-text"><b>${w.name}</b><span class="muted">${w.city || 'Profile not completed'}</span></span>
        ${rankBadge(w.stats.rank)}
        <span class="dir-stat">${w.stats.ratedJobs ? html`${stars(w.stats.avgStars)}<small>${w.stats.avgStars.toFixed(1)} avg</small>` : html`<small class="muted">Unrated</small>`}</span>
        <span class="dir-stat"><b>${w.stats.completed}</b><small>shifts done</small></span>
      </a>`) : html`<p class="muted pad">Nobody matches.</p>`);
  };
  $('#q').oninput = draw;
  $('#rank-f').onchange = draw;
  draw();
}

function profileBody({ user, profile: p, stats, history }) {
  const age = p?.birth_date ? Math.floor((Date.now() - new Date(p.birth_date)) / 31557600000) : null;
  const rated = history.filter((h) => h.stars != null);
  return html`
    <div class="profile-head">
      ${avatar(p?.avatar, user.name, 96)}
      <div>
        <h1>${user.name}</h1>
        <p>${rankBadge(stats.rank, true)}</p>
        <p class="muted">${stats.ratedJobs ? html`${stars(stats.avgStars)} ${stats.avgStars.toFixed(2)} avg from ${stats.ratedJobs} rated shifts · ` : ''}${stats.completed} shifts completed</p>
      </div>
    </div>
    ${!p ? html`<p class="muted">This part-timer has not filled in their profile yet.</p>` : html`
    <dl class="facts facts-2">
      <div><dt>Phone</dt><dd><a href="tel:${p.phone}">${p.phone}</a></dd></div>
      <div><dt>Email</dt><dd><a href="mailto:${user.email}">${user.email}</a></dd></div>
      <div><dt>City / area</dt><dd>${p.city || '—'}</dd></div>
      <div><dt>Age · Gender · Height</dt><dd>${[age && `${age} yrs`, p.gender, p.height_cm && `${p.height_cm} cm`].filter(Boolean).join(' · ') || '—'}</dd></div>
      <div><dt>Languages</dt><dd>${p.languages || '—'}</dd></div>
      <div><dt>Skills</dt><dd>${p.skills || '—'}</dd></div>
    </dl>
    ${p.experience ? html`<h3>Experience</h3><p class="desc">${p.experience}</p>` : ''}
    ${p.about ? html`<h3>About</h3><p class="desc">${p.about}</p>` : ''}
    ${p.resume ? html`<p><a class="btn btn-ghost" href="${p.resume}" target="_blank" rel="noopener">${raw(icons.file)} Open resume (${p.resume_name})</a></p>` : ''}`}
    <h3>Feedback history</h3>
    ${rated.length ? html`<div class="feedback">${rated.map((h) => html`
      <div class="fb"><div class="fb-head"><b>${h.title}</b><span class="muted">${fmtDate(h.start_at)}</span></div>
        <div>${stars(h.stars)} <small class="muted">Punctuality ${h.punctuality} · Attitude ${h.attitude} · Performance ${h.performance}</small></div>
        ${h.comment ? html`<p>${h.comment}</p>` : ''}</div>`)}</div>` : html`<p class="muted">No ratings yet.</p>`}`;
}

async function profileModal(workerId) {
  const data = await api(`/api/admin/workers/${workerId}`);
  const m = modal(html`${profileBody(data)}<p><a href="#/crew/${workerId}" class="link">Open full page →</a></p>`, { wide: true });
  $('a.link', m.el).addEventListener('click', () => m.close());
}

async function crewDetail(view, workerId) {
  const data = await api(`/api/admin/workers/${workerId}`);
  mount(view, html`<a class="back" href="#/crew">${raw(icons.back)} Crew</a><section class="card">${profileBody(data)}</section>`);
}


// Event group chat, shared by organisers and part-timers.
// Members: the event's organiser plus everyone approved for it. New messages are fetched every few seconds.
import { api, html, raw, mount, $, toast, icons, initials, fmtTime, fmtDate, modal, compressImage } from './ui.js';

const POLL_MS = 4000;
let stopPolling = null;

export async function chatPage(view, eventId, backHref, backLabel) {
  stopPolling?.();
  const first = await api(`/api/events/${eventId}/chat`);
  const { event, members, me, organiserId } = first;
  const crewCount = members.length - 1;

  mount(view, html`
    <a class="back" href="${backHref}">${raw(icons.back)} ${backLabel}</a>
    <div class="chat">
      <div class="chat-head">
        <div><h1>${event.title}</h1>
          <p class="muted small">Group chat · ${fmtDate(event.start_at)} · ${crewCount} crew + organiser</p></div>
        <details class="chat-members"><summary>${raw(icons.users)} Members (${members.length})</summary>
          <ul>${members.map((p) => html`<li><span class="avatar avatar-ph" style="width:28px;height:28px;font-size:11px">${initials(p.name)}</span>
            <span><b>${p.name}</b>${p.id === me ? ' (you)' : ''}<small>${p.organiser ? 'Organiser' : p.chosen_roles || 'Crew'}</small></span></li>`)}</ul>
        </details>
      </div>
      <div class="chat-log" id="chat-log" aria-live="polite"></div>
      <div class="chat-attach" id="chat-attach" hidden>
        <img alt="Photo to send"><button type="button" class="chat-attach-x" aria-label="Remove photo">${raw(icons.x)}</button>
      </div>
      <form class="chat-form" id="chat-form">
        <label class="chat-tool" title="Take a photo"><input type="file" accept="image/*" capture="environment" data-pick hidden>${raw(icons.camera)}</label>
        <label class="chat-tool" title="Send a picture from your phone"><input type="file" accept="image/*" data-pick hidden>${raw(icons.image)}</label>
        <textarea name="body" rows="1" maxlength="1000" placeholder="Message the group…"></textarea>
        <button class="btn btn-primary" type="submit">Send</button>
      </form>
    </div>`);

  const log = $('#chat-log');
  const form = $('#chat-form');
  const input = form.elements.body;
  let lastId = 0;
  let lastDay = '';
  let lastSender = null;

  const add = (messages) => {
    if (!messages.length) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    let out = '';
    for (const m of messages) {
      if (m.id <= lastId) continue;
      lastId = m.id;
      const day = fmtDate(m.created_at);
      if (day !== lastDay) { out += html`<div class="chat-day">${day}</div>`; lastDay = day; lastSender = null; }
      const mine = m.user_id === me;
      const org = m.user_id === organiserId;
      const showName = !mine && lastSender !== m.user_id;
      out += html`<div class="msg ${mine ? 'msg-mine' : ''} ${org ? 'msg-org' : ''}">
        ${showName ? html`<div class="msg-name">${m.name}${org ? html` <span class="chip chip-org">Organiser</span>` : ''}</div>` : ''}
        <div class="msg-bubble ${m.photo ? 'msg-has-photo' : ''}">
          ${m.photo ? html`<button type="button" class="msg-photo" data-full="${m.photo}"><img src="${m.photo}" alt="Photo from ${m.name}" loading="lazy"></button>` : ''}
          ${m.body ? html`<span class="msg-text">${m.body}</span>` : ''}<span class="msg-time">${fmtTime(m.created_at)}</span></div>
      </div>`;
      lastSender = m.user_id;
    }
    log.insertAdjacentHTML('beforeend', out);
    if (nearBottom || messages.some((m) => m.user_id === me)) log.scrollTop = log.scrollHeight;
  };

  if (first.messages.length) add(first.messages);
  else log.innerHTML = String(html`<div class="chat-empty" id="chat-empty">${raw(icons.chat)}<b>No messages yet</b>
    <span>Say hi to the crew. Everyone approved for this event can read and reply here.</span></div>`);
  log.scrollTop = log.scrollHeight;

  const poll = async () => {
    try {
      const { messages } = await api(`/api/events/${eventId}/chat?after=${lastId}`);
      if (messages.length) $('#chat-empty')?.remove();
      add(messages);
    } catch (err) {
      if (err.status === 403 || err.status === 404) { stop(); toast(err.message, 'error'); }
    }
  };
  const timer = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  const stop = () => { clearInterval(timer); window.removeEventListener('hashchange', stop); stopPolling = null; };
  window.addEventListener('hashchange', stop);
  stopPolling = stop;

  // Enter sends, Shift+Enter makes a new line. The box grows with the text.
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); form.requestSubmit(); }
  });
  // Pictures load after the text, so keep the view pinned to the bottom when they arrive.
  log.addEventListener('load', () => {
    if (log.scrollHeight - log.scrollTop - log.clientHeight < 400) log.scrollTop = log.scrollHeight;
  }, true);
  log.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-full]');
    if (b) modal(html`<img class="proof-big chat-full" src="${b.dataset.full}" alt="Photo">`, { wide: true });
  });

  // One photo can be attached per message: take one with the camera or pick from the phone.
  const attach = $('#chat-attach');
  let photo = null;
  const setPhoto = (dataUrl) => {
    photo = dataUrl;
    attach.hidden = !photo;
    if (photo) attach.querySelector('img').src = photo;
  };
  attach.querySelector('.chat-attach-x').onclick = () => setPhoto(null);
  form.addEventListener('change', async (ev) => {
    if (!ev.target.matches('[data-pick]')) return;
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try { setPhoto(await compressImage(file)); input.focus(); } catch (err) { toast(err.message, 'error'); }
  });

  let sending = false;
  const sendBtn = form.querySelector('button[type=submit]');
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const body = input.value.trim();
    if ((!body && !photo) || sending) return;
    sending = true;
    sendBtn.disabled = true;
    try {
      await api(`/api/events/${eventId}/chat`, { method: 'POST', body: { body, photo } });
      input.value = '';
      input.style.height = 'auto';
      setPhoto(null);
      $('#chat-empty')?.remove();
      await poll();
    } catch (err) { toast(err.message, 'error'); }
    finally { sending = false; sendBtn.disabled = false; input.focus(); }
  };
}

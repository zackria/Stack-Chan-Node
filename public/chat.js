// Chat tab: typed or spoken conversation with Claude / ChatGPT / Gemini via the local server.
// Voice uses the browser's Web Speech API (recognition + synthesis); the robot gets lip-flap while speaking.

const $ = (s) => document.querySelector(s);
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export function initChat({ wsSend, setAvatar }) {
  const log = $('#log'), form = $('#chat-form'), input = $('#chat-text'), status = $('#chat-status');
  const providerSel = $('#provider'), modelIn = $('#model');
  let providers = [], busy = false, speaking = false, recognizer = null, listening = false, flapTimer = null;

  const add = (cls, text) => {
    log.querySelector('.muted')?.remove();
    const el = document.createElement('div');
    el.className = cls === 'acts' ? 'acts' : `msg ${cls}`;
    el.textContent = text;
    log.append(el); log.scrollTop = log.scrollHeight;
    return el;
  };
  const setStatus = (t) => { status.textContent = t; };

  /* ───── speech output with simple lip-flap ───── */
  function stopFlap() { clearInterval(flapTimer); flapTimer = null; setAvatar({ mouth: { weight: 0 } }); }
  function speak(text) {
    return new Promise((resolve) => {
      if (!$('#speak').checked || !('speechSynthesis' in window)) return resolve();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.onstart = () => { speaking = true; flapTimer = setInterval(() => setAvatar({ mouth: { weight: 15 + Math.round(Math.random() * 65) } }), 130); };
      const done = () => { speaking = false; stopFlap(); resolve(); };
      u.onend = done; u.onerror = done;
      speechSynthesis.speak(u);
    });
  }
  $('#stop-speech').onclick = () => { speechSynthesis.cancel(); };

  /* ───── speech input ───── */
  const mic = $('#mic');
  if (!SpeechRecognition) { mic.disabled = true; mic.title = 'Speech recognition needs Chrome or Edge'; $('#handsfree').disabled = true; }
  function listen() {
    if (!SpeechRecognition || listening || busy || speaking) return;
    recognizer = new SpeechRecognition();
    recognizer.lang = navigator.language || 'en-US';
    recognizer.interimResults = false;
    recognizer.onstart = () => { listening = true; mic.setAttribute('aria-pressed', 'true'); setStatus('Listening…'); };
    recognizer.onresult = (e) => { const t = e.results[0]?.[0]?.transcript; if (t) send(t); };
    recognizer.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') setStatus(`Microphone: ${e.error}`); };
    recognizer.onend = () => {
      listening = false; mic.setAttribute('aria-pressed', 'false');
      if (!busy && !speaking && status.textContent === 'Listening…') setStatus('');
    };
    try { recognizer.start(); } catch { /* already started */ }
  }
  mic.onclick = () => (listening ? recognizer?.stop() : listen());

  /* ───── sending ───── */
  function send(text) {
    if (busy) return;
    speechSynthesis.cancel();
    add('user', text);
    wsSend({ t: 'chat', text, provider: providerSel.value, model: modelIn.value.trim(), system: $('#system').value.trim() });
  }
  form.onsubmit = (e) => { e.preventDefault(); const t = input.value.trim(); if (t) { input.value = ''; send(t); } };
  $('#chat-clear').onclick = () => { wsSend({ t: 'chat_reset' }); log.innerHTML = '<p class="muted">New conversation.</p>'; speechSynthesis.cancel(); };

  providerSel.onchange = () => {
    const p = providers.find((x) => x.id === providerSel.value);
    modelIn.value = p?.defaultModel ?? '';
    if (p && !p.available) setStatus(`${p.label} has no API key on the server yet. Add it to .env and restart.`); else setStatus('');
    try { localStorage.setItem('sc.provider', providerSel.value); } catch { /* storage unavailable */ }
  };

  async function afterReply() {
    if ($('#handsfree').checked && SpeechRecognition) listen();
  }

  return {
    onMessage(m) {
      if (m.t === 'providers') {
        providers = m.list;
        let saved = null; try { saved = localStorage.getItem('sc.provider'); } catch { /* ignore */ }
        providerSel.innerHTML = providers.map((p) => `<option value="${p.id}">${p.label}${p.available ? '' : ' (no key)'}</option>`).join('');
        providerSel.value = providers.find((p) => p.id === saved)?.id ?? providers.find((p) => p.available)?.id ?? providers[0].id;
        if (!$('#system').value) $('#system').value = m.defaultSystem;
        providerSel.onchange();
      } else if (m.t === 'chat_busy') {
        busy = m.busy; $('#send').disabled = busy;
        if (busy) setStatus('Thinking…'); else if (status.textContent === 'Thinking…') setStatus('');
      } else if (m.t === 'chat_reply') {
        if (m.actions?.length) add('acts', `🤖 ${m.actions.map((a) => a.name.replace('_', ' ') + (a.args?.name ? `: ${a.args.name}` : '')).join(' · ')}`);
        add('bot', m.text);
        speak(m.text).then(afterReply);
      } else if (m.t === 'voice_link') {
        const el = $('#voice-link');
        el.hidden = m.state === 'off';
        el.textContent = `Robot voice agent link: ${m.state}${m.state === 'connected' ? ' (talk to the robot; it can move its face and head through this app)' : ''}`;
      } else if (m.t === 'voice_call') {
        add('acts', `🎙️ voice agent: ${m.name.replace('_', ' ')}${m.args?.name ? ': ' + m.args.name : ''} → ${m.result}`);
      } else if (m.t === 'chat_error') {
        add('err', m.message); setStatus('');
      }
    },
  };
}

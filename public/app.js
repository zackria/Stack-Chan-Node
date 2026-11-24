import { EXPRESSIONS, EXPRESSION_META, EMOTION_SEQUENCES, fullFace, lerpFace } from '/shared/expressions.js';
import { DEFAULTS, readFace, mapFace, Smoother } from '/mapping.js';
import { initChat } from '/chat.js';

const $ = (s, el = document) => el.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ───────────── connection to the Node server ───────────── */
let ws = null;
let connState = 'disconnected';

function openSocket() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'status') renderStatus(m);
    else if (m.t === 'applied') applyFromServer(m);
    else if (m.t === 'sensor') renderSensor(m.data);
    else if (m.t === 'sdcard') renderSdCard(m.data);
    else if (m.t === 'device_demo') renderDeviceDemo(m.data);
    else if (m.t === 'voice_link' || m.t === 'voice_call') chat?.onMessage(m);
    else chat?.onMessage(m);
  };
  ws.onclose = () => {
    renderStatus({ state: 'disconnected', error: 'Lost connection to the local server. Is `npm run app` still running?' });
    setTimeout(openSocket, 1500);
  };
}
const send = (t, data) => { if (ws?.readyState === 1 && connState === 'connected') ws.send(JSON.stringify({ t, data })); };
const sendHead = (yawDeg, pitchDeg, speed) => send('motion', {
  yawServo: yawDeg == null ? undefined : { angle: Math.round(yawDeg * 10), speed },
  pitchServo: pitchDeg == null ? undefined : { angle: Math.round(pitchDeg * 10), speed },
});

function renderStatus({ state, transport, usbPort, error }) {
  connState = state;
  $('#dot').className = `dot ${state}`;
  const label = {
    disconnected: usbPort ? `Standby (USB: ${usbPort.split('/').pop()})` : 'Disconnected (Preview Ready)',
    connecting: 'Connecting to StackChan…',
    connected: transport === 'usb-serial' ? 'Connected (USB + On-Device Voice)' : 'Connected to StackChan (BLE)',
  }[state];
  $('#status').textContent = label;
  const b = $('#connect');
  b.textContent = state === 'connected' ? 'Disconnect' : state === 'connecting' ? 'Connecting…' : 'Connect';
  b.disabled = state === 'connecting';
  const hint = $('#hint');
  hint.hidden = !error;
  hint.textContent = error || '';
}
$('#connect').onclick = () => {
  if (ws?.readyState !== 1) return;
  ws.send(JSON.stringify({ t: connState === 'connected' ? 'disconnect' : 'connect' }));
};
$('#device-voice-btn').onclick = () => {
  if (ws?.readyState !== 1) return;
  ws.send(JSON.stringify({ t: 'device_voice_toggle' }));
};

/* ───────────── tabs ───────────── */
function switchTab(tabName) {
  document.querySelectorAll('.tabs [role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tabName)));
  document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.id !== `tab-${tabName}`; });
}
for (const tab of document.querySelectorAll('.tabs [role=tab]')) {
  tab.onclick = () => switchTab(tab.dataset.tab);
}

/* ───────────── avatar state, sliders, preview ───────────── */
const FEATURES = {
  leftEye: { label: 'Left eye', keys: ['x', 'y', 'rotation', 'weight', 'size'] },
  rightEye: { label: 'Right eye', keys: ['x', 'y', 'rotation', 'weight', 'size'] },
  mouth: { label: 'Mouth', keys: ['x', 'y', 'rotation', 'weight'] },
};
const RANGE = { x: [-100, 100], y: [-100, 100], rotation: [-1800, 1800], weight: [0, 100], size: [-100, 100] };
const NEUTRAL = fullFace(EXPRESSIONS.neutral);
const avatar = fullFace(EXPRESSIONS.neutral);
const sliderEls = {};
let activeExpressionName = 'neutral';

for (const [group, def] of Object.entries(FEATURES)) {
  const fs = document.createElement('fieldset');
  fs.className = 'card';
  fs.innerHTML = `<legend>${def.label}</legend>`;
  for (const k of def.keys) {
    const [lo, hi] = RANGE[k];
    const label = document.createElement('label');
    label.className = 'slider';
    label.innerHTML = `<span>${k}</span><input type="range" min="${lo}" max="${hi}" value="${avatar[group][k]}"><output>${avatar[group][k]}</output>`;
    const input = $('input', label), out = $('output', label);
    input.oninput = () => { setAvatar({ [group]: { [k]: +input.value } }); };
    sliderEls[`${group}.${k}`] = { input, out };
    fs.append(label);
  }
  $('#sliders').append(fs);
}

function setLedPreview(colorHex) {
  const c = (!colorHex || colorHex === '#000000' || colorHex === 'off') ? '#2b5cff' : colorHex;
  document.documentElement.style.setProperty('--led-glow', c);
  if (colorHex && colorHex !== 'off') $('#led-color').value = colorHex === '#000000' ? '#2b5cff' : colorHex;
}

function setLed(colorHex, duration = 0.3) {
  setLedPreview(colorHex);
  send('rgb', { leftRgbColor: colorHex, rightRgbColor: colorHex, leftRgbDuration: duration, rightRgbDuration: duration });
}

/** Merge a patch into local state, refresh UI, and optionally send to the robot. */
function setAvatar(patch, { send: doSend = true } = {}) {
  for (const [g, vals] of Object.entries(patch)) {
    if (!avatar[g] || !vals) continue;
    for (const [k, v] of Object.entries(vals)) {
      if (!(k in avatar[g])) continue;
      avatar[g][k] = v;
      const el = sliderEls[`${g}.${k}`];
      if (el) { el.input.value = v; el.out.textContent = Math.round(v); }
    }
  }
  drawFace();
  if (doSend) send('avatar', patch);
}

function updateExpressionBadge(name) {
  activeExpressionName = name;
  const meta = EXPRESSION_META[name] || { emoji: '🤖', label: name };
  const badge = $('#active-expr-badge');
  if (badge) badge.textContent = `${meta.emoji} ${meta.label}`;
  document.querySelectorAll('#presets button').forEach((btn) => {
    btn.classList.toggle('active-preset', btn.dataset.expr === name);
  });
}

let morphToken = 0;
async function morphToExpression(name, { durationMs = 240, syncHead = false, syncLed = false } = {}) {
  const target = EXPRESSIONS[name];
  if (!target) return;
  const token = ++morphToken;
  updateExpressionBadge(name);
  const meta = EXPRESSION_META[name];
  if (syncLed && meta?.led) setLed(meta.led, 0.35);
  if (syncHead && meta) moveHead(meta.yaw, meta.pitch);

  const start = fullFace(avatar);
  const end = fullFace(target);
  const steps = Math.max(2, Math.round(durationMs / 40));
  for (let i = 1; i <= steps; i++) {
    if (token !== morphToken) return;
    const isLast = i === steps;
    const frame = isLast ? end : lerpFace(start, end, i / steps);
    setAvatar(frame, { send: isLast });
    if (!isLast) await sleep(durationMs / steps);
  }
  // Ensure exact compact BLE payload is sent on completion
  send('avatar', target);
}

const canvas = $('#face'), ctx = canvas.getContext('2d');
let brandImage = null;
let brandLoadId = 0;
const cgiBadgeImg = new Image();
cgiBadgeImg.src = '/cgi-logo.png';
cgiBadgeImg.onload = () => drawFace();

function drawFace() {
  const { width: W, height: H } = canvas;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);
  const placement = $('#brand-placement').value;

  if (brandImage && (placement === 'background' || placement === 'face')) {
    const scale = Math[$('#brand-fit').value === 'cover' ? 'max' : 'min'](W / brandImage.naturalWidth, H / brandImage.naturalHeight);
    const w = brandImage.naturalWidth * scale, h = brandImage.naturalHeight * scale;
    ctx.save();
    ctx.globalAlpha = +$('#brand-opacity').value / 100;
    ctx.drawImage(brandImage, (W - w) / 2, (H - h) / 2, w, h);
    ctx.restore();
    if (placement === 'face') return;
  }

  // Always draw official CGI logo badge in top-left when background HUD is active
  if (cgiBadgeImg.complete && cgiBadgeImg.naturalWidth > 0 && placement === 'background') {
    ctx.save();
    ctx.globalAlpha = Math.max(0.85, +$('#brand-opacity').value / 100);
    ctx.drawImage(cgiBadgeImg, 24, 20, 78, 36);
    ctx.restore();
  }

  // Draw eyes and mouth with subtle glow
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = getComputedStyle(document.documentElement).getPropertyValue('--led-glow').trim() || '#38bdf8';
  ctx.shadowBlur = 10;
  const eye = (cx, e) => {
    const s = 1 + e.size / 200;
    ctx.save();
    ctx.translate(cx + e.x * 0.6, 125 + e.y * 0.6);
    ctx.rotate((e.rotation / 10) * Math.PI / 180);
    ctx.beginPath();
    ctx.ellipse(0, 0, 24 * s, Math.max(1.5, 24 * s * (e.weight / 100)), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  eye(160, avatar.leftEye);
  eye(320, avatar.rightEye);
  const m = avatar.mouth;
  ctx.save();
  ctx.translate(240 + m.x * 0.6, 235 + m.y * 0.6);
  ctx.rotate((m.rotation / 10) * Math.PI / 180);
  const h = 3 + m.weight * 0.45;
  ctx.beginPath();
  ctx.roundRect(-60, -h / 2, 120, h, Math.min(h / 2, 20));
  ctx.fill();
  ctx.restore();
  ctx.restore();

  // Corner badge mode: overlays custom logo in the top-left corner of the robot screen
  if (brandImage && placement === 'badge') {
    const maxW = 132, maxH = 76;
    const scale = Math.min(maxW / brandImage.naturalWidth, maxH / brandImage.naturalHeight);
    const w = brandImage.naturalWidth * scale, h = brandImage.naturalHeight * scale;
    ctx.save();
    ctx.globalAlpha = +$('#brand-opacity').value / 100;
    ctx.drawImage(brandImage, 14, 14, w, h);
    ctx.restore();
  }
}

async function loadLogoFromSrc(src, label = 'Default custom logo loaded.') {
  const id = ++brandLoadId;
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    if (id !== brandLoadId) return;
    brandImage = image;
    $('#brand-remove').disabled = false;
    $('#brand-status').textContent = label;
    const headerLogo = $('.header-logo');
    if (headerLogo) headerLogo.src = src === '/logo.svg' ? '/cgi-logo.png' : src;
    drawFace();
  } catch {
    if (id === brandLoadId) $('#brand-status').textContent = 'Could not load logo image.';
  }
}

// Initialize custom logo: restore user-uploaded logo from localStorage or load default /logo.svg
try {
  const savedLogo = localStorage.getItem('sc.customLogo');
  const savedName = localStorage.getItem('sc.customLogoName');
  if (savedLogo) loadLogoFromSrc(savedLogo, `Custom logo "${savedName || 'saved'}" restored.`);
  else loadLogoFromSrc('/logo.svg', 'Default custom logo active.');
} catch {
  loadLogoFromSrc('/logo.svg', 'Default custom logo active.');
}
drawFace();

$('#brand-file').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const status = $('#brand-status');
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    status.textContent = 'Choose a PNG, JPEG, WebP or SVG image up to 5 MB.';
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result;
    try {
      localStorage.setItem('sc.customLogo', dataUrl);
      localStorage.setItem('sc.customLogoName', file.name);
    } catch { /* quota exceeded, still show in session */ }
    await loadLogoFromSrc(dataUrl, `${file.name} installed as custom logo.`);
  };
  reader.readAsDataURL(file);
  event.target.value = '';
};

$('#brand-default').onclick = () => {
  try {
    localStorage.removeItem('sc.customLogo');
    localStorage.removeItem('sc.customLogoName');
  } catch { /* ignore */ }
  loadLogoFromSrc('/logo.svg', 'Reset to default custom logo.');
};

for (const id of ['brand-placement', 'brand-fit', 'brand-opacity']) {
  $(`#${id}`).oninput = () => {
    $('#brand-opacity').nextElementSibling.textContent = $('#brand-opacity').value;
    drawFace();
  };
}
$('#brand-remove').onclick = () => {
  ++brandLoadId;
  brandImage = null;
  $('#brand-file').value = '';
  $('#brand-remove').disabled = true;
  $('#brand-status').textContent = 'Logo overlay hidden.';
  drawFace();
};
function facePng() {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not export the preview.')), 'image/png'));
}
$('#brand-download').onclick = async () => {
  try {
    const url = URL.createObjectURL(await facePng());
    const a = document.createElement('a');
    a.href = url; a.download = 'stackchan-face.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    $('#brand-status').textContent = 'PNG ready for download.';
  } catch (error) { $('#brand-status').textContent = error.message; }
};
const shareButton = $('#brand-share');
if (navigator.canShare && navigator.share) {
  const sample = new File([''], 'stackchan-face.png', { type: 'image/png' });
  shareButton.hidden = !navigator.canShare({ files: [sample] });
}
shareButton.onclick = async () => {
  try {
    const file = new File([await facePng()], 'stackchan-face.png', { type: 'image/png' });
    await navigator.share({ files: [file], title: 'StackChan face' });
    $('#brand-status').textContent = 'Image shared.';
  } catch (error) {
    if (error.name !== 'AbortError') $('#brand-status').textContent = 'Could not share. Use Download PNG instead.';
  }
};

for (const name of Object.keys(EXPRESSIONS)) {
  const meta = EXPRESSION_META[name] || { emoji: '', label: name };
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.expr = name;
  b.textContent = `${meta.emoji} ${meta.label}`.trim();
  b.onclick = () => morphToExpression(name, {
    durationMs: 220,
    syncHead: $('#expr-sync-head')?.checked,
    syncLed: $('#expr-sync-led')?.checked,
  });
  $('#presets').append(b);
}
updateExpressionBadge('neutral');

$('#reset-face').onclick = () => morphToExpression('neutral', { durationMs: 180, syncHead: true, syncLed: true });
async function triggerBlink() {
  const prevL = avatar.leftEye.weight, prevR = avatar.rightEye.weight;
  setAvatar({ leftEye: { weight: 0 }, rightEye: { weight: 0 } });
  await sleep(140);
  setAvatar({ leftEye: { weight: prevL || 100 }, rightEye: { weight: prevR || 100 } });
}
$('#blink').onclick = triggerBlink;
$('#led-set').onclick = () => setLed($('#led-color').value, 0.3);
$('#led-off').onclick = () => setLed('#000000', 0.3);

/* ───────────── motion: joystick, sliders, nod/shake ───────────── */
const motion = { yaw: 0, pitch: 45 };     // degrees
const speedEl = $('#speed');
const motionSpeed = () => +speedEl.value;
const yawEl = $('#yaw'), pitchEl = $('#pitch');
const out = (el) => el.parentElement.querySelector('output');

function showMotion() {
  yawEl.value = motion.yaw * 10; pitchEl.value = motion.pitch * 10;
  out(yawEl).textContent = Math.round(motion.yaw * 10); out(pitchEl).textContent = Math.round(motion.pitch * 10);
  const nx = motion.yaw / 100, ny = (45 - motion.pitch) / 40;
  const knob = $('#knob');
  knob.style.left = `${50 + clamp(nx, -1, 1) * 39 - 11}%`;
  knob.style.top = `${50 + clamp(ny, -1, 1) * 39 - 11}%`;
}
function moveHead(yaw, pitch, { send: doSend = true, speed } = {}) {
  motion.yaw = clamp(yaw, -128, 128); motion.pitch = clamp(pitch, 0, 90);
  showMotion();
  if (doSend) sendHead(motion.yaw, motion.pitch, speed ?? motionSpeed());
}
yawEl.oninput = () => moveHead(yawEl.value / 10, motion.pitch);
pitchEl.oninput = () => moveHead(motion.yaw, pitchEl.value / 10);
speedEl.oninput = () => { out(speedEl).textContent = speedEl.value; };
$('#center').onclick = () => moveHead(0, 45);
async function doNod() {
  const p = motion.pitch;
  for (let i = 0; i < 2; i++) { moveHead(motion.yaw, p + 15); await sleep(320); moveHead(motion.yaw, p - 15); await sleep(320); }
  moveHead(motion.yaw, p);
}
async function doShake() {
  const y = motion.yaw;
  for (let i = 0; i < 2; i++) { moveHead(y + 25, motion.pitch); await sleep(320); moveHead(y - 25, motion.pitch); await sleep(320); }
  moveHead(y, motion.pitch);
}
$('#nod').onclick = doNod;
$('#shake').onclick = doShake;

const pad = $('#pad');
let dragging = false;
function padMove(e) {
  const r = pad.getBoundingClientRect();
  let nx = ((e.clientX - r.left) / r.width - 0.5) * 2 / 0.78;
  let ny = ((e.clientY - r.top) / r.height - 0.5) * 2 / 0.78;
  const len = Math.hypot(nx, ny);
  if (len > 1) { nx /= len; ny /= len; }
  moveHead(nx * 100, 45 - ny * 40);
}
pad.onpointerdown = (e) => { dragging = true; pad.setPointerCapture(e.pointerId); pad.style.cursor = 'grabbing'; padMove(e); };
pad.onpointermove = (e) => { if (dragging) padMove(e); };
const release = () => { if (!dragging) return; dragging = false; pad.style.cursor = 'grab'; if ($('#spring').checked) moveHead(0, 45); };
pad.onpointerup = release; pad.onpointercancel = release;
pad.onkeydown = (e) => {
  const d = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[e.key];
  if (d) { e.preventDefault(); moveHead(motion.yaw + d[0], motion.pitch + d[1]); }
};
showMotion();

/* ───────────── Expression Mode (Live Emotion Simulator) ───────────── */
let exprSimRunning = false;
let exprSimToken = 0;

for (const [seqId, seq] of Object.entries(EMOTION_SEQUENCES)) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = seq.label;
  btn.onclick = () => playEmotionSequence(seqId);
  $('#sequence-buttons').append(btn);
}

$('#expr-interval').oninput = (e) => {
  out(e.target).textContent = `${(+e.target.value).toFixed(1)}s`;
};

async function playEmotionSequence(seqId, checkToken = null) {
  const seq = EMOTION_SEQUENCES[seqId];
  if (!seq) return;
  $('#expr-sim-status').textContent = `Playing sequence: ${seq.label}…`;
  for (const step of seq.steps) {
    if (checkToken !== null && checkToken !== exprSimToken) return;
    await morphToExpression(step.expression, {
      durationMs: 240,
      syncHead: $('#expr-sync-head').checked,
      syncLed: $('#expr-sync-led').checked,
    });
    if ($('#expr-sync-head').checked && (step.yaw !== undefined || step.pitch !== undefined)) {
      moveHead(step.yaw ?? motion.yaw, step.pitch ?? motion.pitch);
    }
    if ($('#expr-sync-led').checked && step.led) setLed(step.led, 0.3);
    await sleep(step.durationMs || 650);
  }
  if (checkToken === null) $('#expr-sim-status').textContent = `Completed sequence: ${seq.label}.`;
}

function stopExpressionMode() {
  if (!exprSimRunning) return;
  exprSimRunning = false;
  ++exprSimToken;
  $('#expr-sim-toggle').textContent = '▶ Start Expression Mode';
  $('#expr-sim-badge').textContent = 'Stopped';
  $('#expr-sim-badge').className = 'badge muted-badge';
  $('#expr-sim-status').textContent = 'Expression Mode paused.';
}

async function startExpressionMode() {
  if (exprSimRunning) { stopExpressionMode(); return; }
  stopMirror();
  exprSimRunning = true;
  const token = ++exprSimToken;
  $('#expr-sim-toggle').textContent = '⏹ Stop Expression Mode';
  $('#expr-sim-badge').textContent = 'Simulating Live';
  $('#expr-sim-badge').className = 'badge active-badge';

  const exprNames = Object.keys(EXPRESSIONS);
  const seqNames = Object.keys(EMOTION_SEQUENCES);
  let idx = 0;

  while (exprSimRunning && token === exprSimToken) {
    const mode = $('#expr-sim-mode').value;
    const intervalMs = Math.round((+$('#expr-interval').value || 3) * 1000);
    const syncHead = $('#expr-sync-head').checked;
    const syncLed = $('#expr-sync-led').checked;
    const autoBlink = $('#expr-auto-blink').checked;

    if (mode === 'carousel') {
      const name = exprNames[idx % exprNames.length];
      idx++;
      const meta = EXPRESSION_META[name];
      $('#expr-sim-status').textContent = `Simulating: ${meta.emoji} ${meta.label} (LED ${meta.led}, Yaw ${meta.yaw}°, Pitch ${meta.pitch}°)`;
      await morphToExpression(name, { durationMs: 320, syncHead, syncLed });
      const half = Math.max(300, Math.round(intervalMs / 2));
      await sleep(half);
      if (token !== exprSimToken) break;
      if (autoBlink && name !== 'sleepy' && name !== 'wink') await triggerBlink();
      await sleep(Math.max(300, intervalMs - half));
    } else if (mode === 'ambient') {
      const ambientMoods = ['neutral', 'happy', 'curious', 'neutral', 'wink', 'thinking', 'happy'];
      const name = ambientMoods[idx % ambientMoods.length];
      idx++;
      const meta = EXPRESSION_META[name];
      const glanceYaw = Math.round((Math.random() - 0.5) * 32);
      const glancePitch = clamp(45 + Math.round((Math.random() - 0.45) * 18), 25, 65);
      $('#expr-sim-status').textContent = `Ambient companion: ${meta.emoji} ${meta.label} · glancing (${glanceYaw}°, ${glancePitch}°)`;
      await morphToExpression(name, { durationMs: 360, syncHead: false, syncLed });
      if (syncHead) moveHead(glanceYaw, glancePitch, { speed: 250 });
      await sleep(Math.round(intervalMs * 0.45));
      if (token !== exprSimToken) break;
      if (autoBlink) {
        await triggerBlink();
        if (Math.random() > 0.6) { await sleep(120); await triggerBlink(); }
      }
      await sleep(Math.round(intervalMs * 0.55));
    } else if (mode === 'story') {
      const seqId = seqNames[idx % seqNames.length];
      idx++;
      await playEmotionSequence(seqId, token);
      await sleep(600);
    }
  }
}
$('#expr-sim-toggle').onclick = startExpressionMode;

/* ───────────── camera ───────────── */
let stream = null;
const videos = [$('#cam'), $('#cam2')];
const camSelect = $('#cam-select');

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  camSelect.innerHTML = devs.map((d, i) => `<option value="${d.deviceId}">${d.label || `Camera ${i + 1}`}</option>`).join('');
}
async function startCamera() {
  if (stream) return stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: camSelect.value ? { exact: camSelect.value } : undefined, width: 640, height: 480 } });
  } catch (e) {
    $('#track-status').textContent = `Camera error: ${e.message}`;
    throw e;
  }
  videos.forEach((v) => { v.srcObject = stream; });
  $('#cam-empty').hidden = $('#cam2-empty').hidden = true;
  $('#cam-start').disabled = true; $('#cam-stop').disabled = false;
  await refreshDevices();
  return stream;
}
function stopCamera() {
  stopMirror();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  videos.forEach((v) => { v.srcObject = null; });
  $('#cam-empty').hidden = $('#cam2-empty').hidden = false;
  $('#cam-start').disabled = false; $('#cam-stop').disabled = true;
}
$('#cam-start').onclick = () => startCamera().catch(() => {});
$('#cam-stop').onclick = stopCamera;
camSelect.onchange = () => { if (stream) { stopCamera(); startCamera().catch(() => {}); } };
$('#cam-flip').onchange = (e) => videos.forEach((v) => v.classList.toggle('noflip', !e.target.checked));
refreshDevices().catch(() => {});

/* ───────────── mirror my face ───────────── */
const cfg = { ...DEFAULTS };
const smoother = new Smoother();
let landmarker = null, mirroring = false, calib = { yaw: 0, pitch: 0 }, lastFace = null, lastTs = 0;

const bind = (id, key, invert = false) => { $(id).onchange = (e) => { cfg[key] = invert ? !e.target.checked : e.target.checked; smoother.reset(); }; };
bind('#m-head', 'head'); bind('#m-eyes', 'eyes'); bind('#m-mouth', 'mouth'); bind('#m-gaze', 'gaze');
bind('#m-mirror', 'mirror'); bind('#m-invyaw', 'invertYaw'); bind('#m-invpitch', 'invertPitch');
for (const [id, key] of [['#m-gain', 'gain'], ['#m-smooth', 'smooth'], ['#m-speed', 'speed']]) {
  const el = $(id);
  el.oninput = () => { cfg[key] = +el.value; out(el).textContent = el.value; };
}

async function loadTracker() {
  if (landmarker) return landmarker;
  $('#track-status').textContent = 'Loading face model…';
  const { FaceLandmarker, FilesetResolver } = await import('/vendor/mediapipe/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
  const base = (delegate) => ({ baseOptions: { modelAssetPath: '/vendor/face_landmarker.task', delegate }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
  try { landmarker = await FaceLandmarker.createFromOptions(fileset, base('GPU')); }
  catch { landmarker = await FaceLandmarker.createFromOptions(fileset, base('CPU')); }
  return landmarker;
}

async function startMirror() {
  stopExpressionMode();
  try {
    await startCamera();
    await loadTracker();
  } catch (e) {
    $('#track-status').textContent = `Could not start camera: ${e.message}. Use "Simulate mirror test" to test mirroring without a webcam.`;
    return;
  }
  mirroring = true; smoother.reset();
  $('#mirror-toggle').textContent = 'Stop mirroring';
  $('#mirror-badge').textContent = 'Mirroring Live';
  $('#mirror-badge').className = 'badge active-badge';
  $('#calibrate').disabled = false;
  $('#track-status').textContent = connState === 'connected' ? 'Mirroring live to StackChan…' : 'Tracking your face live in preview';
  requestAnimationFrame(loop);
}
function stopMirror() {
  if (!mirroring) return;
  mirroring = false;
  $('#mirror-toggle').textContent = 'Start mirroring';
  $('#mirror-badge').textContent = 'Idle';
  $('#mirror-badge').className = 'badge muted-badge';
  $('#calibrate').disabled = true;
  $('#track-status').textContent = 'Mirroring stopped.';
}
$('#mirror-toggle').onclick = () => (mirroring ? stopMirror() : startMirror());
$('#calibrate').onclick = () => { if (lastFace) { calib = { yaw: lastFace.yaw, pitch: lastFace.pitch }; smoother.reset(); $('#track-status').textContent = 'Calibrated: current pose is now center.'; } };

function applySyntheticFace(face) {
  const changes = smoother.step(mapFace(face, cfg, { yaw: 0, pitch: 0 }), 0.15);
  const { head, ...features } = changes;
  if (Object.keys(features).length) setAvatar(features);
  if (head) moveHead(head.yaw ?? motion.yaw, head.pitch ?? motion.pitch, { speed: cfg.speed });
}

async function runSimulatedMirrorTest(checkCancel = () => false) {
  smoother.reset();
  $('#mirror-badge').textContent = 'Mirror Sim Active';
  $('#mirror-badge').className = 'badge active-badge';
  const poses = [
    { label: 'Looking left & smiling (jawOpen=0.45)', face: { blend: { jawOpen: 0.45, eyeLookOutLeft: 0.6, eyeLookInRight: 0.6 }, yaw: -18, pitch: 6 } },
    { label: 'Right-eye wink (mirrored to robot left eye)', face: { blend: { eyeBlinkRight: 0.95, jawOpen: 0.2 }, yaw: 0, pitch: 4 } },
    { label: 'Looking right & surprised (jawOpen=0.75)', face: { blend: { jawOpen: 0.75, eyeLookInLeft: 0.7, eyeLookOutRight: 0.7 }, yaw: 20, pitch: 10 } },
    { label: 'Left-eye wink (mirrored to robot right eye)', face: { blend: { eyeBlinkLeft: 0.95, jawOpen: 0.15 }, yaw: -8, pitch: -4 } },
    { label: 'Centered neutral pose', face: { blend: { jawOpen: 0 }, yaw: 0, pitch: 0 } },
  ];
  for (const step of poses) {
    if (checkCancel()) break;
    $('#track-status').textContent = `Mirror engine: ${step.label}`;
    applySyntheticFace(step.face);
    await sleep(650);
  }
  $('#mirror-badge').textContent = mirroring ? 'Mirroring Live' : 'Idle';
  if (!mirroring) $('#mirror-badge').className = 'badge muted-badge';
}
$('#mirror-sim-btn').onclick = () => runSimulatedMirrorTest();

function loop(now) {
  if (!mirroring) return;
  requestAnimationFrame(loop);
  const video = $('#cam');
  if (now - lastTs < 55 || video.readyState < 2) return; // ~18 fps cap
  lastTs = now;
  const face = readFace(landmarker.detectForVideo(video, now));
  if (!face) { $('#track-status').textContent = 'No face detected'; return; }
  lastFace = face;
  $('#track-status').textContent = `Mirroring: yaw ${Math.round(face.yaw)}°, pitch ${Math.round(face.pitch)}°`;
  const changes = smoother.step(mapFace(face, cfg, calib), cfg.smooth);
  const { head, ...features } = changes;
  if (Object.keys(features).length) setAvatar(features);
  if (head) {
    if (head.yaw !== undefined) motion.yaw = head.yaw;
    if (head.pitch !== undefined) motion.pitch = head.pitch;
    showMotion();
    sendHead(head.yaw, head.pitch, cfg.speed);
  }
}

/* ───────────── chat + changes made by the AI ───────────── */
const wsSend = (obj) => { if (ws?.readyState === 1) ws.send(JSON.stringify(obj)); };
const chat = initChat({ wsSend, setAvatar });

/** The server moved the robot on the AI's behalf: mirror it in the UI without re-sending. */
function applyFromServer({ kind, data }) {
  if (kind === 'avatar') setAvatar(data, { send: false });
  else if (kind === 'motion') {
    if (data.yawServo?.angle !== undefined) motion.yaw = data.yawServo.angle / 10;
    if (data.pitchServo?.angle !== undefined) motion.pitch = data.pitchServo.angle / 10;
    showMotion();
  } else if (kind === 'rgb' && data.leftRgbColor) setLedPreview(data.leftRgbColor);
}

/* ───────────── 6-Stage Capability Showcase Demo ───────────── */
let demoRunning = false;
let demoToken = 0;

function markDemoStage(stageNum, progressPct, statusText) {
  $('#demo-progress').style.width = `${progressPct}%`;
  $('#demo-status').textContent = statusText;
  document.querySelectorAll('#demo-stages li').forEach((li) => {
    const s = +li.dataset.stage;
    li.classList.toggle('stage-active', s === stageNum);
    li.classList.toggle('stage-done', s < stageNum || progressPct === 100);
  });
}

function stopCapabilityDemo() {
  if (ws?.readyState === 1) {
    ws.send(JSON.stringify({ t: 'device_demo_stop' }));
  }
  demoRunning = false;
  ++demoToken;
  speechSynthesis?.cancel();
  $('#demo-run-btn').disabled = false;
  $('#demo-stop-btn').disabled = true;
  $('#demo-badge').textContent = 'Stopped on Device';
  $('#demo-badge').className = 'badge muted-badge';
  $('#demo-status').textContent = 'On-Device Capability Demo stopped.';
}

function startOnDeviceCapabilityDemo() {
  switchTab('avatar');
  stopExpressionMode();
  if (ws?.readyState === 1 && connState === 'connected') {
    ws.send(JSON.stringify({ t: 'device_demo_start' }));
    demoRunning = true;
    $('#demo-run-btn').disabled = true;
    $('#demo-stop-btn').disabled = false;
    $('#demo-badge').textContent = 'Running on Device (Stage 1/7)';
    $('#demo-badge').className = 'badge active-badge';
    markDemoStage(1, 14, 'Stage 1/7 running natively on Stack-Chan hardware (LCD + Servos + RGB + Speaker)…');
  } else {
    runCapabilityDemo();
  }
}

function renderDeviceDemo(d) {
  if (!d) return;
  if (d.active) {
    demoRunning = true;
    $('#demo-run-btn').disabled = true;
    $('#demo-stop-btn').disabled = false;
    const total = d.total || 7;
    const stage = d.stage || 1;
    const pct = Math.min(100, Math.round((stage / total) * 100));
    $('#demo-badge').textContent = `On-Device · Stage ${stage}/${total}`;
    $('#demo-badge').className = 'badge active-badge';
    markDemoStage(stage, pct, `On-Device Stage ${stage}/${total}: ${d.title || ''} — ${d.detail || ''}`);
    // Sync UI preview expression & LED with what the physical device is currently showcasing
    const stageExprMap = { 1: 'happy', 2: 'love', 3: 'excited', 4: 'dizzy', 5: 'curious', 6: 'happy', 7: 'excited' };
    const expr = stageExprMap[stage] || 'happy';
    setAvatar(fullFace(EXPRESSIONS[expr] || EXPRESSIONS.happy), { send: false });
    updateExpressionBadge(expr);
  } else {
    demoRunning = false;
    $('#demo-run-btn').disabled = false;
    $('#demo-stop-btn').disabled = true;
    $('#demo-badge').textContent = 'Completed on Device ✓';
    $('#demo-badge').className = 'badge active-badge';
    markDemoStage(7, 100, d.detail || 'On-Device 7-Stage CGI Capability Demo complete!');
  }
}

async function runCapabilityDemo() {
  if (demoRunning) { stopCapabilityDemo(); return; }
  switchTab('avatar');
  stopExpressionMode();
  demoRunning = true;
  const token = ++demoToken;
  const aborted = () => !demoRunning || token !== demoToken;
  const narrate = async (text) => {
    if (aborted() || !$('#demo-narration').checked) return;
    await chat.speak(text, { force: true });
  };

  $('#demo-run-btn').disabled = true;
  $('#demo-stop-btn').disabled = false;
  $('#demo-badge').textContent = 'Running Showcase';
  $('#demo-badge').className = 'badge active-badge';

  try {
    // Stage 1: Custom Brand & Logo Reveal
    markDemoStage(1, 12, 'Stage 1/6: Revealing custom brand logo & LED signature…');
    if (!brandImage) await loadLogoFromSrc('/logo.svg', 'Default custom logo active.');
    $('#brand-placement').value = 'face';
    $('#brand-opacity').value = '100';
    $('#brand-opacity').nextElementSibling.textContent = '100';
    setLed('#38bdf8', 0.4);
    drawFace();
    await sleep(900);
    if (aborted()) return;
    $('#brand-placement').value = 'background';
    $('#brand-opacity').value = '85';
    $('#brand-opacity').nextElementSibling.textContent = '85';
    drawFace();
    await narrate('Hello! I am StackChan, running my custom branded application.');
    if (aborted()) return;

    // Stage 2: Expression Mode Simulation
    markDemoStage(2, 30, 'Stage 2/6: Demonstrating Expression Mode emotion simulation…');
    for (const expr of ['happy', 'curious', 'thinking', 'surprised', 'excited', 'wink']) {
      if (aborted()) return;
      await morphToExpression(expr, { durationMs: 260, syncHead: true, syncLed: true });
      await sleep(550);
    }
    await narrate('My expression simulator morphs smoothly between emotions with synchronized mood lighting.');
    if (aborted()) return;

    // Stage 3: 3D Servo & Gesture Choreography
    markDemoStage(3, 50, 'Stage 3/6: Performing 3D servo choreography (yaw, pitch, nod & shake)…');
    moveHead(-35, 55, { speed: 400 }); await sleep(450);
    if (aborted()) return;
    moveHead(35, 55, { speed: 400 }); await sleep(450);
    if (aborted()) return;
    moveHead(0, 45, { speed: 350 }); await sleep(300);
    await doNod();
    if (aborted()) return;
    await doShake();
    if (aborted()) return;

    // Stage 4: Mirror-Me Face Tracking Engine
    markDemoStage(4, 68, 'Stage 4/6: Showcasing Mirror-Me face & gaze tracking pipeline…');
    await runSimulatedMirrorTest(aborted);
    if (aborted()) return;

    // Stage 5: Google Gemini AI Live Turn
    markDemoStage(5, 85, 'Stage 5/6: Connecting to Google Gemini AI for an autonomous turn…');
    if (chat.isGeminiReady()) {
      const res = await chat.askDemo('Say a one-sentence excited greeting for our live capability demo and show a happy or excited expression!');
      if (!aborted() && res?.ok && res.text) {
        await narrate(res.text);
      }
    } else {
      await morphToExpression('excited', { durationMs: 250, syncHead: true, syncLed: true });
      await narrate('Google Gemini integration is wired and ready! Add your Gemini API key in dot E N V for live AI conversations.');
    }
    if (aborted()) return;

    // Stage 6: Grand Finale & Transition to Ambient Expression Mode
    markDemoStage(6, 100, 'Stage 6/6: Finale complete! Transitioning into Ambient Expression Mode…');
    await morphToExpression('happy', { durationMs: 250, syncHead: true, syncLed: true });
    await doNod();
    if (aborted()) return;

    demoRunning = false;
    $('#demo-run-btn').disabled = false;
    $('#demo-stop-btn').disabled = true;
    $('#demo-badge').textContent = 'Completed ✓';
    $('#demo-badge').className = 'badge active-badge';
  } finally {
    if (demoRunning && token === demoToken) {
      demoRunning = false;
      $('#demo-run-btn').disabled = false;
      $('#demo-stop-btn').disabled = true;
    }
  }
}

$('#demo-run-btn').onclick = startOnDeviceCapabilityDemo;
$('#demo-stop-btn').onclick = stopCapabilityDemo;
$('#header-demo-btn').onclick = startOnDeviceCapabilityDemo;
if ($('#browser-demo-btn')) $('#browser-demo-btn').onclick = runCapabilityDemo;
if ($('#voice-brain-provider')) {
  $('#voice-brain-provider').onchange = (e) => {
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify({ t: 'set_voice_provider', provider: e.target.value }));
    }
  };
}

/* ───────────── Live On-Device Top Head Touch & 6-Axis IMU Gyroscope Telemetry ───────────── */
let lastRenderedImuEvent = 'none';
let lastRenderedGesture = 'none';

function renderSensor(d) {
  if (!d) return;
  if (Array.isArray(d.touch)) {
    d.touch.forEach((v, i) => {
      const bar = $(`#tz-${i}`);
      if (bar) bar.style.width = `${Math.min(100, Math.round((v / 3) * 100))}%`;
    });
  }
  const gBadge = $('#touch-gesture-badge');
  const gMap = {
    none: ['Idle', 'badge muted-badge'],
    press: ['Patting / Touched ❤️', 'badge active-badge'],
    swipe_forward: ['Swiped Forward ❤️', 'badge active-badge'],
    swipe_backward: ['Swiped Backward ❤️', 'badge active-badge'],
    double_tap_voice: ['Double-Tap Voice 🎙️', 'badge active-badge'],
    release: ['Released', 'badge muted-badge'],
  };
  if (gBadge && d.gesture) {
    const [txt, cls] = gMap[d.gesture] || [d.gesture, 'badge active-badge'];
    gBadge.textContent = txt;
    gBadge.className = cls;
  }
  if ($('#touch-status')) {
    const activePads = (d.touch || []).some((x) => x > 0);
    $('#touch-status').textContent = `Position: ${d.pos ?? 0} · Zones: [${(d.touch || [0, 0, 0]).join(', ')}] · ${activePads ? 'Head touch active!' : 'Touch top of head to pet or double-tap for voice'}`;
  }
  if (d.gesture && d.gesture !== lastRenderedGesture) {
    lastRenderedGesture = d.gesture;
    if (d.gesture === 'press' || d.gesture === 'swipe_forward' || d.gesture === 'swipe_backward') {
      setAvatar(fullFace(EXPRESSIONS.love), { send: false });
      updateExpressionBadge('love');
      setLedPreview('#ff4081');
    } else if (d.gesture === 'release') {
      setAvatar(fullFace(EXPRESSIONS.neutral), { send: false });
      updateExpressionBadge('neutral');
    }
  }

  if (d.pitch !== undefined) $('#imu-pitch').textContent = `${Number(d.pitch).toFixed(1)}°`;
  if (d.roll !== undefined) $('#imu-roll').textContent = `${Number(d.roll).toFixed(1)}°`;
  if (d.gx !== undefined) $('#imu-gyro').textContent = `${Math.round(d.gx)} / ${Math.round(d.gy)} / ${Math.round(d.gz)} °/s`;
  if (d.ax !== undefined) $('#imu-accel').textContent = `${Number(d.ax).toFixed(1)} / ${Number(d.ay).toFixed(1)} / ${Number(d.az).toFixed(1)} m/s²`;

  const imuBadge = $('#imu-event-badge');
  const imuMap = {
    none: ['Stable', 'badge muted-badge'],
    shake: ['Shaken 😵 Dizzy!', 'badge active-badge'],
    pickup: ['Picked Up / Tilted 😮', 'badge active-badge'],
  };
  if (imuBadge && d.imu) {
    const [txt, cls] = imuMap[d.imu] || [d.imu, 'badge active-badge'];
    imuBadge.textContent = txt;
    imuBadge.className = cls;
  }
  if (d.imu && d.imu !== lastRenderedImuEvent) {
    lastRenderedImuEvent = d.imu;
    if (d.imu === 'shake') {
      setAvatar(fullFace(EXPRESSIONS.dizzy), { send: false });
      updateExpressionBadge('dizzy');
      setLedPreview('#76ff03');
    } else if (d.imu === 'pickup') {
      setAvatar(fullFace(EXPRESSIONS.surprised), { send: false });
      updateExpressionBadge('surprised');
      setLedPreview('#00e5ff');
    }
  }

  if ($('#imu-mirror-head')?.checked && d.roll !== undefined && d.pitch !== undefined) {
    const ex = clamp(Math.round(d.roll * 1.2), -80, 80);
    const ey = clamp(Math.round(-d.pitch * 1.2), -80, 80);
    setAvatar({ leftEye: { x: ex, y: ey }, rightEye: { x: ex, y: ey } }, { send: false });
  }
}

/* ───────────── MicroSD Card & PSRAM Storage Manager ───────────── */
function renderSdCard(d) {
  if (!d) return;
  const badge = $('#sd-status-badge');
  if (badge) {
    badge.textContent = d.mounted ? `${d.status || 'Mounted (FAT32)'} ✓` : (d.status || 'SD Not Mounted');
    badge.className = d.mounted ? 'badge active-badge' : 'badge muted-badge';
  }
  if ($('#sd-name')) $('#sd-name').textContent = d.name || (d.mounted ? 'SDHC/FAT32' : '—');
  if ($('#sd-capacity')) {
    const gb = d.total_mb >= 1024 ? `${(d.total_mb / 1024).toFixed(2)} GB (${Math.round(d.total_mb)} MB)` : `${Number(d.total_mb || 0).toFixed(1)} MB`;
    $('#sd-capacity').textContent = d.mounted ? gb : '—';
  }
  if ($('#sd-space')) {
    const freeStr = d.free_mb >= 1024 ? `${(d.free_mb / 1024).toFixed(2)} GB` : `${Number(d.free_mb || 0).toFixed(1)} MB`;
    $('#sd-space').textContent = d.mounted ? `${freeStr} free (${Number(d.used_mb || 0).toFixed(2)} MB used)` : '—';
  }
  if ($('#sd-files')) $('#sd-files').textContent = `${d.files ?? 0} files (/sdcard/cgi & /sdcard/memory)`;
  if ($('#sd-psram')) $('#sd-psram').textContent = `${d.free_psram_kb ?? 0} KB / ${d.total_psram_kb ?? 8192} KB`;
  if ($('#sd-sram')) $('#sd-sram').textContent = `${d.free_sram_kb ?? 0} KB free`;
  if ($('#sd-status-text')) {
    $('#sd-status-text').textContent = d.mounted
      ? `MicroSD card "${d.name || 'SD'}" mounted at /sdcard (FAT32). Storing CGI brand config & Gemini conversation memory on SD card.`
      : `MicroSD status: ${d.status || 'Check card insertion'}`;
  }
}

$('#sd-format-btn').onclick = () => {
  if (ws?.readyState !== 1) return;
  $('#sd-status-badge').textContent = 'Formatting FAT32…';
  $('#sd-status-text').textContent = 'Formatting MicroSD card as FAT32 and initializing /sdcard/cgi and /sdcard/memory…';
  ws.send(JSON.stringify({ t: 'sd_format' }));
};
$('#sd-sync-btn').onclick = () => {
  if (ws?.readyState !== 1) return;
  $('#sd-status-text').textContent = 'Syncing CGI.com brand config and 14 expression presets to /sdcard/cgi/cgi_brand.json…';
  ws.send(JSON.stringify({
    t: 'sd_brand',
    data: {
      brand: 'CGI.com',
      color: '#E11937',
      expressionCount: Object.keys(EXPRESSIONS).length,
      activeExpression: activeExpressionName,
      syncedAt: new Date().toISOString(),
    },
  }));
};
$('#sd-refresh-btn').onclick = () => {
  if (ws?.readyState !== 1) return;
  ws.send(JSON.stringify({ t: 'sd_info' }));
};

openSocket();

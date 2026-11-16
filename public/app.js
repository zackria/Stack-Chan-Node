import { EXPRESSIONS } from '/shared/expressions.js';
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
    else if (m.t === 'voice_link' || m.t === 'voice_call') chat?.onMessage(m);
    else chat?.onMessage(m);
  };
  ws.onclose = () => { renderStatus({ state: 'disconnected', error: 'Lost connection to the local server. Is `npm run app` still running?' }); setTimeout(openSocket, 1500); };
}
const send = (t, data) => { if (ws?.readyState === 1 && connState === 'connected') ws.send(JSON.stringify({ t, data })); };
const sendHead = (yawDeg, pitchDeg, speed) => send('motion', {
  yawServo: yawDeg == null ? undefined : { angle: Math.round(yawDeg * 10), speed },
  pitchServo: pitchDeg == null ? undefined : { angle: Math.round(pitchDeg * 10), speed },
});

function renderStatus({ state, error }) {
  connState = state;
  $('#dot').className = `dot ${state}`;
  $('#status').textContent = { disconnected: 'Disconnected', connecting: 'Searching for StackChan…', connected: 'Connected' }[state];
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

/* ───────────── tabs ───────────── */
for (const tab of document.querySelectorAll('.tabs [role=tab]')) {
  tab.onclick = () => {
    document.querySelectorAll('.tabs [role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.id !== `tab-${tab.dataset.tab}`; });
  };
}

/* ───────────── avatar state, sliders, preview ───────────── */
const FEATURES = {
  leftEye: { label: 'Left eye', keys: ['x', 'y', 'rotation', 'weight', 'size'] },
  rightEye: { label: 'Right eye', keys: ['x', 'y', 'rotation', 'weight', 'size'] },
  mouth: { label: 'Mouth', keys: ['x', 'y', 'rotation', 'weight'] },
};
const RANGE = { x: [-100, 100], y: [-100, 100], rotation: [-1800, 1800], weight: [0, 100], size: [-100, 100] };
const NEUTRAL = JSON.parse(JSON.stringify(EXPRESSIONS.neutral));
const avatar = {
  leftEye: { x: 0, y: 0, rotation: 0, weight: 100, size: 0 },
  rightEye: { x: 0, y: 0, rotation: 0, weight: 100, size: 0 },
  mouth: { x: 0, y: 0, rotation: 0, weight: 0 },
};
const sliderEls = {};

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

/** Merge a patch into local state, refresh UI, and optionally send to the robot. */
function setAvatar(patch, { send: doSend = true } = {}) {
  for (const [g, vals] of Object.entries(patch)) {
    for (const [k, v] of Object.entries(vals)) {
      if (!(k in avatar[g])) continue;
      avatar[g][k] = v;
      const el = sliderEls[`${g}.${k}`];
      el.input.value = v; el.out.textContent = Math.round(v);
    }
  }
  drawFace();
  if (doSend) send('avatar', patch);
}

const canvas = $('#face'), ctx = canvas.getContext('2d');
let brandImage = null;
let brandLoadId = 0;
function drawFace() {
  const { width: W, height: H } = canvas;
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H);
  if (brandImage) {
    const scale = Math[$('#brand-fit').value === 'cover' ? 'max' : 'min'](W / brandImage.naturalWidth, H / brandImage.naturalHeight);
    const w = brandImage.naturalWidth * scale, h = brandImage.naturalHeight * scale;
    ctx.save();
    ctx.globalAlpha = +$('#brand-opacity').value / 100;
    ctx.drawImage(brandImage, (W - w) / 2, (H - h) / 2, w, h);
    ctx.restore();
    if ($('#brand-placement').value === 'face') return;
  }
  ctx.fillStyle = '#fff';
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
}
drawFace();

$('#brand-file').onchange = async (event) => {
  const id = ++brandLoadId;
  const file = event.target.files[0];
  if (!file) return;
  const status = $('#brand-status');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    status.textContent = 'Choose a PNG, JPEG or WebP image up to 5 MB.';
    event.target.value = '';
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (id !== brandLoadId) return;
    brandImage = image;
    $('#brand-remove').disabled = false;
    status.textContent = `${file.name} added to preview.`;
    drawFace();
  } catch {
    if (id === brandLoadId) status.textContent = 'Could not read this image. Try another file.';
  } finally {
    URL.revokeObjectURL(url);
    if (id === brandLoadId) event.target.value = '';
  }
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
  $('#brand-status').textContent = 'Image removed.';
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
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => setAvatar(JSON.parse(JSON.stringify(EXPRESSIONS[name])));
  $('#presets').append(b);
}
$('#reset-face').onclick = () => setAvatar(JSON.parse(JSON.stringify(NEUTRAL)));
$('#blink').onclick = async () => {
  setAvatar({ leftEye: { weight: 0 }, rightEye: { weight: 0 } }); await sleep(150);
  setAvatar({ leftEye: { weight: 100 }, rightEye: { weight: 100 } });
};
$('#led-set').onclick = () => { const c = $('#led-color').value; send('rgb', { leftRgbColor: c, rightRgbColor: c, leftRgbDuration: 0.3, rightRgbDuration: 0.3 }); };
$('#led-off').onclick = () => send('rgb', { leftRgbColor: '#000000', rightRgbColor: '#000000', leftRgbDuration: 0.3, rightRgbDuration: 0.3 });

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
function moveHead(yaw, pitch, { send: doSend = true } = {}) {
  motion.yaw = clamp(yaw, -128, 128); motion.pitch = clamp(pitch, 0, 90);
  showMotion();
  if (doSend) sendHead(motion.yaw, motion.pitch, motionSpeed());
}
yawEl.oninput = () => moveHead(yawEl.value / 10, motion.pitch);
pitchEl.oninput = () => moveHead(motion.yaw, pitchEl.value / 10);
speedEl.oninput = () => { out(speedEl).textContent = speedEl.value; };
$('#center').onclick = () => moveHead(0, 45);
$('#nod').onclick = async () => {
  const p = motion.pitch;
  for (let i = 0; i < 2; i++) { moveHead(motion.yaw, p + 15); await sleep(350); moveHead(motion.yaw, p - 15); await sleep(350); }
  moveHead(motion.yaw, p);
};
$('#shake').onclick = async () => {
  const y = motion.yaw;
  for (let i = 0; i < 2; i++) { moveHead(y + 25, motion.pitch); await sleep(350); moveHead(y - 25, motion.pitch); await sleep(350); }
  moveHead(y, motion.pitch);
};

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

/* ───────────── camera ───────────── */
let stream = null;
const videos = [$('#cam'), $('#cam2')];
const camSelect = $('#cam-select');

async function refreshDevices() {
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
  try {
    await startCamera();
    await loadTracker();
  } catch (e) {
    $('#track-status').textContent = `Could not start: ${e.message}`;
    return;
  }
  mirroring = true; smoother.reset();
  $('#mirror-toggle').textContent = 'Stop mirroring';
  $('#calibrate').disabled = false;
  $('#track-status').textContent = connState === 'connected' ? 'Mirroring…' : 'Tracking (connect the robot to drive it)';
  requestAnimationFrame(loop);
}
function stopMirror() {
  if (!mirroring) return;
  mirroring = false;
  $('#mirror-toggle').textContent = 'Start mirroring';
  $('#calibrate').disabled = true;
  $('#track-status').textContent = 'Mirroring stopped.';
}
$('#mirror-toggle').onclick = () => (mirroring ? stopMirror() : startMirror());
$('#calibrate').onclick = () => { if (lastFace) { calib = { yaw: lastFace.yaw, pitch: lastFace.pitch }; smoother.reset(); $('#track-status').textContent = 'Calibrated: current pose is now center.'; } };

function loop(now) {
  if (!mirroring) return;
  requestAnimationFrame(loop);
  const video = $('#cam');
  if (now - lastTs < 55 || video.readyState < 2) return; // ~18 fps cap
  lastTs = now;
  const face = readFace(landmarker.detectForVideo(video, now));
  if (!face) { $('#track-status').textContent = 'No face detected'; return; }
  lastFace = face;
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
  } else if (kind === 'rgb' && data.leftRgbColor) $('#led-color').value = data.leftRgbColor;
}

openSocket();

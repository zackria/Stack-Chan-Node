// StackChan control panel: static UI + WebSocket bridge to the robot over Bluetooth.
//   npm run app   ->  http://127.0.0.1:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { BleManager } from './lib/ble-manager.js';
import { createAdapter, listProviders } from './lib/llm/providers.js';
import { runTurn, DEFAULT_SYSTEM } from './lib/agent.js';
import { createRobotActions } from './lib/robot-actions.js';
import { startXiaozhiBridge } from './lib/xiaozhi-mcp.js';
import { createAskTool } from './lib/ask-ai.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1'; // never expose the robot to the network

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.task': 'application/octet-stream',
  '.svg': 'image/svg+xml', '.json': 'application/json',
};
const MOUNTS = [
  ['/shared/', path.join(ROOT, 'src')],
  ['/vendor/mediapipe/', path.join(ROOT, 'node_modules/@mediapipe/tasks-vision')],
  ['/', path.join(ROOT, 'public')],
];

function resolveFile(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  for (const [prefix, dir] of MOUNTS) {
    if (!p.startsWith(prefix)) continue;
    const rel = p.slice(prefix.length) || 'index.html';
    const file = path.resolve(dir, rel);
    if (file !== dir && !file.startsWith(dir + path.sep)) return null; // path traversal
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const file = req.method === 'GET' ? resolveFile(req.url) : null;
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ noServer: true });
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

server.on('upgrade', (req, socket, head) => {
  // Block drive-by pages: only our own UI may talk to the robot.
  if (req.url !== '/ws' || !ALLOWED_ORIGINS.has(req.headers.origin)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

const broadcast = (msg) => { const s = JSON.stringify(msg); wss.clients.forEach((c) => c.readyState === 1 && c.send(s)); };
const ble = new BleManager(broadcast);
const robot = createRobotActions(ble, broadcast);
const MAX_HISTORY = 24; // messages kept per conversation

// Optional: let the robot's built-in voice agent (xiaozhi) call our robot tools. URL carries a secret token: env only.
let bridgeState = 'off';
const bridgeStatus = () => ({ t: 'voice_link', state: bridgeState });
if (process.env.XIAOZHI_MCP_URL) {
  if (!/^wss:\/\//.test(process.env.XIAOZHI_MCP_URL)) {
    console.warn('XIAOZHI_MCP_URL must start with wss:// — voice link disabled');
  } else {
    const askTool = createAskTool();
    console.log(askTool ? `Voice agent tool ask_ai enabled (${askTool.schema.properties.provider.enum.join(', ')})` : 'ask_ai disabled: no AI provider key in .env');
    startXiaozhiBridge({
      url: process.env.XIAOZHI_MCP_URL,
      robot,
      extraTools: askTool ? [askTool] : [],
      onState: (s) => { bridgeState = s; console.log(`Voice link (xiaozhi MCP): ${s}`); broadcast(bridgeStatus()); },
      onCall: (c) => { console.log(`Voice agent used tool: ${c.name} -> ${c.result}`); broadcast({ t: 'voice_call', ...c }); },
    });
  }
}

wss.on('connection', (ws) => {
  const chat = { history: [], busy: false };
  const reply = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
  reply(ble.status());
  reply(bridgeStatus());
  reply({ t: 'providers', list: listProviders(), defaultSystem: DEFAULT_SYSTEM });

  async function handleChat(m) {
    if (chat.busy) return reply({ t: 'chat_error', message: 'Still thinking about the last message…' });
    const text = String(m.text ?? '').trim().slice(0, 2000);
    if (!text) return;
    chat.busy = true; reply({ t: 'chat_busy', busy: true });
    try {
      const adapter = createAdapter(String(m.provider), { model: m.model ? String(m.model).slice(0, 100) : undefined });
      const system = m.system ? String(m.system).slice(0, 4000) : DEFAULT_SYSTEM;
      const { text: answer, actions } = await runTurn({ adapter, robot, history: chat.history, userText: text, system });
      chat.history.push({ role: 'user', text }, { role: 'assistant', text: answer });
      chat.history = chat.history.slice(-MAX_HISTORY);
      reply({ t: 'chat_reply', text: answer, actions });
    } catch (e) {
      reply({ t: 'chat_error', message: e.message });
    } finally {
      chat.busy = false; reply({ t: 'chat_busy', busy: false });
    }
  }

  ws.on('message', async (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case 'connect': await ble.connect(); break;
      case 'disconnect': await ble.disconnect(); break;
      case 'motion': case 'avatar': case 'rgb': ble.send(m.t, m.data); break;
      case 'chat': await handleChat(m); break;
      case 'chat_reset': chat.history = []; break;
      default: break;
    }
  });
});

server.listen(PORT, HOST, () => console.log(`StackChan panel: http://${HOST}:${PORT}`));

const shutdown = async () => { await ble.disconnect(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

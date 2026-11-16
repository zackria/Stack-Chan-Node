import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { startXiaozhiBridge, createMcpHandler } from '../lib/xiaozhi-mcp.js';

const fakeRobot = () => { const calls = []; return { calls, run: async (n, a) => { calls.push([n, a]); if (n === 'boom') throw new Error('bad'); return 'ok'; } }; };

test('MCP handler: initialize, list, call, errors, notifications', async () => {
  const robot = fakeRobot();
  const seen = [];
  const h = createMcpHandler(robot, (c) => seen.push(c));
  const init = await h({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(await h({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const list = await h({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map((t) => t.name), ['set_expression', 'move_head', 'gesture', 'set_led']);
  assert.equal(list.result.tools[0].inputSchema.type, 'object');
  const call = await h({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'set_expression', arguments: { name: 'happy' } } });
  assert.deepEqual(call.result, { content: [{ type: 'text', text: 'ok' }], isError: false });
  assert.deepEqual(robot.calls, [['set_expression', { name: 'happy' }]]);
  assert.equal(seen[0].name, 'set_expression');
  assert.equal((await h({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } })).error.code, -32602);
  assert.equal((await h({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).error.code, -32601);
  assert.deepEqual((await h({ jsonrpc: '2.0', id: 6, method: 'ping' })).result, {});
});

test('bridge: serves tools over a WebSocket and reconnects after the cloud drops it', async () => {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.once('listening', r));
  const url = `ws://127.0.0.1:${wss.address().port}/mcp/?token=secret-token`;
  const robot = fakeRobot();
  const states = [];
  let connections = 0;
  const replies = [];
  wss.on('connection', (sock) => {
    connections++;
    sock.on('message', (d) => replies.push(JSON.parse(d.toString())));
    if (connections === 1) {
      sock.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
      sock.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'gesture', arguments: { name: 'nod' } } }));
      setTimeout(() => sock.close(), 150); // cloud drops us
    }
  });
  const bridge = startXiaozhiBridge({ url, robot, onState: (s) => states.push(s) });
  await new Promise((r) => setTimeout(r, 1800));
  bridge.close();
  wss.close();
  assert.ok(connections >= 2, `expected a reconnect, got ${connections} connection(s)`);
  assert.deepEqual(replies.map((r) => r.id), [1, 2]);
  assert.equal(replies[1].result.content[0].text, 'ok');
  assert.deepEqual(robot.calls, [['gesture', { name: 'nod' }]]);
  assert.ok(states.includes('connected') && states.includes('reconnecting'));
});

import http from 'node:http';
import { createAskTool } from '../lib/ask-ai.js';

async function fakeApi(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => { const body = JSON.parse(b); seen.push({ url: req.url, headers: req.headers, body }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(handler(body, req.url))); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('ask_ai is hidden without keys and exposed with them', () => {
  assert.equal(createAskTool({}), null);
  const t = createAskTool({ OPENAI_API_KEY: 'k', GEMINI_API_KEY: 'g' });
  assert.deepEqual(t.schema.properties.provider.enum, ['openai', 'gemini']);
  assert.match(t.description, /ChatGPT, Gemini/);
});

test('ask_ai answers through the chosen provider with no robot tools, via the MCP handler', async () => {
  const api = await fakeApi((body, url) => (url.includes('chat/completions')
    ? { choices: [{ message: { role: 'assistant', content: 'Paris is the capital of France.' } }] }
    : { content: [{ type: 'text', text: 'Claude says hi' }] }));
  const env = { OPENAI_API_KEY: 'k-oa', OPENAI_BASE_URL: api.url, ANTHROPIC_API_KEY: 'k-an', ANTHROPIC_BASE_URL: api.url, ASK_AI_PROVIDER: 'openai' };
  const ask = createAskTool(env);
  const h = createMcpHandler(fakeRobot(), () => {}, [ask]);

  const list = await h({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(list.result.tools.at(-1).name, 'ask_ai');

  const r1 = await h({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ask_ai', arguments: { question: 'Capital of France?' } } });
  assert.equal(r1.result.content[0].text, 'Paris is the capital of France.');
  assert.equal(r1.result.isError, false);
  assert.equal(api.seen[0].url, '/v1/chat/completions');       // default provider from ASK_AI_PROVIDER
  assert.equal(api.seen[0].body.tools, undefined);              // no robot tools offered to the model
  assert.match(api.seen[0].body.messages[0].content, /read aloud/);

  const r2 = await h({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ask_ai', arguments: { question: 'hi', provider: 'anthropic' } } });
  assert.equal(r2.result.content[0].text, 'Claude says hi');
  assert.equal(api.seen[1].url, '/v1/messages');
  assert.equal(api.seen[1].body.tools, undefined);

  const r3 = await h({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ask_ai', arguments: {} } });
  assert.match(r3.result.content[0].text, /no question/);
  api.close();
});

test('ask_ai failures come back as tool errors, not crashes', async () => {
  const ask = createAskTool({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' });
  const h = createMcpHandler(fakeRobot(), () => {}, [ask]);
  const r = await h({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask_ai', arguments: { question: 'x' } } });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /^error: Claude: request failed/);
});

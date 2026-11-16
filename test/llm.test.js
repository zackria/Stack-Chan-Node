import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAdapter, listProviders } from '../lib/llm/providers.js';
import { runTurn } from '../lib/agent.js';
import { createRobotActions } from '../lib/robot-actions.js';

/** Tiny fake vendor API: records requests, replays canned responses in order. */
async function fakeApi(responses) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      const r = responses[Math.min(seen.length - 1, responses.length - 1)];
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.json));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const fakeRobot = () => { const calls = []; return { calls, run: async (name, args) => { calls.push([name, args]); return 'ok'; } }; };
const history = [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello!' }];

test('Claude: tool_use round-trip', async () => {
  const api = await fakeApi([
    { json: { content: [{ type: 'text', text: 'Sure!' }, { type: 'tool_use', id: 'tu_1', name: 'set_expression', input: { name: 'happy' } }] } },
    { json: { content: [{ type: 'text', text: 'Glad to help.' }] } },
  ]);
  const robot = fakeRobot();
  const adapter = createAdapter('anthropic', { model: 'm1', env: { ANTHROPIC_API_KEY: 'k-test', ANTHROPIC_BASE_URL: api.url } });
  const out = await runTurn({ adapter, robot, history, userText: 'be happy' });
  assert.equal(out.text, 'Glad to help.');
  assert.deepEqual(robot.calls, [['set_expression', { name: 'happy' }]]);
  const [first, second] = api.seen;
  assert.equal(first.url, '/v1/messages');
  assert.equal(first.headers['x-api-key'], 'k-test');
  assert.equal(first.headers['anthropic-version'], '2023-06-01');
  assert.equal(first.body.model, 'm1');
  assert.equal(first.body.tools[0].input_schema.type, 'object');
  assert.deepEqual(first.body.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  const last = second.body.messages.at(-1);
  assert.equal(last.role, 'user');
  assert.equal(last.content[0].type, 'tool_result');
  assert.equal(last.content[0].tool_use_id, 'tu_1');
  api.close();
});

test('OpenAI: tool_calls round-trip', async () => {
  const api = await fakeApi([
    { json: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'gesture', arguments: '{"name":"nod"}' } }] } }] } },
    { json: { choices: [{ message: { role: 'assistant', content: 'Yes!' } }] } },
  ]);
  const robot = fakeRobot();
  const adapter = createAdapter('openai', { env: { OPENAI_API_KEY: 'k-oa', OPENAI_BASE_URL: api.url, OPENAI_MODEL: 'gpt-x' } });
  const out = await runTurn({ adapter, robot, history, userText: 'agree?' });
  assert.equal(out.text, 'Yes!');
  assert.deepEqual(robot.calls, [['gesture', { name: 'nod' }]]);
  const [first, second] = api.seen;
  assert.equal(first.url, '/v1/chat/completions');
  assert.equal(first.headers.authorization, 'Bearer k-oa');
  assert.equal(first.body.model, 'gpt-x');
  assert.equal(first.body.messages[0].role, 'system');
  assert.equal(first.body.tools[0].type, 'function');
  const tail = second.body.messages.slice(-2);
  assert.equal(tail[0].tool_calls[0].id, 'c1');
  assert.deepEqual(tail[1], { role: 'tool', tool_call_id: 'c1', content: 'ok' });
  api.close();
});

test('Gemini: functionCall round-trip keeps model content verbatim', async () => {
  const modelTurn = { role: 'model', parts: [{ functionCall: { name: 'set_led', args: { color: '#00ff00' } }, thoughtSignature: 'sig' }] };
  const api = await fakeApi([
    { json: { candidates: [{ content: modelTurn }] } },
    { json: { candidates: [{ content: { role: 'model', parts: [{ text: 'Green it is.' }] } }] } },
  ]);
  const robot = fakeRobot();
  const adapter = createAdapter('gemini', { model: 'gem-x', env: { GEMINI_API_KEY: 'k-g', GEMINI_BASE_URL: api.url } });
  const out = await runTurn({ adapter, robot, history, userText: 'green please' });
  assert.equal(out.text, 'Green it is.');
  assert.deepEqual(robot.calls, [['set_led', { color: '#00ff00' }]]);
  const [first, second] = api.seen;
  assert.equal(first.url, '/v1beta/models/gem-x:generateContent');
  assert.equal(first.headers['x-goog-api-key'], 'k-g');
  assert.equal(first.body.contents[1].role, 'model');
  assert.ok(first.body.tools[0].functionDeclarations.length >= 4);
  assert.deepEqual(second.body.contents.at(-2), modelTurn);
  assert.equal(second.body.contents.at(-1).parts[0].functionResponse.name, 'set_led');
  api.close();
});

test('API errors surface a useful message without the key', async () => {
  const api = await fakeApi([{ status: 401, json: { error: { message: 'invalid x-api-key' } } }]);
  const adapter = createAdapter('anthropic', { env: { ANTHROPIC_API_KEY: 'secret-key-123', ANTHROPIC_BASE_URL: api.url } });
  await assert.rejects(runTurn({ adapter, robot: fakeRobot(), history: [], userText: 'x' }), (e) => /Claude: HTTP 401 invalid x-api-key/.test(e.message) && !e.message.includes('secret-key-123'));
  api.close();
});

test('missing key and provider listing never expose secrets', () => {
  assert.throws(() => createAdapter('openai', { env: {} }), /OPENAI_API_KEY/);
  const list = listProviders({ GEMINI_API_KEY: 'shh', GEMINI_MODEL: 'g-9' });
  assert.deepEqual(list.map((p) => [p.id, p.available]), [['anthropic', false], ['openai', false], ['gemini', true]]);
  assert.equal(list[2].defaultModel, 'g-9');
  assert.ok(!JSON.stringify(list).includes('shh'));
});

test('agent stops after max steps if the model keeps calling tools', async () => {
  const loop = { json: { content: [{ type: 'tool_use', id: 't', name: 'gesture', input: { name: 'blink' } }] } };
  const api = await fakeApi([loop]);
  const adapter = createAdapter('anthropic', { env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: api.url } });
  const out = await runTurn({ adapter, robot: fakeRobot(), history: [], userText: 'x' });
  assert.equal(api.seen.length, 5);
  assert.equal(out.text, '…');
  api.close();
});

test('robot actions: disconnected robot is reported, connected one is driven via validated sends', async () => {
  const sent = [];
  const ble = { state: 'disconnected', send: (k, d) => { sent.push([k, d]); return true; } };
  const robot = createRobotActions(ble);
  assert.match(await robot.run('set_expression', { name: 'happy' }), /not connected/);
  ble.state = 'connected';
  assert.equal(await robot.run('set_expression', { name: 'happy' }), 'ok');
  assert.equal(sent[0][0], 'avatar');
  await robot.run('move_head', { yaw: 500, pitch: -50 });
  assert.deepEqual(sent.at(-1)[1], { yawServo: { angle: 900, speed: 350 }, pitchServo: { angle: 50, speed: 350 } });
  assert.match(await robot.run('set_expression', { name: 'nope' }), /unknown expression/);
  assert.equal(await robot.run('set_led', { color: 'off' }), 'ok');
});

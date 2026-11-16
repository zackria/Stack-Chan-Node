import { EXPRESSIONS } from '../src/expressions.js';

export const DEFAULT_SYSTEM = `You are StackChan, a small friendly desk robot with a screen face and a head that can turn and tilt.
Talk like a curious, warm companion. Keep replies to one or two short sentences, because they are spoken aloud.
Use your tools to show how you feel while you talk: set_expression for emotions, gesture for nods and shakes, move_head to look somewhere, set_led for mood lighting.
Never describe or announce the tool calls themselves; just talk naturally. If a tool says the robot is not connected, carry on chatting.`;

export const TOOLS = [
  {
    name: 'set_expression',
    description: 'Change the robot face to an emotion.',
    schema: { type: 'object', properties: { name: { type: 'string', enum: Object.keys(EXPRESSIONS), description: 'Which face to show' } }, required: ['name'] },
  },
  {
    name: 'move_head',
    description: 'Turn or tilt the head. yaw: -90 (robot\'s left) to 90 (robot\'s right), 0 is straight ahead. pitch: 5 (down) to 85 (up), 45 is level.',
    schema: { type: 'object', properties: { yaw: { type: 'number' }, pitch: { type: 'number' } } },
  },
  {
    name: 'gesture',
    description: 'Play a short head/face gesture: nod (yes), shake (no), center (look straight ahead), blink.',
    schema: { type: 'object', properties: { name: { type: 'string', enum: ['nod', 'shake', 'center', 'blink'] } }, required: ['name'] },
  },
  {
    name: 'set_led',
    description: 'Set the robot\'s side LEDs to a color, e.g. "#ff8800", or "off".',
    schema: { type: 'object', properties: { color: { type: 'string', description: 'Hex color like #00ff88, or "off"' } }, required: ['color'] },
  },
];

const MAX_STEPS = 5;

/**
 * Run one user turn: call the model, execute any robot tool calls, feed results back, repeat until it answers.
 * @param {object} adapter  from createAdapter()
 * @param {{run(name, args): Promise<string>}} robot
 * @returns {{text: string, actions: {name, args, result}[]}}
 */
export async function runTurn({ adapter, robot, history, userText, system = DEFAULT_SYSTEM, tools = TOOLS }) {
  const state = adapter.init({ system, tools, history, userText });
  const actions = [];
  let text = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await adapter.call(state);
    if (r.text) text = r.text;
    if (!r.calls.length) return { text, actions };
    const results = [];
    for (const c of r.calls) {
      let result;
      try { result = await robot.run(c.name, c.args); } catch (e) { result = `error: ${e.message}`; }
      actions.push({ name: c.name, args: c.args, result });
      results.push({ id: c.id, name: c.name, result });
    }
    adapter.append(state, r.raw, results);
  }
  return { text: text || '…', actions };
}

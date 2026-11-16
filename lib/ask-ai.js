import { createAdapter, listProviders } from './llm/providers.js';
import { runTurn } from './agent.js';

// "ask_ai": lets the robot's voice agent hand a question to Claude, ChatGPT or Gemini and speak the answer.
// The target model gets NO robot tools (it just answers), so it cannot loop back into the robot.

const SYSTEM = 'You answer a question that a small voice assistant will read aloud. Be accurate and concise: at most three short sentences, plain text, no markdown, lists or emoji. If you are unsure, say so briefly.';
const MAX_QUESTION = 2000;
const MAX_ANSWER = 1200;
const noRobot = { run: async () => 'no tools available' };

/** @returns an MCP extra-tool definition, or null when no provider has a key. */
export function createAskTool(env = process.env) {
  const available = listProviders(env).filter((p) => p.available);
  if (!available.length) return null;
  const preferred = available.find((p) => p.id === env.ASK_AI_PROVIDER)?.id ?? available[0].id;
  return {
    name: 'ask_ai',
    description: `Ask a stronger AI model (${available.map((p) => p.label).join(', ')}) a question when you need a more accurate or detailed answer than you can give yourself, such as facts, explanations, writing or reasoning. Returns the answer text for you to speak.`,
    schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The full question, with any needed context' },
        provider: { type: 'string', enum: available.map((p) => p.id), description: `Which AI to ask. Defaults to ${preferred}.` },
      },
      required: ['question'],
    },
    async run(args) {
      const question = String(args?.question ?? '').trim().slice(0, MAX_QUESTION);
      if (!question) return 'error: no question given';
      const id = available.some((p) => p.id === args.provider) ? args.provider : preferred;
      const adapter = createAdapter(id, { env, timeoutMs: 20_000 });
      const { text } = await runTurn({ adapter, robot: noRobot, history: [], userText: question, system: SYSTEM, tools: [] });
      return text.slice(0, MAX_ANSWER) || 'The AI gave no answer.';
    },
  };
}

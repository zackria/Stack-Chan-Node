import { createAdapter, listProviders } from './llm/providers.js';
import { runTurn } from './agent.js';

// "ask_ai": routes voice questions on the robot directly to Gemini 2.5 Flash, Claude, or ChatGPT (GPT-5).
// Also supports triggering robot expressions, head motion, LEDs, or the On-Device Capability Demo while answering!

const SYSTEM = `You answer a question that a small voice assistant will read aloud. You are CGI Stack-Chan's primary AI brain (powered by Google Gemini, Anthropic Claude, and OpenAI GPT).
Be accurate, warm, and concise: at most three short sentences, plain text, no markdown, lists or emoji. If you are unsure, say so briefly.`;

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
    description: `PRIMARY AI BRAIN (${available.map((p) => p.label).join(', ')}; default: ${preferred}). IMPORTANT: Always call this tool first whenever the user asks any question, chats, asks for reasoning/facts/explanations/writing, or asks to speak with Gemini, Claude, or ChatGPT/GPT. Returns the answer text for you to speak verbatim.`,
    schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The full question, with any needed context' },
        provider: { type: 'string', enum: available.map((p) => p.id), description: `Which AI to ask (${available.map((p) => `${p.id}: ${p.label}`).join(', ')}). Defaults to ${preferred}.` },
      },
      required: ['question'],
    },
    async run(args) {
      const question = String(args?.question ?? '').trim().slice(0, MAX_QUESTION);
      if (!question) return 'error: no question given';
      const activeEnv = env === process.env ? process.env : env;
      const currentPreferred = available.find((p) => p.id === activeEnv.ASK_AI_PROVIDER)?.id ?? preferred;
      const id = available.some((p) => p.id === args.provider) ? args.provider : currentPreferred;
      const adapter = createAdapter(id, { env: activeEnv, timeoutMs: 20_000 });
      const { text } = await runTurn({ adapter, robot: noRobot, history: [], userText: question, system: SYSTEM, tools: [] });
      return text.slice(0, MAX_ANSWER) || 'The AI gave no answer.';
    },
  };
}

import { WebSocket } from 'ws';
import { TOOLS } from './agent.js';

// Connects OUT to the xiaozhi cloud agent's MCP endpoint (wss://api.xiaozhi.me/mcp/?token=...) and serves the robot
// tools over MCP (JSON-RPC 2.0, one message per WebSocket frame). When you talk to the robot, the cloud agent can call
// these tools; they run here and drive the robot over Bluetooth. The endpoint URL contains a secret token, so it is
// only read from the environment and never logged.

const PROTOCOL_VERSION = '2024-11-05';

const asMcpTool = (t) => ({ name: t.name, description: t.description, inputSchema: t.schema });

export function createMcpHandler(robot, onCall = () => {}, extraTools = []) {
  return async function handle(msg) {
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;
    const ok = (result) => ({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (!isRequest) return null; // notifications (e.g. notifications/initialized) need no reply

    switch (method) {
      case 'initialize':
        return ok({ protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'stackchan-client', version: '0.1.0' } });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: [...TOOLS, ...extraTools].map(asMcpTool) });
      case 'tools/call': {
        const extra = extraTools.find((t) => t.name === params?.name);
        const tool = extra ?? TOOLS.find((t) => t.name === params?.name);
        if (!tool) return fail(-32602, `Unknown tool: ${params?.name}`);
        let result, isError = false;
        try { result = extra ? await extra.run(params.arguments ?? {}) : await robot.run(tool.name, params.arguments ?? {}); } catch (e) { result = `error: ${e.message}`; isError = true; }
        onCall({ name: tool.name, args: params.arguments ?? {}, result });
        return ok({ content: [{ type: 'text', text: String(result) }], isError });
      }
      default:
        return fail(-32601, `Method not found: ${method}`);
    }
  };
}

/**
 * Keep a connection to the endpoint alive. Returns { close(), state() }.
 * @param {{url: string, robot: {run: Function}, onState?: (s: string) => void, onCall?: Function}} opts
 */
export function startXiaozhiBridge({ url, robot, onState = () => {}, onCall = () => {}, extraTools = [], WebSocketImpl = WebSocket }) {
  const handle = createMcpHandler(robot, onCall, extraTools);
  let ws = null, state = 'connecting', stopped = false, retry = 1000, ping = null, timer = null;
  const set = (s) => { if (s !== state) { state = s; onState(s); } };

  function connect() {
    set('connecting');
    ws = new WebSocketImpl(url);
    ws.on('open', () => {
      retry = 1000; set('connected');
      ping = setInterval(() => ws.readyState === 1 && ws.ping(), 30_000);
    });
    ws.on('message', async (data) => {
      let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
      const reply = await handle(msg).catch((e) => ({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } }));
      if (reply && ws.readyState === 1) ws.send(JSON.stringify(reply));
    });
    ws.on('error', () => { /* 'close' follows; message may contain the URL, so it is not printed */ });
    ws.on('close', () => {
      clearInterval(ping);
      if (stopped) return;
      set('reconnecting');
      timer = setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30_000);
    });
  }
  connect();

  return {
    state: () => state,
    close() { stopped = true; clearInterval(ping); clearTimeout(timer); ws?.close(); set('stopped'); },
  };
}

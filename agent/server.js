/**
 * ASCEND Session 3 — THE AGENT
 *
 *   node agent/server.js     ->  http://localhost:3200
 *
 * A chatbot with agentic capability. It is a client THREE times over:
 *   - a server to the browser        (WebSocket, so it can stream)
 *   - a client to the MCP server     (JSON-RPC over HTTP)
 *   - a client to a language model   (HTTPS)
 *
 * THE LOOP, which is all "agentic" means:
 *   1. ask the MCP server what tools exist          -> tools/list
 *   2. give the question + the tool list to a model
 *   3. model picks a tool                           -> tools/call
 *   4. feed the result back in, and go to 2
 *   5. when the model stops picking tools, answer
 *
 * RUNS WITH NO API KEY. Without one it uses a built-in deterministic planner
 * that produces the same visible behaviour, so the demo never depends on a
 * network or a quota. Set a key to use a real model — see README.
 *
 * Zero dependencies. Node built-ins only.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.AGENT_PORT || 3200;
const MCP_URL = process.env.MCP_URL || 'http://localhost:3100/mcp';

/* ---- Which brain? ---------------------------------------------------
 *
 * Providers come and go — GitHub Models launched and was retired inside two
 * years. So this does not hardcode one. It speaks the OpenAI-compatible
 * chat-completions shape, which almost every provider now offers, and picks
 * whichever credentials it finds.
 *
 *   Azure OpenAI / Microsoft Foundry:
 *     AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
 *     AZURE_OPENAI_KEY=...
 *     AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
 *
 *   Anything OpenAI-compatible (OpenAI, OpenRouter, Groq, a local server):
 *     OPENAI_BASE_URL=https://api.openai.com/v1
 *     OPENAI_API_KEY=...
 *     OPENAI_MODEL=gpt-4o-mini
 *
 *   Nothing set  ->  the offline planner. The demo works either way.
 * ------------------------------------------------------------------- */

const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_KEY      = process.env.AZURE_OPENAI_KEY;
const AZURE_DEPLOY   = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini';
const AZURE_VERSION  = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';

const OAI_BASE       = process.env.OPENAI_BASE_URL;
const OAI_KEY        = process.env.OPENAI_API_KEY;
const OAI_MODEL      = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const MODE = AZURE_ENDPOINT && AZURE_KEY ? 'azure'
           : OAI_BASE && OAI_KEY ? 'openai-compatible'
           : 'offline';

const SYSTEM_PROMPT =
  'You are a customer support assistant for an online shop. ' +
  'Use the tools to look things up — never invent order numbers, prices or stock. ' +
  'The customer you are speaking to is identified by the email given in each message; ' +
  'always pass that email to tools that accept customerEmail. ' +
  'Be brief and friendly.';

/* ------------------------------------------------------------------ *
 *  TALKING TO THE MCP SERVER
 * ------------------------------------------------------------------ */

let rpcId = 1;
function mcp(method, params) {
  return new Promise((resolve) => {
    const u = new URL(MCP_URL);
    const body = JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params });
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({ error: { message: raw } }); } });
      }
    );
    req.on('error', (e) => resolve({ error: { message: `MCP unreachable: ${e.message}` } }));
    req.end(body);
  });
}

let toolCache = null;
async function getTools() {
  if (toolCache) return toolCache;
  const r = await mcp('tools/list');
  toolCache = r?.result?.tools || [];
  return toolCache;
}

async function callTool(name, args) {
  const r = await mcp('tools/call', { name, arguments: args });
  return r?.result?.content?.[0]?.text || r?.error?.message || '(no result)';
}

/* ------------------------------------------------------------------ *
 *  THE OFFLINE PLANNER
 *
 *  Not a language model — a set of rules. It exists so the demo works with
 *  no key, no network and no quota. It produces the same tool calls a model
 *  would, so what the room SEES is identical.
 * ------------------------------------------------------------------ */

const COLORS = ['black', 'blue', 'white', 'grey', 'navy', 'olive', 'steel'];

async function offlinePlan(text, email, emit) {
  const t = text.toLowerCase();
  const orderNo = (t.match(/\b(\d{4})\b/) || [])[1];
  const color = COLORS.find((c) => t.includes(c));
  const steps = [];

  const run = async (name, args) => {
    emit({ type: 'tool', name, args });
    const out = await callTool(name, args);
    emit({ type: 'tool_result', name, text: out });
    steps.push({ name, args, out });
    return out;
  };

  // "reorder what I bought last month, but in blue"
  if (/re-?order|order .*again|same .*again|bought last/.test(t)) {
    const hist = await run('get_customer_orders', { customerEmail: email });
    const pid = (hist.match(/\b(P-\d+)\b/) || [])[1] || (await run('search_products', { query: 'tee' })).match(/\b(P-\d+)\b/)?.[1];
    const size = (hist.match(/size (\w+)/) || [])[1] || 'M';
    const want = color || 'blue';
    const stock = await run('check_stock', { productId: pid, color: want, size });
    if (/OUT OF STOCK|does not come in|no product/i.test(stock)) {
      return `I found your previous order, but the ${want} version in size ${size} is not available right now. Would you like me to check another size or colour?`;
    }
    const made = await run('create_order', { customerEmail: email, productId: pid, color: want, size });
    return /^Order \d+ created/.test(made)
      ? `Done. ${made} It is the same item as last time, just in ${want}.`
      : made;
  }

  // "where is my order 1042?"
  if (orderNo) {
    const out = await run('get_order', { orderId: Number(orderNo), customerEmail: email });
    if (/^Refused/.test(out)) return `I can only look up orders placed with your own account, so I'm not able to show you order ${orderNo}.`;
    if (/^There is no order/.test(out)) return out;
    const status = (out.match(/status: ([^\n]+)/) || [])[1];
    const eta = (out.match(/estimated delivery ([\d-]+)/) || [])[1];
    const items = (out.match(/Items: ([^\n]+)/) || [])[1];
    return `Order ${orderNo} is ${status}. It contains ${items}.${eta ? ` It should reach you around ${eta}.` : ''}`;
  }

  // "what have I ordered before?"
  if (/my orders|order history|what.*(bought|ordered)/.test(t)) {
    const out = await run('get_customer_orders', { customerEmail: email });
    return `Here is what I found on your account:\n${out}`;
  }

  // "do you have the tee in blue, size M?"
  if (/stock|available|do you have|got any|size/.test(t)) {
    const query = (t.match(/\b(tee|hoodie|sneaker|backpack|flask|shirt|shoe)\w*/) || [])[1] || t.split(/\s+/).slice(-2)[0];
    const found = await run('search_products', { query });
    const pid = (found.match(/\b(P-\d+)\b/) || [])[1];
    if (!pid) return found;
    const size = (t.match(/size (\w+)/) || [])[1] || (t.match(/\b(xs|s|m|l|xl|4[0-3])\b/) || [])[1];
    const stock = await run('check_stock', { productId: pid, color, size });
    return stock;
  }

  // anything else — search and report
  const out = await run('search_products', { query: text.split(/\s+/).slice(0, 3).join(' ') });
  return `Here is what I found:\n${out}`;
}

/* ------------------------------------------------------------------ *
 *  THE REAL MODEL PATH (OpenAI-compatible chat completions + tools)
 * ------------------------------------------------------------------ */

function chatCompletion(messages, tools) {
  return new Promise((resolve, reject) => {
    // Temperature is opt-in. The gpt-5 and o-series models reject any value
    // other than their default and return a 400, so we simply do not send it
    // unless you ask for it with AGENT_TEMPERATURE.
    const body = { messages, tools, tool_choice: 'auto' };
    if (process.env.AGENT_TEMPERATURE) body.temperature = Number(process.env.AGENT_TEMPERATURE);
    if (MODE === 'openai-compatible') body.model = OAI_MODEL;
    const payload = JSON.stringify(body);

    let opts;
    if (MODE === 'azure') {
      const u = new URL(AZURE_ENDPOINT);
      opts = {
        hostname: u.hostname,
        port: u.port || 443,
        path: `/openai/deployments/${AZURE_DEPLOY}/chat/completions?api-version=${AZURE_VERSION}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': AZURE_KEY,
                   'Content-Length': Buffer.byteLength(payload) }
      };
    } else {
      const u = new URL(OAI_BASE.replace(/\/$/, '') + '/chat/completions');
      opts = {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OAI_KEY}`,
                   'Content-Length': Buffer.byteLength(payload) }
      };
    }

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (data.error) {
            const m = data.error.message || raw.slice(0, 200);
            if (/temperature/i.test(m)) {
              return reject(new Error(`${m}  ->  unset AGENT_TEMPERATURE; this model only accepts its default.`));
            }
            if (/max_tokens/i.test(m)) {
              return reject(new Error(`${m}  ->  this model wants max_completion_tokens, not max_tokens.`));
            }
            if (res.statusCode === 404) {
              return reject(new Error(`${m}  ->  check AZURE_OPENAI_DEPLOYMENT matches the deployment name exactly, and that the api-version is right.`));
            }
            if (res.statusCode === 401) {
              return reject(new Error(`${m}  ->  the key is wrong, or it belongs to a different resource.`));
            }
            if (res.statusCode === 429) {
              return reject(new Error(`${m}  ->  rate limited. Wait, or switch to the offline planner for the demo.`));
            }
            return reject(new Error(m));
          }
          if (!data.choices) return reject(new Error(`Unexpected response (${res.statusCode}): ${raw.slice(0, 200)}`));
          resolve(data.choices[0].message);
        } catch {
          reject(new Error(`Bad response (${res.statusCode}): ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function modelLoop(text, email, emit) {
  const tools = (await getTools()).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema }
  }));

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `[customer email: ${email}]\n${text}` }
  ];

  for (let turn = 0; turn < 6; turn++) {          // the loop. that is the agent.
    const msg = await chatCompletion(messages, tools);
    messages.push(msg);

    if (!msg.tool_calls || !msg.tool_calls.length) return msg.content || '(no answer)';

    for (const tc of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
      emit({ type: 'tool', name: tc.function.name, args });
      const out = await callTool(tc.function.name, args);
      emit({ type: 'tool_result', name: tc.function.name, text: out });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: out });
    }
  }
  return 'I made too many attempts without reaching an answer. Could you rephrase that?';
}

/* ------------------------------------------------------------------ *
 *  HANDLING ONE QUESTION
 * ------------------------------------------------------------------ */

async function answer(text, email, emit) {
  emit({ type: 'thinking' });
  let reply;
  try {
    reply = MODE === 'offline'
      ? await offlinePlan(text, email, emit)
      : await modelLoop(text, email, emit);
  } catch (e) {
    console.log(`  !! model error: ${e.message}`);
    reply = `I could not reach the model. (${e.message})\n\n` +
      'If you are demoing right now: stop this server, clear the model settings with ' +
      '"unset AZURE_OPENAI_KEY OPENAI_API_KEY", and start it again. It falls back to the ' +
      'offline planner and every demo still works.';
  }

  // Stream it out word by word. This is the entire reason this app needs a
  // WebSocket instead of a plain HTTP endpoint.
  const words = String(reply).split(/(\s+)/);
  for (const w of words) {
    emit({ type: 'token', t: w });
    await new Promise((r) => setTimeout(r, 18));
  }
  emit({ type: 'done' });
}

/* ------------------------------------------------------------------ *
 *  WEB SERVER + HAND-WRITTEN WEBSOCKET
 * ------------------------------------------------------------------ */

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/mode') {
    const b = JSON.stringify({ mode: MODE });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': b.length });
    return res.end(b);
  }
  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  const full = path.join(__dirname, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'text/plain' });
    res.end(data);
  });
});

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${crypto.createHash('sha1').update(key + GUID).digest('base64')}\r\n\r\n`
  );
  socket.setNoDelay(true);

  const emit = (obj) => { try { socket.write(encodeFrame(Buffer.from(JSON.stringify(obj)))); } catch {} };
  let buffer = Buffer.alloc(0), busy = false;

  emit({ type: 'ready', mode: MODE });

  socket.on('data', async (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let f;
    while ((f = decodeFrame(buffer))) {
      buffer = buffer.slice(f.total);
      if (f.opcode === 0x8) return socket.destroy();
      if (f.opcode !== 0x1) continue;
      let m; try { m = JSON.parse(f.payload.toString()); } catch { continue; }
      if (busy) { emit({ type: 'token', t: 'One moment — still working on the last one.' }); emit({ type: 'done' }); continue; }
      busy = true;
      console.log(`  ASK  <${m.email}>  ${m.text}`);
      await answer(m.text, m.email || 'nandun@example.lk', emit);
      busy = false;
    }
  });
  socket.on('error', () => socket.destroy());
});

function encodeFrame(payload, opcode = 0x1) {
  const len = payload.length;
  let h;
  if (len < 126) { h = Buffer.alloc(2); h[1] = len; }
  else if (len < 65536) { h = Buffer.alloc(4); h[1] = 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.alloc(10); h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
  h[0] = 0x80 | opcode;
  return Buffer.concat([h, payload]);
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f, masked = (buf[1] & 0x80) === 0x80;
  let len = buf[1] & 0x7f, off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
  let mask;
  if (masked) { if (buf.length < off + 4) return null; mask = buf.slice(off, off + 4); off += 4; }
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.slice(off, off + len));
  if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  return { opcode, payload, total: off + len };
}

server.listen(PORT, () => {
  console.log(`\n  THE AGENT — chatbot with tools`);
  console.log(`  ──────────────────────────────────────────`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  tools from  ${MCP_URL}`);
  console.log(`  brain:      ${MODE === 'offline'
    ? 'offline planner (no API key set — every demo still works)'
    : MODE === 'azure' ? `Azure OpenAI at ${new URL(AZURE_ENDPOINT).hostname}, deployment "${AZURE_DEPLOY}"`
    : `${new URL(OAI_BASE).hostname}, model "${OAI_MODEL}"`}`);
  if (MODE !== 'offline') {
    console.log(`  (unset the key and restart for the offline planner)`);
  }
  console.log(`  ──────────────────────────────────────────\n`);
});

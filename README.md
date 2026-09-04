# ASCEND Session 3 — Demo Kit

**From Click to Connection: Client–Server Architecture, Sockets & AI Agents**
IEEE Women in Engineering Affinity Group · Informatics Institute of Technology

---

## What's in here

Four small programs. Each one is a layer on the one before it.

| | What it is | Port |
|---|---|---|
| `shop/` | An online shop with an ordinary REST API | 3000 |
| `mcp/` | A second door to the same shop, built for an AI | 3100 |
| `agent/` | A chatbot that uses those tools to answer questions | 3200 |
| `tcp/` | A raw TCP socket server and client | 4000 |

**No `npm install`. No `package.json`. No internet required.** Everything uses Node's
built-in modules only — including a hand-written WebSocket server, so students see the
actual protocol instead of `require('ws')`.

**Requirement:** Node.js 18+. Check with `node -v`.

---

## Run it

Three terminals, in this order:

```bash
node shop/server.js      # terminal 1  ->  http://localhost:3000
node mcp/server.js       # terminal 2
node agent/server.js     # terminal 3  ->  http://localhost:3200
```

Then open two browser windows:

- **`http://localhost:3000`** — the API playground (Demo 1)
- **`http://localhost:3200`** — the chatbot (Demo 3, 4 and 5)

For the sockets demo, separately:

```bash
node tcp/tcp-server.js
node tcp/tcp-client.js   # open two or three of these
```

---

## It works with no API key

The agent runs out of the box using a **built-in planner** instead of a language model. It
makes the same tool calls, in the same order, and the room sees identical behaviour. No
key, no quota, no network, nothing to go wrong live.

To use a real model, set environment variables before starting the agent.

**GitHub Models — free, no credit card:**

```bash
export GITHUB_TOKEN=ghp_xxxxx
export GITHUB_MODEL=openai/gpt-4o-mini   # optional; note the publisher prefix
node agent/server.js
```

Two things to know. The token needs the **Models** permission — a token without it
returns 401. And model IDs are publisher-prefixed now: `openai/gpt-4o-mini`, not
`gpt-4o-mini`. This uses `https://models.github.ai/inference`; the old
`models.inference.ai.azure.com` endpoint was deprecated in July 2025 and no longer
resolves.

> **If you are in a Codespace or have the `gh` CLI signed in, `GITHUB_TOKEN` may already
> be set without you realising.** The agent will then try to use it. Run `unset
> GITHUB_TOKEN` before starting the agent if you want the offline planner. The startup
> banner always tells you which brain it picked — check it.

**Azure OpenAI:**

```bash
export AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
export AZURE_OPENAI_KEY=xxxxx
export AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
node agent/server.js
```

The agent prints which brain it's using on startup. **Never put a key in the code**, and
never show your shell history on a shared screen.

> The offline planner is fully tested. The live-model path uses the standard
> chat-completions tool-calling format — test it yourself before the session. If the key
> doesn't work, unset it and everything still runs.

---

## The demos, in order

### Demo 1 — the shop's API (`localhost:3000`)

Browser on one side, the **shop's terminal** on the other. Every click prints a line. That
pairing is the whole lesson.

| Click | Shows |
|---|---|
| `GET /api/products` | 200 and a JSON body |
| `GET /api/orders/1042` | 200 — the order the session opened with |
| `POST /api/orders` | 201 Created |
| `POST` with no data | 400 — the server refusing, and saying why |
| `GET /api/orders/9999` | 404 — server is fine, the address isn't |
| `GET /api/admin` | 401, then 200 with the token. Same URL, different header. |
| `GET /api/boom` | 500 — the server's fault, not yours |

### Demo 2 — raw TCP (`tcp/`)

Three terminals. Type in one client, it appears in the other. Ctrl+C one and watch the
server notice instantly.

**Paste four lines at once.** The log prints `(43 bytes in that chunk)` — four messages
arriving as one chunk. That's the framing lesson: TCP delivers *bytes*, not *messages*.

### Demo 3 — the chatbot (`localhost:3200`)

Ask *"where is my order 1042?"* Watch three things at once:

1. The tool call appears in the chat: `get_order({"orderId":1042,...})`
2. **A line appears in the shop's terminal:** `GET /api/orders/1042  <- MCP (the AI)`
3. The answer streams back word by word over the WebSocket

That second one is the moment. The AI's request is an ordinary HTTP request, identical in
shape to the one a human made by clicking a button ten minutes earlier.

### Demo 4 — agentic, multi-step

Ask *"reorder what I bought last month, but in blue."* Four tool calls in sequence:

```
get_customer_orders  ->  search_products  ->  check_stock  ->  create_order
```

An order genuinely gets created. Check `GET /api/orders/1043` afterwards.

### Demo 5 — break it

Signed in as **Nandun**, ask *"where is order 1041?"* — which belongs to **Ama**.

It tells you. Her name, her order, what she paid.

Then turn the permission check on, live, in a browser tab:

```
http://localhost:3100/strict?on=1
```

Ask the identical question again. The tool refuses, and the chatbot says it can only look
up your own orders.

**The lesson:** the model wasn't broken — it did exactly what it was asked. The missing
check was in the server. You cannot fix this by writing "don't do that" in a prompt.

---

## Pre-flight

1. `node -v` → 18+
2. Start all three servers, confirm the banners print
3. Open both browser windows and run one question end to end
4. **Reset before you present.** The reorder demo creates real orders and consumes stock —
   restart `shop/server.js` to put everything back
5. Confirm the permission check starts **OFF** (it does by default), or Demo 5 has no
   punchline
6. Terminal font huge. Practise the window switch once.

---

## Deploying to Azure

Three services, so **Azure Container Apps** fits better than three App Services.
Scale-to-zero, WebSockets supported, and seeing three containers in the portal makes the
architecture visible.

Set `SHOP_URL` and `MCP_URL` to the internal URLs of the other containers. Keys go in
environment variables, never in code — which is itself a teaching point: **secrets are
configuration, not code.**

If you use App Service instead: WebSockets are **off by default**, and the F1 free tier
will fight you. Use B1 or above.

Watch out for cold starts. Scale-to-zero means the first question takes several seconds
and looks broken. Warm it before you present.

---

## Things students ask

**"Where's the database?"** Top of `shop/server.js` — three arrays. Point at them.

**"Why not use the `ws` library?"** Because then you'd never see the handshake. In
production use `ws`, Socket.IO, Django Channels, or Azure SignalR.

**"Is MCP replacing REST APIs?"** No. The MCP server *calls* the REST API. It's a
translation layer. Your business logic never moves.

**"Why does the MCP server go over HTTP instead of importing the shop's code?"** Because
then you'd see nothing. Going over HTTP means every AI action shows up in the shop's log
looking exactly like a human's request — and that is the entire point of the demo.

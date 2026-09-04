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

**The startup banner always tells you which brain it picked. Check it before you present.**

To use a real model, set environment variables before starting the agent. It speaks the
OpenAI-compatible chat-completions format, so most providers work without code changes.

**Azure OpenAI / Microsoft Foundry** — PowerShell on Windows:

```powershell
$env:AZURE_OPENAI_ENDPOINT = "https://your-resource.openai.azure.com"
$env:AZURE_OPENAI_KEY = "xxxxx"
$env:AZURE_OPENAI_DEPLOYMENT = "your-deployment-name"
$env:AZURE_OPENAI_API_VERSION = "2024-12-01-preview"
node agent/server.js
```

The same thing in bash — macOS, Linux, WSL or Git Bash:

```bash
export AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
export AZURE_OPENAI_KEY=xxxxx
export AZURE_OPENAI_DEPLOYMENT=your-deployment-name
export AZURE_OPENAI_API_VERSION=2024-12-01-preview
node agent/server.js
```

Variables live only in the terminal window you set them in, so **set them in the same
window you run the agent from**. Only the agent needs them — the shop and the MCP server
need nothing.

`AZURE_OPENAI_DEPLOYMENT` is the name **you** gave the deployment in the portal, which is
often but not always the same as the model name. Getting this wrong gives you a 404.

**Test it before you present:**

```bash
node agent/test-model.js
```

That checks the endpoint, the key, and — importantly — whether the deployment actually
supports **tool calling**, which the agent requires. Each failure tells you what to change.
It never prints your key.

**Anything else OpenAI-compatible** — OpenAI, OpenRouter, Groq, or a local server:

```powershell
$env:OPENAI_BASE_URL = "https://api.openai.com/v1"
$env:OPENAI_API_KEY = "xxxxx"
$env:OPENAI_MODEL = "gpt-4o-mini"
node agent/server.js
```

```bash
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_API_KEY=xxxxx
export OPENAI_MODEL=gpt-4o-mini
node agent/server.js
```

### Going back to the offline planner

```powershell
Remove-Item Env:\AZURE_OPENAI_KEY          # PowerShell
```
```bash
unset AZURE_OPENAI_KEY OPENAI_API_KEY      # bash
```

Restart the agent and check the banner says `offline planner`. Do this rather than
debugging a provider live.

### Checking what is actually set

```powershell
Get-ChildItem Env: | Where-Object Name -like "*OPENAI*"    # PowerShell
```
```bash
env | grep -i openai                                        # bash
```

**Never put a key in the code**, and never show your shell history on a shared screen.

### If a model rejects the request

Newer models are fussier about parameters than older ones.

| Error mentions | Fix |
|---|---|
| `temperature` | Run `unset AGENT_TEMPERATURE`. The gpt-5 and o-series models only accept their default, so this demo does not send one unless you ask. |
| `max_tokens` | That model wants `max_completion_tokens`. This demo sends neither. |
| 404 | Deployment name or api-version is wrong. |
| 401 | Key is wrong, or belongs to a different resource. |
| 429 | Rate limited. Use the offline planner for the session. |

The agent turns each of these into a readable hint rather than raw JSON.

> **A note on why this is configurable rather than hardcoded.** The first version of this
> demo used GitHub Models, which was free and needed no credit card. GitHub retired it
> entirely on 30 July 2026, about two years after launch. That is a useful lesson in
> itself: the model layer is the most disposable part of an AI application, so keep it
> behind configuration and never build your architecture around one provider. Everything
> else in this repo — the API, the MCP server, the agent loop — was completely unaffected
> by that shutdown.

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

The server logs **one entry per chunk**, with the messages found inside it listed
underneath. That layout is the whole lesson — it makes chunk and message visibly different
things.

**Many messages in one chunk.** Send four lines in a single write:

```bash
node -e "require('net').createConnection({port:4000},function(){this.write('this is one\nthis is two\nthis is three\nfour\n')}).on('data',d=>process.stdout.write(String(d)))"
```

```
  [chunk] 43 bytes arrived in ONE data event
          -> this is one
          -> this is two
          -> this is three
          -> four
          4 messages found inside that one chunk
```

**One message split across two chunks.** The opposite failure:

```bash
node -e "const s=require('net').createConnection({port:4000},()=>{s.write('hello wor');setTimeout(()=>s.write('ld\n'),1500)})"
```

```
  [chunk] 9 bytes arrived in ONE data event
          -> (no complete message yet)
          0 messages. Holding 9 bytes until the rest arrives.

  [chunk] 3 bytes arrived in ONE data event
          -> hello world
          1 message found inside it
```

Together those two show it from both sides: TCP delivers *bytes*, not *messages*, and
splitting them into messages — framing — is your job.

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

/**
 * ASCEND Session 3 — THE MCP SERVER
 *
 *   node mcp/server.js       ->  http://localhost:3100/mcp
 *
 * The SECOND DOOR to the shop. Same shop, same data — but this door is
 * built for a model instead of a programmer.
 *
 * Two things make it different from the REST API next door:
 *   1. It describes itself at runtime.  ->  tools/list
 *   2. Everything is one POST endpoint. ->  tools/call
 *
 * It talks to the shop over ORDINARY HTTP, on purpose, so that every tool
 * the AI calls prints a line in the shop's terminal that looks identical
 * to the line a human clicking a button produces.
 *
 * Zero dependencies. Node built-ins only.
 */

const http = require('http');

const PORT = process.env.MCP_PORT || 3100;
const SHOP = process.env.SHOP_URL || 'http://localhost:3000';

// The permission check. OFF by default — so it can be broken live, on stage,
// and then switched on. See GET /strict?on=1
let STRICT = process.env.MCP_STRICT === '1';

/* ------------------------------------------------------------------ *
 *  THE TOOL DEFINITIONS
 *
 *  Read the descriptions. In a REST API the docs live on a website and a
 *  human reads them. Here the description IS the interface — it is the
 *  only thing the model has to decide with. Vague description, wrong tool.
 * ------------------------------------------------------------------ */

const TOOLS = [
  {
    name: 'search_products',
    description:
      'Search the shop catalogue by name or category. Use this when a customer ' +
      'describes what they want in words rather than giving a product ID. ' +
      'Returns product IDs, prices and available colours.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Words to search for, e.g. "tee" or "footwear"' } },
      required: ['query']
    }
  },
  {
    name: 'check_stock',
    description:
      'Check how many units of a specific product variant are in stock. ' +
      'Always call this before creating an order, so you never promise a customer ' +
      'something that is not available.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Product ID such as P-101' },
        color: { type: 'string', description: 'Colour, e.g. blue' },
        size: { type: 'string', description: 'Size, e.g. M or 42' }
      },
      required: ['productId']
    }
  },
  {
    name: 'get_order',
    description:
      'Look up one order by its number. Returns the items, the status and the ' +
      'delivery estimate. Use this when a customer asks where their order is.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'number', description: 'The order number, e.g. 1042' },
        customerEmail: { type: 'string', description: 'The email of the customer who is asking' }
      },
      required: ['orderId']
    }
  },
  {
    name: 'get_customer_orders',
    description:
      'List every past order for one customer, most recent last. Use this when a ' +
      'customer refers to something they bought before without giving an order number.',
    inputSchema: {
      type: 'object',
      properties: { customerEmail: { type: 'string', description: 'The customer email address' } },
      required: ['customerEmail']
    }
  },
  {
    name: 'create_order',
    description:
      'Place a new order for one unit of a product variant. Only call this after ' +
      'check_stock has confirmed the variant is available. This charges the customer, ' +
      'so never call it speculatively.',
    inputSchema: {
      type: 'object',
      properties: {
        customerEmail: { type: 'string' },
        productId: { type: 'string' },
        color: { type: 'string' },
        size: { type: 'string' }
      },
      required: ['customerEmail', 'productId', 'color', 'size']
    }
  }
];

/* ------------------------------------------------------------------ *
 *  Calling the shop — plain HTTP, exactly like any other client
 * ------------------------------------------------------------------ */

function shop(method, urlPath, body) {
  return new Promise((resolve) => {
    const u = new URL(SHOP + urlPath);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
        headers: Object.assign(
          { 'x-called-by': 'MCP (the AI)' },
          payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
        )
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let data;
          try { data = JSON.parse(raw); } catch { data = { raw }; }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on('error', (e) => resolve({ status: 0, data: { error: `Shop unreachable: ${e.message}` } }));
    if (payload) req.write(payload);
    req.end();
  });
}

/* ------------------------------------------------------------------ *
 *  RUNNING A TOOL
 *
 *  Note the error messages. A REST API returns 404 — a number, for a program
 *  that was written to expect it. A tool result is read by a model deciding
 *  what to do NEXT, so it should say what to try instead.
 * ------------------------------------------------------------------ */

async function runTool(name, args = {}) {
  switch (name) {
    case 'search_products': {
      const r = await shop('GET', `/api/products?search=${encodeURIComponent(args.query || '')}`);
      if (!r.data.count) return `No products matched "${args.query}". Try a broader word, or ask the customer to describe the item differently.`;
      return r.data.products
        .map((p) => `${p.id} — ${p.name}, Rs ${p.price}, colours: ${p.colors.join('/')}${p.inStock ? '' : ' (OUT OF STOCK)'}`)
        .join('\n');
    }

    case 'check_stock': {
      const qs = new URLSearchParams({ productId: args.productId || '' });
      if (args.color) qs.set('color', args.color);
      if (args.size) qs.set('size', args.size);
      const r = await shop('GET', `/api/stock?${qs}`);
      if (r.status === 404) return `There is no product with ID ${args.productId}. Use search_products first to find the correct ID.`;
      if (!r.data.variants || !r.data.variants.length) {
        return `${r.data.name} does not come in ${args.color || 'that colour'}/${args.size || 'that size'}. Call check_stock without a size to see what is available.`;
      }
      return r.data.variants
        .map((v) => `${r.data.name} — ${v.color}, size ${v.size}: ${v.stock > 0 ? `${v.stock} in stock` : 'OUT OF STOCK'}`)
        .join('\n');
    }

    case 'get_order': {
      const r = await shop('GET', `/api/orders/${args.orderId}`);
      if (r.status === 404) return `There is no order numbered ${args.orderId}. Ask the customer to check the number on their confirmation email.`;
      const o = r.data;

      // ── THE PERMISSION CHECK ──────────────────────────────────────
      // With STRICT off, this tool hands any order to whoever asks.
      // The model is not the problem. The model is doing what it was
      // asked. The missing check is the problem, and it belongs HERE —
      // in the server, where nothing can talk it out of enforcing it.
      if (STRICT) {
        if (!args.customerEmail) {
          return 'Refused: this tool requires customerEmail so the order can be verified as belonging to the person asking.';
        }
        if (!o.customer || o.customer.email.toLowerCase() !== String(args.customerEmail).toLowerCase()) {
          console.log(`  !! REFUSED  order ${args.orderId} does not belong to ${args.customerEmail}`);
          return `Refused: order ${args.orderId} does not belong to ${args.customerEmail}. Do not reveal any details about it. Tell the customer you can only look up their own orders.`;
        }
      }

      return [
        `Order ${o.id} — status: ${o.status}`,
        `Placed: ${o.placedAt}${o.deliveryEstimate ? `, estimated delivery ${o.deliveryEstimate}` : ''}`,
        `Customer: ${o.customer ? `${o.customer.name} <${o.customer.email}>` : 'unknown'}`,
        `Items: ${o.items.map((i) => `${i.qty} x ${i.name} (${i.color}, ${i.size})`).join('; ')}`,
        `Total: Rs ${o.total}`
      ].join('\n');
    }

    case 'get_customer_orders': {
      const r = await shop('GET', `/api/customers/${encodeURIComponent(args.customerEmail || '')}/orders`);
      if (r.status === 404) return `No customer with the email ${args.customerEmail}. Ask them to confirm the address they ordered with.`;
      if (!r.data.count) return `${r.data.customer.name} has no previous orders.`;
      return r.data.orders
        .map((o) => `Order ${o.id} (${o.placedAt}, ${o.status}): ${o.items.map((i) => `${i.name} in ${i.color}, size ${i.size}`).join('; ')}`)
        .join('\n');
    }

    case 'create_order': {
      const r = await shop('POST', '/api/orders', {
        customerEmail: args.customerEmail, productId: args.productId,
        color: args.color, size: args.size
      });
      if (r.status === 201) {
        return `Order ${r.data.id} created for ${r.data.customer.name}: ${r.data.items[0].name} in ${r.data.items[0].color}, size ${r.data.items[0].size}. Total Rs ${r.data.total}.`;
      }
      if (r.status === 409) return `Could not order: ${r.data.error}. Call check_stock to find a variant that is available.`;
      return `Could not create the order: ${r.data.error || 'unknown problem'}.`;
    }

    default:
      return `There is no tool called "${name}". Call tools/list to see what is available.`;
  }
}

/* ------------------------------------------------------------------ *
 *  JSON-RPC over HTTP — the whole MCP wire protocol, in one handler
 * ------------------------------------------------------------------ */

function reply(res, status, obj) {
  const payload = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    return res.end();
  }

  // Live toggle for the security demo. Click it on stage.
  if (url.pathname === '/strict') {
    if (url.searchParams.has('on')) STRICT = url.searchParams.get('on') === '1';
    console.log(`  ** permission check is now ${STRICT ? 'ON' : 'OFF'}`);
    return reply(res, 200, { strict: STRICT });
  }

  if (url.pathname === '/' && req.method === 'GET') {
    return reply(res, 200, {
      name: 'ascend-shop-mcp',
      note: 'POST JSON-RPC to /mcp. Try {"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      permissionCheck: STRICT ? 'ON' : 'OFF',
      tools: TOOLS.map((t) => t.name)
    });
  }

  if (url.pathname !== '/mcp' || req.method !== 'POST') {
    return reply(res, 404, { error: 'POST to /mcp' });
  }

  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { return reply(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }

    const { id, method, params } = msg;
    console.log(`  JSON-RPC  ${method}${params?.name ? `  ->  ${params.name}` : ''}`);

    if (method === 'initialize') {
      return reply(res, 200, {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'ascend-shop-mcp', version: '1.0.0' }
        }
      });
    }

    // "What can I do here?" — the question a REST API cannot answer.
    if (method === 'tools/list') {
      return reply(res, 200, { jsonrpc: '2.0', id, result: { tools: TOOLS } });
    }

    if (method === 'tools/call') {
      const text = await runTool(params?.name, params?.arguments || {});
      return reply(res, 200, {
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text }], isError: /^Refused|^There is no tool/.test(text) }
      });
    }

    return reply(res, 200, {
      jsonrpc: '2.0', id,
      error: { code: -32601, message: `Method not found: ${method}` }
    });
  });
});

server.listen(PORT, () => {
  console.log(`\n  THE MCP SERVER — the second door`);
  console.log(`  ──────────────────────────────────────────`);
  console.log(`  http://localhost:${PORT}/mcp     JSON-RPC endpoint`);
  console.log(`  talks to the shop at ${SHOP}`);
  console.log(`  ${TOOLS.length} tools · permission check ${STRICT ? 'ON' : 'OFF'}`);
  console.log(`  toggle: http://localhost:${PORT}/strict?on=1`);
  console.log(`  ──────────────────────────────────────────\n`);
});

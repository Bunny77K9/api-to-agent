/**
 * ASCEND Session 3 — THE SHOP
 * An ordinary REST API. Nothing AI about it.
 *
 *   node shop/server.js      ->  http://localhost:3000
 *
 * This is "the application". Everything else in this session — the MCP server,
 * the agent, the chatbot — is a layer that eventually calls THIS.
 *
 * Zero dependencies. Node built-ins only.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.SHOP_PORT || 3000;

/* ------------------------------------------------------------------ *
 *  THE "DATABASE" — three arrays. That is genuinely all a database is
 *  at this level: a place where state survives after the response.
 * ------------------------------------------------------------------ */

const products = [
  { id: 'P-101', name: 'Ceylon Cotton Tee',    price: 3500, category: 'clothing',
    variants: [
      { color: 'black', size: 'S', stock: 12 }, { color: 'black', size: 'M', stock: 4 },
      { color: 'black', size: 'L', stock: 0  }, { color: 'blue',  size: 'S', stock: 7 },
      { color: 'blue',  size: 'M', stock: 9 },  { color: 'blue',  size: 'L', stock: 3 },
      { color: 'white', size: 'M', stock: 2 }
    ] },
  { id: 'P-102', name: 'Highland Hoodie',      price: 8900, category: 'clothing',
    variants: [
      { color: 'grey',  size: 'M', stock: 5 }, { color: 'grey',  size: 'L', stock: 6 },
      { color: 'navy',  size: 'M', stock: 0 }, { color: 'navy',  size: 'L', stock: 2 }
    ] },
  { id: 'P-103', name: 'Trail Runner Sneakers', price: 14500, category: 'footwear',
    variants: [
      { color: 'black', size: '41', stock: 3 }, { color: 'black', size: '42', stock: 8 },
      { color: 'blue',  size: '42', stock: 1 }, { color: 'blue',  size: '43', stock: 0 }
    ] },
  { id: 'P-104', name: 'Canvas Backpack',      price: 6200, category: 'bags',
    variants: [
      { color: 'olive', size: 'one', stock: 15 }, { color: 'black', size: 'one', stock: 11 }
    ] },
  { id: 'P-105', name: 'Thermal Flask',        price: 2800, category: 'accessories',
    variants: [
      { color: 'steel', size: '500ml', stock: 22 }, { color: 'blue', size: '500ml', stock: 6 }
    ] }
];

const customers = [
  { id: 'C-1', name: 'Nandun',  email: 'nandun@example.lk' },
  { id: 'C-2', name: 'Ama',     email: 'ama@example.lk' }
];

const orders = [
  // Last month's order — used for the "reorder, but in blue" demo.
  { id: 1039, customerId: 'C-1', placedAt: '2026-08-02', status: 'delivered',
    items: [{ productId: 'P-101', name: 'Ceylon Cotton Tee', color: 'black', size: 'M', qty: 1, price: 3500 }] },

  // Ama's order. THIS is the one used for the security demo — it is NOT Nandun's.
  { id: 1041, customerId: 'C-2', placedAt: '2026-08-28', status: 'shipped',
    items: [{ productId: 'P-102', name: 'Highland Hoodie', color: 'grey', size: 'L', qty: 1, price: 8900 }] },

  // The order the demo opens with.
  { id: 1042, customerId: 'C-1', placedAt: '2026-09-01', status: 'in transit',
    deliveryEstimate: '2026-09-06',
    items: [{ productId: 'P-103', name: 'Trail Runner Sneakers', color: 'black', size: '42', qty: 1, price: 14500 }] }
];

let nextOrderId = 1043;
const stats = { requests: 0 };

/* ------------------------------------------------------------------ *
 *  HTTP plumbing
 * ------------------------------------------------------------------ */

function sendJSON(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) reject(new Error('too large')); });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

const customerByEmail = (email) =>
  customers.find((c) => c.email.toLowerCase() === String(email || '').toLowerCase());

function decorate(order) {
  const c = customers.find((x) => x.id === order.customerId);
  return { ...order, customer: c ? { name: c.name, email: c.email } : null,
           total: order.items.reduce((s, i) => s + i.price * i.qty, 0) };
}

/* ------------------------------------------------------------------ *
 *  THE API
 * ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  stats.requests++;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname;
  const q = url.searchParams;

  // Every request prints. On the projector, this log IS the teaching aid:
  // when the AI agent calls a tool, a line appears here that looks exactly
  // like the line that appears when a human clicks a button.
  const who = req.headers['x-called-by'] || 'browser';
  if (route.startsWith('/api')) {
    console.log(`  ${String(req.method).padEnd(6)} ${route}${url.search}   <- ${who}`);
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    });
    return res.end();
  }

  /* ---- PRODUCTS ---- */

  // GET /api/products?search=tee
  if (route === '/api/products' && req.method === 'GET') {
    const search = (q.get('search') || '').toLowerCase();
    let list = products;
    if (search) {
      list = products.filter((p) =>
        p.name.toLowerCase().includes(search) || p.category.includes(search));
    }
    return sendJSON(res, 200, {
      count: list.length,
      products: list.map((p) => ({
        id: p.id, name: p.name, price: p.price, category: p.category,
        colors: [...new Set(p.variants.map((v) => v.color))],
        inStock: p.variants.some((v) => v.stock > 0)
      }))
    });
  }

  // GET /api/products/P-101
  const pm = route.match(/^\/api\/products\/([\w-]+)$/);
  if (pm && req.method === 'GET') {
    const p = products.find((x) => x.id.toLowerCase() === pm[1].toLowerCase());
    if (!p) return sendJSON(res, 404, { error: `No product with id ${pm[1]}` });
    return sendJSON(res, 200, p);
  }

  // GET /api/stock?productId=P-101&color=blue&size=M
  if (route === '/api/stock' && req.method === 'GET') {
    const p = products.find((x) => x.id.toLowerCase() === String(q.get('productId')).toLowerCase());
    if (!p) return sendJSON(res, 404, { error: `No product with id ${q.get('productId')}` });
    const color = q.get('color'), size = q.get('size');
    let vs = p.variants;
    if (color) vs = vs.filter((v) => v.color === color.toLowerCase());
    if (size)  vs = vs.filter((v) => String(v.size).toLowerCase() === size.toLowerCase());
    return sendJSON(res, 200, { productId: p.id, name: p.name, variants: vs });
  }

  /* ---- ORDERS ---- */

  // GET /api/orders/1042
  const om = route.match(/^\/api\/orders\/(\d+)$/);
  if (om && req.method === 'GET') {
    const o = orders.find((x) => x.id === Number(om[1]));
    if (!o) return sendJSON(res, 404, { error: `No order with id ${om[1]}` });
    return sendJSON(res, 200, decorate(o));
  }

  // GET /api/customers/nandun@example.lk/orders
  const cm = route.match(/^\/api\/customers\/([^/]+)\/orders$/);
  if (cm && req.method === 'GET') {
    const c = customerByEmail(decodeURIComponent(cm[1]));
    if (!c) return sendJSON(res, 404, { error: `No customer with email ${decodeURIComponent(cm[1])}` });
    const mine = orders.filter((o) => o.customerId === c.id).map(decorate);
    return sendJSON(res, 200, { customer: { name: c.name, email: c.email }, count: mine.length, orders: mine });
  }

  // POST /api/orders
  if (route === '/api/orders' && req.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(req)) || '{}'); }
    catch { return sendJSON(res, 400, { error: 'Body is not valid JSON' }); }

    const c = customerByEmail(body.customerEmail);
    if (!c) return sendJSON(res, 400, { error: "Field 'customerEmail' must be a known customer" });
    if (!body.productId) return sendJSON(res, 400, { error: "Field 'productId' is required" });

    const p = products.find((x) => x.id.toLowerCase() === String(body.productId).toLowerCase());
    if (!p) return sendJSON(res, 404, { error: `No product with id ${body.productId}` });

    const v = p.variants.find((x) =>
      x.color === String(body.color || '').toLowerCase() &&
      String(x.size).toLowerCase() === String(body.size || '').toLowerCase());
    if (!v) return sendJSON(res, 400, { error: `No ${body.color}/${body.size} variant of ${p.name}` });
    if (v.stock < 1) return sendJSON(res, 409, { error: `${p.name} in ${body.color}/${body.size} is out of stock` });

    v.stock--;
    const order = {
      id: nextOrderId++, customerId: c.id,
      placedAt: new Date().toISOString().slice(0, 10), status: 'confirmed',
      items: [{ productId: p.id, name: p.name, color: v.color, size: v.size, qty: 1, price: p.price }]
    };
    orders.push(order);
    return sendJSON(res, 201, decorate(order));
  }

  /* ---- DEMO ENDPOINTS: every status code on a button ---- */

  if (route === '/api/admin') {
    if (req.headers.authorization !== 'Bearer ascend-2026') {
      return sendJSON(res, 401, { error: 'Unauthorized — send a valid token' });
    }
    return sendJSON(res, 200, { message: 'You are authenticated.', stats, orders: orders.length });
  }
  if (route === '/api/boom') {
    return sendJSON(res, 500, { error: 'Internal Server Error — the server broke, not you' });
  }
  if (route === '/api/stats') return sendJSON(res, 200, stats);

  /* ---- STATIC ---- */
  const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
  const file = route === '/' ? '/index.html' : route;
  const full = path.join(__dirname, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(full, (err, data) => {
    if (err) return sendJSON(res, 404, { error: `Not Found: ${route}` });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  THE SHOP — plain REST API`);
  console.log(`  ──────────────────────────────────────────`);
  console.log(`  http://localhost:${PORT}          storefront + API playground`);
  console.log(`  ${products.length} products · ${customers.length} customers · ${orders.length} orders`);
  console.log(`  ──────────────────────────────────────────\n`);
});

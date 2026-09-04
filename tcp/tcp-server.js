/**
 * ASCEND Session 3 — RAW TCP SOCKET SERVER
 *
 *   Run:  node tcp/tcp-server.js
 *   Then: node tcp/tcp-client.js        (open 2 or 3 of these)
 *   Or:   nc localhost 4000   /   telnet localhost 4000
 *
 * No HTTP. No framework. No JSON. Just bytes over a pipe that stays open.
 * This is the layer everything else in the session is built on top of.
 */

const net = require('net');
const PORT = 4000;

const clients = new Map();          // socket -> nickname
let counter = 0;

const server = net.createServer((socket) => {
  // A NEW SOCKET. It exists because someone connected. It is unique to them.
  const name = `guest-${++counter}`;
  const address = `${socket.remoteAddress}:${socket.remotePort}`;
  clients.set(socket, name);

  console.log(`[+] ${name} connected from ${address}   (${clients.size} online)`);

  socket.write(`\n  Connected to the ASCEND TCP server.\n`);
  socket.write(`  You are ${name}. Your socket is ${address}.\n`);
  socket.write(`  Type a message and press Enter. Type /who or /quit.\n\n`);
  broadcast(`* ${name} joined (${clients.size} online)\n`, socket);

  // ── THE MOST IMPORTANT LESSON IN THIS FILE ────────────────────────────
  // 'data' fires whenever BYTES arrive — not whenever a MESSAGE arrives.
  // One chunk may hold two messages. Or half of one. TCP guarantees order
  // and delivery; it does NOT guarantee message boundaries. It is a stream
  // of bytes, not a queue of messages.
  //
  // So we buffer, and we split on '\n' ourselves. That is called FRAMING,
  // and every protocol built on TCP has to invent it: HTTP frames with
  // headers + Content-Length, WebSocket frames with a 2-byte header.
  // ──────────────────────────────────────────────────────────────────────
  let buffer = '';

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) handleLine(socket, line, chunk.length);
    }
    if (buffer.length > 4096) buffer = '';   // never trust a client to send '\n'
  });

  socket.on('end', () => drop(socket));
  socket.on('error', () => drop(socket));   // clients DO vanish. Always handle this.
});

function handleLine(socket, text, bytes) {
    if (text === '/quit') return socket.end('  Goodbye.\n');
    if (text === '/who') {
      return socket.write(`  Online (${clients.size}): ${[...clients.values()].join(', ')}\n`);
    }
    if (text.startsWith('/name ')) {
      const old = clients.get(socket);
      const next = text.slice(6).trim().slice(0, 20) || old;
      clients.set(socket, next);
      return broadcast(`* ${old} is now ${next}\n`);
    }

    console.log(`[>] ${clients.get(socket)}: ${text}   (${bytes} bytes in that chunk)`);
    broadcast(`${clients.get(socket)}: ${text}\n`, socket);
    socket.write(`you: ${text}\n`);
}

function broadcast(line, except) {
  for (const [sock] of clients) {
    if (sock !== except && !sock.destroyed) sock.write(line);
  }
}

function drop(socket) {
  const name = clients.get(socket);
  if (!name) return;
  clients.delete(socket);
  console.log(`[-] ${name} disconnected   (${clients.size} online)`);
  broadcast(`* ${name} left (${clients.size} online)\n`);
}

server.listen(PORT, () => {
  console.log(`\n  TCP socket server listening on port ${PORT}`);
  console.log(`  Connect with:  node tcp/tcp-client.js   or   nc localhost ${PORT}\n`);
});

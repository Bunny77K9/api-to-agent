/**
 * ASCEND Session 3 — RAW TCP SOCKET CLIENT
 *
 *   Run:  node tcp/tcp-client.js            (connects to localhost:4000)
 *         node tcp/tcp-client.js 192.168.1.5 4000
 *
 * Four lines of real work: connect, write, read, close.
 */

const net = require('net');

const HOST = process.argv[2] || 'localhost';
const PORT = Number(process.argv[3]) || 4000;

// 1. CONNECT — the three-way handshake happens here, invisibly.
const socket = net.createConnection({ host: HOST, port: PORT }, () => {
  console.log(`connected to ${HOST}:${PORT} — type and press Enter (/quit to leave)\n`);
});

// 2. READ — fires whenever the server sends bytes. We never asked. It just arrives.
socket.on('data', (chunk) => process.stdout.write(chunk.toString('utf8')));

// 3. WRITE — everything you type goes down the same open pipe.
process.stdin.on('data', (chunk) => socket.write(chunk));

// 4. CLOSE
socket.on('end', () => { console.log('\nserver closed the connection'); process.exit(0); });
socket.on('error', (err) => { console.error(`connection error: ${err.message}`); process.exit(1); });

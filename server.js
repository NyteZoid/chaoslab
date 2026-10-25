// ChaosLab server: serves the sandbox and proxies Gemma 4 calls so the API key stays server-side.
const http = require('http');
const gemma = require('./gemma');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const PUBLIC_DIR = path.join(__dirname, 'public');
const VENDOR = {
  '/vendor/matter.min.js': path.join(__dirname, 'node_modules/matter-js/build/matter.min.js'),
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = VENDOR[urlPath];
  if (!file) {
    file = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

const API = {
  '/api/explain': (body) => gemma.explain(body),
  '/api/build': (body) => gemma.build(body),
  '/api/challenge': (body) => gemma.challenge(body),
  '/api/warm': () => gemma.warmLocal().then((ok) => ({ ok })),
};

function handler(req, res) {
  const urlPath = new URL(req.url, 'http://x').pathname;
  if (req.method === 'GET' && urlPath === '/api/status') {
    return gemma.status().then((s) => sendJson(res, 200, s));
  }
  if (req.method === 'GET') return serveStatic(req, res);
  if (req.method === 'POST' && API[urlPath]) return handleApi(req, res, API[urlPath]);
  send(res, 405, 'Method not allowed');
}

const MAX_BODY = 6 * 1024 * 1024; // screenshots are sent as base64 JPEG

function handleApi(req, res, fn) {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { sendJson(res, 413, { error: 'Request too large' }); req.destroy(); }
    else chunks.push(c);
  });
  req.on('end', async () => {
    if (res.writableEnded) return;
    try {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      sendJson(res, 200, await fn(body));
    } catch (e) {
      console.error(urlPathOf(req), e.message);
      sendJson(res, 502, { error: e.message });
    }
  });
}

const urlPathOf = (req) => new URL(req.url, 'http://x').pathname;

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

http.createServer(handler).listen(PORT, () => console.log(`ChaosLab on http://localhost:${PORT}`));

// Phones need HTTPS for the camera (sketch-to-scene). Uses certs/ if present.
const keyFile = path.join(__dirname, 'certs/key.pem');
const certFile = path.join(__dirname, 'certs/cert.pem');
if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
  https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, handler)
    .listen(HTTPS_PORT, () => console.log(`ChaosLab on https://<laptop-ip>:${HTTPS_PORT}`));
}

// sh_server.js — Star Health Premium Calculator Backend
// PORT: 3004 | Proxy: https://shapi.starhealth.in/atompro-bff/ext

const express = require('express');
const https = require('https');
const path  = require('path');
const fs    = require('fs');
const app = express();
const PORT = Number(process.env.PORT) || 3004;

// ── Public origins ────────────────────────────────────────────────────────
// See care_server.js for why this exists.
const PUBLIC_ORIGIN_CARE = process.env.PUBLIC_ORIGIN_CARE || 'http://localhost:3005';
const PUBLIC_ORIGIN_NIVA = process.env.PUBLIC_ORIGIN_NIVA || 'http://localhost:3002';
const PUBLIC_ORIGIN_MC   = process.env.PUBLIC_ORIGIN_MC   || 'http://localhost:3003';
const PUBLIC_ORIGIN_STAR = process.env.PUBLIC_ORIGIN_STAR || 'http://localhost:3004';
const ORIGIN_SUBS = [
  ['http://localhost:3002', PUBLIC_ORIGIN_NIVA],
  ['http://localhost:3003', PUBLIC_ORIGIN_MC],
  ['http://localhost:3004', PUBLIC_ORIGIN_STAR],
  ['http://localhost:3005', PUBLIC_ORIGIN_CARE],
];
function sendTemplated(res, filePath) {
  let html = fs.readFileSync(filePath, 'utf8');
  for (const [from, to] of ORIGIN_SUBS) html = html.split(from).join(to);
  res.type('html').send(html);
}

app.use(express.json({ limit: '10mb' }));

// CORS
// ── Local-only access control ─────────────────────────────────────────────────
// These servers proxy live insurer APIs with no authentication of their own.
// Binding to 127.0.0.1 keeps them off the network, and the origin allow-list
// stops any page the operator happens to be browsing from driving them.
const LOCAL_ORIGINS = new Set([
  'http://localhost:3002','http://127.0.0.1:3002',
  'http://localhost:3003','http://127.0.0.1:3003',
  'http://localhost:3004','http://127.0.0.1:3004',
  'http://localhost:3005','http://127.0.0.1:3005',
]);
[PUBLIC_ORIGIN_CARE, PUBLIC_ORIGIN_NIVA, PUBLIC_ORIGIN_MC, PUBLIC_ORIGIN_STAR].forEach(o => LOCAL_ORIGINS.add(o));
function localCors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && LOCAL_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (origin) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
}
app.use(localCors);

const STAR_HOST = 'shapi.starhealth.in';
const STAR_BASE = '/atompro-bff/ext';

const BASE_HEADERS = {
  'appid': 'web',
  'entity': '',
  'origin': 'https://atompro.starhealth.in',
  'referer': 'https://atompro.starhealth.in/',
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'x-requested-with': 'XMLHttpRequest',
};

function proxyRequest({ method, path, qs, body }, res) {
  const fullPath = STAR_BASE + path + (qs ? '?' + qs : '');
  const bodyStr = body ? JSON.stringify(body) : null;

  const headers = { ...BASE_HEADERS, 'content-type': 'application/json' };
  if (bodyStr) headers['content-length'] = String(Buffer.byteLength(bodyStr));

  const opts = { hostname: STAR_HOST, port: 443, path: fullPath, method, headers };

  console.log(`→ [${method}] https://${STAR_HOST}${fullPath}`);

  const pReq = https.request(opts, (pRes) => {
    let data = '';
    pRes.on('data', chunk => data += chunk);
    pRes.on('end', () => {
      console.log(`← [${pRes.statusCode}] ${fullPath.slice(0, 60)}`);
      res.status(pRes.statusCode)
         .setHeader('Content-Type', pRes.headers['content-type'] || 'application/json')
         .send(data);
    });
  });

  pReq.on('error', err => {
    console.error('Proxy error:', err.message);
    res.status(502).json({ error: 'Upstream error', detail: err.message });
  });

  if (bodyStr) pReq.write(bodyStr);
  pReq.end();
}

// ──────────────── Routes ────────────────

// GET /pre-quote — returns form config
app.get('/pre-quote', (req, res) => {
  proxyRequest({ method: 'GET', path: '/pre-quote' }, res);
});

// GET /pre-quote/validate-pincode?pinCode=XXXXXX
app.get('/pre-quote/validate-pincode', (req, res) => {
  const pin = req.query.pinCode || req.query.pincode || '';
  proxyRequest({ method: 'GET', path: '/pre-quote/validate-pincode', qs: `pinCode=${pin}` }, res);
});

// POST /quote/basic-details — form schema + product list
app.post('/quote/basic-details', (req, res) => {
  proxyRequest({ method: 'POST', path: '/quote/basic-details', body: req.body }, res);
});

// POST /quote/ped-details
app.post('/quote/ped-details', (req, res) => {
  proxyRequest({ method: 'POST', path: '/quote/ped-details', body: req.body }, res);
});

// POST /recommend-me — get product recommendations
app.post('/recommend-me', (req, res) => {
  proxyRequest({ method: 'POST', path: '/recommend-me', body: req.body }, res);
});

// POST /recommend-me/pricing — get premium for a specific sub-product
app.post('/recommend-me/pricing', (req, res) => {
  proxyRequest({ method: 'POST', path: '/recommend-me/pricing', body: req.body }, res);
});

// POST /checkout — product customization page data (covers, add-ons, pricing)
app.post('/checkout', (req, res) => {
  proxyRequest({ method: 'POST', path: '/checkout', body: req.body }, res);
});

// POST /checkout/cover-benefits — "Know More" details for a cover
app.post('/checkout/cover-benefits', (req, res) => {
  proxyRequest({ method: 'POST', path: '/checkout/cover-benefits', body: req.body }, res);
});

// ──────────────── Serve HTML ────────────────
app.get('/',         (req, res) => sendTemplated(res, path.join(__dirname, '..', 'public', 'calculators', 'sh_index.html')));

// ──────────────── Start ────────────────
// Guarded so this file can also be require()'d as a router (see
// server/combined_server.js) without binding its own port.
if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   Star Health Premium Calculator — Server    ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log(`\n  Local:   http://localhost:${PORT}`);
    console.log(`  Proxy:   https://${STAR_HOST}${STAR_BASE}`);
    console.log('\n  Open sh_index.html in your browser to start.\n');
  });
}
module.exports = app;

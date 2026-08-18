const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
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
app.use(express.json());

const API_BASE = 'https://otc.nivabupa.com/NewInstaAPI/api';

// In-memory cache: planType → products array
// The bulk ProductCode=0 fetch returns incomplete planSubCategory for some products
// (e.g. ReAssure3.0 is missing plantype options). Individual fetches fix this.
// Cached per-session so the extra API calls only happen once per plan type.
const productConfigCache = new Map();

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'niva_index.html'));
});

// ─────────────────────────────────────────────
// GET /api/config  →  cities + plan types
// ─────────────────────────────────────────────
app.get('/api/config', async (req, res) => {
  try {
    const resp = await fetch(`${API_BASE}/Premium/BasicPremiumData`);
    const json = await resp.json();

    // The 4th key (index 3) of json.data is the form-config array
    const dataKeys = Object.keys(json.data);
    const configArray = json.data[dataKeys[3]];

    // Cities (628 entries)
    const cityField = configArray.find(f => f.name === 'city');
    const cities = (cityField?.options || [])
      .map(c => ({ id: c.value, name: c.label, zone: c.ZoneCode }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Plan types
    const suggestedPlan = configArray.find(f => f.name === 'suggestedPlan');
    const planTypes = (suggestedPlan?.options || []).map(p => ({
      id: p.PlanId,
      name: p.PlanName,
    }));

    res.json({ cities, planTypes });
  } catch (err) {
    console.error('/api/config error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// Helper: fetch one product's full config
// ─────────────────────────────────────────────
async function fetchProductConfig(productCode, planType) {
  const url = `${API_BASE}/Premium/ProductConfiguration/?ChannelName=&ProductCode=${encodeURIComponent(productCode)}&PlanType=${encodeURIComponent(planType)}&IsPos=false&UserType=undefined`;
  const resp = await fetch(url);
  const json = await resp.json();
  const configs = json.data?.ProductCongiguration || [];
  // Match by product code; fall back to first entry
  return configs.find(c => String(c.value) === String(productCode)) || configs[0] || null;
}

// ─────────────────────────────────────────────
// GET /api/products/:planType  →  product list
// ─────────────────────────────────────────────
app.get('/api/products/:planType', async (req, res) => {
  try {
    const { planType } = req.params;

    // Serve from cache if available (individual fetches are only done once per planType)
    if (productConfigCache.has(planType)) {
      return res.json({ products: productConfigCache.get(planType) });
    }

    let baseList;

    if (planType === 'SeniorCitizen') {
      // ProductCode=0 returns empty for SC — seed the list from codes 45 & 46 directly
      const [j45, j46] = await Promise.all([
        fetch(`${API_BASE}/Premium/ProductConfiguration/?ChannelName=&ProductCode=45&PlanType=SeniorCitizen&IsPos=false&UserType=undefined`).then(r => r.json()),
        fetch(`${API_BASE}/Premium/ProductConfiguration/?ChannelName=&ProductCode=46&PlanType=SeniorCitizen&IsPos=false&UserType=undefined`).then(r => r.json()),
      ]);
      baseList = [
        ...(j45.data?.ProductCongiguration || []),
        ...(j46.data?.ProductCongiguration || []),
      ];
    } else {
      // Get product list via bulk fetch
      const url = `${API_BASE}/Premium/ProductConfiguration/?ChannelName=&ProductCode=0&PlanType=${encodeURIComponent(planType)}&IsPos=false&UserType=undefined`;
      const json = await fetch(url).then(r => r.json());
      baseList = (json.data?.ProductCongiguration || []).filter(p => p.value && p.value !== '0');
    }

    // Fetch individual configs in parallel — the bulk fetch omits plantype options for
    // some products (confirmed: ReAssure3.0 missing Classic/Select/Elite/Black in bulk).
    // Individual fetches return the complete planSubCategory every time.
    const products = await Promise.all(
      baseList.map(async (p) => {
        try {
          const ind = await fetchProductConfig(p.value, planType);
          return {
            value:           p.value,
            label:           p.label,
            productType:     p.ProductType,
            planSubCategory: ind?.planSubCategory || p.planSubCategory || [],
          };
        } catch (e) {
          console.warn(`Individual config fetch failed for product ${p.value}:`, e.message);
          return {
            value:           p.value,
            label:           p.label,
            productType:     p.ProductType,
            planSubCategory: p.planSubCategory || [],
          };
        }
      })
    );

    productConfigCache.set(planType, products);
    res.json({ products });
  } catch (err) {
    console.error('/api/products error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/premium  →  calculate premium
// ─────────────────────────────────────────────
app.post('/api/premium', async (req, res) => {
  try {
    const payload = req.body;

    // Always inject today's date
    const now = new Date();
    const dd   = String(now.getDate()).padStart(2, '0');
    const mm   = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    if (!payload.premiumCal) payload.premiumCal = {};
    if (!payload.premiumCal.policyDetails) payload.premiumCal.policyDetails = {};
    payload.premiumCal.policyDetails.premiumCalculationDate = `${dd}/${mm}/${yyyy}`;

    // 15-second timeout — prevents the request from hanging indefinitely
    // AbortController is built-in from Node.js 15+; skip timeout on older versions
    let controller = null, timer = null;
    try { controller = new AbortController(); } catch(e) { /* Node < 15 */ }
    if (controller) timer = setTimeout(() => controller.abort(), 15000);

    let resp;
    try {
      resp = await fetch(`${API_BASE}/Premium/GetPremium`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
        },
        body: JSON.stringify(payload),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    const json = await resp.json();
    res.json(json);
  } catch (err) {
    console.error('/api/premium error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve ExcelJS from node_modules (no CDN needed)
app.get('/exceljs.js', (req, res) => {
  const path = require('path'), fs = require('fs');
  const candidates = [
    path.join(__dirname, 'node_modules', 'exceljs', 'dist', 'es5', 'exceljs.browser.min.js'),
    path.join(__dirname, '..', 'node_modules', 'exceljs', 'dist', 'es5', 'exceljs.browser.min.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(p);
    }
  }
  res.status(404).send('// ExcelJS not found');
});

const PORT = 3002;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅  Niva Bupa premium calculator running on http://localhost:${PORT}`);
});

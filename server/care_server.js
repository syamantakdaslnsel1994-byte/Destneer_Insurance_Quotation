// care_server.js — Care Health Premium Calculator Backend
// PORT: 3005 | Proxy: https://abacus.careinsurance.com/religare

const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');
const fs      = require('fs');
const app     = express();
const PORT    = Number(process.env.PORT) || 3005;

// Shared HTML scrapers — used by both this file's raw-POST path and
// care_automation.js's browser-automation path (server/care_scrapers.js).
const {
  extractCSRF, parsePremium, parseAddons, parseFields, parseDynamicExtraFields,
  FIELD_LABELS, KNOWN_BASE_FIELDS,
} = require('./care_scrapers');
const careAutomation = require('./care_automation');
// Plans not yet migrated to browser automation — travel products (date/
// region-driven, no member/age/cover-type fields) and the Secure/income-band
// family (different age-band and income-field structure). These stay on the
// old raw-POST path below until a follow-up pass covers them; every other
// plan goes through care_automation.js.
const NOT_YET_AUTOMATED = new Set(['107','5674','5833','5834','7425','7424','6740','6384','188','573']);

// ── Public origins ────────────────────────────────────────────────────────
// Every calculator page and the hub hardcode each other's origin (iframe src,
// API base, postMessage allow-list) so they work with zero config on
// localhost. In production these env vars swap in the real domain per
// service; unset, everything defaults to today's exact localhost behaviour.
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

// ── CORS ─────────────────────────────────────────────────────────────────────
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

// ── Constants ─────────────────────────────────────────────────────────────────
const CARE_HOST = 'abacus.careinsurance.com';
const INIT_URL  = `https://${CARE_HOST}/religare/partner/generic-religare-know-popup`;
const CALC_URL  = `https://${CARE_HOST}/religare/partner-abacus/calculate-premium`;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const BASE_HEADERS = {
  'User-Agent':      UA,
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         INIT_URL,
  'Origin':          `https://${CARE_HOST}`,
  'Sec-Fetch-Dest':  'empty',
  'Sec-Fetch-Mode':  'cors',
  'Sec-Fetch-Site':  'same-origin',
};

// ── Hardcoded plan_id map (abacusId → plan_id) ────────────────────────────────
// plan_id is fetched dynamically via init POST, but known values skip that step.
// Confirmed via /debug-fields endpoint (Jul 2026).
// Travel policies — a different product from every other plan in this file
// (date/duration-priced, not member/age-priced). See the /calculate handler.
const TRAVEL_PLANS = new Set(['107', '5674', '5833', '5834']);

const PLAN_ID_MAP = {
  '2813': '110',  // Care Supreme
  '6384': '187',  // Secure Plus           — confirmed via /debug-fields
  '7424': '230',  // POS Secure Plus       — confirmed via /debug-fields
  '7425': '231',  // POS Secure Child      — confirmed via /debug-fields
  '6740': '210',  // Secure Child          — confirmed via /debug-fields
  '188':  '45',   // Secure                — confirmed via /debug-fields
  '573':  '69',   // POS Secure            — confirmed via /debug-fields
};

// ── Session state ─────────────────────────────────────────────────────────────
// One session per in-flight request. This used to be a single module-global
// mutated by initSession, postCalc and parsePremium, which meant two
// concurrent /calculate calls interleaved their cookies and CSRF tokens —
// and the hub's "Fill All + Calculate" is exactly a concurrent workload.
function newSession() { return { cookie: '', csrf: '', ts: 0 }; }

// ── Cookie helpers ────────────────────────────────────────────────────────────

/** Get all Set-Cookie values as an array using node-fetch v2's raw() API. */
function getRawSetCookies(res) {
  if (res.headers.raw) {
    const raw = res.headers.raw();
    return raw['set-cookie'] || [];
  }
  // Fallback: single get() call (may be joined for multiple values)
  const v = res.headers.get('set-cookie');
  return v ? [v] : [];
}

/** Merge new cookie strings into an existing cookie string (by name). */
function mergeCookies(existing, fresh) {
  const map = {};
  (existing || '').split('; ').forEach(pair => {
    const name = pair.split('=')[0].trim();
    if (name) map[name] = pair;
  });
  fresh.forEach(cookieLine => {
    const pair = cookieLine.split(';')[0].trim(); // name=value
    const name = pair.split('=')[0].trim();
    if (name) map[name] = pair;
  });
  return Object.values(map).join('; ');
}

// extractCSRF now lives in ./care_scrapers (required at the top of this file).

/** Build URL-encoded body that supports duplicate keys. */
function buildBody(pairs) {
  return pairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`)
    .join('&');
}

// ── Session init ──────────────────────────────────────────────────────────────
async function initSession() {
  const sess = newSession();
  console.log('[Care] Initialising session via GET…');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let res;
  try {
    res = await fetch(INIT_URL, {
      headers: { ...BASE_HEADERS, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const setCookies = getRawSetCookies(res);
  console.log(`[Care] GET status: ${res.status}  Set-Cookie count: ${setCookies.length}`);
  setCookies.forEach((c, i) => console.log(`  cookie[${i}]: ${c.split(';')[0]}`));

  const html = await res.text();
  const csrf = extractCSRF(html);
  console.log(`[Care] CSRF token found: ${!!csrf}  len=${csrf.length}`);

  sess.cookie = mergeCookies('', setCookies);
  sess.csrf   = csrf;
  sess.ts     = Date.now();

  console.log(`[Care] Session ready. Cookie: ${sess.cookie.slice(0, 80)}`);
  return sess;
}

// ── POST to calculate-premium ─────────────────────────────────────────────────
async function postCalc(pairs, sess) {
  if (!sess) throw new Error('postCalc requires a session');
  const body = buildBody(pairs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  let res;
  try {
    res = await fetch(CALC_URL, {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie':           sess.cookie,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept':           'application/json, text/javascript, */*; q=0.01',
      },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  console.log(`[Care] POST → ${res.status}`);

  // Merge new cookies (don't replace — keep _csrf-frontend cookie)
  const newCookies = getRawSetCookies(res);
  if (newCookies.length) {
    sess.cookie = mergeCookies(sess.cookie, newCookies);
  }

  const text = await res.text();
  try   { return JSON.parse(text); }
  catch { return { content: text, plan_content: '' }; }
}

// parsePremium now lives in ./care_scrapers (required at the top of this file).

// ── /debug  — detailed session + request diagnostics ──────────────────────────
app.get('/debug', async (req, res) => {
  const info = { step1: {}, step2: {}, step3: {} };
  try {
    // Step 1: GET page
    const pageRes = await fetch(INIT_URL, {
      headers: { ...BASE_HEADERS, Accept: 'text/html,application/xhtml+xml' },
    });
    const setCookies = getRawSetCookies(pageRes);
    const pageHtml   = await pageRes.text();
    const csrf       = extractCSRF(pageHtml);
    const cookie     = mergeCookies('', setCookies);

    info.step1 = {
      status:         pageRes.status,
      setCookieCount: setCookies.length,
      setCookies:     setCookies.map(c => c.split(';')[0]),
      csrfFound:      !!csrf,
      csrf:           csrf ? csrf.slice(0, 40) + '…' : null,
      hasCsrfCookie:  cookie.includes('_csrf-frontend'),
    };

    // Step 2: Init POST
    const initBody = buildBody([
      ['_csrf-frontend',                      csrf],
      ['assignedAbacus',                      '2813'],
      ['PartnerPreviewForm[partnerAbacusId]', '3'],
      ['PartnerPreviewForm[agentCode]',       ''],
      ['PartnerPreviewForm[source]',          'GenericAbacus'],
    ]);
    const initRes  = await fetch(CALC_URL, {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie':           cookie,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept':           'application/json, text/javascript, */*; q=0.01',
      },
      body: initBody,
    });
    const initText = await initRes.text();
    let initJson = {};
    try { initJson = JSON.parse(initText); } catch {}
    const initHtml  = initJson.content || initText;
    const initCsrf  = extractCSRF(initHtml);
    const initPlanId = (initHtml.match(/name="PartnerPreviewForm\[plan_id\]"\s+value="([^"]+)"/) || [])[1];

    info.step2 = {
      status:    initRes.status,
      isJson:    !!initJson.content,
      planId:    initPlanId,
      csrfFound: !!initCsrf,
      preview:   initHtml.slice(0, 300).replace(/\s+/g, ' '),
    };

    // Step 3: Calc POST with pincode
    const calcCsrf = initCsrf || csrf;
    const calcPairs = [
      ['_csrf-frontend', calcCsrf],
      ['assignedAbacus', '2813'],
      ['PartnerPreviewForm[input][field_75][field_value]', 'NB'],
      ['PartnerPreviewForm[input][field_54][field_value]', '700041'],
      ['PartnerPreviewForm[input][field_9][field_value]',  'Floater'],
      ['PartnerPreviewForm[input][field_1][field_value]',  '2'],
      ['PartnerPreviewForm[input][field_10][field_value]', '0'],
      ['PartnerPreviewForm[input][field_3][field_value]',  '30'],
      ['PartnerPreviewForm[input][newMem_2][field_value]', '28'],
      ['PartnerPreviewForm[input][field_2][field_value]',  '10'],
      ['PartnerPreviewForm[input][field_4][field_value]',  ''],
      ['PartnerPreviewForm[input][field_4][field_value]',  '1 Year'],
      ['PartnerPreviewForm[abacusId]',          '2813'],
      ['PartnerPreviewForm[partnerAbacusId]',   '3'],
      ['PartnerPreviewForm[plan_id]',           initPlanId || '110'],
      ['PartnerPreviewForm[output][outPutField][field_value][]', ''],
      ['PartnerPreviewForm[output][outPutField][field_value][]', 'field_8'],
      ['PartnerPreviewForm[selectedBasePremium]', '1'],
      ['PartnerPreviewForm[premium_type]',        ''],
      ['PartnerPreviewForm[premium_amount]',      ''],
      ['PartnerPreviewForm[addonTags]',           ''],
      ['PartnerPreviewForm[agentCode]',           ''],
      ['PartnerPreviewForm[source]',              'GenericAbacus'],
      ['PartnerPreviewForm[extra][field_WB][field_value]',  '0'],
      ['PartnerPreviewForm[extra][field_WB][field_value]',  'checked'],
      ['PartnerPreviewForm[extra][field_NCB][field_value]', '0'],
      ['PartnerPreviewForm[extra][field_NCB][field_value]', 'checked'],
      ['PartnerPreviewForm[input][field_NCB_Value][field_value]', 'CB Super'],
      ['PartnerPreviewForm[extra][field_OPD][field_value]', '0'],
      ['PartnerPreviewForm[extra][field_OPD][field_value]', 'checked'],
      ['PartnerPreviewForm[input][field_OPD_Value][field_value]', 'OPD'],
    ];

    // Merge init cookies
    const newC2 = getRawSetCookies(initRes);
    const cookieForCalc = newC2.length ? mergeCookies(cookie, newC2) : cookie;

    const calcRes  = await fetch(CALC_URL, {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie':           cookieForCalc,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept':           'application/json, text/javascript, */*; q=0.01',
      },
      body: buildBody(calcPairs),
    });
    const calcText = await calcRes.text();
    let calcJson = {};
    try { calcJson = JSON.parse(calcText); } catch {}
    const calcHtml = calcJson.content || calcText;
    const result   = parsePremium(calcHtml);

    info.step3 = {
      status:       calcRes.status,
      isJson:       !!calcJson.content,
      premiumFound: result.ok,
      discounted:   result.discounted,
      grandTotal:   result.grandTotal,
      needsPincode: result.needsPincode,
      preview:      calcHtml.slice(0, 400).replace(/\s+/g, ' '),
    };

    res.json({ ok: true, ...info });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, ...info });
  }
});

// ── /plans ────────────────────────────────────────────────────────────────────
// ── Plan catalogue ────────────────────────────────────────────────────────────
// Single source of truth: care_plans.json. This list previously existed in
// FIVE places (here, care_index.html, care_audit.js, insurance_hub.html and
// the .md docs) and had already drifted — nine plans disagreed on whether
// they have a Business Type field, and plan 748 (Enhance) has a Plan Version
// field on the portal that no copy recorded.
//
// care_plans.json was built by merging all five against the 7 Jul 2026
// live-portal audit; where they disagreed, the measured portal won.
const PLAN_CATALOGUE = (() => {
  try {
    const raw = require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'care_plans.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.plans || !parsed.plans.length) throw new Error('no plans in file');
    console.log(`[Care] Loaded ${parsed.plans.length} plans from care_plans.json`);
    return parsed;
  } catch (e) {
    console.error('\n[Care] FATAL: could not load care_plans.json —', e.message);
    console.error('[Care] This file is the plan catalogue. Restore it from the repo and restart.\n');
    process.exit(1);
  }
})();

const PLANS = PLAN_CATALOGUE.plans.map(p => ({
  id: p.id, name: p.name, biz: p.businessType, pt: p.planTypeField,
}));

// Full record by id, for the front-end and the audit.
const PLAN_BY_ID = Object.fromEntries(PLAN_CATALOGUE.plans.map(p => [p.id, p]));

// Serve the whole catalogue — care_index.html and insurance_hub.html build
// their plan pickers from this instead of carrying their own copies.
app.get('/plans', (_, res) => res.json(PLAN_CATALOGUE));

// FIELD_LABELS, parseAddons, parseFields, KNOWN_BASE_FIELDS, and
// parseDynamicExtraFields now live in ./care_scrapers (required at the top
// of this file).

// ── /addons  — fetch plan-specific add-on checkboxes ─────────────────────────
// Browser-automation path (server/care_automation.js) — drives Care's own
// live page instead of replaying a guessed raw POST. Covers every plan
// except NOT_YET_AUTOMATED (travel + Secure/income-band family), which fall
// through to legacyAddons below.
app.post('/addons', async (req, res) => {
  const { abacusId = '2813' } = req.body;
  if (NOT_YET_AUTOMATED.has(abacusId)) return legacyAddons(req, res);
  try {
    const { businessType, planType, coverType, nationalityStatus, globalCoverage } = req.body;
    const catalogueExtra = ((PLAN_BY_ID[abacusId] || {}).extraFields || []).map(f => f.field);
    const result = await careAutomation.previewCascade({ abacusId, businessType, planType, coverType, nationalityStatus, globalCoverage });
    // Merge in the plan's static catalogue extraFields so they aren't
    // re-reported as "dynamic" (previewCascade doesn't know the catalogue).
    const dynamicExtraFields = (result.dynamicExtraFields || []).filter(f => !catalogueExtra.includes(f.field));
    res.json({ ok: true, addons: result.addons, fields: result.fields, dynamicExtraFields, catalogue: PLAN_BY_ID[abacusId] || null });
  } catch (e) {
    console.error('[Care /addons automation]', e.message);
    res.status(503).json({ ok: false, error: `Care's live calculator is unavailable right now: ${e.message}`, addons: [], fields: null, dynamicExtraFields: [] });
  }
});

// ── legacyAddons — raw-POST path, kept only for NOT_YET_AUTOMATED plans ──────
async function legacyAddons(req, res) {
  try {
    const { abacusId = '2813', businessType, planType, coverType, nationalityStatus, globalCoverage } = req.body;

    // Fresh session
    const pageRes  = await fetch(INIT_URL, {
      headers: { ...BASE_HEADERS, Accept: 'text/html,application/xhtml+xml' },
    });
    const setCookies = getRawSetCookies(pageRes);
    const pageHtml   = await pageRes.text();
    const csrf       = extractCSRF(pageHtml);
    const cookie     = mergeCookies('', setCookies);

    // Init POST → get form HTML with add-on checkboxes for this plan
    const initBody = buildBody([
      ['_csrf-frontend',                      csrf],
      ['assignedAbacus',                      abacusId],
      ['PartnerPreviewForm[partnerAbacusId]', '3'],
      ['PartnerPreviewForm[agentCode]',       ''],
      ['PartnerPreviewForm[source]',          'GenericAbacus'],
    ]);
    const initRes  = await fetch(CALC_URL, {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie':           cookie,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept':           'application/json, text/javascript, */*; q=0.01',
      },
      body: initBody,
    });
    const initText = await initRes.text();
    let initJson   = {};
    try { initJson = JSON.parse(initText); } catch {}
    const initHtml = initJson.content || initText;

    // ── Cascade: if the operator has Plan Type / Business Type already
    // selected, the bare init HTML above is the WRONG snapshot — it always
    // reflects the plan's default combo. Resubmit with the current values,
    // the same way the real page's own dropdown-change handler does, and
    // parse the re-rendered form instead. Confirmed live on Care Supreme
    // (2813): Plan Type "Senior Premium" swaps in a different Sum Insured
    // ladder, a different add-on set, and reveals a "PED" field that plain
    // "Care Supreme" doesn't have at all.
    let html = initHtml;
    let dynamicExtraFields = [];
    if (businessType || planType || coverType || nationalityStatus || globalCoverage) {
      const csrf2 = extractCSRF(initHtml) || csrf;
      const planIdM = initHtml.match(/name="PartnerPreviewForm\[plan_id\]"\s+value="([^"]+)"/);
      const planId = planIdM ? planIdM[1] : (PLAN_ID_MAP[abacusId] || '');
      const cascadePairs = [
        ['_csrf-frontend', csrf2],
        // Baseline "someone is filled in" context — the portal's
        // field-changed handler is the calc endpoint itself, and it wants a
        // complete form, not just the one field that changed. Values here
        // are placeholders; they only affect which fields/options/add-ons
        // get rendered back, not anything actually calculated yet.
        ['PartnerPreviewForm[input][field_9][field_value]',  coverType || 'Floater'],
        ['PartnerPreviewForm[input][field_1][field_value]',  '2'],
        ['PartnerPreviewForm[input][field_10][field_value]', '0'],
        ['PartnerPreviewForm[input][field_3][field_value]',  '30'],
        ['PartnerPreviewForm[input][newMem_2][field_value]', '28'],
        ['PartnerPreviewForm[input][field_2][field_value]',  '10'],
        ['PartnerPreviewForm[input][field_4][field_value]',  '1 Year'],
      ];
      if (businessType)      cascadePairs.push(['PartnerPreviewForm[input][field_75][field_value]', businessType]);
      if (planType)          cascadePairs.push(['PartnerPreviewForm[input][field_23][field_value]', planType]);
      if (nationalityStatus) cascadePairs.push(['PartnerPreviewForm[input][field_NS][field_value]', nationalityStatus]);
      if (globalCoverage)    cascadePairs.push(['PartnerPreviewForm[input][field_GC][field_value]', globalCoverage]);
      // Same boilerplate /calculate sends on every request — the portal
      // 400s without it (learned the hard way building the travel-plan
      // support earlier).
      cascadePairs.push(
        ['PartnerPreviewForm[abacusId]',        abacusId],
        ['PartnerPreviewForm[partnerAbacusId]', '3'],
        ['PartnerPreviewForm[plan_id]',         planId],
        ['PartnerPreviewForm[output][outPutField][field_value][]', ''],
        ['PartnerPreviewForm[output][outPutField][field_value][]', 'field_8'],
        ['PartnerPreviewForm[selectedBasePremium]', '1'],
        ['PartnerPreviewForm[premium_type]',        ''],
        ['PartnerPreviewForm[premium_amount]',      ''],
        ['PartnerPreviewForm[addonTags]',           ''],
        ['PartnerPreviewForm[agentCode]',           ''],
        ['PartnerPreviewForm[source]',              'GenericAbacus'],
      );
      const cascadeRes = await fetch(CALC_URL, {
        method: 'POST',
        headers: { ...BASE_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Cookie': cookie, 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/javascript, */*; q=0.01' },
        body: buildBody(cascadePairs),
      });
      const cascadeText = await cascadeRes.text();
      let cascadeJson = {};
      try { cascadeJson = JSON.parse(cascadeText); } catch {}
      html = cascadeJson.content || cascadeText;
      const catalogueExtra = ((PLAN_BY_ID[abacusId] || {}).extraFields || []).map(f => f.field);
      dynamicExtraFields = parseDynamicExtraFields(html, catalogueExtra);
    }

    const addons = parseAddons(html);
    const fields = parseFields(html);
    // Include the catalogue record so the front-end never needs its own copy
    // of the plan's capabilities, sum-insured ladder or portal default.
    res.json({ ok: true, addons, fields, dynamicExtraFields, catalogue: PLAN_BY_ID[abacusId] || null });
  } catch (e) {
    console.error('[Care /addons]', e.message);
    res.status(500).json({ ok: false, error: e.message, addons: [], fields: null, dynamicExtraFields: [] });
  }
}

// ── /calculate ────────────────────────────────────────────────────────────────
// Browser-automation path for every plan except NOT_YET_AUTOMATED (travel +
// Secure/income-band family), which fall through to legacyCalculate below.
app.post('/calculate', async (req, res) => {
  const { abacusId = '2813', pincode = '' } = req.body;
  if (NOT_YET_AUTOMATED.has(abacusId)) return legacyCalculate(req, res);

  if (!pincode || pincode.length < 6) {
    return res.status(422).json({ ok: false, error: 'Pincode is required (6 digits).' });
  }
  try {
    const result = await careAutomation.runQuote(req.body);
    if (!result.ok) {
      if (result.needsPincode) {
        return res.status(422).json({ ok: false, error: 'Please enter a valid pincode to get premium.' });
      }
      return res.status(422).json({ ok: false, error: 'No premium returned. Please try again.' });
    }
    res.json({
      ok:                true,
      discountedPremium: result.discounted,
      basePremium:       result.original || result.discounted,
      grandTotal:        result.grandTotal || result.discounted,
      discountPct:       result.discPct,
    });
  } catch (e) {
    console.error('[Care /calculate automation]', e.message);
    res.status(503).json({ ok: false, error: `Care's live calculator is unavailable right now: ${e.message}` });
  }
});

// ── legacyCalculate — raw-POST path, kept only for NOT_YET_AUTOMATED plans ──
async function legacyCalculate(req, res) {
  try {
    // Fresh session for THIS request only — Care Health sessions can expire
    // server-side quickly, and a shared one would be clobbered by any
    // concurrent calculation.
    const sess = await initSession();

    const {
      abacusId     = '2813',
      pincode      = '',
      coverType    = 'Floater',
      totalMembers = '2',
      children     = '0',
      eldestAge    = '30',
      member2Age   = '25',
      member3Age,
      member4Age,
      member5Age,
      member6Age,
      travel,
      sumInsured   = '10',
      tenure       = '1 Year',
      businessType = 'NB',
      planType          = '',
      nationalityStatus = '',
      globalCoverage    = '',
      addons            = {},
      // Chosen sub-option for a checked add-on that offers a real second
      // choice — { 'field_NCB_Value': 'CB Booster', ... }. Falls back to
      // SUB_DEFAULTS' first option when a field isn't present here.
      subValues         = {},
      // Plan-specific fields with no checkbox gate at all (e.g. Deductible,
      // OPD Sum Insured, PED Tenure on the Super Saver/Ultimate Care family)
      // — { 'field_11': '5', 'field_OPD_SI': '10000', ... }. Any field the
      // plan's catalogue entry lists but the caller didn't send gets that
      // entry's own default, since the real form requires a value either way.
      extraFields       = {},
      // Income fields (Secure family plans)
      annualIncome,
      jobType,
      monthlyIncome,
      // Age band for plans 188/573 — "18-64" or "65-70"
      ageBand      = '18-64',
      incomeFieldIds = {},
    } = req.body;

    if (!pincode || pincode.length < 6) {
      return res.status(422).json({ ok: false, error: 'Pincode is required (6 digits).' });
    }

    // ── Step 1: Plan init → get plan_id + rotate CSRF ────────────────────────
    let planId = PLAN_ID_MAP[abacusId] || null;

    if (!planId) {
      console.log(`[Care] No cached plan_id for ${abacusId}, fetching via init POST…`);
      const initData = await postCalc([
        ['_csrf-frontend',                      sess.csrf],
        ['assignedAbacus',                      abacusId],
        ['PartnerPreviewForm[partnerAbacusId]', '3'],
        ['PartnerPreviewForm[agentCode]',       ''],
        ['PartnerPreviewForm[source]',          'GenericAbacus'],
      ], sess);
      const initHtml = initData.content || '';
      const initInfo = parsePremium(initHtml, sess);
      planId = initInfo.planId || '';
      console.log(`[Care] plan_id discovered: ${planId || '(none)'}`);
    } else {
      console.log(`[Care] plan_id from cache: ${planId}`);
      // Still do init POST to rotate CSRF even if plan_id is known
      const initData = await postCalc([
        ['_csrf-frontend',                      sess.csrf],
        ['assignedAbacus',                      abacusId],
        ['PartnerPreviewForm[partnerAbacusId]', '3'],
        ['PartnerPreviewForm[agentCode]',       ''],
        ['PartnerPreviewForm[source]',          'GenericAbacus'],
      ], sess);
      const initHtml = initData.content || '';
      parsePremium(initHtml, sess); // rotates this session's CSRF
    }

    // ── Travel plans — a genuinely different product shape ──────────────────
    // Student Explore (107), Student Explore-Health Unlimited (5674), New
    // Explore (5833) and POS Explore (5834) aren't health covers with the
    // usual member/age/cover-type fields — they're travel policies priced
    // off a date range (or, for 107, a month count) and, for 5833/5834, a
    // per-traveler age band. Handled entirely separately rather than forcing
    // them through the health-plan field logic below, which doesn't apply.
    if (TRAVEL_PLANS.has(abacusId)) {
      const t = travel || {};
      const tPairs = [
        ['_csrf-frontend', sess.csrf],
        ['assignedAbacus', abacusId],
        ['PartnerPreviewForm[input][field_54][field_value]', pincode],
        // Same boilerplate the health-plan pairs below send — required by
        // the portal regardless of product type.
        ['PartnerPreviewForm[abacusId]',        abacusId],
        ['PartnerPreviewForm[partnerAbacusId]', '3'],
        ['PartnerPreviewForm[plan_id]',         planId],
        ['PartnerPreviewForm[output][outPutField][field_value][]', ''],
        ['PartnerPreviewForm[output][outPutField][field_value][]', 'field_8'],
        ['PartnerPreviewForm[selectedBasePremium]', '1'],
        ['PartnerPreviewForm[premium_type]',        ''],
        ['PartnerPreviewForm[premium_amount]',      ''],
        ['PartnerPreviewForm[addonTags]',           ''],
        ['PartnerPreviewForm[agentCode]',           ''],
        ['PartnerPreviewForm[source]',              'GenericAbacus'],
      ];
      if (abacusId === '107') {
        // Student Explore: fixed 12-40 age band, month-based tenure, a
        // 2-option geographical scope, 4-option plan tier, six optional
        // covers (each a Yes/No radio) plus one with its own sub-choice.
        tPairs.push(
          ['PartnerPreviewForm[input][field_3][field_value]',  '12 - 40'],
          ['PartnerPreviewForm[input][field_16][field_value]', t.geoScope || 'Worldwide'],
          ['PartnerPreviewForm[input][field_21][field_value]', t.planType || 'Explore Start'],
          ['PartnerPreviewForm[input][field_4][field_value]',  t.tenureMonths || '1'],
          ['PartnerPreviewForm[input][field_2][field_value]',  '30'],
        );
        const covers = t.optionalCovers || {};
        for (const field of ['opt_cvr_SII','opt_cvr_HIV','opt_cvr_VC','opt_cvr_MNBC','opt_cvr_ASI','opt_cvr_PEDC']) {
          tPairs.push([`PartnerPreviewForm[input][${field}][field_value]`, covers[field] ? 'checked' : 'No']);
        }
        if (covers.opt_cvr_MNBC) {
          tPairs.push(['PartnerPreviewForm[input][opt_cvr_MNBC_dropdown][field_value]', t.mnbcOption || 'Upto SI']);
        }
      } else if (abacusId === '5674') {
        // Student Explore-Health Unlimited: date range only, fixed
        // Unlimited SI, fixed 12-17/... age band (already handled as a
        // regular AGE_BAND_MAP field via eldestAge, so just forwarded).
        tPairs.push(
          ['PartnerPreviewForm[input][field_3][field_value]',  eldestAge],
          ['PartnerPreviewForm[input][start_date][field_value]', t.startDate || ''],
          ['PartnerPreviewForm[input][end_date][field_value]',   t.endDate   || ''],
          ['PartnerPreviewForm[input][field_4][field_value]',    String(t.days || '')],
          ['PartnerPreviewForm[input][field_2][field_value]',    'Unlimited'],
        );
      } else {
        // 5833 (New Explore) / 5834 (POS Explore): region, trip type, max
        // duration, currency, date range, travelers + per-traveler age band,
        // PED flag, sum insured. field_21 "Travel Plan Type" is cosmetic —
        // confirmed live it doesn't affect the premium and always mirrors
        // whatever region is chosen, so it's sent as the same value rather
        // than exposing a second, meaningless control to the operator.
        const travelers = Math.max(1, Math.min(6, parseInt(t.travelers, 10) || 1));
        tPairs.push(
          ['PartnerPreviewForm[input][field_16][field_value]',  t.region || 'Asia'],
          ['PartnerPreviewForm[input][field_21][field_value]',  t.region || 'Asia'],
          ['PartnerPreviewForm[input][field_20][field_value]',  t.tripType || 'Single'],
          ['PartnerPreviewForm[input][field_221][field_value]', 'Dollar'],
          ['PartnerPreviewForm[input][field_MTD][field_value]', t.maxDuration || '30'],
          ['PartnerPreviewForm[input][start_date][field_value]', t.startDate || ''],
          ['PartnerPreviewForm[input][end_date][field_value]',   t.endDate   || ''],
          ['PartnerPreviewForm[input][field_4][field_value]',    String(t.days || '')],
          ['PartnerPreviewForm[input][field_17][field_value]',   String(travelers)],
          ['PartnerPreviewForm[input][field_19][field_value]',   t.hasPED ? 'Yes' : 'No'],
          ['PartnerPreviewForm[input][field_2][field_value]',    t.sumInsured || '10'],
        );
        const ages = Array.isArray(t.travelerAges) ? t.travelerAges : [];
        if (ages[0]) tPairs.push(['PartnerPreviewForm[input][field_18][field_value]', ages[0]]);
        for (let i = 1; i < travelers; i++) {
          if (ages[i]) tPairs.push([`PartnerPreviewForm[input][newMem_${i}][field_value]`, ages[i]]);
        }
      }

      const calcData = await postCalc(tPairs, sess);
      const result = parsePremium(calcData.content || '', sess);
      if (!result.ok) {
        return res.status(422).json({ ok: false, error: 'No premium returned. Please try again.' });
      }
      return res.json({ ok: true, discountedPremium: result.discounted, basePremium: result.original,
                         grandTotal: result.grandTotal, discountPct: result.discPct });
    }

    // ── Step 2: Full calculation ──────────────────────────────────────────────
    // Secure family plan sets — confirmed from /debug-fields (Jul 2026)
    const SECURE_PLANS   = new Set(['7425','7424','6740','6384','188','573']); // all income plans

    // 188 (Secure) and 573 (POS Secure) have DIFFERENT field structure:
    //   - Age field: field_15 with options "18-64" / "65-70" (NOT field_3)
    //   - SI: fixed pre-set value (188→"300", 573→"50"), NOT user-selectable
    const LEGACY_SECURE  = new Set(['188','573']);

    // 7425/6740 now send user-selected SI as field_2 (not Monthly Income)
    const MONTHLY_SI_PLANS = new Set([]);

    // 188/573 now use user-selected SI (10–200L / 10–50L) — no fixed pre-set
    const FIXED_SI = {};

    const pairs = [
      ['_csrf-frontend', sess.csrf],
      ['assignedAbacus', abacusId],
    ];

    if (businessType)     pairs.push(['PartnerPreviewForm[input][field_75][field_value]', businessType]);
    if (planType)         pairs.push(['PartnerPreviewForm[input][field_23][field_value]', planType]);
    if (nationalityStatus) pairs.push(['PartnerPreviewForm[input][field_NS][field_value]', nationalityStatus]);
    if (globalCoverage)   pairs.push(['PartnerPreviewForm[input][field_GC][field_value]', globalCoverage]);
    if (pincode)          pairs.push(['PartnerPreviewForm[input][field_54][field_value]', pincode]);

    // Cover type, children — only for plans that actually have these fields.
    // Secure family plans (6384, 7424, 7425, 6740, 188, 573) never have them;
    // beyond that, some plans (e.g. 362 Super Mediclaim) have no Cover Type
    // or Children field at all on the live portal — sending field_9/field_10
    // to those plans made the portal reject the request outright (HTTP 400).
    const planRec = PLAN_BY_ID[abacusId];
    if (!SECURE_PLANS.has(abacusId) && (!planRec || planRec.coverType !== false)) {
      pairs.push(['PartnerPreviewForm[input][field_9][field_value]',  coverType]);
    }
    if (!SECURE_PLANS.has(abacusId) && (!planRec || planRec.children !== false)) {
      pairs.push(['PartnerPreviewForm[input][field_10][field_value]', children]);
    }
    pairs.push(['PartnerPreviewForm[input][field_1][field_value]',  totalMembers]);

    // Age field — three different structures confirmed from /debug-fields (Jul 2026):
    //   Standard plans:          field_3 = individual year (e.g. "30")
    //   6384/7424/7425/6740:     field_3 = SELECT, single option "18 - 64 YEARS"
    //   188/573 (LEGACY_SECURE): field_15 = SELECT, options "18-64" / "65-70"
    if (LEGACY_SECURE.has(abacusId)) {
      // Plans 188 and 573 — different age field entirely
      const band = ageBand || '18-64';
      pairs.push(['PartnerPreviewForm[input][field_15][field_value]', band]);
      console.log(`[Care] Legacy Secure — field_15=${band}`);
    } else if (SECURE_PLANS.has(abacusId)) {
      // Plans 6384, 7424, 7425, 6740 — single fixed band
      pairs.push(['PartnerPreviewForm[input][field_3][field_value]', '18 - 64 YEARS']);
      console.log(`[Care] Secure — fixed age band "18 - 64 YEARS"`);
    } else {
      // Standard plans — individual year
      pairs.push(['PartnerPreviewForm[input][field_3][field_value]', eldestAge]);
    }

    const total = parseInt(totalMembers, 10);
    if (total >= 2)              pairs.push(['PartnerPreviewForm[input][newMem_2][field_value]', member2Age]);
    if (total >= 3 && member3Age) pairs.push(['PartnerPreviewForm[input][newMem_3][field_value]', member3Age]);
    if (total >= 4 && member4Age) pairs.push(['PartnerPreviewForm[input][newMem_4][field_value]', member4Age]);
    // Members 5/6 — only a handful of plans go this high (confirmed via
    // /debug-fields: field_1 offers up to 6 there). newMem_5/newMem_6 follow
    // the same naming the portal already confirmed for newMem_2/3/4; the
    // live form only renders these fields once Total Members is raised that
    // high via its own AJAX, so this couldn't be captured in a static dump.
    if (total >= 5 && member5Age) pairs.push(['PartnerPreviewForm[input][newMem_5][field_value]', member5Age]);
    if (total >= 6 && member6Age) pairs.push(['PartnerPreviewForm[input][newMem_6][field_value]', member6Age]);

    // Income fields for Secure family plans
    // Field IDs confirmed from live portal via /debug-fields (Jul 2026):
    //   field_12 = Annual Income (In Lakhs)
    //   field_13 = Job Type (Salaried / Business / Other Source)
    //   No monthly income field for any plan — all use field_2 as SI.
    // Confirmed field IDs from /debug-fields (Jul 2026).
    const SECURE_INCOME_FIELDS = {
      '6384': { annualIncome: 'field_12', jobType: 'field_13', monthlyIncome: null     },
      '7424': { annualIncome: 'field_12', jobType: 'field_13', monthlyIncome: null     },
      '7425': { annualIncome: 'field_12', jobType: 'field_13', monthlyIncome: null     }, // SI sent as field_2 (30–50L)
      '6740': { annualIncome: 'field_12', jobType: 'field_13', monthlyIncome: null     }, // SI sent as field_2 (30K–200K)
      '188':  { annualIncome: 'field_12', jobType: 'field_13', monthlyIncome: null     },
      '573':  { annualIncome: 'field_12', jobType: 'field_13', monthlyIncome: null     },
    };
    if (SECURE_PLANS.has(abacusId)) {
      const flds = SECURE_INCOME_FIELDS[abacusId] || {};
      // Use server-discovered IDs (from /addons parseFields) if available, else hardcoded
      // Use hardcoded confirmed field IDs only — NEVER trust incomeFieldIds from the
      // frontend, which may carry stale/wrong values from an old parseFields run.
      const afld = flds.annualIncome  || 'field_12';
      const jfld = flds.jobType       || 'field_13';
      const mfld = flds.monthlyIncome || null;

      if (annualIncome !== undefined && annualIncome !== '') {
        pairs.push([`PartnerPreviewForm[input][${afld}][field_value]`, String(annualIncome)]);
        console.log(`[Care] AnnualIncome → ${afld}=${annualIncome}`);
      }
      if (jobType !== undefined && jobType !== '') {
        pairs.push([`PartnerPreviewForm[input][${jfld}][field_value]`, jobType]);
        console.log(`[Care] JobType → ${jfld}=${jobType}`);
      }
      if (mfld && monthlyIncome !== undefined && monthlyIncome !== '') {
        pairs.push([`PartnerPreviewForm[input][${mfld}][field_value]`, String(monthlyIncome)]);
        console.log(`[Care] MonthlyIncome → ${mfld}=${monthlyIncome}`);
      }
    }

    // SI field (field_2) — three different behaviours:
    //   7425/6740 (MONTHLY_SI_PLANS): field_2 = Monthly Income — already sent above, skip here
    //   188 (→"300") / 573 (→"50"): single fixed pre-set SI value
    //   All others: user-selected sumInsured
    if (MONTHLY_SI_PLANS.has(abacusId)) {
      // Monthly Income was sent as field_2 in the income section — do NOT overwrite it
      console.log(`[Care] Monthly SI plan — skipping field_2 as SI (field_2 already set to Monthly Income)`);
    } else if (FIXED_SI[abacusId]) {
      pairs.push(['PartnerPreviewForm[input][field_2][field_value]', FIXED_SI[abacusId]]);
      console.log(`[Care] Fixed SI — field_2=${FIXED_SI[abacusId]}`);
    } else {
      pairs.push(['PartnerPreviewForm[input][field_2][field_value]', sumInsured]);
    }
    pairs.push(['PartnerPreviewForm[input][field_4][field_value]', '']);
    pairs.push(['PartnerPreviewForm[input][field_4][field_value]', tenure]);

    pairs.push(['PartnerPreviewForm[abacusId]',         abacusId]);
    pairs.push(['PartnerPreviewForm[partnerAbacusId]',  '3']);
    pairs.push(['PartnerPreviewForm[plan_id]',          planId]);

    pairs.push(['PartnerPreviewForm[output][outPutField][field_value][]', '']);
    pairs.push(['PartnerPreviewForm[output][outPutField][field_value][]', 'field_8']);
    pairs.push(['PartnerPreviewForm[selectedBasePremium]', '1']);
    pairs.push(['PartnerPreviewForm[premium_type]',        '']);
    pairs.push(['PartnerPreviewForm[premium_amount]',      '']);
    pairs.push(['PartnerPreviewForm[addonTags]',           '']);
    pairs.push(['PartnerPreviewForm[agentCode]',           '']);
    pairs.push(['PartnerPreviewForm[source]',              'GenericAbacus']);

    // ── Add-ons: accept raw field→boolean map from frontend ─────────────────
    // Frontend sends { 'field_WB': true, 'field_COPAY': false, ... }
    // Sub-option defaults for fields that require a value when checked. Each
    // one but field_CS genuinely offers two real choices on the live portal
    // (confirmed via /debug-fields) — subValues (below) lets the operator
    // actually pick one instead of always getting the first.
    const SUB_DEFAULTS = {
      'field_NCB': { subField: 'field_NCB_Value', value: 'CB Super'         },
      'field_OPD': { subField: 'field_OPD_Value', value: 'OPD'             },
      'field_IC':  { subField: 'field_IC_Value',  value: 'Instant Cover'    },
      'field_CS':  { subField: 'field_CS_Value',  value: 'Claim Shield Plus'}, // only one real option
      'field_43':  { subField: 'field_PED_TENURE',value: '1 Year'           },
    };

    if (addons && typeof addons === 'object' && Object.keys(addons).length > 0) {
      // Dynamic: frontend sent per-plan add-on state
      for (const [field, checked] of Object.entries(addons)) {
        pairs.push([`PartnerPreviewForm[extra][${field}][field_value]`, '0']);
        if (checked) {
          pairs.push([`PartnerPreviewForm[extra][${field}][field_value]`, 'checked']);
          if (SUB_DEFAULTS[field]) {
            const sub = SUB_DEFAULTS[field];
            const chosen = (subValues && subValues[sub.subField]) || sub.value;
            pairs.push([`PartnerPreviewForm[input][${sub.subField}][field_value]`, chosen]);
          }
        }
      }
    } else if (!SECURE_PLANS.has(abacusId)) {
      // Fallback Care Supreme add-on defaults — ONLY for non-Secure plans.
      // Secure plans (6384, 7424, 7425, 6740, 188, 573) have no add-on fields at all;
      // sending Care Supreme addon keys to them causes the portal to return HTTP 500.
      const defaults = [
        { field: 'field_WB',  checked: true  },
        { field: 'field_NCB', checked: true  },
        { field: 'field_OPD', checked: true  },
        { field: 'field_35',  checked: false },
        { field: 'field_BFB', checked: false },
        { field: 'field_AHC', checked: false },
      ];
      for (const a of defaults) {
        pairs.push([`PartnerPreviewForm[extra][${a.field}][field_value]`, '0']);
        if (a.checked) pairs.push([`PartnerPreviewForm[extra][${a.field}][field_value]`, 'checked']);
      }
      pairs.push(['PartnerPreviewForm[input][field_NCB_Value][field_value]', 'CB Super']);
      pairs.push(['PartnerPreviewForm[input][field_OPD_Value][field_value]', 'OPD']);
    }
    // Secure plans with no add-ons: send nothing extra

    // ── Plan-specific fields with no checkbox gate ───────────────────────────
    // Deductible sliders, OPD Sum Insured and (on some plans) PED Tenure are
    // required inputs the real form always shows for these plans — never
    // behind an add-on checkbox — so every one the catalogue lists for this
    // plan gets sent, using the caller's choice or that field's own default.
    // Confirmed per plan via /debug-fields; see care_plans.json's extraFields.
    const planExtraFields = (PLAN_BY_ID[abacusId] && PLAN_BY_ID[abacusId].extraFields) || [];
    const knownExtraFieldNames = new Set(planExtraFields.map(s => s.field));
    for (const spec of planExtraFields) {
      const value = extraFields[spec.field] || spec.default;
      pairs.push([`PartnerPreviewForm[input][${spec.field}][field_value]`, value]);
    }
    // Fields the current Plan Type/Business Type combo revealed dynamically
    // (e.g. Care Supreme's "PED" field, only shown for Senior Premium/Senior
    // Super — see /addons' dynamicExtraFields) aren't in the static catalogue
    // list above, so aren't caught by that loop. Send whatever the frontend
    // has rendered for them; there's no server-side default to fall back to
    // since these were only ever discovered per-request, not stored.
    for (const [field, value] of Object.entries(extraFields || {})) {
      if (knownExtraFieldNames.has(field) || !value) continue;
      pairs.push([`PartnerPreviewForm[input][${field}][field_value]`, value]);
    }

    const calcData = await postCalc(pairs, sess);
    const calcHtml = calcData.content || '';

    console.log('[Care] Response preview:', calcHtml.slice(0, 800).replace(/\s+/g, ' '));

    const result = parsePremium(calcHtml, sess);
    console.log(`[Care] ✓ disc=${result.discounted}  base=${result.original}  grand=${result.grandTotal}  pct=${result.discPct}`);

    if (!result.ok) {
      if (result.needsPincode || !pincode) {
        return res.status(422).json({ ok: false, error: 'Please enter a valid pincode to get premium.' });
      }
      // Log more of the response for debugging
      console.warn('[Care] No premium found. Full response snippet:');
      console.warn(calcHtml.slice(0, 2000).replace(/\s+/g, ' '));
      // Check for error messages in HTML
      const errMatch = calcHtml.match(/class="[^"]*(?:error|alert)[^"]*"[^>]*>([^<]{5,200})</i)
                    || calcHtml.match(/<div[^>]*>([^<]{10,200}(?:required|invalid|please|error)[^<]{0,100})<\/div>/i);
      const portalMsg = errMatch ? errMatch[1].trim() : null;
      console.warn('[Care] Portal message:', portalMsg || '(none detected)');

      return res.status(422).json({
        ok: false,
        error: 'No premium returned. Please try again.',
        portalMessage: portalMsg,
        hint: `Visit http://localhost:3005/debug-fields/${abacusId} to inspect field IDs for this plan.`,
      });
    }

    res.json({
      ok:                true,
      discountedPremium: result.discounted,
      basePremium:       result.original || result.discounted,
      grandTotal:        result.grandTotal || result.discounted,
      discountPct:       result.discPct,
    });

  } catch (err) {
    console.error('[Care] Error:', err.message);
    if (err.name === 'AbortError') {
      return res.status(504).json({ ok: false, error: 'Request timed out. Please try again.' });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
}

// ── /debug-fields/:id  — show ALL field IDs from the plan's init POST ─────────
// Usage: http://localhost:3005/debug-fields/6384
app.get('/debug-fields/:id', async (req, res) => {
  const abacusId = req.params.id;
  try {
    const pageRes   = await fetch(INIT_URL, { headers: { ...BASE_HEADERS, Accept: 'text/html,application/xhtml+xml' } });
    const setCookies = getRawSetCookies(pageRes);
    const pageHtml   = await pageRes.text();
    const csrf       = extractCSRF(pageHtml);
    const cookie     = mergeCookies('', setCookies);

    const initBody = buildBody([
      ['_csrf-frontend',                      csrf],
      ['assignedAbacus',                      abacusId],
      ['PartnerPreviewForm[partnerAbacusId]', '3'],
      ['PartnerPreviewForm[agentCode]',       ''],
      ['PartnerPreviewForm[source]',          'GenericAbacus'],
    ]);
    const initRes  = await fetch(CALC_URL, {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': cookie,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
      },
      body: initBody,
    });
    const initText = await initRes.text();
    let initJson = {};
    try { initJson = JSON.parse(initText); } catch {}
    const initHtml = initJson.content || initText;

    // Extract ALL PartnerPreviewForm[input] field names
    const allFields = {};
    const re = /name="PartnerPreviewForm\[input\]\[([^\]]+)\]\[field_value\]"([^>]*)/gi;
    let m;
    while ((m = re.exec(initHtml)) !== null) {
      const fieldName = m[1];
      const attrs     = m[2];
      const pos       = m.index;
      const ctx       = initHtml.slice(Math.max(0, pos - 300), pos + 200).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const valM  = attrs.match(/value="([^"]*)"/i);
      const typeM = attrs.match(/type="([^"]*)"/i);
      allFields[fieldName] = {
        type:    typeM?.[1] || 'select/text',
        value:   valM?.[1]  || '',
        context: ctx.trim().slice(0, 150),
      };
    }

    // Extract ALL radio values
    const radioRe = /name="PartnerPreviewForm\[input\]\[([^\]]+)\]\[field_value\]"\s+value="([^"]+)"/gi;
    while ((m = radioRe.exec(initHtml)) !== null) {
      const fieldName = m[1];
      if (!allFields[fieldName]) allFields[fieldName] = { type:'radio', values:[] };
      if (!allFields[fieldName].values) allFields[fieldName].values = [];
      if (!allFields[fieldName].values.includes(m[2])) allFields[fieldName].values.push(m[2]);
    }

    // Extract SELECT options for every field_XX select
    const selectOpts = {};
    const selRe = /name="PartnerPreviewForm\[input\]\[([^\]]+)\]\[field_value\]"[\s\S]{0,50}?>([\s\S]{0,3000}?)<\/select>/gi;
    while ((m = selRe.exec(initHtml)) !== null) {
      const fieldName = m[1];
      const block     = m[2];
      const opts      = [...block.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)</gi)]
                          .map(o => ({ value: o[1], label: o[2].trim() }));
      selectOpts[fieldName] = opts;
    }

    const fields  = parseFields(initHtml);
    const planIdM = initHtml.match(/name="PartnerPreviewForm\[plan_id\]"\s+value="([^"]+)"/);

    res.json({
      abacusId,
      planId:         planIdM?.[1] || null,
      parsedFields:   fields,
      allInputFields: allFields,
      selectOptions:  selectOpts,   // ← all SELECT field options
      htmlSnippet:    initHtml.slice(0, 8000).replace(/\s+/g, ' '),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Serve HTML ───────────────────────────────────────────────────────────────
app.get('/',              (req, res) => sendTemplated(res, path.join(__dirname, '..', 'public', 'calculators', 'care_index.html')));
// /unified served the 14 Jul hub. It is superseded by /hub, and its one
// unique feature (the print view) now lives there. Once unified.html is
// archived this redirects instead of 404-ing on an old bookmark.
app.get('/unified', (req, res) => {
  const legacy = path.join(__dirname, '..', 'public', 'hub', 'unified.html');
  if (require('fs').existsSync(legacy)) return res.sendFile(legacy);
  res.redirect('/hub');
});
app.get('/hub',           (req, res) => sendTemplated(res, path.join(__dirname, '..', 'public', 'hub', 'insurance_hub.html')));

// ═════════════════════════════════════════════════════════════════════════════
//  QUOTATION STORE — history, and saving to a folder of the operator's choosing
// ═════════════════════════════════════════════════════════════════════════════
// The hub kept every quote in memory only. A tab reload lost the lot, which is
// how 55 live quotes disappeared in one sitting. Quotations are now written
// here: one folder per quotation holding a snapshot (client, members, and every
// premium as quoted that day) plus the generated .xlsx and .pdf.
//
// Premiums age, so the snapshot is a record of what was quoted on a date, not a
// price list. Loading one back into the hub restores the rows for amendment; it
// does not re-price them.
const fsp   = require('fs').promises;
const fss   = require('fs');
const QROOT = path.join(__dirname, '..', 'quotations');
const QINDEX = path.join(QROOT, 'index.json');
const QCONF  = path.join(QROOT, 'config.json');

async function qEnsureRoot(){ await fsp.mkdir(QROOT, { recursive: true }); }

async function qReadIndex(){
  try { const raw = await fsp.readFile(QINDEX, 'utf8'); const j = JSON.parse(raw);
        return Array.isArray(j.quotations) ? j.quotations : []; }
  catch (e) { return []; }
}
async function qWriteIndex(list){
  await qEnsureRoot();
  await fsp.writeFile(QINDEX, JSON.stringify({ _comment:
    'Quotation history written by care_server.js. One entry per saved quotation; '
    + 'files live in the folder named by "dir". Premiums are a snapshot of the day '
    + 'they were quoted and do not update.', quotations: list }, null, 2));
}
async function qReadConfig(){
  try { return JSON.parse(await fsp.readFile(QCONF, 'utf8')); }
  catch (e) { return { destination: '' }; }
}
async function qWriteConfig(cfg){
  await qEnsureRoot();
  await fsp.writeFile(QCONF, JSON.stringify(cfg, null, 2));
}

// Filenames come from a client name typed by an operator, so they are rebuilt
// from scratch rather than sanitised: anything that is not a letter, digit,
// space, dash or underscore is dropped. That removes path separators, '..',
// drive letters, NUL and the Windows reserved characters in one pass.
function qSafeName(s, fallback){
  const out = String(s == null ? '' : s)
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return out || (fallback || 'Quotation');
}
// Windows refuses these as filenames regardless of extension.
const QRESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
function qSafeFileName(s, fallback){
  const n = qSafeName(s, fallback);
  return QRESERVED.test(n) ? '_' + n : n;
}

// A destination the operator typed. It must be an absolute path to a directory
// that already exists — this deliberately does NOT create arbitrary folders on
// the strength of an HTTP request, and does not accept a relative path, which
// would resolve against wherever node happens to have been started.
async function qCheckDestination(dir){
  const d = String(dir || '').trim();
  if (!d) return { ok:false, reason:'No folder given.' };
  if (!path.isAbsolute(d))
    return { ok:false, reason:'Give a full path, for example D:\\Quotations\\2026 — '
             + 'a relative path would land wherever the server was started from.' };
  let st;
  try { st = await fsp.stat(d); }
  catch (e) { return { ok:false, reason:'That folder does not exist. Create it first, '
                       + 'then check again.' }; }
  if (!st.isDirectory()) return { ok:false, reason:'That path is a file, not a folder.' };
  // Writability is checked by writing, not by reading permission bits, which
  // are unreliable on Windows shares.
  const probe = path.join(d, '.lnsel-write-test');
  try { await fsp.writeFile(probe, 'x'); await fsp.unlink(probe); }
  catch (e) { return { ok:false, reason:'That folder is not writable by the server ('
                       + e.code + ').' }; }
  return { ok:true, resolved: path.resolve(d) };
}

// ═════════════════════════════════════════════════════════════════════════════
//  LOGIN
// ═════════════════════════════════════════════════════════════════════════════
// The hub is a client-data screen: names, dates of birth and pincodes for
// everyone anyone has ever quoted. A password typed into the page would be
// readable in the source by whoever it was meant to keep out, so accounts live
// here instead.
//
// Passwords are stored as scrypt hashes with a per-user random salt, never in
// the code and never in plain text — including in this file, which is why there
// is no default account. On a fresh install nobody can log in and the login page
// offers a one-time setup screen to create the accounts.
const crypto  = require('crypto');
const QUSERS  = path.join(QROOT, 'users.json');
// Long-lived on purpose: signed in once, stays signed in until an explicit
// logout, rather than expiring on its own on a normal desk.
const SESSION_HOURS = 24 * 30;
const MAX_USERS = 25;

function authHash(password, salt){
  // 64 MiB / N=16384 keeps a brute-force attempt slow without making a login
  // feel sluggish on the office machines this runs on.
  return crypto.scryptSync(String(password), salt, 32,
    { N: 16384, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }).toString('hex');
}
function authNewSalt(){ return crypto.randomBytes(16).toString('hex'); }
// Comparison is constant-time: a plain === leaks how much of the hash matched
// through how long the comparison took.
function authSame(a, b){
  const x = Buffer.from(String(a), 'utf8'), y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// A recovery code is a second secret, generated for the person (never chosen
// by them) and shown exactly once. It is hashed the same way as a password —
// scrypt, per-user salt, never stored in plain text — so losing users.json
// doesn't hand out anyone's codes either. 80 bits is plenty against guessing
// even with no separate rate limit; the scrypt cost slows attempts the same
// way it already does for passwords.
function genRecoveryCode(){
  const hex = crypto.randomBytes(10).toString('hex').toUpperCase();
  return hex.match(/.{1,4}/g).join('-');
}

async function authReadUsers(){
  try { const j = JSON.parse(await fsp.readFile(QUSERS, 'utf8'));
        return Array.isArray(j.users) ? j.users : []; }
  catch (e) { return []; }
}
async function authWriteUsers(users){
  await qEnsureRoot();
  await fsp.writeFile(QUSERS, JSON.stringify({ _comment:
    'Login accounts for the Desteneer hub. Passwords are scrypt hashes with a '
    + 'per-user salt — the plain text is not stored and cannot be recovered. To '
    + 'reset everything, delete this file and reload the login page.',
    users }, null, 2), { mode: 0o600 });
}

// Sessions are persisted to quotations/sessions.json (same gitignored folder
// as users.json) so a server restart doesn't sign everyone out either — only
// an explicit logout, or the session actually expiring, does.
const QSESSIONS = path.join(QROOT, 'sessions.json');
function loadSessions(){
  try {
    const raw = JSON.parse(fss.readFileSync(QSESSIONS, 'utf8'));
    const now = Date.now();
    return Object.entries(raw).filter(([, s]) => s && s.expires > now);
  } catch (e) { return []; }
}
function saveSessions(){
  const obj = {};
  for (const [token, s] of SESSIONS) obj[token] = s;
  try {
    fss.mkdirSync(QROOT, { recursive: true });
    fss.writeFileSync(QSESSIONS, JSON.stringify(obj), { mode: 0o600 });
  } catch (e) { console.warn('[Care] Could not persist sessions:', e.message); }
}
const SESSIONS = new Map(loadSessions());          // token → { user, expires }
function authIssue(user){
  const token = crypto.randomBytes(24).toString('hex');
  SESSIONS.set(token, { user, expires: Date.now() + SESSION_HOURS * 3600e3 });
  saveSessions();
  return token;
}
function authWhois(req){
  const h = String(req.headers['authorization'] || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-hub-token'] || '');
  if (!token) return null;
  const s = SESSIONS.get(String(token));
  if (!s) return null;
  if (s.expires < Date.now()) { SESSIONS.delete(String(token)); return null; }
  return s.user;
}
// Applied to the quotation routes only. The calculator proxies are left open:
// they hold no stored client data, and gating them would break the four
// calculators' own standalone pages, which the operators use directly.
function authRequired(req, res, next){
  const u = authWhois(req);
  if (!u) return res.status(401).json({ error: 'Not signed in.', needsLogin: true });
  req.hubUser = u;
  next();
}

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'hub', 'login.html')));

// Does this install have accounts yet?
app.get('/auth/status', async (req, res) => {
  const users = await authReadUsers();
  res.json({ setupNeeded: users.length === 0, userCount: users.length,
             signedInAs: authWhois(req) || null,
             adminExists: users.some(u => u.isAdmin) });
});

// One-time setup. Refused once any account exists, so it cannot be used to add
// an account later or to overwrite the existing ones.
app.post('/auth/setup', async (req, res) => {
  const existing = await authReadUsers();
  if (existing.length)
    return res.status(409).json({ error: 'Accounts already exist. Delete quotations/users.json '
      + 'on the server to start over.' });
  const list = ((req.body || {}).users) || [];
  if (!Array.isArray(list) || !list.length)
    return res.status(400).json({ error: 'Give at least one username and password.' });
  if (list.length > MAX_USERS)
    return res.status(400).json({ error: 'At most ' + MAX_USERS + ' accounts.' });
  const seen = new Set(), users = [], created = [];
  for (const u of list) {
    const name = String((u && u.username) || '').trim();
    const pw   = String((u && u.password) || '');
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(name))
      return res.status(400).json({ error: 'Username "' + name + '" must be 3–32 characters, '
        + 'letters, digits, dot, dash or underscore.' });
    if (pw.length < 8)
      return res.status(400).json({ error: 'The password for ' + name + ' must be at least 8 characters.' });
    const key = name.toLowerCase();
    if (seen.has(key)) return res.status(400).json({ error: 'Duplicate username: ' + name });
    seen.add(key);
    const salt = authNewSalt();
    const recoverySalt = authNewSalt();
    const recoveryCode = genRecoveryCode();
    users.push({ username: name, salt, hash: authHash(pw, salt),
      recoverySalt, recoveryHash: authHash(recoveryCode, recoverySalt),
      isAdmin: !!(u && u.isAdmin), createdAt: new Date().toISOString() });
    created.push({ username: name, recoveryCode });
  }
  // Every install needs at least one admin so a lost recovery code has a way
  // back in — if the setup form didn't mark anyone, the first account becomes
  // admin rather than leaving nobody able to reset a teammate.
  if (!users.some(u => u.isAdmin)) users[0].isAdmin = true;
  await authWriteUsers(users);
  console.log('[Care] ' + users.length + ' hub account(s) created:', users.map(u => u.username).join(', '));
  res.json({ ok: true, created });
});

app.post('/auth/login', async (req, res) => {
  const b = req.body || {};
  const name = String(b.username || '').trim();
  const pw   = String(b.password || '');
  const users = await authReadUsers();
  if (!users.length) return res.status(409).json({ error: 'No accounts yet.', setupNeeded: true });
  const u = users.find(x => x.username.toLowerCase() === name.toLowerCase());
  // The same message either way: saying "no such user" tells anyone probing
  // which of the ten names are real.
  const FAIL = { error: 'Wrong username or password.' };
  if (!u) { authHash(pw, 'decoy-salt'); return res.status(401).json(FAIL); }
  if (!authSame(authHash(pw, u.salt), u.hash)) return res.status(401).json(FAIL);
  const token = authIssue(u.username);
  res.json({ ok: true, token, user: u.username, expiresInHours: SESSION_HOURS });
});

app.post('/auth/logout', (req, res) => {
  const h = String(req.headers['authorization'] || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-hub-token'] || '');
  if (token && SESSIONS.delete(String(token))) saveSessions();
  res.json({ ok: true });
});

app.get('/auth/me', async (req, res) => {
  const u = authWhois(req);
  if (!u) return res.status(401).json({ error: 'Not signed in.', needsLogin: true });
  const users = await authReadUsers();
  const me = users.find(x => x.username === u);
  res.json({ user: u, isAdmin: !!(me && me.isAdmin),
             adminExists: users.some(x => x.isAdmin) });
});

// Let a signed-in user change their own password.
app.post('/auth/password', authRequired, async (req, res) => {
  const b = req.body || {};
  const users = await authReadUsers();
  const u = users.find(x => x.username === req.hubUser);
  if (!u) return res.status(404).json({ error: 'Account not found.' });
  if (!authSame(authHash(String(b.current || ''), u.salt), u.hash))
    return res.status(401).json({ error: 'Current password is wrong.' });
  const next = String(b.next || '');
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  u.salt = authNewSalt(); u.hash = authHash(next, u.salt);
  u.passwordChangedAt = new Date().toISOString();
  await authWriteUsers(users);
  res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════════
//  PASSWORD / USERNAME RECOVERY
// ═════════════════════════════════════════════════════════════════════════════
// Two independent ways back in for someone locked out, since this install has
// no email to send a reset link to:
//  1. The recovery code shown once at account creation — /auth/forgot/verify
//     + /auth/forgot/reset. Looking it up by scanning every account (rather
//     than requiring a username first) means it also answers "what's my
//     username", which a forgotten-password person has often also forgotten.
//  2. An admin account resetting a teammate's password outright — the admin
//     still has to be signed in with their own credentials; this cannot be
//     used to set your own password without knowing it.

// Reset tokens are short-lived and single-use, kept in memory only (unlike
// SESSIONS, they are not worth persisting across a restart — a lost one just
// means asking for the code again).
const RESET_TOKENS = new Map();          // token → { username, expires }
const RESET_TOKEN_MINUTES = 15;

app.post('/auth/forgot/verify', async (req, res) => {
  const code = String((req.body || {}).recoveryCode || '').trim();
  const FAIL = { error: 'That recovery code was not recognised.' };
  if (!code) return res.status(400).json(FAIL);
  const users = await authReadUsers();
  const match = users.find(u => u.recoveryHash
    && authSame(authHash(code, u.recoverySalt), u.recoveryHash));
  if (!match) return res.status(401).json(FAIL);
  const token = crypto.randomBytes(24).toString('hex');
  RESET_TOKENS.set(token, { username: match.username, expires: Date.now() + RESET_TOKEN_MINUTES * 60e3 });
  res.json({ ok: true, username: match.username, resetToken: token });
});

app.post('/auth/forgot/reset', async (req, res) => {
  const b = req.body || {};
  const token = String(b.resetToken || '');
  const entry = RESET_TOKENS.get(token);
  if (!entry || entry.expires < Date.now()) {
    RESET_TOKENS.delete(token);
    return res.status(401).json({ error: 'That reset link has expired. Start over with your recovery code.' });
  }
  const next = String(b.newPassword || '');
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const users = await authReadUsers();
  const u = users.find(x => x.username === entry.username);
  if (!u) { RESET_TOKENS.delete(token); return res.status(404).json({ error: 'Account not found.' }); }
  u.salt = authNewSalt(); u.hash = authHash(next, u.salt);
  u.passwordChangedAt = new Date().toISOString();
  // The code just used is consumed and replaced — otherwise the same code
  // (or an intercepted copy of it) would keep working after the reset.
  const recoverySalt = authNewSalt();
  const newRecoveryCode = genRecoveryCode();
  u.recoverySalt = recoverySalt; u.recoveryHash = authHash(newRecoveryCode, recoverySalt);
  await authWriteUsers(users);
  RESET_TOKENS.delete(token);
  res.json({ ok: true, username: u.username, newRecoveryCode });
});

// Self-service: (re)generate my own recovery code. Also how an account
// created before this feature existed gets one for the first time.
app.post('/auth/recovery-code/regenerate', authRequired, async (req, res) => {
  const users = await authReadUsers();
  const u = users.find(x => x.username === req.hubUser);
  if (!u) return res.status(404).json({ error: 'Account not found.' });
  const recoverySalt = authNewSalt();
  const recoveryCode = genRecoveryCode();
  u.recoverySalt = recoverySalt; u.recoveryHash = authHash(recoveryCode, recoverySalt);
  await authWriteUsers(users);
  res.json({ ok: true, recoveryCode });
});

// Bootstraps installs whose users.json predates the admin flag: whoever signs
// in first can claim it, but only while genuinely nobody holds it yet — once
// any account is admin this always refuses, so it can't be used to escalate
// later (mirrors how /auth/setup refuses once accounts already exist).
app.post('/auth/claim-admin', authRequired, async (req, res) => {
  const users = await authReadUsers();
  if (users.some(u => u.isAdmin))
    return res.status(409).json({ error: 'This install already has an admin.' });
  const u = users.find(x => x.username === req.hubUser);
  if (!u) return res.status(404).json({ error: 'Account not found.' });
  u.isAdmin = true;
  await authWriteUsers(users);
  res.json({ ok: true });
});

function adminRequired(req, res, next){
  authReadUsers().then(users => {
    const me = users.find(x => x.username === req.hubUser);
    if (!me || !me.isAdmin) return res.status(403).json({ error: 'Admin only.' });
    next();
  }).catch(e => res.status(500).json({ error: e.message }));
}

app.get('/auth/admin/users', authRequired, adminRequired, async (req, res) => {
  const users = await authReadUsers();
  res.json({ users: users.map(u => ({ username: u.username, isAdmin: !!u.isAdmin, createdAt: u.createdAt })) });
});

// Resets a teammate's password without needing to know it. Does not touch
// their recovery code — once they can sign in again they can regenerate
// their own from the account panel.
app.post('/auth/admin/reset-password', authRequired, adminRequired, async (req, res) => {
  const b = req.body || {};
  const name = String(b.username || '').trim();
  const next = String(b.newPassword || '');
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const users = await authReadUsers();
  const u = users.find(x => x.username === name);
  if (!u) return res.status(404).json({ error: 'No such account.' });
  u.salt = authNewSalt(); u.hash = authHash(next, u.salt);
  u.passwordChangedAt = new Date().toISOString();
  u.passwordResetByAdmin = req.hubUser;
  await authWriteUsers(users);
  res.json({ ok: true });
});

// ── GET /quotations — the history list, newest first ─────────────────────────
app.get('/quotations', authRequired, async (req, res) => {
  try {
    const list = await qReadIndex();
    const cfg  = await qReadConfig();
    res.json({ quotations: list.slice().sort((a, b) =>
      String(b.savedAt || '').localeCompare(String(a.savedAt || ''))),
      destination: cfg.destination || '', root: QROOT });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /quotations/:id — one quotation, with its snapshot rows ──────────────
app.get('/quotations/:id', authRequired, async (req, res) => {
  try {
    const list = await qReadIndex();
    const meta = list.find(q => q.id === req.params.id);
    if (!meta) return res.status(404).json({ error: 'No such quotation.' });
    const p = path.join(QROOT, meta.dir, 'quotation.json');
    if (!fss.existsSync(p)) return res.status(404).json({ error: 'Snapshot file is missing.' });
    res.json(JSON.parse(await fsp.readFile(p, 'utf8')));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /quotations/:id/file/:kind — download the archived xlsx or pdf ───────
app.get('/quotations/:id/file/:kind', authRequired, async (req, res) => {
  try {
    const kind = req.params.kind === 'pdf' ? 'pdf' : 'xlsx';
    const list = await qReadIndex();
    const meta = list.find(q => q.id === req.params.id);
    if (!meta) return res.status(404).send('No such quotation.');
    const name = meta.files && meta.files[kind];
    if (!name) return res.status(404).send('No ' + kind + ' archived for this quotation.');
    const p = path.join(QROOT, meta.dir, name);
    if (!fss.existsSync(p)) return res.status(404).send('Archived file is missing from disk.');
    res.download(p, name);
  } catch (e) { res.status(500).send(e.message); }
});

// A quotation is identified by its content, not by when a file was written.
// The hub archives once when the Excel is generated and again for the PDF, which
// produced two history rows for one quotation — same client, same premiums, one
// file each. The fingerprint lets the second call merge into the first.
function qFingerprint(b){
  const canon = JSON.stringify({
    client: String(b.client || '').trim(),
    members: (b.members || []).map(m => [m.name, m.relation, m.dob, m.gender, m.ped, m.pin]),
    rows: (b.rows || []).map(r => [r.company, r.planName, r.planType, r.siKey,
                                   r.sumAssured, r.tenor, r.premium, r.addons, r.member])
                        .sort(),                     // row order must not matter
  });
  return require('crypto').createHash('sha1').update(canon).digest('hex').slice(0, 16);
}

// ── POST /quotations — archive a quotation, and copy it to the destination ───
// Body: { client, members, rows, sections, destination?, files: { xlsx?, pdf? } }
// where each file is { name, b64 }. Generating the Excel and then the PDF for the
// same quotation updates one entry rather than creating two.
app.post('/quotations', authRequired, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.rows || !Array.isArray(b.rows) || !b.rows.length)
      return res.status(400).json({ error: 'A quotation needs at least one row.' });

    await qEnsureRoot();
    const now   = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const client = qSafeName(b.client, 'Quotation');
    const fp     = qFingerprint(b);

    // Same content already archived? Add to it.
    const existingList = await qReadIndex();
    const prior = existingList.find(q => q.fingerprint === fp);
    const id    = prior ? prior.id  : stamp + '_' + client.replace(/ /g, '_');
    const dir   = prior ? prior.dir : id;
    const abs   = path.join(QROOT, dir);
    await fsp.mkdir(abs, { recursive: true });

    // The snapshot. Kept whole so a quotation can be reloaded into the hub.
    // On a merge the original savedAt stands: it is when the quotation was
    // produced, not when a second file happened to be exported from it.
    const snapshot = {
      id, savedAt: prior ? prior.savedAt : now.toISOString(),
      updatedAt: now.toISOString(), fingerprint: fp,
      client: b.client || client,
      createdBy: (prior && prior.createdBy) || req.hubUser || b.createdBy || '',
      members: b.members || [], rows: b.rows, memberTag: b.memberTag || {},
      memberGroups: b.memberGroups || [], header: b.header || {},
      _note: 'Premiums are as quoted on savedAt and do not update.',
    };
    await fsp.writeFile(path.join(abs, 'quotation.json'), JSON.stringify(snapshot, null, 2));

    // Files, if the hub sent them.
    const written = {}, copies = [];
    for (const kind of ['xlsx', 'pdf']) {
      const f = (b.files || {})[kind];
      if (!f || !f.b64) continue;
      const name = qSafeFileName(f.name && f.name.replace(/\.(xlsx|pdf)$/i, ''), client)
                 + '.' + kind;
      await fsp.writeFile(path.join(abs, name), Buffer.from(f.b64, 'base64'));
      written[kind] = name;
    }

    // Copy to the operator's folder. A failure here must not lose the archive,
    // so it is reported rather than thrown.
    let destNote = null;
    const wantDest = (b.destination || (await qReadConfig()).destination || '').trim();
    if (wantDest) {
      const chk = await qCheckDestination(wantDest);
      if (!chk.ok) destNote = chk.reason;
      else {
        for (const kind of Object.keys(written)) {
          try {
            const from = path.join(abs, written[kind]);
            const to   = path.join(chk.resolved, written[kind]);
            await fsp.copyFile(from, to);
            copies.push(to);
          } catch (e) { destNote = 'Could not write ' + kind + ' to the destination: ' + e.message; }
        }
      }
    }

    const insurers = [...new Set(b.rows.map(r => String(r.company || '')).filter(Boolean))];
    const bands    = [...new Set(b.rows.map(r => String(r.siKey || '')).filter(Boolean))];
    // Merging keeps whichever files already existed, so an entry accumulates its
    // Excel and its PDF instead of one entry appearing per export.
    const entry = {
      id, dir, fingerprint: fp,
      savedAt: snapshot.savedAt, updatedAt: snapshot.updatedAt,
      client: snapshot.client, createdBy: snapshot.createdBy,
      memberCount: (b.members || []).length,
      memberNames: (b.members || []).map(m => m.name).filter(Boolean),
      rowCount: b.rows.length, insurers, bands,
      files:   Object.assign({}, (prior && prior.files)   || {}, written),
      savedTo: [...new Set([...((prior && prior.savedTo) || []), ...copies])],
    };
    const list = await qReadIndex();
    const at = list.findIndex(q => q.fingerprint === fp);
    if (at === -1) list.push(entry); else list[at] = entry;
    await qWriteIndex(list);

    res.json({ ok:true, entry, merged: !!prior, destination: wantDest, destNote,
               archivedAt: abs, copiedTo: copies });
  } catch (e) {
    console.error('[Care] /quotations save failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /quotations/:id ───────────────────────────────────────────────────
// Removes the archive folder only. Copies already written to the operator's own
// destination are left alone — deleting a file from a folder they chose is not
// this endpoint's business.
app.delete('/quotations/:id', authRequired, async (req, res) => {
  try {
    const list = await qReadIndex();
    const i = list.findIndex(q => q.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'No such quotation.' });
    const meta = list[i];
    const abs  = path.join(QROOT, meta.dir);
    // Guard against an index entry whose dir has been tampered with.
    if (path.resolve(abs) !== path.join(QROOT, path.basename(meta.dir)))
      return res.status(400).json({ error: 'Refusing to delete outside the quotations folder.' });
    try { await fsp.rm(abs, { recursive: true, force: true }); } catch (e) {}
    list.splice(i, 1);
    await qWriteIndex(list);
    res.json({ ok:true, removed: meta.id, keptCopies: meta.savedTo || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Destination folder ───────────────────────────────────────────────────────
app.get('/save-destination', authRequired, async (req, res) => {
  const cfg = await qReadConfig();
  const out = { destination: cfg.destination || '' };
  if (out.destination) Object.assign(out, await qCheckDestination(out.destination));
  res.json(out);
});
app.post('/save-destination', authRequired, async (req, res) => {
  const dir = (req.body || {}).destination;
  if (dir === '') { await qWriteConfig({ destination: '' });
                    return res.json({ ok:true, destination:'', cleared:true }); }
  const chk = await qCheckDestination(dir);
  if (!chk.ok) return res.status(400).json({ ok:false, error: chk.reason });
  await qWriteConfig({ destination: chk.resolved });
  res.json({ ok:true, destination: chk.resolved });
});

// ── Serve the report's feature-comparison content ────────────────────────────
// insurance_hub.html fetches this with a relative URL, which resolves to
// /feature_comparison.json against this server. There was no route for it, so
// the fetch 404'd, FEATURE_DATA stayed null, and both the Excel and the PDF
// silently dropped their Feature Comparison section — no error anywhere.
app.get('/feature_comparison.json', (req, res) => {
  const p = path.join(__dirname, '..', 'data', 'feature_comparison.json');
  if (!require('fs').existsSync(p))
    return res.status(404).json({ error: 'feature_comparison.json not found in data/' });
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(p);
});

// Same reasoning as feature_comparison.json just above — insurance_hub.html's
// loadCareLiveFeatures() also fetches a relative URL, which needs its own
// explicit route rather than silently 404ing. See scripts/
// build_care_feature_mapping.js for how this file is generated; when it's
// missing, Care's column just falls back to the static feature_comparison.json
// entry rather than the request failing.
app.get('/care_features_mapped.json', (req, res) => {
  const p = path.join(__dirname, '..', 'data', 'care_features_mapped.json');
  if (!require('fs').existsSync(p))
    return res.status(404).json({ error: 'care_features_mapped.json not found in data/ — run scripts/build_care_feature_mapping.js' });
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(p);
});

// Same reasoning again — insurance_hub.html's loadNivaLiveFeatures() also
// needs an explicit route. See scripts/build_niva_feature_mapping.js.
app.get('/niva_features_mapped.json', (req, res) => {
  const p = path.join(__dirname, '..', 'data', 'niva_features_mapped.json');
  if (!require('fs').existsSync(p))
    return res.status(404).json({ error: 'niva_features_mapped.json not found in data/ — run scripts/build_niva_feature_mapping.js' });
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(p);
});

// Same reasoning again — insurance_hub.html's loadMcLiveFeatures() also
// needs an explicit route. See scripts/build_mc_feature_mapping.js.
app.get('/mc_features_mapped.json', (req, res) => {
  const p = path.join(__dirname, '..', 'data', 'mc_features_mapped.json');
  if (!require('fs').existsSync(p))
    return res.status(404).json({ error: 'mc_features_mapped.json not found in data/ — run scripts/build_mc_feature_mapping.js' });
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(p);
});

// Same reasoning again — insurance_hub.html's loadStarLiveFeatures() also
// needs an explicit route. See scripts/build_star_feature_mapping.js.
app.get('/star_features_mapped.json', (req, res) => {
  const p = path.join(__dirname, '..', 'data', 'star_features_mapped.json');
  if (!require('fs').existsSync(p))
    return res.status(404).json({ error: 'star_features_mapped.json not found in data/ — run scripts/build_star_feature_mapping.js' });
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(p);
});

// ── Serve ExcelJS from node_modules (avoids CDN dependency) ──────────────────
app.get('/exceljs.js', (req, res) => {
  const candidates = [
    path.join(__dirname, 'node_modules', 'exceljs', 'dist', 'es5', 'exceljs.browser.min.js'),
    path.join(__dirname, '..', 'node_modules', 'exceljs', 'dist', 'es5', 'exceljs.browser.min.js'),
  ];
  for (const p of candidates) {
    if (require('fs').existsSync(p)) {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(p);
    }
  }
  res.status(404).send('// ExcelJS not found in node_modules');
});

// ── Serve jsPDF the same way, for the PDF report ─────────────────────────────
app.get('/jspdf.js', (req, res) => {
  const candidates = [
    path.join(__dirname, 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js'),
    path.join(__dirname, '..', 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js'),
  ];
  for (const p of candidates) {
    if (require('fs').existsSync(p)) {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(p);
    }
  }
  res.status(404).send('// jsPDF not found in node_modules — run npm install');
});

// ── Start ─────────────────────────────────────────────────────────────────────
// Guarded so this file can also be require()'d as a router (see
// server/combined_server.js) without binding its own port.
if (require.main === module) {
  app.listen(PORT, '127.0.0.1', async () => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║  Care Health Premium Calculator — Server    ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log(`\n  Local:    http://localhost:${PORT}`);
    console.log(`  Debug:    http://localhost:${PORT}/debug`);
    console.log(`  Proxy:    https://${CARE_HOST}/religare`);
    console.log('\n  Open care_index.html in your browser to start.\n');
    // Warm-up only: proves the upstream is reachable at boot. The session it
    // returns is deliberately discarded — every request makes its own.
    try   { await initSession(); console.log('[Care] Upstream reachable.'); }
    catch (e) { console.warn('[Care] Startup check failed:', e.message, '— will retry on first request.'); }
  });
}
module.exports = app;

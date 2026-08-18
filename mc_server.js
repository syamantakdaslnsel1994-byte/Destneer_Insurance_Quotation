const express = require('express');
const https   = require('https');
const http    = require('http');
const cors    = require('cors');
const path    = require('path');
const crypto  = require('crypto');
const fs      = require('fs');

// ── Config from .env ──────────────────────────────────────────────
// Zero-dependency loader so no npm install is needed. Reads .env from this
// folder (and the parent) into process.env without overwriting anything the
// real environment already set. Lines are KEY=VALUE; # starts a comment.
(function loadEnv() {
  for (const p of [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')]) {
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
    break;   // first file found wins
  }
})();

function requireEnv(name, hint) {
  const v = process.env[name];
  if (!v) {
    console.error(`\n[config] Missing ${name}.`);
    console.error(`[config] ${hint}`);
    console.error(`[config] Copy .env.example to .env and fill it in, then restart.\n`);
    process.exit(1);
  }
  return v;
}

const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin':          'https://online.manipalcigna.com',
  'Referer':         'https://online.manipalcigna.com/',
};

// Single auth token used by all services (confirmed from bundle analysis).
// Value lives in .env — see .env.example. Decodes to a client_id:client_secret
// pair, so it is a real credential and must not be committed.
const AUTH_WKT = 'Basic ' + requireEnv('MC_AUTH_TOKEN',
  'ManipalCigna gateway credential (the base64 blob after "Basic ").');

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod    = parsed.protocol === 'https:' ? https : http;
    const opts   = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   options.method || 'GET',
      headers:  { ...BROWSER_HEADERS, ...(options.headers || {}) },
      timeout:  20000,
    };
    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const snippet = data.length > 200 ? data.substring(0, 200) + '...' : data;
        console.log(`[${opts.method}] ${url} → HTTP ${res.statusCode} (${data.length}b) | ${snippet}`);
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: null, rawBody: data });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out after 20s')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

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

const GATEWAY = process.env.MC_GATEWAY || 'https://online.gateway.manipalcigna.com';
// 16-byte AES-128-ECB key. Value lives in .env — see .env.example.
const AES_KEY = Buffer.from(requireEnv('MC_AES_KEY',
  'ManipalCigna payload encryption key (16 characters).'), 'utf8');
if (AES_KEY.length !== 16) {
  console.error(`\n[config] MC_AES_KEY must be exactly 16 bytes, got ${AES_KEY.length}.\n`);
  process.exit(1);
}

// ── Plan configuration ────────────────────────────────────────────
//
// viewPlansPath: overrides URL when set → /{viewPlansPath}/quote/viewPlans
//   null → old-API URL: /{service}/udaanapi/quoteservice/viewPlans
//
// encrypted: true → send { encodedString: AES_encrypted_payload }
//   false/absent → send plain JSON
//
const PLAN_CONFIG = {
  'lifetime-health': {
    name:    'Lifetime Health',
    service: 'sellonlineltappformservice',
    format:  'lifetime',
    siOptions: [5000000, 7500000, 10000000, 15000000, 20000000, 30000000],
    minSI: 5000000, maxSI: 30000000,
    minAge: 18, maxChildAge: 25,
    auth: null,
    viewPlansPath: null,
    encrypted:     true,            // real portal now sends encrypted payload
    product:       'Lifetime Health',
    product_code:  'LTIN02SBLF',    // CONFIRMED from payload decryption
  },
  'prohealth-prime': {
    name:    'ProHealth Prime',
    service: 'sellonlineprimequickquoteservice',
    format:  'prime',
    siOptions: [500000, 1000000, 1500000, 2000000, 3000000, 5000000, 7500000, 10000000, 15000000, 20000000, 30000000],
    minSI: 500000, maxSI: 30000000,
    minAge: 18, maxChildAge: 25,
    auth: 'wkt',
    viewPlansPath: null,            // CONFIRMED: uses old /udaanapi/ URL
    encrypted:     true,            // CONFIRMED: payload is encrypted
    product:       'Prohealth Prime', // CONFIRMED from payload decryption
    product_code:  'PR01SBLF',        // CONFIRMED from payload decryption
  },
  'sarvah': {
    name:    'Sarvah',
    service: 'sellonlineprohealthquickquoteservice',
    format:  'prime',
    siOptions: [500000, 1000000, 1500000, 2000000, 2500000, 3000000, 5000000, 7500000, 10000000, 15000000, 20000000],
    minSI: 500000, maxSI: 20000000,
    minAge: 18, maxChildAge: 25,
    auth: 'wkt',
    viewPlansPath: 'sarvahpolicyproposal',   // CONFIRMED
    encrypted:     true,
    product:       'ManipalCigna Sarvah',    // CONFIRMED
    product_code:  'PRAT03SBLF',             // CONFIRMED
  },
  'prime-senior': {
    name:    'Prime Senior',
    service: 'sellonlineseniorquickquoteservice',
    format:  'prime',
    siOptions: [500000, 1000000, 1500000, 2000000, 3000000, 5000000, 7500000, 10000000],
    minSI: 500000, maxSI: 10000000,
    minAge: 56, maxChildAge: 0,
    auth: 'wkt',
    viewPlansPath: null,
    encrypted:     false,           // CONFIRMED: still plain JSON
    product:       'Prime Senior',  // CONFIRMED from plain JSON payload
    product_code:  'ELIT01SB',      // CONFIRMED
  },
  'super-top-up': {
    name:    'Super Top Up',
    service: 'sellonlinestuquickquoteservice',
    format:  'stu',
    siOptions: [500000, 1000000, 2000000, 3000000, 5000000, 10000000, 15000000, 20000000, 25000000],
    minSI: 500000, maxSI: 25000000,
    minAge: 18, maxChildAge: 25,
    auth: 'wkt',
    viewPlansPath: null,            // CONFIRMED: uses old /udaanapi/ URL
    encrypted:     true,            // CONFIRMED: payload is encrypted
    product:       'Super Top Up',  // CONFIRMED from payload decryption
    product_code:  'SPLS03SBLF',    // CONFIRMED from payload decryption
  },
  'critical-illness': {
    name:    'Critical Illness',
    service: 'sellonlineccquickquoteservice',
    format:  'prime',
    siOptions: [1000000, 2000000, 3000000, 5000000, 10000000, 15000000, 20000000],
    minSI: 1000000, maxSI: 20000000,
    minAge: 18, maxChildAge: 0,
    auth: 'wkt',
    viewPlansPath: null,            // likely old /udaanapi/ URL — verify in DevTools
    encrypted:     true,            // likely encrypted — verify in DevTools
    product:       '',
    product_code:  '',
  },
  'personal-accident': {
    noZone: true,   // probe finding: these two 500 when preparedData.zone is present
    name:    'Personal Accident',
    service: 'sellonlinepaquickquoteservice',
    format:  'prime',
    siOptions: [500000, 1000000, 2000000, 3000000, 5000000, 10000000],
    minSI: 500000, maxSI: 10000000,
    minAge: 18, maxChildAge: 25,
    auth: 'wkt',
    viewPlansPath: null,            // likely old /udaanapi/ URL — verify in DevTools
    encrypted:     true,            // likely encrypted — verify in DevTools
    product:       '',
    product_code:  '',
  },
  'accident-shield': {
    noZone: true,   // probe finding: these two 500 when preparedData.zone is present
    name:    'Accident Shield',
    service: 'sellonlineasquickquoteservice',
    format:  'prime',
    siOptions: [200000, 500000, 1000000, 2000000, 3000000, 5000000],
    minSI: 200000, maxSI: 5000000,
    minAge: 18, maxChildAge: 25,
    auth: 'wkt',
    viewPlansPath: null,            // likely old /udaanapi/ URL — verify in DevTools
    encrypted:     true,            // likely encrypted — verify in DevTools
    product:       '',
    product_code:  '',
  },
};

// ── Crypto helpers ────────────────────────────────────────────────
function encryptECB(obj) {
  const plain  = JSON.stringify(obj);
  const cipher = crypto.createCipheriv('aes-128-ecb', AES_KEY, Buffer.alloc(0));
  cipher.setAutoPadding(true);
  return cipher.update(plain, 'utf8', 'base64') + cipher.final('base64');
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function cuid() {
  return 'c' + Math.random().toString(36).slice(2, 12) +
         Date.now().toString(36) +
         Math.random().toString(36).slice(2, 8);
}

function ageToDOB(age) {
  const now = new Date();
  const dd  = String(now.getDate()).padStart(2, '0');
  const mm  = String(now.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${now.getFullYear() - age}`;
}
function todayStr() {
  const n = new Date();
  return `${String(n.getDate()).padStart(2,'0')}/${String(n.getMonth()+1).padStart(2,'0')}/${n.getFullYear()}`;
}
function normalizeGender(g) {
  if (!g) return 'M';
  const u = g.toUpperCase();
  if (u === 'MALE'   || u === 'M') return 'M';
  if (u === 'FEMALE' || u === 'F') return 'F';
  return 'M';
}
function getCoverType(members) {
  // MC cover codes, verified from real Sarvah captures — keyed on TOTAL member count:
  //   1 → INDI, 2 → INFF (e.g. self+spouse), 3+ → INFI (e.g. self+parents / larger family).
  const n = (members || []).length;
  if (n <= 1)  return 'INDI';
  if (n === 2) return 'INFF';
  return 'INFI';
}

// ── Plan Type ─────────────────────────────────────────────────────
// The real quick-quote results page carries a "Plan Type" dropdown that the
// replica had no equivalent for. Its option values, read off the live page on
// 13 Aug 2026, are `individual` / `FamilyFloater` / `multiindividual`.
//
// Those are the *page's* vocabulary. The API takes the three-letter codes
// below. The evidence for each mapping differs and is worth being precise about:
//
//   individual      → INDI   Well supported. A one-member quote can only be
//                            individual, and INDI is what we already send for
//                            one member, with valid premiums coming back.
//   FamilyFloater   → INFF   Well supported. A real 2-adult Family Floater quote
//                            was captured from the portal, and INFF is what we
//                            already send for two members, again with valid
//                            premiums.
//   multiindividual → INFI   NOT VERIFIED. INFI is what we send for 3+ members,
//                            but a 3+ member quote on the portal may equally be
//                            a floater, so nothing establishes that INFI means
//                            "multi individual". Flagged in the UI.
//
// See docs_mc_live_capture_findings.md. Until the unverified one is confirmed
// against a real portal quote, treat a multi-individual premium as indicative.
const MC_COVER_CODE = {
  individual:      'INDI',
  FamilyFloater:   'INFF',
  multiindividual: 'INFI',
  // the codes themselves pass through, so an operator or a caller that already
  // speaks the API's vocabulary is not forced to translate
  INDI: 'INDI', INFF: 'INFF', INFI: 'INFI',
};
const MC_COVER_UNVERIFIED = { multiindividual: 1, INFI: 1 };

// 'YES' / 'NO' as the page spells it, 'Y' / 'N' as the payload wants it.
function mcResidentFlag(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().toUpperCase();
  if (s === 'NO'  || s === 'N' || s === 'FALSE') return 'N';
  if (s === 'YES' || s === 'Y' || s === 'TRUE')  return 'Y';
  return null;
}

// ── Lifetime Health payload (existing, confirmed working) ─────────
function buildLifetimePayload({ members, sumInsured, pincode, tenure, portability, frequency, zone, overrideCoverType, residentIndian }) {
  const adults   = members.filter(m => m.type === 'adult');
  const children = members.filter(m => m.type === 'child');
  const coverType = overrideCoverType || getCoverType(members);

  const details = members.map((m, i) => ({
    gender:               normalizeGender(m.gender),
    dob:                  ageToDOB(m.age),
    adult:                m.type === 'adult' ? 'A' : 'C',
    infertilityTreatment: 'N',
    maternityBenefit:     'N',
    oocyteBenefit:        'N',
    surrogacyBenefit:     'N',
    partyId:              i + 1,
    paFlag:               'N',
    paOption:             '',
    paSumInsured:         '',
  }));

  return {
    preparedData: {
      coverType,
      sumInsured:                 String(sumInsured),
      sumInsured2:                String(sumInsured),
      pinCode:                    String(pincode),
      zone,
      allInsuredAreResidentIndian: residentIndian || 'Y',
      areaOfCover:                null,
      createDate:                 todayStr(),
      majorIllnessCover:          'ALL',
      coverTypeInfo: { adultCount: adults.length, peopleCount: members.length, childCount: children.length, details },
    },
    leadId:              cuid(),
    isSingleProduct:     'N',
    paymentMode:         '',
    emailAddress:        '',
    mobileNumber:        '',
    isWorkSite:          'N',
    suggestionSet:       'Set0',
    variant:             '',
    tenure:              String(tenure),
    deductable:          '0',
    isEmployee:          'N',
    worldZone:           'WORLDZONE1',
    renewalDiscount:     'N',
    channelId:           '',
    parentAgencyId:      '',
    portability:         portability ? 'Y' : 'N',
    posp:                'N',
    sourceType:          'NB',
    globalIllCoverage:   'All',
    healthPlus:          'N',
    globalPlus:          'N',
    ciRider:             'N',
    ciRiderSA:           null,
    opdRider:            'N',
    opdRiderPackage:     null,
    opdRiderSA:          null,
    advanceAddOn:        'N',
    shield:              'N',
    womensPlus:          'N',
    inputMode:           '5',
    isMchiCustomer:      'N',
    isDirectPolicy:      'N',
    socialMedia:         'N',
    waiverOfDeductible:  'N',
    cbb:                 'Y',
    infertilityTreatment:'N',
    loyaltyDiscount:     'N',
    maternityBenefit:    'N',
    pedPolicyTerm:       0,
    pedReduction:        'N',
    surrogacyBenefit:    'N',
    oocyteBenefit:       'N',
    worksiteDiscount:    'N',
    worldwideEmergency:  'Y',
    worldwideEmergencySA:'2500000',
    isZoneUpgrade:       'N',
    agentId:             '',
    agentName:           '',
    businessFor:         '',
    skip:                false,
    agentMobileNum:      '',
    agentEmailId:        '',
    branchId:            '',
    employeeCodeOrSpCode:'',
    employeeNameOrSpName:'',
    parentagencyname:    '',
    mappedirdalocation:  '',
    businesscreditchannel:'',
    pan:                 '',
    flowType:            'advisor',
    refA:                '',
    refB:                '',
    refC:                '',
    mode:                'all',
    product:             'Lifetime Health',
    product_code:        'LTIN02SBLF',
    quickQuoteId:        uuid(),
    medium:              '',
    source:              '',
    campaign:            '',
    applicationNo:       '',
    custAuthFlag:        '',
    frequency,
  };
}

// ── Prime Senior payload — reverse-engineered from real F12 DevTools capture ──
// Plain JSON (no encryption). Field list confirmed from real portal capture.
function buildPrimePayload({ members, sumInsured, pincode, tenure, portability, zone, deductible = 0, product = '', product_code = '', overrideCoverType, residentIndian }) {
  const adults   = members.filter(m => m.type === 'adult');
  const children = members.filter(m => m.type === 'child');

  // Cover code by member count: 1→INDI, 2→INFF, 3+→INFI
  const coverType = overrideCoverType || getCoverType(members);

  const details = members.map(m => ({
    gender:    normalizeGender(m.gender),
    dob:       ageToDOB(m.age),
    adult:     m.type === 'adult' ? 'A' : 'C',
    uwLoading: null,
  }));

  const pd = { adultCount: adults.length, peopleCount: members.length, details };
  if (children.length > 0) pd.childCount = children.length;

  return {
    preparedData: {
      coverType,
      sumInsured:                  String(sumInsured),
      pinCode:                     String(pincode),
      zone,
      allInsuredAreResidentIndian: residentIndian || 'Y',
      createDate:                  todayStr(),
      coverTypeInfo:               pd,
    },
    leadId:               cuid(),
    isSingleProduct:      'N',
    paymentMode:          '',
    emailAddress:         '',
    mobileNumber:         '',
    isWorkSite:           'N',
    suggestionSet:        'Set0',
    variant:              '',
    tenure:               String(tenure),
    frequency:            'single',
    deductable:           deductible > 0 ? String(deductible) : '0',
    isEmployee:           'N',
    worldZone:            'WORLDZONE1',
    renewalDiscount:      'N',
    channelId:            '',
    parentAgencyId:       '',
    portability:          portability ? 'Y' : 'N',
    posp:                 'N',
    sourceType:           'NB',
    coPayment:            '999',
    opdRider:             'N',
    opdRiderPackage:      null,
    opdRiderSA:           null,
    pedReduction:         'N',
    inputMode:            '5',
    isMchiCustomer:       'N',
    isDirectPolicy:       'N',
    socialMedia:          'N',
    isZoneUpgrade:        false,
    agentId:              '',
    agentName:            '',
    businessFor:          '',
    skip:                 false,
    agentMobileNum:       '',
    agentEmailId:         '',
    branchId:             '',
    employeeCodeOrSpCode: '',
    employeeNameOrSpName: '',
    parentagencyname:     '',
    mappedirdalocation:   '',
    businesscreditchannel:'',
    pan:                  '',
    flowType:             'advisor',
    refA:                 '',
    refB:                 '',
    refC:                 '',
    shield:               'N',
    roomUpgrade:          'N',
    restorationOfSA:      'N',
    standingInstruction:  'N',
    premiumManagement:    'N',
    mode:                 'all',
    product,
    product_code,
    quickQuoteId:         '',
    applicationNo:        '',
    custAuthFlag:         '',
    campaign:             '',
  };
}

// ── Old-URL encrypted payload — reverse-engineered from real ProHealth Prime DevTools capture ──
// Used by ProHealth Prime, Super Top Up, Critical Illness, Personal Accident, Accident Shield
// Key differences from Sarvah: simpler details, different optional fields, boolean isZoneUpgrade
function buildPrimeEncryptedPayload({ members, sumInsured, pincode, tenure, portability, zone, deductible = 0, product = '', product_code = '', overrideCoverType, residentIndian }) {
  const adults   = members.filter(m => m.type === 'adult');
  const children = members.filter(m => m.type === 'child');

  // Cover code by member count: 1→INDI, 2→INFF, 3+→INFI (verified from real captures)
  const coverType = overrideCoverType || getCoverType(members);

  // Real payload: details has only gender, dob, adult — no partyId/relationship/etc.
  const details = members.map(m => ({
    gender: normalizeGender(m.gender),
    dob:    ageToDOB(m.age),
    adult:  m.type === 'adult' ? 'A' : 'C',
  }));

  const pd = { adultCount: adults.length, peopleCount: members.length, details };
  if (children.length > 0) pd.childCount = children.length;

  return {
    preparedData: {
      coverType,
      sumInsured:                  String(sumInsured),
      pinCode:                     String(pincode),
      zone,
      allInsuredAreResidentIndian: residentIndian || 'Y',
      createDate:                  todayStr(),
      coverTypeInfo:               pd,
    },
    leadId:               cuid(),
    isSingleProduct:      'N',
    paymentMode:          '',
    emailAddress:         '',
    mobileNumber:         '',
    isWorkSite:           'N',
    suggestionSet:        'Set0',
    variant:              '',
    tenure:               String(tenure),
    frequency:            'SINGLE',           // uppercase (confirmed from real payload)
    deductable:           deductible > 0 ? String(deductible) : '0',
    deductableType:       '',
    isEmployee:           'N',
    renewalDiscount:      'N',
    channelId:            '',
    parentAgencyId:       '',
    portability:          portability ? 'Y' : 'N',
    posp:                 'N',
    sourceType:           'NB',
    // Optional riders — all null for base quote (confirmed from real payload)
    healthCheckUp:        null,
    ciRider:              null,
    nonMedicalCover:      null,
    opdSA:                null,
    optionalPackage:      null,
    personalAccident:     null,
    bonusBooster:         null,
    iftcRider:            null,
    inputMode:            '5',
    isMchiCustomer:       'N',
    waiverCoPay:          null,
    waiverSubLimit:       null,
    worldWideCover:       null,
    isZoneUpgrade:        false,              // boolean (not string 'N') — confirmed
    agentId:              '',
    agentName:            '',
    businessFor:          '',
    skip:                 false,
    agentMobileNum:       '',
    agentEmailId:         '',
    branchId:             '',
    employeeCodeOrSpCode: '',
    employeeNameOrSpName: '',
    parentagencyname:     '',
    mappedirdalocation:   '',
    businesscreditchannel:'',
    pan:                  '',
    flowType:             'advisor',
    refA:                 '',
    refB:                 '',
    refC:                 '',
    roomRentModification: null,
    roomType:             'ANYROOM',
    supremeBonus:         null,
    surplusBenefit:       null,
    prmManagementCover:   null,
    womenCare:            null,
    mode:                 'all',
    product,
    product_code,
    quickQuoteId:         null,               // null (not uuid) — confirmed
    medium:               '',
    source:               '',
    campaign:             '',
    applicationNo:        '',
    custAuthFlag:         '',
  };
}

// ── Super Top Up payload — reverse-engineered from real STU DevTools capture ──
// Key differences: majorIllnessCover, worldZone, STU-specific riders, authorizationFlag,
//   deductable = base threshold (not 0), frequency lowercase, no roomType/womenCare etc.
function buildSTUPayload({ members, sumInsured, pincode, tenure, portability, zone, deductible = 500000, product = '', product_code = '', overrideCoverType, residentIndian }) {
  const adults   = members.filter(m => m.type === 'adult');
  const children = members.filter(m => m.type === 'child');

  const coverType = overrideCoverType || getCoverType(members);  // fallback: 1→INDI, 2→INFF, 3+→INFI

  const details = members.map(m => ({
    gender: normalizeGender(m.gender),
    dob:    ageToDOB(m.age),
    adult:  m.type === 'adult' ? 'A' : 'C',
  }));

  const pd = { adultCount: adults.length, peopleCount: members.length, details };
  if (children.length > 0) pd.childCount = children.length;

  return {
    preparedData: {
      coverType,
      sumInsured:                  String(sumInsured),
      pinCode:                     String(pincode),
      zone,
      allInsuredAreResidentIndian: residentIndian || 'Y',
      areaOfCover:                 null,
      createDate:                  todayStr(),
      majorIllnessCover:           'ALL',   // STU-specific (top-up covers all illnesses)
      coverTypeInfo:               pd,
    },
    leadId:               cuid(),
    isSingleProduct:      'N',
    paymentMode:          'single',
    emailAddress:         '',
    mobileNumber:         '',
    isWorkSite:           'N',
    suggestionSet:        'Set0',
    variant:              '',
    tenure:               String(tenure),
    deductable:           String(deductible), // base coverage threshold (NOT zero)
    isEmployee:           'N',
    worldZone:            'WORLDZONE1',       // present in STU, absent in ProHealth Prime
    renewalDiscount:      'N',
    channelId:            '',
    parentAgencyId:       '',
    portability:          portability ? 'Y' : 'N',
    posp:                 'N',
    sourceType:           'NB',
    ciRider:              'N',
    opdRider:             'N',
    opdRiderPackage:      null,
    opdRiderSA:           null,
    inputMode:            '5',
    isMchiCustomer:       'N',
    isDirectPolicy:       'N',
    socialMedia:          'N',
    guarContinuityDc:     'N',              // STU-specific
    pedReduction:         'N',              // STU-specific
    isZoneUpgrade:        false,
    agentId:              '',
    agentName:            '',
    businessFor:          '',
    skip:                 false,
    authorizationFlag:    false,            // STU-specific
    agentMobileNum:       '',
    agentEmailId:         '',
    branchId:             '',
    employeeCodeOrSpCode: '',
    employeeNameOrSpName: '',
    parentagencyname:     '',
    mappedirdalocation:   '',
    businesscreditchannel:'',
    pan:                  '',
    flowType:             'advisor',
    refA:                 '',
    refB:                 '',
    refC:                 '',
    mode:                 'all',
    product,
    product_code,
    quickQuoteId:         null,
    applicationNo:        '',
    custAuthFlag:         '',
    frequency:            'single',         // lowercase (unlike ProHealth Prime's 'SINGLE')
  };
}

// ── New-API payload — reverse-engineered from real Sarvah DevTools capture ───
// Used by all plans with cfg.viewPlansPath set (encrypted API)
function buildNewApiPayload({ members, sumInsured, pincode, tenure, portability, zone, deductible = 0, product = '', product_code = '', overrideCoverType, residentIndian }) {
  const adults   = members.filter(m => m.type === 'adult');
  const children = members.filter(m => m.type === 'child');

  // Cover code by member count, verified from real Sarvah captures:
  //   1 → INDI, 2 → INFF (self+spouse), 3+ → INFI (self+parents / larger family).
  const coverType = overrideCoverType || getCoverType(members);

  let adultCount = 0;
  const details = members.map((m, i) => {
    const isAdult = m.type === 'adult';
    let relationship;
    if (m.relation) {
      // Relationship explicitly chosen in the calculator / sent from the hub
      relationship = String(m.relation).toUpperCase();
      if (isAdult) adultCount++;
    } else if (isAdult) {
      relationship = adultCount++ === 0 ? 'SELF' : 'SPOUSE';
    } else {
      relationship = normalizeGender(m.gender) === 'F' ? 'DAUGHTER' : 'SON';
    }

    return {
      gender:              normalizeGender(m.gender),
      dob:                 ageToDOB(m.age),
      adult:               isAdult ? 'A' : 'C',
      partyId:             i + 1,
      insuredIncome:       isAdult ? 0 : '',
      insuredRelationShip: relationship,
      paFlag:              'N',
      ttdFlag:             'N',
      meFlag:              'N',
      ttdPayout:           '0',
      sumInsured:          String(sumInsured),
      uwLoading:           '0',
      isEarning:           'N',
      insuredCategory:     isAdult ? 'A' : 'C',
      paSumInsured:        '0',
    };
  });

  const pd = { adultCount: adults.length, peopleCount: members.length, details };
  if (children.length > 0) pd.childCount = children.length;

  return {
    preparedData: {
      coverType,
      sumInsured:                  String(sumInsured),
      pinCode:                     String(pincode),
      zone,
      allInsuredAreResidentIndian: residentIndian || 'Y',
      createDate:                  todayStr(),
      coverTypeInfo:               pd,
    },
    leadId:               cuid(),
    isSingleProduct:      'N',
    paymentMode:          '',
    isWorkSite:           'N',
    suggestionSet:        'Set0',
    variant:              '',
    tenure:               String(tenure),
    deductable:           deductible > 0 ? String(deductible) : '0',
    isEmployee:           'N',
    worldZone:            'WORLDZONE1',
    renewalDiscount:      'N',
    channelId:            '',
    parentAgencyId:       '',
    portability:          portability ? 'Y' : 'N',
    posp:                 'N',
    sourceType:           'NB',
    inputMode:            '5',
    isMchiCustomer:       'N',
    isDirectPolicy:       'N',
    socialMedia:          'N',
    isZoneUpgrade:        'N',
    agentId:              '',
    agentName:            '',
    businessFor:          '',
    skip:                 false,
    agentMobileNum:       '',
    agentEmailId:         '',
    branchId:             '',
    employeeCodeOrSpCode: '',
    employeeNameOrSpName: '',
    parentagencyname:     '',
    mappedirdalocation:   '',
    businesscreditchannel:'',
    pan:                  '',
    flowType:             'advisor',
    refA:                 '',
    refB:                 '',
    refC:                 '',
    // Add-on flags (all off for base quote)
    accidentalCover:      'N',
    healthCheckUp:        'N',
    airAmbulance:         'N',
    restorationOfSI:      'N',
    gcb:                  'N',
    instantCover:         'N',
    rrmFlag:              'N',
    rrmType:              '',
    surplusBenefit:       'N',
    deductibleOption:     '',
    deductibleSI:         '10000',
    vcopay:               '',
    nmeDMECover:          'N',
    unlimitedSI:          'N',
    commercialDiscount:   '0',
    onlineDiscount:       '',
    doj:                  '',
    earlyRenewalDiscount: 'N',
    policyAnniversayDisc: 'N',
    isWebSiteDisc:        'N',
    opdFlag:              'N',
    pratiksha:            'N',
    specificDisease:      'N',
    shaktiBenefit:        '0',
    mode:                 'all',
    product,
    product_code,
    quickQuoteId:         uuid(),
    medium:               '',
    source:               '',
    campaign:             '',
    applicationNo:        '',
    custAuthFlag:         '',
    frequency:            'single',
  };
}

// ── Serve frontends ───────────────────────────────────────────────
// mc_index.html is the orphaned single-plan replica — every hub embeds
// /multi. Serve it while it exists, redirect once it is archived.
app.get('/', (req, res) => {
  const legacy = path.join(__dirname, 'mc_index.html');
  if (fs.existsSync(legacy)) return res.sendFile(legacy);
  res.redirect('/multi');
});
app.get('/multi',   (req, res) => res.sendFile(path.join(__dirname, 'mc_multi.html')));

// ── GET /api/location/:pincode ────────────────────────────────────
app.get('/api/location/:pincode', async (req, res) => {
  try {
    const url    = `${GATEWAY}/sellonline/v1/location-details/${req.params.pincode}/app/lifetime`;
    const result = await request(url);
    res.json(result.body);
  } catch (err) {
    console.error('/api/location error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/plans — return plan config for frontend ─────────────
app.get('/api/plans', (req, res) => {
  const plans = Object.entries(PLAN_CONFIG).map(([id, cfg]) => ({
    id,
    name:      cfg.name,
    siOptions: cfg.siOptions,
    minSI:     cfg.minSI,
    maxSI:     cfg.maxSI,
    minAge:    cfg.minAge,
    maxChildAge: cfg.maxChildAge,
  }));
  res.json({ plans });
});

// ── POST /api/premium — Lifetime Health (existing route) ──────────
app.post('/api/premium', async (req, res) => {
  await handlePremiumRequest(req, res, 'lifetime-health');
});

// ── POST /api/premium/:planId — any plan ─────────────────────────
app.post('/api/premium/:planId', async (req, res) => {
  await handlePremiumRequest(req, res, req.params.planId);
});

async function handlePremiumRequest(req, res, planId) {
  try {
    const cfg = PLAN_CONFIG[planId];
    if (!cfg) return res.status(400).json({ error: `Unknown plan: ${planId}` });

    const {
      members     = [],
      sumInsured  = cfg.siOptions[0],
      pincode     = '400001',
      tenure      = '1',
      portability = false,
      frequency   = 'single',
      planType    = null,
      residentIndian = null,
      deductible  = 0,
      addons      = {},    // { fieldKey: true } — add-on flags to overlay on payload
    } = req.body || {};

    // Validate
    const adults = members.filter(m => m.type === 'adult');
    if (adults.length === 0) return res.json({ error: 'At least one adult member is required.' });
    for (const m of members) {
      if (!m.age || isNaN(m.age) || m.age < 1 || m.age > 99)
        return res.json({ error: `Invalid age "${m.age}". Enter ages between 1 and 99.` });
    }
    const pin = String(pincode).trim();
    if (!/^\d{6}$/.test(pin)) return res.json({ error: 'Enter a valid 6-digit pincode.' });
    if (!cfg.siOptions.includes(Number(sumInsured)))
      return res.json({ error: `Invalid Sum Insured for ${cfg.name}.` });
    if (planId === 'prime-senior') {
      const youngAdult = adults.find(m => Number(m.age) < 56);
      if (youngAdult) return res.json({ error: 'Prime Senior requires all adults to be 56+ years.' });
    }

    // Zone lookup — use plan-specific app name; add auth for wkt plans
    const zoneApp    = planId === 'prime-senior' ? 'senior' : 'lifetime';
    const locUrl     = `${GATEWAY}/sellonline/v1/location-details/${pin}/app/${zoneApp}`;
    const zoneAuthTk = cfg.auth === 'wpt' ? AUTH_WPT : cfg.auth === 'wkt' ? AUTH_WKT : null;
    const locHdrs    = zoneAuthTk ? { headers: { 'Authorization': zoneAuthTk } } : {};
    const locResult  = await request(locUrl, locHdrs);
    const zone      = locResult.body?.response?.zonecd || 'ZONE1';
    console.log(`[${planId}] Zone: ${zone} | SI: ${sumInsured} | Members: ${members.length}`);

    // Cover type. Resolved once, for every plan format — it used to be honoured
    // only inside the `lifetime` branch, so on Sarvah, ProHealth Prime, Prime
    // Senior and Super Top Up the caller's choice was silently discarded and the
    // member count decided instead.
    const overrideCoverType = planType ? (MC_COVER_CODE[planType] || null) : null;
    const coverTypeUnverified = !!(planType && MC_COVER_UNVERIFIED[planType]);
    if (planType && !overrideCoverType)
      console.warn(`[${planId}] Unrecognised planType "${planType}" — falling back to the member count.`);
    const resident = mcResidentFlag(residentIndian);

    // Build payload
    const shouldEncrypt = cfg.viewPlansPath || cfg.encrypted;
    const common = { members, sumInsured, pincode: pin, tenure, portability, zone,
                     overrideCoverType, residentIndian: resident };
    let payload;
    if (cfg.format === 'lifetime') {
      payload = buildLifetimePayload({ ...common, frequency });
    } else if (cfg.format === 'stu') {
      // Super Top Up: old URL + encrypted, unique field set (majorIllnessCover, authorizationFlag etc.)
      payload = buildSTUPayload({ ...common, deductible: Number(deductible) || cfg.siOptions[0],
                                  product: cfg.product || '', product_code: cfg.product_code || '' });
    } else if (cfg.viewPlansPath) {
      // New URL plans (Sarvah) — complex detail structure with partyId/relationships
      payload = buildNewApiPayload({ ...common, deductible: Number(deductible),
                                     product: cfg.product || '', product_code: cfg.product_code || '' });
    } else if (cfg.encrypted) {
      // Old URL + encrypted (ProHealth Prime, CI, PA, AS) — simpler detail structure
      payload = buildPrimeEncryptedPayload({ ...common, deductible: Number(deductible),
                                             product: cfg.product || '', product_code: cfg.product_code || '' });
    } else {
      // Prime Senior only: old /udaanapi/ URL with plain JSON
      payload = buildPrimePayload({ ...common, deductible: Number(deductible),
                                    product: cfg.product || '', product_code: cfg.product_code || '' });
    }

    // Personal Accident and Accident Shield reject a payload that carries a
    // zone — mc_probe2.js recorded this ("adding zone causes 500, removing it
    // gives 200") and the finding was never shipped. Opt in per plan via
    // `noZone` so the behaviour is visible in PLAN_CONFIG rather than hidden.
    if (cfg.noZone && payload && payload.preparedData) {
      delete payload.preparedData.zone;
      console.log(`[${planId}] zone omitted from preparedData (cfg.noZone)`);
    }

    // Overlay selected add-ons onto payload.
    // IMPORTANT: only toggle genuine Y/N flags (current value 'N' or 'Y'). Value-type fields
    // like deductibleOption (''), vcopay (''), shaktiBenefit ('0'), deductibleSI ('10000')
    // must NOT be forced to 'Y' — doing so makes MC reject the quote (Status:Fail, empty cards).
    // These are reported back to the client in json.addOnReport (see below) so the
    // UI can state what was actually priced rather than what the operator ticked.
    const addOnApplied = [], addOnSkipped = [];
    if (addons && typeof addons === 'object') {
      const skippedNonBool = [], skippedMissing = [];
      for (const [field, enabled] of Object.entries(addons)) {
        if (!enabled) continue;
        if (!Object.prototype.hasOwnProperty.call(payload, field)) {
          skippedMissing.push(field);
          addOnSkipped.push({ field, reason: 'not a field on this plan’s payload' });
          continue;
        }
        const cur = payload[field];
        if (cur === 'N' || cur === 'Y') { payload[field] = 'Y'; addOnApplied.push(field); }
        else {
          skippedNonBool.push(`${field}(=${JSON.stringify(cur)})`);
          addOnSkipped.push({
            field,
            reason: cur === null
              ? 'rider is not toggleable on this plan (sent as null)'
              : `needs a value, not an on/off flag (currently ${JSON.stringify(cur)})`
          });
        }
      }
      if (addOnApplied.length)   console.log(`[${planId}] Add-ons APPLIED: ${addOnApplied.join(', ')}`);
      if (skippedNonBool.length) console.log(`[${planId}] Add-ons SKIPPED (value-type field, not a toggle): ${skippedNonBool.join(', ')}`);
      if (skippedMissing.length) console.log(`[${planId}] Add-ons NOT in payload (name/field mismatch): ${skippedMissing.join(', ')}`);
    }

    // URL: new-path plans use /{viewPlansPath}/quote/viewPlans, others use /{service}/udaanapi/quoteservice/viewPlans
    const viewsUrl = cfg.viewPlansPath
      ? `${GATEWAY}/${cfg.viewPlansPath}/quote/viewPlans`
      : `${GATEWAY}/${cfg.service}/udaanapi/quoteservice/viewPlans`;

    let reqBody;
    if (shouldEncrypt) {
      const encryptedStr = encryptECB(payload);
      reqBody = JSON.stringify({ encodedString: encryptedStr });
      console.log(`[${planId}] Using ${cfg.viewPlansPath ? 'NEW-PATH' : 'OLD-PATH'} + ENCRYPTED → ${viewsUrl}`);
    } else {
      reqBody = JSON.stringify(payload);
      console.log(`[${planId}] Using OLD-PATH + plain JSON → ${viewsUrl}`);
    }

    const authToken    = cfg.auth ? AUTH_WKT : null;
    const extraHeaders = authToken ? { 'Authorization': authToken } : {};

    const result = await request(viewsUrl, {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': String(Buffer.byteLength(reqBody)),
        ...extraHeaders,
      },
    }, reqBody);

    if (result.statusCode >= 500) {
      const detail = result.body?.message || result.body?.error || result.rawBody?.substring(0, 120) || '';
      console.error(`[${planId}] HTTP ${result.statusCode} from ManipalCigna:`, detail);
      return res.json({ error: `${cfg.name} service is unavailable on ManipalCigna's end (HTTP ${result.statusCode}). Their backend is returning errors for this plan. Please try again later.` });
    }

    if (result.body === null) {
      console.error('Non-JSON response:', result.rawBody?.substring(0, 300));
      return res.json({ error: `API returned unexpected response (HTTP ${result.statusCode}). ${(result.rawBody || '').substring(0, 150)}` });
    }

    const json = result.body;
    const resp = json?.response || json;

    // Check for cards (outer Status may be 'Fail' for prime plans if some cards fail, but individual cards succeed)
    const cards = resp?.Card || [];
    const successCards = cards.filter(c => c.Status === 'Success' || !c.Status);

    if (successCards.length === 0 && resp?.Status && resp.Status !== 'Success') {
      let msg = Array.isArray(resp.ErrorMessage) ? resp.ErrorMessage.join('; ') : (resp.ErrorMessage || '');
      const cvt = payload?.preparedData?.coverType || payload?.coverType || '?';
      if (!msg) msg = `${cfg.name}: ManipalCigna returned no quotes for this member/zone combination (coverType ${cvt}, ${members.length} member${members.length>1?'s':''}).`;
      console.error(`\n[${planId}] ⚠️  STATUS=Fail — coverType=${cvt} SI=${sumInsured} zone=${zone} members=${members.length}`);
      try {
        const rel=(payload?.preparedData?.coverTypeInfo?.details||payload?.details||[]).map(x=>x.insuredRelationShip||x.adult||'?').join(',');
        if(rel) console.error(`[${planId}] member details: ${rel}`);
        console.error(`[${planId}] PAYLOAD SENT:\n`+JSON.stringify(payload).substring(0,2500));
      } catch(e){}
      console.error(`[${planId}] MC RAW:\n`+(result.rawBody||JSON.stringify(json)||'').substring(0,800)+'\n');
      return res.json({ error: msg });
    }

    if (cards.length === 0) {
      // ── DEBUG: surface exactly what MC returned + what we sent ──
      console.error(`\n[${planId}] ⚠️  EMPTY CARDS — MC accepted request but returned 0 quotes`);
      console.error(`[${planId}] Request → coverType=${payload?.preparedData?.coverType || payload?.coverType || '?'} SI=${sumInsured} zone=${zone} tenure=${tenure} members=${members.length}`);
      try {
        const relDbg = (payload?.preparedData?.coverTypeInfo?.details || payload?.details || [])
          .map(function(x){ return x.insuredRelationShip || x.relationship || '?'; }).join(',');
        if (relDbg) console.error(`[${planId}] Relationships sent: ${relDbg}`);
      } catch(e) {}
      console.error(`[${planId}] MC response Status: ${resp?.Status}  ErrorMessage: ${JSON.stringify(resp?.ErrorMessage)}`);
      console.error(`[${planId}] MC raw response (first 1500 chars):\n${(result.rawBody || JSON.stringify(resp) || '').substring(0, 1500)}\n`);
      return res.json({ error: `No plans returned for ${cfg.name}. The API accepted the request but returned no quotes — try a different Sum Insured or age combination.` });
    }

    // ── DEBUG: log the returned premium(s) so add-on effect is visible ──
    try {
      const prems = cards.map(function(c){
        const p = (c.FinalPremiumTable && c.FinalPremiumTable[0]) || {};
        return (c.SuggestionCode || c.SuggestionName || '?') + '=' + (p.MODAL_PREM_TAX || p.TOTAL_PREM || p.PREM_WITH_TAX || '?');
      });
      console.log(`[${planId}] Premiums returned: ${prems.join(' | ')}`);
    } catch(e) {}

    // Attach metadata
    if (json.response) {
      json.response.zone    = zone;
      json.response.planId  = planId;
      json.response.planName = cfg.name;
    } else {
      json.zone    = zone;
      json.planId  = planId;
      json.planName = cfg.name;
    }

    // What the operator asked for vs what this plan's payload could actually
    // carry. Several plans (ProHealth Prime, Critical Illness, Personal
    // Accident, Accident Shield) initialise every rider to null, so no add-on
    // can be applied at all — the UI must say so instead of confirming them.
    json.addOnReport = {
      requested: Object.keys(addons || {}).filter(k => addons[k]),
      applied:   addOnApplied,
      skipped:   addOnSkipped,
    };

    // What cover type this quote was actually priced with, and whether that code
    // is one we have confirmed against a real portal quote. The UI needs both:
    // it used to tell the hub that any requested cover type had been discarded,
    // which is no longer true, and it must not present an unverified
    // multi-individual premium as if it were confirmed.
    json.coverTypeReport = {
      requested:  planType || null,
      applied:    overrideCoverType || getCoverType(members),
      fromMemberCount: !overrideCoverType,
      unverified: coverTypeUnverified,
      residentIndian: resident || 'Y',
    };

    res.json(json);
  } catch (err) {
    console.error(`[${planId || 'unknown'}] error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── GET /decrypt — simple in-browser form to paste a real encodedString and see the decrypted payload ──
// The decrypt tools expose ManipalCigna's AES key as an oracle to anything
// that can reach this port. Off unless MC_ENABLE_DECRYPT_TOOLS=1 in .env.
const DECRYPT_TOOLS = process.env.MC_ENABLE_DECRYPT_TOOLS === '1';
function requireDecryptTools(req, res, next) {
  if (!DECRYPT_TOOLS) {
    return res.status(404).json({ error: 'Decrypt tools are disabled. Set MC_ENABLE_DECRYPT_TOOLS=1 in .env to enable.' });
  }
  next();
}

app.get('/decrypt', requireDecryptTools, (req, res) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>MC Decrypt</title>
<style>body{font-family:system-ui,Arial;max-width:900px;margin:30px auto;padding:0 16px;color:#1e293b}
h2{color:#0284c7}textarea{width:100%;height:120px;font-family:monospace;font-size:12px;padding:10px;border:1px solid #cbd5e1;border-radius:8px}
button{margin-top:10px;padding:10px 20px;background:#0284c7;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer}
pre{background:#0f172a;color:#e2e8f0;padding:16px;border-radius:8px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-all}
.hint{font-size:13px;color:#64748b;line-height:1.6}</style></head><body>
<h2>ManipalCigna payload decryptor</h2>
<p class="hint">Paste the <b>encodedString</b> value from the real site's <b>viewPlans</b> request (DevTools → Network → Payload), then click Decrypt. Copy the result and share it.</p>
<textarea id="enc" placeholder="Paste the long base64 encodedString here…"></textarea>
<button onclick="go()">Decrypt</button>
<pre id="out"></pre>
<script>
async function go(){
  const enc=document.getElementById('enc').value.trim();
  const out=document.getElementById('out');
  out.textContent='Decrypting…';
  try{
    const r=await fetch('/api/decrypt-test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({encodedString:enc})});
    const d=await r.json();
    out.textContent = d.success ? JSON.stringify(d.payload,null,2) : ('Error: '+(d.error||'could not decrypt'));
  }catch(e){ out.textContent='Error: '+e.message; }
}
</script></body></html>`);
});

// ── POST /api/decrypt-test — decode a real encodedString to see exact payload fields ──
// Usage: POST { "encodedString": "9Fq98TD..." }  (paste from F12 DevTools Payload tab)
// Returns the decrypted JSON so you can see every field the real site sends
app.post('/api/decrypt-test', requireDecryptTools, (req, res) => {
  const { encodedString } = req.body;
  if (!encodedString) return res.status(400).json({ error: 'Provide encodedString in request body' });
  try {
    const decipher = crypto.createDecipheriv('aes-128-ecb', AES_KEY, Buffer.alloc(0));
    decipher.setAutoPadding(true);
    const decrypted = decipher.update(encodedString, 'base64', 'utf8') + decipher.final('utf8');
    const parsed = JSON.parse(decrypted);
    res.json({ success: true, fieldCount: Object.keys(parsed).length, payload: parsed });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// ── GET /api/debug/:planId ────────────────────────────────────────
app.get('/api/debug/:planId', async (req, res) => {
  const planId = req.params.planId || 'prohealth-prime';
  req.body = { members: [{ type: 'adult', age: 35, gender: 'M' }], sumInsured: PLAN_CONFIG[planId]?.siOptions[3] || 5000000, pincode: '400001', tenure: '1' };
  await handlePremiumRequest(req, res, planId);
});

// ── GET /api/rawtest/:planId — compare old-URL/plain vs new-URL/plain vs new-URL/encrypted ─
// Open in browser: http://localhost:3003/api/rawtest/sarvah
app.get('/api/rawtest/:planId', async (req, res) => {
  const planId = req.params.planId;
  const cfg    = PLAN_CONFIG[planId];
  if (!cfg) return res.status(400).json({ error: 'Unknown plan' });

  const mockMembers = [{ type: 'adult', age: planId === 'prime-senior' ? 60 : 35, gender: 'M' }];
  let payload;
  if (cfg.format === 'lifetime') {
    payload = buildLifetimePayload({ members: mockMembers, sumInsured: cfg.siOptions[0], pincode: '400001', tenure: '1', portability: false, frequency: 'single', zone: 'ZONE2', overrideCoverType: 'INDI' });
  } else if (cfg.format === 'stu') {
    payload = buildSTUPayload({ members: mockMembers, sumInsured: cfg.siOptions[0], pincode: '400001', tenure: '1', portability: false, zone: 'ZONE2', deductible: cfg.siOptions[0], product: cfg.product || '', product_code: cfg.product_code || '' });
  } else if (cfg.viewPlansPath) {
    payload = buildNewApiPayload({ members: mockMembers, sumInsured: cfg.siOptions[0], pincode: '400001', tenure: '1', portability: false, zone: 'ZONE2', product: cfg.product || '', product_code: cfg.product_code || '' });
  } else if (cfg.encrypted) {
    payload = buildPrimeEncryptedPayload({ members: mockMembers, sumInsured: cfg.siOptions[0], pincode: '400001', tenure: '1', portability: false, zone: 'ZONE2', product: cfg.product || '', product_code: cfg.product_code || '' });
  } else {
    payload = buildPrimePayload({ members: mockMembers, sumInsured: cfg.siOptions[0], pincode: '400001', tenure: '1', portability: false, zone: 'ZONE2', product: cfg.product || '', product_code: cfg.product_code || '' });
  }

  const results = {};
  const hdrs = (body) => ({ 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), 'Authorization': AUTH_WKT });

  // Test 1: Old URL, plain JSON
  const oldUrl = `${GATEWAY}/${cfg.service}/udaanapi/quoteservice/viewPlans`;
  try {
    const body = JSON.stringify(payload);
    const r = await request(oldUrl, { method: 'POST', headers: hdrs(body) }, body);
    const cards = r.body?.response?.Card || r.body?.Card || [];
    results.oldUrl_plain = { url: oldUrl, status: r.statusCode, cards: cards.length, body: r.rawBody?.substring(0, 400) || JSON.stringify(r.body).substring(0, 400) };
  } catch(e) { results.oldUrl_plain = { error: e.message }; }

  // Test 2: Old URL, encrypted (what we now send for most plans)
  try {
    const enc  = encryptECB(payload);
    const body = JSON.stringify({ encodedString: enc });
    const r    = await request(oldUrl, { method: 'POST', headers: hdrs(body) }, body);
    const cards = r.body?.response?.Card || r.body?.Card || [];
    results.oldUrl_encrypted = { url: oldUrl, status: r.statusCode, cards: cards.length, body: r.rawBody?.substring(0, 400) || JSON.stringify(r.body).substring(0, 400) };
  } catch(e) { results.oldUrl_encrypted = { error: e.message }; }

  if (cfg.viewPlansPath) {
    const newUrl = `${GATEWAY}/${cfg.viewPlansPath}/quote/viewPlans`;

    // Test 3: New URL, encrypted JSON
    try {
      const enc  = encryptECB(payload);
      const body = JSON.stringify({ encodedString: enc });
      const r    = await request(newUrl, { method: 'POST', headers: hdrs(body) }, body);
      const cards = r.body?.response?.Card || r.body?.Card || [];
      results.newUrl_encrypted = { url: newUrl, status: r.statusCode, cards: cards.length, body: r.rawBody?.substring(0, 400) || JSON.stringify(r.body).substring(0, 400) };
    } catch(e) { results.newUrl_encrypted = { error: e.message }; }
  }

  res.json(results);
});

// ── GET /api/addons/:planId — show all AddOns/Riders strings from first successful card ──
// Open in browser: http://localhost:3003/api/addons/prohealth-prime
// Useful for discovering what string names the API actually returns
app.get('/api/addons/:planId', async (req, res) => {
  const planId = req.params.planId;
  const cfg    = PLAN_CONFIG[planId];
  if (!cfg) return res.status(400).json({ error: 'Unknown plan: ' + planId });

  const mockAge = planId === 'prime-senior' ? 60 : 35;
  const fakeReq = {
    body: {
      members:     [{ type: 'adult', age: mockAge, gender: 'M' }],
      sumInsured:  cfg.siOptions[0] || 500000,
      pincode:     '400001',
      tenure:      '1',
      portability: false,
      frequency:   'single',
      addons:      {},
    }
  };

  let result;
  const fakeRes = {
    json(data) { result = data; },
    status(c)  { return this; },
  };

  await handlePremiumRequest(fakeReq, fakeRes, planId);

  if (result?.error) return res.json({ error: result.error });

  const cards = result?.response?.Card || result?.Card || [];
  const addonData = cards.map(c => ({
    name:            c.SuggestionName,
    code:            c.SuggestionCode,
    AddOns:          c.AddOns || [],
    Riders:          c.Riders || [],
    OptionalPackage: c.OptionalPackage || [],
  }));

  // Collect all unique names
  const uniqueNames = new Set();
  addonData.forEach(c => {
    [...c.AddOns, ...c.Riders, ...c.OptionalPackage].forEach(x => {
      const name = (typeof x === 'string') ? x : (x?.Name || x?.PackageName || '');
      if (name) uniqueNames.add(name);
    });
  });

  res.json({ planId, planName: cfg.name, cards: addonData, uniqueAddonNames: [...uniqueNames] });
});

// ── GET /api/health — availability check for all plans ──
// Cached. Every hub page load used to fire 8 sequential quotes = 16 upstream
// requests to MC's gateway, with no in-flight guard, repeated on every iframe
// reload across three hubs. Now one real sweep serves every caller for
// HEALTH_TTL_MS, and concurrent callers share the same in-flight promise.
// Pass ?refresh=1 (the "Check Availability" button) to force a new sweep.
const HEALTH_TTL_MS = 10 * 60 * 1000;
let _healthCache = null;      // { at, results }
let _healthInFlight = null;

async function runHealthSweep() {
  const results = {};
  const planIds = Object.keys(PLAN_CONFIG);
  const delay   = ms => new Promise(r => setTimeout(r, ms));

  for (let i = 0; i < planIds.length; i++) {
    const planId = planIds[i];
    const cfg    = PLAN_CONFIG[planId];

    // A plan with no product code cannot return a card no matter what we send.
    // Report that as a configuration gap instead of spending two upstream
    // requests to rediscover it — and so the UI can stop labelling it
    // "API Error", which is indistinguishable from MC being down.
    if (!cfg.product || !cfg.product_code) { results[planId] = 'not-configured'; continue; }

    if (i > 0) await delay(400); // small gap to avoid rate limiting

    const mockReq = {
      body: {
        members:     [{ type: 'adult', age: planId === 'prime-senior' ? 60 : 35, gender: 'M' }],
        sumInsured:  cfg.siOptions[0],
        pincode:     '400001',
        tenure:      '1',
        portability: false,
        frequency:   'single',
      },
    };

    let settled = false;
    await new Promise(resolve => {
      const done = v => { if (!settled) { settled = true; results[planId] = v; resolve(); } };
      const mockRes = {
        json(data) { done(data && !data.error ? 'ok' : 'unavailable'); },
        status(code) { return this; },
      };
      handlePremiumRequest(mockReq, mockRes, planId)
        .catch(() => done('unavailable'))
        .finally(() => done('unavailable'));
    });
  }
  return results;
}

app.get('/api/health', async (req, res) => {
  const force = req.query.refresh === '1';
  const fresh = _healthCache && (Date.now() - _healthCache.at < HEALTH_TTL_MS);

  if (!force && fresh) {
    return res.json({ ..._healthCache.results, _cachedAt: _healthCache.at, _cached: true });
  }
  if (_healthInFlight) {                       // someone else is already sweeping
    try {
      const results = await _healthInFlight;
      return res.json({ ...results, _cachedAt: Date.now(), _cached: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  _healthInFlight = runHealthSweep()
    .then(r => { _healthCache = { at: Date.now(), results: r }; return r; })
    .finally(() => { _healthInFlight = null; });

  try {
    const results = await _healthInFlight;
    res.json({ ...results, _cachedAt: Date.now(), _cached: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Overridable so a second instance can be started against a stand-in gateway
// for testing without disturbing the one on 3003. Defaults are unchanged.
const PORT = Number(process.env.PORT) || 3003;
app.listen(PORT, '127.0.0.1', () =>
  console.log(`✅  ManipalCigna multi-plan calculator on http://localhost:${PORT}\n   Multi: http://localhost:${PORT}/multi\n   LT:    http://localhost:${PORT}/`)
);

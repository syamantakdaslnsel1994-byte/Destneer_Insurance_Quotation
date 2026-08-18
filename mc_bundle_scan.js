/**
 * mc_bundle_scan.js — fetch MC JS bundles and scan for API endpoint patterns
 * Also probes the /api/sellonline/v1/ URL discovered from the bundle env vars.
 * Run: node mc_bundle_scan.js
 */
const https  = require('https');
const crypto = require('crypto');

const GATEWAY = 'https://online.gateway.manipalcigna.com';
const AUTH    = 'Basic Z01GMkx0amJZUDVGNTVuUnBVdzUrU09hWktTZTNhc1Y6UFFRZE1oaG5wTHUvS2wwMzNUUHNhT25heEZpRW14YXo=';
const AES_KEY = Buffer.from('lv39eptlvuhaqqer', 'utf8');
const BASE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin':          'https://online.manipalcigna.com',
  'Referer':         'https://online.manipalcigna.com/',
  'Authorization':   AUTH,
  'Content-Type':    'application/json',
};

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', timeout: 20000,
                   headers: { 'User-Agent': BASE_HEADERS['User-Agent'], 'Accept': '*/*' } };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.on('error', reject);
    req.end();
  });
}

function postPlain(url, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const u    = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname, method: 'POST', timeout: 12000,
      headers: { ...BASE_HEADERS, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { let j=null; try{j=JSON.parse(d);}catch(_){} resolve({ status: res.statusCode, body: d, json: j }); });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status:'TIMEOUT', body:'', json:null }); });
    req.on('error', e => resolve({ status:'ERR', body:e.message, json:null }));
    req.write(body); req.end();
  });
}

function encryptECB(obj) {
  const cipher = crypto.createCipheriv('aes-128-ecb', AES_KEY, Buffer.alloc(0));
  cipher.setAutoPadding(true);
  return cipher.update(JSON.stringify(obj), 'utf8', 'base64') + cipher.final('base64');
}

function postAES(url, payload) {
  const encrypted = { encodedString: encryptECB(payload) };
  return postPlain(url, encrypted);
}

function ageToDOB(age) {
  const n = new Date();
  return `${String(n.getDate()).padStart(2,'0')}/${String(n.getMonth()+1).padStart(2,'0')}/${n.getFullYear()-age}`;
}
function todayStr() {
  const n = new Date();
  return `${String(n.getDate()).padStart(2,'0')}/${String(n.getMonth()+1).padStart(2,'0')}/${n.getFullYear()}`;
}
function cuid() { return 'c'+Math.random().toString(36).slice(2)+Date.now().toString(36); }

const basePayload = {
  preparedData: {
    coverType:'INDI', sumInsured:'500000', pinCode:'400001', zone:'ZONE1',
    allInsuredAreResidentIndian:'Y', createDate:todayStr(),
    coverTypeInfo:{ adultCount:1, peopleCount:1, details:[{gender:'M', dob:ageToDOB(35), adult:'A', uwLoading:null}] },
  },
  isSingleProduct:'N', isWorkSite:'N', suggestionSet:'Set0', variant:'',
  tenure:'1', isEmployee:'N', worldZone:'WORLDZONE1', renewalDiscount:'N',
  channelId:'', parentAgencyId:'', portability:'N', posp:'N', sourceType:'NB',
  deductable:'0', opdRider:'N', opdRiderPackage:null, opdRiderSA:null,
  shield:'N', roomUpgrade:'N', pedReduction:'N', restorationOfSA:'N',
  premiumManagement:'N', coPayment:'999', standingInstruction:'N',
  inputMode:'5', isMchiCustomer:'N', isDirectPolicy:'N', socialMedia:'N',
  isZoneUpgrade:false, leadId:cuid(), paymentMode:'', emailAddress:'', mobileNumber:'',
  agentId:'', agentName:'', businessFor:'', skip:false,
  agentMobileNum:'', agentEmailId:'', branchId:'', employeeCodeOrSpCode:'', employeeNameOrSpName:'', parentagencyname:'',
};

function fmtR(r, label) {
  const sym = r.status===200?'✅':r.status===404?'🔍':r.status===500?'⚠️ ':r.status===401?'🔑':'❌';
  const resp = r.json?.response || r.json;
  const cards = (resp?.Card||[]).filter(c=>c.Status==='Success'||!c.Status);
  let detail = '';
  if (r.status===200) detail = cards.length > 0 ? `  🎉 ${cards.length} CARDS: ${cards.slice(0,3).map(c=>c.SuggestionName||'?').join(', ')}` : `  Status=${resp?.Status} Err=${JSON.stringify(resp?.ErrorMessage||[]).substring(0,60)}`;
  else detail = `  ${(r.body||'').substring(0,120)}`;
  console.log(`  ${sym} ${String(r.status).padEnd(4)} ${label}${detail?'\n'+detail:''}`);
}

async function main() {
  console.log('=== mc_bundle_scan.js ===\n');

  // ── SECTION 1: Scan get-quick-quote JS bundles for API paths ─────
  console.log('── 1: Scanning JS bundles for API endpoint patterns ──');

  // Fetch manifest to find chunk files
  const bundles = [
    'https://online.manipalcigna.com/get-quick-quote/static/js/main.870ac8f3.js',
    'https://online.manipalcigna.com/get-quick-quote/asset-manifest.json',
  ];

  let mainBundle = '';
  for (const url of bundles) {
    try {
      const r = await get(url);
      console.log(`  Fetched ${url.split('/').pop()} — ${r.body.length}b status=${r.status}`);
      if (url.endsWith('.js')) mainBundle = r.body;
      if (url.endsWith('.json')) {
        try {
          const manifest = JSON.parse(r.body);
          console.log('  Manifest files:', JSON.stringify(Object.keys(manifest.files || manifest).slice(0, 20)));
        } catch(_) { console.log('  Manifest raw:', r.body.substring(0, 300)); }
      }
    } catch(e) { console.log(`  ERR: ${e.message}`); }
  }

  // Search for API patterns in main bundle
  const searchTerms = ['viewPlan', 'udaanapi', 'quoteservice', 'sellonline', '/api/', 'v1/', 'sarvah', 'prohealth', 'primeInsurance', 'senior', 'accident', 'topup', 'critical', '.chunk'];
  console.log('\n  Bundle search results:');
  for (const term of searchTerms) {
    const idx = mainBundle.toLowerCase().indexOf(term.toLowerCase());
    if (idx >= 0) {
      console.log(`  FOUND "${term}" at ${idx}: ...${mainBundle.substring(Math.max(0,idx-30), idx+80)}...`);
    }
  }

  // Find chunk references (webpack chunk map: {number: "hash"} patterns)
  const chunkMap = mainBundle.match(/\{(\d+:"[a-f0-9]+"(?:,\d+:"[a-f0-9]+")*)\}/);
  if (chunkMap) {
    console.log('\n  Webpack chunk map found:', chunkMap[0].substring(0, 300));
  } else {
    // Try to find .chunk.js references
    const chunkRefs = [...mainBundle.matchAll(/["'](\d+\.[a-f0-9]{8})["']/g)].map(m=>m[1]);
    console.log('\n  Chunk refs:', [...new Set(chunkRefs)].slice(0, 15));
  }

  // ── SECTION 2: Probe /api/sellonline/v1/ URL paths ───────────────
  console.log('\n── 2: Probing /api/sellonline/v1/ base URL (from bundle env) ──');
  const SELL_BASE = `${GATEWAY}/api/sellonline/v1/`;

  const sellPaths = [
    'quoteservice/viewPlans',
    'viewPlans',
    'prohealth/viewPlans',
    'prohealth/quoteservice/viewPlans',
    'prime/quoteservice/viewPlans',
    'prime/viewPlans',
    'sarvah/viewPlans',
    'sarvah/quoteservice/viewPlans',
    'stu/viewPlans',
    'cc/viewPlans',
    'pa/viewPlans',
    'as/viewPlans',
    'prohealthquickquote/quoteservice/viewPlans',
  ];

  for (const p of sellPaths) {
    const r = await postPlain(SELL_BASE + p, basePayload);
    fmtR(r, `POST ${SELL_BASE}${p}`);
  }

  // ── SECTION 3: AES-encrypted payload on all broken plan services ──
  console.log('\n── 3: AES-encrypted payloads on broken plans (plain-path) ──');
  const brokenPlans = [
    ['Sarvah',          'sellonlineprohealthquickquoteservice'],
    ['ProHealth Prime', 'sellonlineprimequickquoteservice'],
    ['Super Top Up',    'sellonlinestuquickquoteservice'],
    ['Critical Ill.',   'sellonlineccquickquoteservice'],
    ['Personal Acc.',   'sellonlinepaquickquoteservice'],
    ['Accident Shield', 'sellonlineasquickquoteservice'],
  ];

  for (const [name, svc] of brokenPlans) {
    const url = `${GATEWAY}/${svc}/udaanapi/quoteservice/viewPlans`;
    const r = await postAES(url, { ...basePayload, leadId: cuid() });
    fmtR(r, `${name} (AES)`);
  }

  // ── SECTION 4: AES on /api/sellonline/v1/ for broken plans ───────
  console.log('\n── 4: AES on /api/sellonline/v1/ ──');
  const sellAESPaths = [
    ['Sarvah',          'prohealthquickquote/udaanapi/quoteservice/viewPlans'],
    ['ProHealth Prime', 'primequickquote/udaanapi/quoteservice/viewPlans'],
    ['STU',             'stuquickquote/udaanapi/quoteservice/viewPlans'],
    ['CI',              'ccquickquote/udaanapi/quoteservice/viewPlans'],
  ];
  for (const [name, path] of sellAESPaths) {
    const r = await postAES(`${SELL_BASE}${path}`, { ...basePayload, leadId: cuid() });
    fmtR(r, `${name} AES via api/v1 (${path})`);
  }

  // ── SECTION 5: Try the mc_results-page bundle scripts ─────────────
  console.log('\n── 5: Fetching mc_results-page bundles (main MC site) ──');

  // The results page bundles are at a different path
  const resultsBundles = [
    'https://online.manipalcigna.com/asset-manifest.json',
    'https://online.manipalcigna.com/static/js/main.220bc0d0146d8106abc0.js',
  ];
  for (const url of resultsBundles) {
    try {
      const r = await get(url);
      console.log(`  ${url.split('/').pop()}: status=${r.status} size=${r.body.length}`);
      if (r.status === 200 && r.body.length > 0) {
        const terms = ['viewPlan', 'udaanapi', 'sellonlineprohealth', 'sellonlineprime', 'sellonlinestу', 'sellonlinecc', 'sellonlinepa', 'sellonlineas'];
        for (const term of terms) {
          const idx = r.body.toLowerCase().indexOf(term.toLowerCase());
          if (idx >= 0) {
            console.log(`    FOUND "${term}": ...${r.body.substring(Math.max(0,idx-30), idx+120)}...`);
          }
        }
      }
    } catch(e) { console.log(`  ERR ${url.split('/').pop()}: ${e.message}`); }
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);

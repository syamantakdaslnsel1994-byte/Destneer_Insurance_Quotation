/**
 * mc_probe2.js — focused plain-JSON probe
 *
 * Key insight from probe v7: AES-encrypted payloads return either 500 (Senior)
 * or 200-empty-cards (ProHealth Prime). mc_server.js sends PLAIN JSON and Senior
 * actually works. This probe uses the same plain-JSON + full buildPrimePayload
 * approach as mc_server.js to see if ProHealth Prime and others respond with cards.
 *
 * Run: node mc_probe2.js
 */
const https = require('https');

const GATEWAY = 'https://online.gateway.manipalcigna.com';
const AUTH    = 'Basic Z01GMkx0amJZUDVGNTVuUnBVdzUrU09hWktTZTNhc1Y6UFFRZE1oaG5wTHUvS2wwMzNUUHNhT25heEZpRW14YXo=';

const BASE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin':          'https://online.manipalcigna.com',
  'Referer':         'https://online.manipalcigna.com/',
  'Authorization':   AUTH,
  'Content-Type':    'application/json',
};

// ── Helpers ───────────────────────────────────────────────────────────
function ageToDOB(age) {
  const n = new Date();
  return `${String(n.getDate()).padStart(2,'0')}/${String(n.getMonth()+1).padStart(2,'0')}/${n.getFullYear()-age}`;
}
function todayStr() {
  const n = new Date();
  return `${String(n.getDate()).padStart(2,'0')}/${String(n.getMonth()+1).padStart(2,'0')}/${n.getFullYear()}`;
}
function cuid() {
  return 'c' + Math.random().toString(36).slice(2,12) + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

// Exact clone of mc_server.js buildPrimePayload
function buildPrimePayload({ members, sumInsured, pincode, zone, tenure = '1', portability = false, deductible = 0 }) {
  const adults   = members.filter(m => m.type === 'adult');
  const children = members.filter(m => m.type === 'child');
  const coverType = members.length === 1 ? 'INDI' : 'FamilyFloater';
  const details = members.map(m => ({
    gender:    m.gender === 'F' ? 'F' : 'M',
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
      allInsuredAreResidentIndian: 'Y',
      createDate:                  todayStr(),
      coverTypeInfo:               pd,
    },
    isSingleProduct:      'N',
    isWorkSite:           'N',
    suggestionSet:        'Set0',
    variant:              '',
    tenure:               String(tenure),
    isEmployee:           'N',
    worldZone:            'WORLDZONE1',
    renewalDiscount:      'N',
    channelId:            '',
    parentAgencyId:       '',
    portability:          portability ? 'Y' : 'N',
    posp:                 'N',
    sourceType:           'NB',
    deductable:           deductible > 0 ? String(deductible) : '0',
    opdRider:             'N',
    opdRiderPackage:      null,
    opdRiderSA:           null,
    shield:               'N',
    roomUpgrade:          'N',
    pedReduction:         'N',
    restorationOfSA:      'N',
    premiumManagement:    'N',
    coPayment:            '999',
    standingInstruction:  'N',
    inputMode:            '5',
    isMchiCustomer:       'N',
    isDirectPolicy:       'N',
    socialMedia:          'N',
    isZoneUpgrade:        false,
    leadId:               cuid(),
    paymentMode:          '',
    emailAddress:         '',
    mobileNumber:         '',
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
  };
}

// ── HTTP POST (plain JSON — NOT AES-encrypted, same as mc_server.js) ──
function postPlain(svc, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const url  = new URL(`${GATEWAY}/${svc}/udaanapi/quoteservice/viewPlans`);
    const opts = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      timeout:  15000,
      headers:  { ...BASE_HEADERS, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch(_) {}
        resolve({ status: res.statusCode, body: data, json: parsed });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT', body: '', json: null }); });
    req.on('error', e => resolve({ status: 'ERR:'+e.code, body: e.message, json: null }));
    req.write(body);
    req.end();
  });
}

// Zone lookup
function getZone(pin) {
  return new Promise((resolve) => {
    const url  = new URL(`${GATEWAY}/sellonline/v1/location-details/${pin}/app/lifetime`);
    const opts = { hostname: url.hostname, path: url.pathname, method: 'GET', timeout: 8000, headers: BASE_HEADERS };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)?.response?.zonecd || 'ZONE1'); } catch(_) { resolve('ZONE1'); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve('ZONE1'); });
    req.on('error', () => resolve('ZONE1'));
    req.end();
  });
}

function fmtResult(r, label) {
  const sym = r.status === 200 ? '✅' : r.status === 500 ? '⚠️ ' : '❌';
  const resp = r.json?.response || r.json;
  const cards = resp?.Card || [];
  const ok = cards.filter(c => c.Status === 'Success' || !c.Status);
  let detail = '';
  if (r.status === 200) {
    detail = ok.length > 0
      ? `  🎉 ${ok.length} card(s): ${ok.slice(0,3).map(c => c.SuggestionName || c.SuggestionCode || '?').join(', ')}`
      : `  Status=${resp?.Status} cards=[] ${resp?.ErrorMessage?.length ? 'Err: '+resp.ErrorMessage.slice(0,2).join('; ') : '(no error msg)'}`;
  } else if (r.status !== 500) {
    detail = `  ${r.body.substring(0,120)}`;
  }
  console.log(`  ${sym} ${String(r.status).padEnd(4)} ${label}${detail ? '\n'+detail : ''}`);
}

// ── MAIN ──────────────────────────────────────────────────────────────
async function main() {
  console.log('=== mc_probe2: Plain JSON sweep (same format as mc_server.js) ===\n');

  // Look up zones for key pins upfront
  console.log('── Zone lookups ──');
  const PINS = {
    '400001': null,  // Mumbai
    '110001': null,  // Delhi
    '560001': null,  // Bangalore
    '600001': null,  // Chennai
    '700001': null,  // Kolkata
    '500001': null,  // Hyderabad
  };
  for (const [pin] of Object.entries(PINS)) {
    PINS[pin] = await getZone(pin);
    console.log(`  Pin ${pin} → ${PINS[pin]}`);
  }

  // ── SECTION A: Senior verification ─────────────────────────────────
  console.log('\n── A: Prime Senior (plain JSON, should return cards) ──');
  const seniorTests = [
    ['60yo 5L Mumbai', { members:[{type:'adult',age:60,gender:'M'}], sumInsured:500000, pincode:'400001', zone:PINS['400001'] }],
    ['60yo 10L Mumbai', { members:[{type:'adult',age:60,gender:'M'}], sumInsured:1000000, pincode:'400001', zone:PINS['400001'] }],
    ['65yo 5L Delhi',  { members:[{type:'adult',age:65,gender:'M'}], sumInsured:500000,  pincode:'110001', zone:PINS['110001'] }],
  ];
  for (const [label, params] of seniorTests) {
    const r = await postPlain('sellonlineseniorquickquoteservice', buildPrimePayload(params));
    fmtResult(r, label);
  }

  // ── SECTION B: ProHealth Prime — plain JSON age+SI matrix ──────────
  console.log('\n── B: ProHealth Prime (plain JSON — ages 18–60, all SIs, 6 pins) ──');
  const primeSvc = 'sellonlineprimequickquoteservice';
  const primeAges = [18, 25, 30, 35, 40, 45, 50, 55, 60];
  const primeSIs  = [500000, 1000000, 3000000, 5000000, 10000000];
  const testPins  = [
    ['Mumbai', '400001'],
    ['Delhi',  '110001'],
    ['Blore',  '560001'],
  ];

  let foundCards = false;
  outer:
  for (const [cityName, pin] of testPins) {
    const zone = PINS[pin];
    for (const age of primeAges) {
      for (const si of primeSIs) {
        const params = { members:[{type:'adult',age,gender:'M'}], sumInsured:si, pincode:pin, zone };
        const r = await postPlain(primeSvc, buildPrimePayload(params));
        const resp = r.json?.response || r.json;
        const cards = (resp?.Card || []).filter(c => c.Status === 'Success' || !c.Status);
        if (cards.length > 0) {
          fmtResult(r, `${cityName} age=${age} SI=${si/100000}L`);
          foundCards = true;
          break outer;
        }
        // Only print non-500 misses to keep output readable
        if (r.status !== 500) fmtResult(r, `${cityName} age=${age} SI=${si/100000}L`);
      }
    }
    console.log(`  (${cityName} ${zone}: all tested, no cards)`);
  }
  if (!foundCards) console.log('  → No cards returned for ANY age/SI/pin combination.');

  // ── SECTION C: ProHealth Prime — FamilyFloater variants ────────────
  console.log('\n── C: ProHealth Prime — FamilyFloater + couples ──');
  const ffTests = [
    ['2A Mumbai 5L', { members:[{type:'adult',age:35,gender:'M'},{type:'adult',age:32,gender:'F'}], sumInsured:500000,  pincode:'400001', zone:PINS['400001'] }],
    ['2A+1C Mum 5L', { members:[{type:'adult',age:35,gender:'M'},{type:'adult',age:32,gender:'F'},{type:'child',age:5,gender:'M'}], sumInsured:500000, pincode:'400001', zone:PINS['400001'] }],
    ['2A Delhi 5L',  { members:[{type:'adult',age:35,gender:'M'},{type:'adult',age:32,gender:'F'}], sumInsured:500000,  pincode:'110001', zone:PINS['110001'] }],
    ['2A Delhi 10L', { members:[{type:'adult',age:35,gender:'M'},{type:'adult',age:32,gender:'F'}], sumInsured:1000000, pincode:'110001', zone:PINS['110001'] }],
  ];
  for (const [label, params] of ffTests) {
    const r = await postPlain(primeSvc, buildPrimePayload(params));
    fmtResult(r, label);
  }

  // ── SECTION D: Sarvah ───────────────────────────────────────────────
  console.log('\n── D: Sarvah — plain JSON sweep ──');
  const sarvahSvc = 'sellonlineprohealthquickquoteservice';
  const sarvahTests = [
    ['35yo 5L Mumbai',  {members:[{type:'adult',age:35,gender:'M'}], sumInsured:500000,   pincode:'400001', zone:PINS['400001']}],
    ['35yo 5L Delhi',   {members:[{type:'adult',age:35,gender:'M'}], sumInsured:500000,   pincode:'110001', zone:PINS['110001']}],
    ['25yo 5L Delhi',   {members:[{type:'adult',age:25,gender:'M'}], sumInsured:500000,   pincode:'110001', zone:PINS['110001']}],
    ['35yo 10L Delhi',  {members:[{type:'adult',age:35,gender:'M'}], sumInsured:1000000,  pincode:'110001', zone:PINS['110001']}],
    ['35yo 5L Blore',   {members:[{type:'adult',age:35,gender:'M'}], sumInsured:500000,   pincode:'560001', zone:PINS['560001']}],
    ['2A 5L Delhi',     {members:[{type:'adult',age:35,gender:'M'},{type:'adult',age:32,gender:'F'}], sumInsured:500000, pincode:'110001', zone:PINS['110001']}],
  ];
  for (const [label, params] of sarvahTests) {
    const r = await postPlain(sarvahSvc, buildPrimePayload(params));
    fmtResult(r, label);
  }

  // ── SECTION E: Super Top Up ─────────────────────────────────────────
  console.log('\n── E: Super Top Up — plain JSON sweep ──');
  const stuSvc = 'sellonlinestuquickquoteservice';
  const stuTests = [
    ['35yo 5L ded=5L Mumbai', {members:[{type:'adult',age:35,gender:'M'}], sumInsured:500000,  pincode:'400001', zone:PINS['400001'], deductible:500000}],
    ['35yo 5L ded=5L Delhi',  {members:[{type:'adult',age:35,gender:'M'}], sumInsured:500000,  pincode:'110001', zone:PINS['110001'], deductible:500000}],
    ['35yo 10L ded=5L Delhi', {members:[{type:'adult',age:35,gender:'M'}], sumInsured:1000000, pincode:'110001', zone:PINS['110001'], deductible:500000}],
    ['35yo 20L ded=10L Mum',  {members:[{type:'adult',age:35,gender:'M'}], sumInsured:2000000, pincode:'400001', zone:PINS['400001'], deductible:1000000}],
  ];
  for (const [label, params] of stuTests) {
    const r = await postPlain(stuSvc, buildPrimePayload(params));
    fmtResult(r, label);
  }

  // ── SECTION F: Critical Illness ─────────────────────────────────────
  console.log('\n── F: Critical Illness — plain JSON sweep ──');
  const ciSvc = 'sellonlineccquickquoteservice';
  const ciTests = [
    ['35yo 10L Mumbai', {members:[{type:'adult',age:35,gender:'M'}], sumInsured:1000000,  pincode:'400001', zone:PINS['400001']}],
    ['35yo 10L Delhi',  {members:[{type:'adult',age:35,gender:'M'}], sumInsured:1000000,  pincode:'110001', zone:PINS['110001']}],
    ['25yo 10L Delhi',  {members:[{type:'adult',age:25,gender:'M'}], sumInsured:1000000,  pincode:'110001', zone:PINS['110001']}],
    ['35yo 20L Delhi',  {members:[{type:'adult',age:35,gender:'M'}], sumInsured:2000000,  pincode:'110001', zone:PINS['110001']}],
  ];
  for (const [label, params] of ciTests) {
    const r = await postPlain(ciSvc, buildPrimePayload(params));
    fmtResult(r, label);
  }

  // ── SECTION G: PA + Accident Shield (no zone in preparedData) ───────
  // From previous session: adding zone causes 500, removing it gives 200 (empty cards)
  // Try: remove zone from preparedData, vary SI and age
  console.log('\n── G: Personal Accident + Accident Shield (no zone field) ──');

  function buildPAPayload(members, si, pin) {
    const p = buildPrimePayload({ members, sumInsured: si, pincode: pin, zone: 'ZONE1' });
    delete p.preparedData.zone;   // PA/AS breaks with zone field
    return p;
  }

  const paSvc = 'sellonlinepaquickquoteservice';
  const asSvc = 'sellonlineasquickquoteservice';

  const paTests = [
    ['PA 35yo 5L Mumbai',   [paSvc, buildPAPayload([{type:'adult',age:35,gender:'M'}], 500000,  '400001')]],
    ['PA 35yo 5L Delhi',    [paSvc, buildPAPayload([{type:'adult',age:35,gender:'M'}], 500000,  '110001')]],
    ['PA 25yo 5L Delhi',    [paSvc, buildPAPayload([{type:'adult',age:25,gender:'M'}], 500000,  '110001')]],
    ['PA 35yo 20L Delhi',   [paSvc, buildPAPayload([{type:'adult',age:35,gender:'M'}], 2000000, '110001')]],
    ['PA 35yo 50L Delhi',   [paSvc, buildPAPayload([{type:'adult',age:35,gender:'M'}], 5000000, '110001')]],
    ['AS 35yo 2L Mumbai',   [asSvc, buildPAPayload([{type:'adult',age:35,gender:'M'}], 200000,  '400001')]],
    ['AS 35yo 2L Delhi',    [asSvc, buildPAPayload([{type:'adult',age:35,gender:'M'}], 200000,  '110001')]],
    ['AS 25yo 5L Delhi',    [asSvc, buildPAPayload([{type:'adult',age:25,gender:'M'}], 500000,  '110001')]],
  ];
  for (const [label, [svc, payload]] of paTests) {
    const r = await postPlain(svc, payload);
    fmtResult(r, label);
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);

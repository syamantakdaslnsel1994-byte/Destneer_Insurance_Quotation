/**
 * mc_probe.js — probe ManipalCigna plan APIs
 * Run: node mc_probe.js
 */
const https  = require('https');
const http   = require('http');
const crypto = require('crypto');

const AES_KEY = Buffer.from('lv39eptlvuhaqqer', 'utf8');
const GATEWAY = 'https://online.gateway.manipalcigna.com';
// Wkt token from results-page JS bundle — used by Senior/STU/Sarvah/PA/AS/CI
const AUTH    = 'Basic Z01GMkx0amJZUDVGNTVuUnBVdzUrU09hWktTZTNhc1Y6UFFRZE1oaG5wTHUvS2wwMzNUUHNhT25heEZpRW14YXo=';
// Wpt token from quick-quote-page JS bundle — used by LT and ProHealth Prime
const AUTH_WPT = 'Basic Z01GMkx0amJZUDVGNTVuUnBVdzUrU09hWptTZTNhc1Y6UFFRZE1oaG5wTHUvS2wwMzNUUHNhT25heEZpRW14YXo=';

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin':          'https://online.manipalcigna.com',
  'Referer':         'https://online.manipalcigna.com/',
};

function encryptECB(obj) {
  const cipher = crypto.createCipheriv('aes-128-ecb', AES_KEY, Buffer.alloc(0));
  cipher.setAutoPadding(true);
  return cipher.update(JSON.stringify(obj), 'utf8', 'base64') + cipher.final('base64');
}

function today() {
  const n = new Date();
  return `${String(n.getDate()).padStart(2,'0')}/${String(n.getMonth()+1).padStart(2,'0')}/${n.getFullYear()}`;
}

function mkPayload(si = '3000000', extra = {}) {
  const yr = new Date().getFullYear();
  return {
    preparedData: {
      coverType: 'INDI', sumInsured: si, pinCode: '400001', zone: 'ZONE1',
      allInsuredAreResidentIndian: 'Y', createDate: today(),
      coverTypeInfo: { adultCount:1, peopleCount:1, childCount:0, details:[{gender:'M', dob:`01/01/${yr-35}`, adult:'A'}] }
    },
    leadId: 'probe-test-001', isSingleProduct:'N', paymentMode:'', emailAddress:'', mobileNumber:'',
    isWorkSite:'N', suggestionSet:'Set0', variant:'', tenure:'1', frequency:'SINGLE',
    deductable:'0', deductableType:'', isEmployee:'N', renewalDiscount:'N',
    channelId:'', parentAgencyId:'', portability:'N', posp:'N', sourceType:'NB',
    healthCheckUp:null, ciRider:null, nonMedicalCover:null, opdSA:null, optionalPackage:null,
    personalAccident:null, bonusBooster:null, iftcRider:null, inputMode:'5',
    isMchiCustomer:'N', waiverCoPay:null, waiverSubLimit:null, worldWideCover:null,
    isZoneUpgrade:false, agentId:'', agentName:'', businessFor:'', skip:false,
    agentMobileNum:'', agentEmailId:'',
    ...extra
  };
}

function postPath(svc, path, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ encodedString: encryptECB(payload) });
    const url  = new URL(`${GATEWAY}/${svc}/${path}`);
    const opts = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      timeout:  10000,
      headers: {
        ...HEADERS,
        'Authorization':  AUTH,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data.substring(0, 250) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT', body: '' }); });
    req.on('error', (e) => resolve({ status: 'ERR:' + e.code, body: e.message }));
    req.write(body);
    req.end();
  });
}

function post(svc, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ encodedString: encryptECB(payload) });
    const url  = new URL(`${GATEWAY}/${svc}/udaanapi/quoteservice/viewPlans`);
    const opts = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      timeout:  10000,
      headers: {
        ...HEADERS,
        'Authorization':  AUTH,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data.substring(0, 250) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT', body: '' }); });
    req.on('error', (e) => resolve({ status: 'ERR:' + e.code, body: e.message }));
    req.write(body);
    req.end();
  });
}

function mkPayloadFor(planId, overridePD = {}, overrideTop = {}) {
  const yr = new Date().getFullYear();

  // Default member: 35yo adult male
  const defaultDetail = { gender:'M', dob:`01/01/${yr-35}`, adult:'A' };

  // Plan-specific member ages
  const seniorDetail   = { gender:'M', dob:`01/01/${yr-60}`, adult:'A' };
  const details = (planId === 'prime-senior') ? [seniorDetail] : [defaultDetail];

  const pd = {
    coverType: 'INDI',
    sumInsured: '3000000',
    pinCode: '400001',
    zone: 'ZONE1',
    allInsuredAreResidentIndian: 'Y',
    createDate: today(),
    coverTypeInfo: { adultCount:1, peopleCount:1, childCount:0, details },
    ...overridePD,
  };

  return {
    preparedData: pd,
    leadId: `cltest${Date.now().toString(36)}`, isSingleProduct:'N', paymentMode:'', emailAddress:'', mobileNumber:'',
    isWorkSite:'N', suggestionSet:'Set0', variant:'', tenure:'1', frequency:'SINGLE',
    deductable:'0', deductableType:'', isEmployee:'N', renewalDiscount:'N',
    channelId:'', parentAgencyId:'', portability:'N', posp:'N', sourceType:'NB',
    healthCheckUp:null, ciRider:null, nonMedicalCover:null, opdSA:null, optionalPackage:null,
    personalAccident:null, bonusBooster:null, iftcRider:null, inputMode:'5',
    isMchiCustomer:'N', waiverCoPay:null, waiverSubLimit:null, worldWideCover:null,
    isZoneUpgrade:false, agentId:'', agentName:'', businessFor:'', skip:false,
    agentMobileNum:'', agentEmailId:'',
    ...overrideTop,
  };
}

async function testVariants(label, svc, variants, authOverride) {
  console.log(`\n── ${label} (${svc}) ──`);
  for (const [varLabel, pd, top] of variants) {
    const result = authOverride
      ? await postWithAuth(svc, mkPayloadFor(label, pd, top), authOverride)
      : await post(svc, mkPayloadFor(label, pd, top));
    const s = result.status === 200 ? '✅' : result.status === 500 ? '⚠️ ' : '❌';
    console.log(`  ${s} ${String(result.status).padEnd(4)} [${varLabel}]`);
    if (result.status === 200) console.log(`         ${result.body.substring(0,280)}`);
  }
}

// Minimal payload — no null fields, only required keys
function mkMinimal(si, age, extraPD = {}, extraTop = {}) {
  const yr = new Date().getFullYear();
  const n = new Date();
  const dateStr = `${String(n.getDate()).padStart(2,'0')}/${String(n.getMonth()+1).padStart(2,'0')}/${yr}`;
  return {
    preparedData: {
      coverType: 'INDI', sumInsured: si, pinCode: '400001', zone: 'ZONE1',
      allInsuredAreResidentIndian: 'Y', createDate: dateStr,
      coverTypeInfo: { adultCount:1, peopleCount:1, childCount:0,
        details: [{ gender:'M', dob:`01/01/${yr-age}`, adult:'A' }] },
      ...extraPD
    },
    leadId: `cltest${Date.now().toString(36)}`,
    tenure: '1', frequency: 'SINGLE', sourceType: 'NB', inputMode: '5',
    isSingleProduct: 'N', suggestionSet: 'Set0', variant: '',
    portability: 'N', isEmployee: 'N', renewalDiscount: 'N', isZoneUpgrade: false,
    posp: 'N', isMchiCustomer: 'N', skip: false,
    ...extraTop
  };
}

function postWithAuth(svc, payload, authHeader) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ encodedString: encryptECB(payload) });
    const url  = new URL(`${GATEWAY}/${svc}/udaanapi/quoteservice/viewPlans`);
    const hdrs = { ...HEADERS, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (authHeader) hdrs['Authorization'] = authHeader;
    const opts = { hostname: url.hostname, path: url.pathname, method:'POST', timeout:10000, headers: hdrs };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data.substring(0, 300) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status:'TIMEOUT', body:'' }); });
    req.on('error', e => resolve({ status:'ERR:'+e.code, body: e.message }));
    req.write(body);
    req.end();
  });
}

function decryptECB(b64) {
  const decipher = crypto.createDecipheriv('aes-128-ecb', AES_KEY, Buffer.alloc(0));
  decipher.setAutoPadding(true);
  return decipher.update(Buffer.from(b64, 'base64'), null, 'utf8') + decipher.final('utf8');
}

// ── q=-style payload builder (used by Senior/STU/Sarvah/PA/AS/CI) ──
// Field names are UPPERCASE/PascalCase as seen in the decrypted q= URL param
function buildQPayload(si, age, gender='M', extraPD={}, extraTop={}) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2,'0');
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const yr = now.getFullYear();
  const createDateISO = `${yr}-${mm}-${dd}`;
  const dob = `${dd}/${mm}/${yr - age}`;
  const gStr = gender === 'M' ? 'MALE' : 'FEMALE';
  const siStr = String(si);

  return {
    preparedData: {
      All_Insured_Are_Resident_Indian: 'YES',
      sumInsured2: siStr,
      coverTypeInfo: {
        adultCount: 1, peopleCount: 1, childCount: 0,
        details: [{ DOB: dob, GENDER: gStr, Adult: 'YES' }],
      },
      portability: 'NO',
      parentagencyid: '',
      paymentMode: '',
      emailAddress: '',
      mobileNumber: '',
      sumInsured: siStr,
      zone: 'ZONE1',
      pinCode: '400001',
      tenure: '1',
      createDate: createDateISO,
      channel: '',
      agentId: '',
      agentName: '',
      agentMobileNum: '',
      agentEmailId: '',
      branchId: '',
      employeeCodeOrSpCode: '',
      employeeNameOrSpName: '',
      parentagencyname: '',
      mappedirdalocation: '',
      businesscreditchannel: '',
      pan: '',
      flowType: 'advisor',
      businessFor: '',
      skip: false,
      refA: '', refB: '', refC: '',
      ...extraPD,
    },
    ...extraTop,
  };
}

// buildQPayload + standard top-level fields (leadId, tenure, etc.)
function buildQPayloadFull(si, age, gender='M', extraPD={}) {
  const base = buildQPayload(si, age, gender, extraPD);
  return {
    ...base,
    leadId: `cltest${Date.now().toString(36)}`,
    isSingleProduct: 'N', paymentMode: '', emailAddress: '', mobileNumber: '',
    isWorkSite: 'N', suggestionSet: 'Set0', variant: '', tenure: '1',
    frequency: 'SINGLE', deductable: '0', deductableType: '', isEmployee: 'N',
    renewalDiscount: 'N', channelId: '', parentAgencyId: '',
    portability: 'N', posp: 'N', sourceType: 'NB',
    healthCheckUp: null, ciRider: null, nonMedicalCover: null, opdSA: null,
    optionalPackage: null, personalAccident: null, bonusBooster: null, iftcRider: null,
    inputMode: '5', isMchiCustomer: 'N', waiverCoPay: null, waiverSubLimit: null,
    worldWideCover: null, isZoneUpgrade: false, agentId: '', agentName: '',
    businessFor: '', skip: false, agentMobileNum: '', agentEmailId: '',
  };
}

// Low-level POST: raw headers, custom auth, optional extra headers
function postRaw(svc, payload, authHeader, extraHeaders = {}) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ encodedString: encryptECB(payload) });
    const url  = new URL(`${GATEWAY}/${svc}/udaanapi/quoteservice/viewPlans`);
    const hdrs = {
      ...HEADERS,
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...extraHeaders,
    };
    if (authHeader) hdrs['Authorization'] = authHeader;
    const opts = { hostname: url.hostname, path: url.pathname, method:'POST', timeout:10000, headers: hdrs };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d.substring(0, 500) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status:'TIMEOUT', body:'' }); });
    req.on('error', e => resolve({ status:'ERR:'+e.code, body: e.message }));
    req.write(body); req.end();
  });
}

async function main() {
  console.log('=== MANIPALCIGNA PROBE v7 (OAuth + header sweep) ===\n');

  const lbl = (s) => {
    const sym = s===200?'✅':s===401?'🔑':s===403?'🚫':s===500?'⚠️ ':s==='TIMEOUT'?'⏱ ':'❌';
    return `  ${sym} ${String(s).padEnd(8)}`;
  };

  const seniorSvc = 'sellonlineseniorquickquoteservice';
  const seniorPay = mkPayloadFor('prime-senior', { sumInsured:'1000000' }, {});

  // ─────────────────────────────────────────────────────────────────────
  // SECTION 1: OAuth token exchange attempts
  // Hypothesis: Wkt/Wpt are OAuth client_id:client_secret — must exchange
  // for Bearer token before calling viewPlans
  // ─────────────────────────────────────────────────────────────────────
  console.log('── SECTION 1: OAuth token exchange ──');

  async function tryTokenEndpoint(label, url, credBasic) {
    return new Promise((resolve) => {
      const body = 'grant_type=client_credentials';
      const u = new URL(url);
      const opts = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        timeout: 8000,
        headers: {
          'Authorization':  credBasic,
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'Accept':         'application/json',
          'Origin':         'https://online.manipalcigna.com',
          'Referer':        'https://online.manipalcigna.com/',
          'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      };
      const req = https.request(opts, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          const result = { status: res.statusCode, body: d.substring(0, 400) };
          console.log(`${lbl(res.statusCode)} [${label}]`);
          if (res.statusCode === 200) console.log('    TOKEN BODY:', result.body);
          resolve(result);
        });
      });
      req.on('timeout', () => { req.destroy(); console.log(`  ⏱  TIMEOUT  [${label}]`); resolve({ status:'TIMEOUT', body:'' }); });
      req.on('error', e => { console.log(`  ❌ ERR      [${label}] ${e.message}`); resolve({ status:'ERR', body: e.message }); });
      req.write(body); req.end();
    });
  }

  // Common OAuth2 token endpoints to try
  const tokenEndpoints = [
    ['gateway /oauth/token (Wkt)', `${GATEWAY}/oauth/token`, AUTH],
    ['gateway /token (Wkt)',       `${GATEWAY}/token`,       AUTH],
    ['gateway /auth/token (Wkt)',  `${GATEWAY}/auth/token`,  AUTH],
    ['sellonline /oauth/token (Wkt)', `${GATEWAY}/sellonline/oauth/token`, AUTH],
    ['senior-svc /oauth/token (Wkt)', `${GATEWAY}/${seniorSvc}/oauth/token`, AUTH],
    ['senior-svc /token (Wkt)',       `${GATEWAY}/${seniorSvc}/token`,       AUTH],
    ['gateway /oauth/token (Wpt)', `${GATEWAY}/oauth/token`, AUTH_WPT],
    ['sellonline /v1/token (Wkt)', `${GATEWAY}/sellonline/v1/token`, AUTH],
  ];

  let bearerToken = null;
  for (const [label, url, cred] of tokenEndpoints) {
    const r = await tryTokenEndpoint(label, url, cred);
    if (r.status === 200) {
      try {
        const j = JSON.parse(r.body);
        if (j.access_token) { bearerToken = `Bearer ${j.access_token}`; console.log('  🎉 Got Bearer token!'); break; }
      } catch(_) {}
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // SECTION 2: Test Senior viewPlans with Bearer token (if obtained)
  // ─────────────────────────────────────────────────────────────────────
  if (bearerToken) {
    console.log('\n── SECTION 2: Senior viewPlans with Bearer token ──');
    const r = await postRaw(seniorSvc, seniorPay, bearerToken);
    console.log(`${lbl(r.status)} Senior + Bearer`);
    if (r.status === 200) console.log('    BODY:', r.body);
  }

  // ─────────────────────────────────────────────────────────────────────
  // SECTION 3: Header sweep on Senior — what header makes it work?
  // Try all permutations the browser might send that Node doesn't
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n── SECTION 3: Senior header sweep ──');

  const headerVariants = [
    ['no-auth (public?)',    null,     {}],
    ['Wkt + XHR header',    AUTH,     { 'X-Requested-With': 'XMLHttpRequest' }],
    ['Wkt + XSRF token',    AUTH,     { 'X-XSRF-TOKEN': 'fetch', 'X-Requested-With': 'XMLHttpRequest' }],
    ['Wkt + referer-exact', AUTH,     { 'Referer': 'https://online.manipalcigna.com/get-product-quote/calculate-prime-senior-insurance/quick-quote/your-quote' }],
    ['Wkt + no-CT',         AUTH,     { 'Content-Type': undefined }],  // might reveal if CT matters
    ['Wpt + XHR header',    AUTH_WPT, { 'X-Requested-With': 'XMLHttpRequest' }],
    ['Wkt + x-api-key(wkt-raw)', AUTH, { 'x-api-key': 'Z01GMkx0amJZUDVGNTVuUnBVdzUrU09hWktTZTNhc1Y6UFFRZE1oaG5wTHUvS2wwMzNUUHNhT25heEZpRW14YXo=' }],
    ['Wkt + x-api-key(wpt-raw)', AUTH, { 'x-api-key': 'Z01GMkx0amJZUDVGNTVuUnBVdzUrU09hWptTZTNhc1Y6UFFRZE1oaG5wTHUvS2wwMzNUUHNhT25heEZpRW14YXo=' }],
  ];

  for (const [label, auth, extra] of headerVariants) {
    const hdrs = { ...extra };
    if (hdrs['Content-Type'] === undefined) delete hdrs['Content-Type'];
    const r = await postRaw(seniorSvc, seniorPay, auth, hdrs);
    console.log(`${lbl(r.status)} [${label}]`);
    if (r.status !== 500) console.log('    BODY:', r.body);
    if (r.status === 200) console.log('    HEADERS:', JSON.stringify(r.headers).substring(0,200));
  }

  // ─────────────────────────────────────────────────────────────────────
  // SECTION 4: Payload format sweep — maybe Senior has completely
  // different expected fields than Prime/LT
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n── SECTION 4: Minimal / alternate payload sweep (Senior) ──');

  // Try: ULTRA-minimal payload (just the bare minimum coverTypeInfo)
  const ultraMinimal = {
    sumInsured: '1000000',
    pinCode: '400001',
    zone: 'ZONE1',
    allInsuredAreResidentIndian: 'Y',
    createDate: today(),
    coverTypeInfo: { adultCount:1, peopleCount:1, childCount:0,
      details: [{ gender:'M', dob:`01/01/${new Date().getFullYear()-60}`, adult:'A' }] },
  };

  // Try: Only the preparedData without top-level wrapper (maybe they don't need outer fields)
  const justPD = {
    coverType: 'INDI',
    sumInsured: '1000000',
    pinCode: '400001',
    zone: 'ZONE1',
    allInsuredAreResidentIndian: 'Y',
    createDate: today(),
    coverTypeInfo: { adultCount:1, peopleCount:1, childCount:0,
      details: [{ gender:'M', dob:`01/01/${new Date().getFullYear()-60}`, adult:'A' }] },
  };

  // Try: Senior with coverType = 'SENIOR' or 'SEN' or 'INDV'
  const ctSenior = mkPayloadFor('prime-senior', { sumInsured:'1000000', coverType:'SENIOR' }, {});
  const ctSen    = mkPayloadFor('prime-senior', { sumInsured:'1000000', coverType:'SEN' }, {});
  const ctIndv   = mkPayloadFor('prime-senior', { sumInsured:'1000000', coverType:'INDV' }, {});

  const payloadVariants = [
    ['ultra-minimal (flat)',           { encodedString: encryptECB(ultraMinimal) }],
    ['flat preparedData only',         { encodedString: encryptECB(justPD) }],
    ['coverType=SENIOR',               { encodedString: encryptECB(ctSenior) }],
    ['coverType=SEN',                  { encodedString: encryptECB(ctSen) }],
    ['coverType=INDV',                 { encodedString: encryptECB(ctIndv) }],
    ['standard camelCase (baseline)',  { encodedString: encryptECB(seniorPay) }],
  ];

  for (const [label, bodyObj] of payloadVariants) {
    const r = await new Promise((resolve) => {
      const body = JSON.stringify(bodyObj);
      const url = new URL(`${GATEWAY}/${seniorSvc}/udaanapi/quoteservice/viewPlans`);
      const opts = {
        hostname: url.hostname, path: url.pathname, method: 'POST', timeout: 10000,
        headers: { ...HEADERS, 'Authorization': AUTH, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) },
      };
      const req = https.request(opts, (res) => {
        let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode,body:d.substring(0,300)}));
      });
      req.on('timeout',()=>{req.destroy();resolve({status:'TIMEOUT',body:''})});
      req.on('error',e=>resolve({status:'ERR',body:e.message}));
      req.write(body); req.end();
    });
    console.log(`${lbl(r.status)} [${label}]`);
    if (r.status !== 500) console.log('    BODY:', r.body);
  }

  // ─────────────────────────────────────────────────────────────────────
  // SECTION 5: ProHealth Prime — why empty Card:[] ?
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n── SECTION 5: ProHealth Prime — fix empty cards ──');
  const primeSvc = 'sellonlineprimequickquoteservice';

  const primeVariants = [
    ['35yo  SI=5L  INDI', mkPayloadFor('prime', {sumInsured:'500000',  coverType:'INDI'}, {})],
    ['35yo  SI=10L INDI', mkPayloadFor('prime', {sumInsured:'1000000', coverType:'INDI'}, {})],
    ['35yo  SI=5L  INDV', mkPayloadFor('prime', {sumInsured:'500000',  coverType:'INDV'}, {})],
    ['35yo  SI=5L  IND',  mkPayloadFor('prime', {sumInsured:'500000',  coverType:'IND'},  {})],
    ['25yo  SI=5L  INDI', (() => { const yr=new Date().getFullYear(); return { preparedData:{ coverType:'INDI', sumInsured:'500000', pinCode:'400001', zone:'ZONE1', allInsuredAreResidentIndian:'Y', createDate:today(), coverTypeInfo:{ adultCount:1, peopleCount:1, childCount:0, details:[{gender:'M',dob:`01/01/${yr-25}`,adult:'A'}] } }, leadId:`cl${Date.now().toString(36)}`, isSingleProduct:'N', paymentMode:'', emailAddress:'', mobileNumber:'', isWorkSite:'N', suggestionSet:'Set0', variant:'', tenure:'1', frequency:'SINGLE', deductable:'0', deductableType:'', isEmployee:'N', renewalDiscount:'N', channelId:'', parentAgencyId:'', portability:'N', posp:'N', sourceType:'NB', healthCheckUp:null, ciRider:null, nonMedicalCover:null, opdSA:null, optionalPackage:null, personalAccident:null, bonusBooster:null, iftcRider:null, inputMode:'5', isMchiCustomer:'N', waiverCoPay:null, waiverSubLimit:null, worldWideCover:null, isZoneUpgrade:false, agentId:'', agentName:'', businessFor:'', skip:false, agentMobileNum:'', agentEmailId:'' }; })()],
    ['35yo  SI=5L  zone=ZONE2', mkPayloadFor('prime', {sumInsured:'500000', zone:'ZONE2'}, {})],
    ['35yo  SI=5L  pin=110001', mkPayloadFor('prime', {sumInsured:'500000', pinCode:'110001', zone:'ZONE1'}, {})],
  ];

  for (const [label, payload] of primeVariants) {
    const r = await postRaw(primeSvc, payload, AUTH_WPT);
    console.log(`${lbl(r.status)} [${label}]`);
    if (r.status === 200) console.log('    BODY:', r.body.substring(0, 300));
  }
}

main().catch(console.error);

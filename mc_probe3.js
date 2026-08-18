/**
 * mc_probe3.js — variant sweep for ProHealth Prime + Accident Shield full-SI sweep
 *
 * From probe2: ProHealth Prime returns 200+empty-cards for ALL ages/SIs/pins with INDI.
 * Hypothesis: needs a `variant` field specifying the sub-plan.
 * Accident Shield gets 200+Status=Fail for all tested combos — try all SIs.
 *
 * Run: node mc_probe3.js
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

function ageToDOB(age) {
  const n = new Date();
  return `${String(n.getDate()).padStart(2,'0')}/${String(n.getMonth()+1).padStart(2,'0')}/${n.getFullYear()-age}`;
}
function todayStr() {
  const n = new Date();
  return `${String(n.getDate()).padStart(2,'0')}/${String(n.getMonth()+1).padStart(2,'0')}/${n.getFullYear()}`;
}
function cuid() {
  return 'c'+Math.random().toString(36).slice(2,12)+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
}

function buildBase({ age=35, si=500000, pin='400001', zone='ZONE1', gender='M', variant='', deductible=0, noZone=false }) {
  const pd = {
    coverType: 'INDI',
    sumInsured: String(si),
    pinCode: pin,
    allInsuredAreResidentIndian: 'Y',
    createDate: todayStr(),
    coverTypeInfo: { adultCount:1, peopleCount:1, details:[{ gender, dob:ageToDOB(age), adult:'A', uwLoading:null }] },
  };
  if (!noZone) pd.zone = zone;

  return {
    preparedData: pd,
    isSingleProduct: 'N', isWorkSite: 'N', suggestionSet: 'Set0',
    variant,
    tenure: '1', isEmployee: 'N', worldZone: 'WORLDZONE1', renewalDiscount: 'N',
    channelId: '', parentAgencyId: '', portability: 'N', posp: 'N', sourceType: 'NB',
    deductable: deductible > 0 ? String(deductible) : '0',
    opdRider: 'N', opdRiderPackage: null, opdRiderSA: null,
    shield: 'N', roomUpgrade: 'N', pedReduction: 'N', restorationOfSA: 'N',
    premiumManagement: 'N', coPayment: '999', standingInstruction: 'N',
    inputMode: '5', isMchiCustomer: 'N', isDirectPolicy: 'N', socialMedia: 'N',
    isZoneUpgrade: false,
    leadId: cuid(),
    paymentMode: '', emailAddress: '', mobileNumber: '',
    agentId: '', agentName: '', businessFor: '', skip: false,
    agentMobileNum: '', agentEmailId: '', branchId: '',
    employeeCodeOrSpCode: '', employeeNameOrSpName: '', parentagencyname: '',
  };
}

function postPlain(svc, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const url  = new URL(`${GATEWAY}/${svc}/udaanapi/quoteservice/viewPlans`);
    const opts = {
      hostname: url.hostname, path: url.pathname, method: 'POST', timeout: 15000,
      headers: { ...BASE_HEADERS, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch(_) {}
        resolve({ status: res.statusCode, body: d, json });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status:'TIMEOUT', body:'', json:null }); });
    req.on('error', e => resolve({ status:'ERR:'+e.code, body:e.message, json:null }));
    req.write(body); req.end();
  });
}

function report(r, label) {
  const sym = r.status===200?'✅':r.status===500?'⚠️ ':'❌';
  const resp = r.json?.response || r.json;
  const cards = (resp?.Card||[]).filter(c=>c.Status==='Success'||!c.Status);
  let detail = '';
  if (r.status===200) {
    detail = cards.length > 0
      ? `  🎉 ${cards.length} card(s): ${cards.slice(0,4).map(c=>c.SuggestionName||'?').join(', ')}`
      : `  Status=${resp?.Status||'?'} Err=${JSON.stringify(resp?.ErrorMessage||[]).substring(0,80)}`;
  } else if (r.status!==500) {
    detail = `  ${r.body.substring(0,100)}`;
  }
  console.log(`  ${sym} ${String(r.status).padEnd(4)} ${label}${detail?'\n'+detail:''}`);
}

async function main() {
  console.log('=== mc_probe3: variant sweep + AS full-SI ===\n');

  const primeSvc = 'sellonlineprimequickquoteservice';
  const asSvc    = 'sellonlineasquickquoteservice';
  const paSvc    = 'sellonlinepaquickquoteservice';

  // ── A: ProHealth Prime — variant field sweep ──────────────────────
  // The plan has 4 sub-products on the MC website. variant='' gives empty cards.
  // Try all plausible variant identifiers.
  console.log('── A: ProHealth Prime — variant field values ──');
  const variants = [
    '',                    // baseline (known = empty cards)
    'ProHealth Plus',
    'ProHealth Protect',
    'ProHealth Accumulate',
    'ProHealth Premier',
    'PROHEALTH_PLUS',
    'PROHEALTH_PROTECT',
    'PROHEALTH_ACCUMULATE',
    'PROHEALTH_PREMIER',
    'ProHealthPlus',
    'ProHealthProtect',
    'ProHealthAccumulate',
    'ProHealthPremier',
    'PHP',
    'PHPr',
    'PHA',
    'PHPm',
    'PRIME_PLUS',
    'PRIME_PROTECT',
    'prime-plus',
    'prime-protect',
    'Set1',               // maybe suggestionSet matters
    'Set2',
    'Set3',
  ];

  for (const v of variants) {
    const payload = buildBase({ age:35, si:500000, pin:'400001', zone:'ZONE1', variant:v });
    // Also try variant in suggestionSet
    const r = await postPlain(primeSvc, payload);
    const label = v === '' ? '(empty — baseline)' : `variant="${v}"`;
    report(r, label);
  }

  // ── B: ProHealth Prime — suggestionSet sweep (variant='') ─────────
  console.log('\n── B: ProHealth Prime — suggestionSet values ──');
  const suggestionSets = ['Set0','Set1','Set2','Set3','ALL','all','PRIME','prime'];
  for (const ss of suggestionSets) {
    const payload = buildBase({ age:35, si:500000, pin:'400001', zone:'ZONE1' });
    payload.suggestionSet = ss;
    const r = await postPlain(primeSvc, payload);
    report(r, `suggestionSet="${ss}"`);
  }

  // ── C: ProHealth Prime — isSingleProduct sweep ────────────────────
  console.log('\n── C: ProHealth Prime — isSingleProduct values ──');
  for (const isp of ['Y','N','y','n']) {
    const payload = buildBase({ age:35, si:500000, pin:'400001', zone:'ZONE1' });
    payload.isSingleProduct = isp;
    const r = await postPlain(primeSvc, payload);
    report(r, `isSingleProduct="${isp}"`);
  }

  // ── D: ProHealth Prime — with worldwideEmergency=Y like Lifetime ──
  console.log('\n── D: ProHealth Prime — extra Lifetime-style fields ──');
  const ltExtras = [
    ['+ worldwideEmergency', { worldwideEmergency:'Y', worldwideEmergencySA:'2500000' }],
    ['+ mode=all',           { mode:'all' }],
    ['+ healthCheckUp=N',    { healthCheckUp:'N' }],
    ['+ ciRider=N',          { ciRider:'N', ciRiderSA:null }],
    ['+ shield=Y',           { shield:'Y' }],
  ];
  for (const [label, extra] of ltExtras) {
    const payload = { ...buildBase({ age:35, si:500000, pin:'400001', zone:'ZONE1' }), ...extra };
    const r = await postPlain(primeSvc, payload);
    report(r, label);
  }

  // ── E: Accident Shield — full SI range sweep (no zone field) ─────
  // AS consistently 200+fail. Try every valid SI with no zone.
  console.log('\n── E: Accident Shield — full SI range (no zone) ──');
  const asSIs = [200000, 300000, 500000, 1000000, 1500000, 2000000, 3000000, 5000000];
  const asPins = [['Mumbai','400001','ZONE1'],['Delhi','110001','ZONE1'],['Blore','560001','ZONE2']];
  for (const [city, pin] of asPins) {
    for (const si of asSIs) {
      const payload = buildBase({ age:35, si, pin, zone:'ZONE1', noZone:true });
      const r = await postPlain(asSvc, payload);
      const resp = r.json?.response||r.json;
      const cards = (resp?.Card||[]).filter(c=>c.Status==='Success'||!c.Status);
      if (cards.length > 0 || r.status !== 500) {
        report(r, `AS ${city} SI=${si/100000}L noZone`);
      }
    }
  }

  // ── F: Accident Shield — with zone field (for comparison) ────────
  console.log('\n── F: Accident Shield — WITH zone field ──');
  for (const si of [200000, 500000, 1000000, 2000000]) {
    const payload = buildBase({ age:35, si, pin:'400001', zone:'ZONE1', noZone:false });
    const r = await postPlain(asSvc, payload);
    report(r, `AS Mumbai SI=${si/100000}L zone=ZONE1`);
  }

  // ── G: PA — also try no-zone (same as AS) ────────────────────────
  console.log('\n── G: Personal Accident — no zone field ──');
  for (const si of [500000, 1000000, 2000000, 3000000, 5000000, 10000000]) {
    const payload = buildBase({ age:35, si, pin:'110001', zone:'ZONE1', noZone:true });
    const r = await postPlain(paSvc, payload);
    if (r.status !== 500) report(r, `PA Delhi SI=${si/100000}L noZone`);
    else console.log(`  ⚠️  500  PA Delhi SI=${si/100000}L noZone`);
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);

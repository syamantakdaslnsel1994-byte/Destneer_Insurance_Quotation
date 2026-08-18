/**
 * mc_probe4.js — Accident Shield occupation + PA occupation sweep
 *
 * AS returns 200+Status=Fail with empty cards for ALL SI/pin combos tested.
 * PA/AS plans traditionally require occupation type. This probe adds every
 * plausible occupation field combination to the payload.
 *
 * Run: node mc_probe4.js
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

function basePayload(extraPD = {}, extraTop = {}) {
  return {
    preparedData: {
      coverType: 'INDI',
      sumInsured: '500000',
      pinCode: '400001',
      allInsuredAreResidentIndian: 'Y',
      createDate: todayStr(),
      coverTypeInfo: {
        adultCount: 1, peopleCount: 1,
        details: [{ gender:'M', dob: ageToDOB(35), adult:'A', uwLoading: null }],
      },
      ...extraPD,
    },
    isSingleProduct: 'N', isWorkSite: 'N', suggestionSet: 'Set0', variant: '',
    tenure: '1', isEmployee: 'N', worldZone: 'WORLDZONE1', renewalDiscount: 'N',
    channelId: '', parentAgencyId: '', portability: 'N', posp: 'N', sourceType: 'NB',
    deductable: '0', opdRider: 'N', opdRiderPackage: null, opdRiderSA: null,
    shield: 'N', roomUpgrade: 'N', pedReduction: 'N', restorationOfSA: 'N',
    premiumManagement: 'N', coPayment: '999', standingInstruction: 'N',
    inputMode: '5', isMchiCustomer: 'N', isDirectPolicy: 'N', socialMedia: 'N',
    isZoneUpgrade: false, leadId: cuid(),
    paymentMode: '', emailAddress: '', mobileNumber: '',
    agentId: '', agentName: '', businessFor: '', skip: false,
    agentMobileNum: '', agentEmailId: '', branchId: '',
    employeeCodeOrSpCode: '', employeeNameOrSpName: '', parentagencyname: '',
    ...extraTop,
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
      : `  Status=${resp?.Status||'?'} Err=${JSON.stringify(resp?.ErrorMessage||[]).substring(0,100)}`;
  } else if (r.status!==500) {
    detail = `  ${r.body.substring(0,120)}`;
  }
  console.log(`  ${sym} ${String(r.status).padEnd(4)} ${label}${detail?'\n'+detail:''}`);
}

async function main() {
  console.log('=== mc_probe4: Occupation field sweep for PA + AS ===\n');

  const asSvc = 'sellonlineasquickquoteservice';
  const paSvc = 'sellonlinepaquickquoteservice';

  // ── A: AS — occupation field in preparedData ─────────────────────
  // Try adding occupation/income fields inside preparedData
  console.log('── A: Accident Shield — occupation in preparedData ──');
  const occupationCodes = [
    '1',  // Sedentary / Office
    '2',  // Light manual
    '3',  // Moderate manual
    '4',  // Heavy manual
    'A',
    'B',
    'C',
    'D',
    'E',
    'I',
    'II',
    'III',
    'IV',
    'SEDENTARY',
    'OFFICE',
    'PROFESSIONAL',
    'SELF_EMPLOYED',
    'SALARIED',
    'HOUSEWIFE',
    'STUDENT',
  ];

  for (const occ of occupationCodes) {
    const p = basePayload({ occupation: occ });
    const r = await postPlain(asSvc, p);
    const resp = r.json?.response || r.json;
    const cards = (resp?.Card||[]).filter(c=>c.Status==='Success'||!c.Status);
    if (cards.length > 0) {
      report(r, `occupation="${occ}" IN preparedData`);
      console.log('  🎉 FOUND CARDS WITH THIS OCCUPATION!');
    } else if (r.status !== 200) {
      report(r, `occupation="${occ}" IN preparedData`);
    }
    // print Status=Success hits or non-standard failures
    if (r.status===200 && resp?.Status !== 'Fail') {
      report(r, `occupation="${occ}" IN preparedData`);
    }
  }
  console.log('  (All 200+Fail results omitted — same as baseline if not shown above)');

  // ── B: AS — occupation field at top level ─────────────────────────
  console.log('\n── B: Accident Shield — occupation at top level ──');
  const topOccCodes = ['1','2','3','4','A','B','C','D','OFFICE','SALARIED','PROFESSIONAL'];
  for (const occ of topOccCodes) {
    const p = basePayload({}, { occupation: occ });
    const r = await postPlain(asSvc, p);
    const resp = r.json?.response || r.json;
    const cards = (resp?.Card||[]).filter(c=>c.Status==='Success'||!c.Status);
    if (cards.length > 0 || r.status !== 200 || (r.status===200 && resp?.Status !== 'Fail')) {
      report(r, `occupation="${occ}" at top level`);
    }
  }
  console.log('  (All 200+Fail results omitted)');

  // ── C: AS — occupationType field (common MC field name) ──────────
  console.log('\n── C: Accident Shield — occupationType field ──');
  const occTypeCodes = ['1','2','3','4','A','B','C','D','E','OFFICE','SALARIED','PROFESSIONAL','SELF_EMPLOYED'];
  for (const occ of occTypeCodes) {
    // try in preparedData
    const p1 = basePayload({ occupationType: occ });
    const r1 = await postPlain(asSvc, p1);
    const resp1 = r1.json?.response || r1.json;
    const cards1 = (resp1?.Card||[]).filter(c=>c.Status==='Success'||!c.Status);
    if (cards1.length > 0 || r1.status !== 200 || resp1?.Status !== 'Fail') {
      report(r1, `occupationType="${occ}" in preparedData`);
    }
    // try at top level
    const p2 = basePayload({}, { occupationType: occ });
    const r2 = await postPlain(asSvc, p2);
    const resp2 = r2.json?.response || r2.json;
    const cards2 = (resp2?.Card||[]).filter(c=>c.Status==='Success'||!c.Status);
    if (cards2.length > 0 || r2.status !== 200 || resp2?.Status !== 'Fail') {
      report(r2, `occupationType="${occ}" at top level`);
    }
  }
  console.log('  (All 200+Fail results omitted)');

  // ── D: AS — member detail level occupation ───────────────────────
  console.log('\n── D: Accident Shield — occupation inside member details ──');
  const detailOccCodes = ['1','2','3','4','A','B','OFFICE','SALARIED','PROFESSIONAL'];
  for (const occ of detailOccCodes) {
    const p = {
      preparedData: {
        coverType: 'INDI', sumInsured: '500000', pinCode: '400001',
        allInsuredAreResidentIndian: 'Y', createDate: todayStr(),
        coverTypeInfo: {
          adultCount: 1, peopleCount: 1,
          details: [{ gender:'M', dob: ageToDOB(35), adult:'A', uwLoading: null,
            occupation: occ, occupationType: occ, occupationCode: occ }],
        },
      },
      isSingleProduct:'N', isWorkSite:'N', suggestionSet:'Set0', variant:'',
      tenure:'1', isEmployee:'N', worldZone:'WORLDZONE1', renewalDiscount:'N',
      channelId:'', parentAgencyId:'', portability:'N', posp:'N', sourceType:'NB',
      deductable:'0', opdRider:'N', opdRiderPackage:null, opdRiderSA:null,
      shield:'N', roomUpgrade:'N', pedReduction:'N', restorationOfSA:'N',
      premiumManagement:'N', coPayment:'999', standingInstruction:'N',
      inputMode:'5', isMchiCustomer:'N', isDirectPolicy:'N', socialMedia:'N',
      isZoneUpgrade:false, leadId:cuid(),
      paymentMode:'', emailAddress:'', mobileNumber:'',
      agentId:'', agentName:'', businessFor:'', skip:false,
      agentMobileNum:'', agentEmailId:'', branchId:'',
      employeeCodeOrSpCode:'', employeeNameOrSpName:'', parentagencyname:'',
    };
    const r = await postPlain(asSvc, p);
    const resp = r.json?.response || r.json;
    const cards = (resp?.Card||[]).filter(c=>c.Status==='Success'||!c.Status);
    if (cards.length > 0 || r.status !== 200 || resp?.Status !== 'Fail') {
      report(r, `occupation="${occ}" in member details`);
    }
  }
  console.log('  (All 200+Fail results omitted)');

  // ── E: AS — income fields ─────────────────────────────────────────
  console.log('\n── E: Accident Shield — annual income field sweep ──');
  const incomes = ['100000','250000','500000','750000','1000000','2000000','5000000'];
  for (const income of incomes) {
    const p1 = basePayload({ annualIncome: income });
    const r1 = await postPlain(asSvc, p1);
    const resp1 = r1.json?.response || r1.json;
    const cards1 = (resp1?.Card||[]).filter(c=>c.Status==='Success'||!c.Status);
    if (cards1.length > 0 || r1.status !== 200 || resp1?.Status !== 'Fail') {
      report(r1, `annualIncome="${income}" in preparedData`);
    }
  }
  console.log('  (All 200+Fail results omitted)');

  // ── F: PA — same occupation sweep ────────────────────────────────
  console.log('\n── F: Personal Accident — occupation in preparedData ──');
  for (const occ of ['1','2','3','4','A','B','C','D','OFFICE','SALARIED']) {
    const p = basePayload({ occupation: occ });
    const r = await postPlain(paSvc, p);
    if (r.status !== 500) report(r, `PA occupation="${occ}"`);
    else console.log(`  ⚠️  500  PA occupation="${occ}"`);
  }

  // ── G: AS — raw full response dump for Status=Fail case ──────────
  console.log('\n── G: AS full raw response (to check hidden fields) ──');
  const baseR = await postPlain(asSvc, basePayload({}));
  console.log('  Full JSON response:');
  console.log(JSON.stringify(baseR.json, null, 2).substring(0, 1500));

  console.log('\n=== Done ===');
}

main().catch(console.error);

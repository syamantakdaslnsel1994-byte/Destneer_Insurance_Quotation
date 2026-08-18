// verify_mc_plantype.js
// ---------------------------------------------------------------------------
// Starts mc_server.js against a STAND-IN gateway on localhost and asserts what
// it puts on the wire for each Plan Type, plus the resident-Indian flag.
// Nothing reaches ManipalCigna.
//
//     node verify_mc_plantype.js
//
// Exits 1 on failure. No jsdom needed.
// ---------------------------------------------------------------------------
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');

const KEY = Buffer.from('lv39eptlvuhaqqer', 'utf8');
const dec = b64 => {
  const d = crypto.createDecipheriv('aes-128-ecb', KEY, Buffer.alloc(0));
  d.setAutoPadding(true);
  return JSON.parse(d.update(b64, 'base64', 'utf8') + d.final('utf8'));
};

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '\n          ' + JSON.stringify(extra) : '')); }
};

// ── fake upstream: records every payload it is asked to price ────────────────
const seen = [];
const upstream = http.createServer((rq, rs) => {
  let body = '';
  rq.on('data', c => body += c);
  rq.on('end', () => {
    let payload = null;
    try {
      const o = JSON.parse(body || '{}');
      payload = o.encodedString ? dec(o.encodedString) : o;
    } catch (e) { payload = { _unparsed: body.slice(0, 120) }; }
    seen.push({ url: rq.url, payload });

    if (/location-details/.test(rq.url)) {
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      return rs.end(JSON.stringify({ response: { zonecd: 'ZONE2' } }));
    }
    // a minimal successful quote the parser will accept
    rs.writeHead(200, { 'Content-Type': 'application/json' });
    rs.end(JSON.stringify({ response: { zone: 'ZONE2', Card: [{
      Status: 'Success', PlanName: 'Test', SumInsured: '5000000',
      FinalPremiumTable: [{ Tenure: '1', FinalPremium: '12345', TotalPremium: '12345' }],
    }] } }));
  });
});

function post(port, path, obj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(obj);
    const r = http.request({ host: '127.0.0.1', port, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
                 'Origin': 'http://localhost:3003' } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve({ _raw: d.slice(0, 200) }); } }); });
    r.on('error', reject); r.write(body); r.end();
  });
}

const MEMBERS_2A = [
  { type: 'adult', age: 45, gender: 'male',   relation: 'self' },
  { type: 'adult', age: 42, gender: 'female', relation: 'spouse' },
];

(async () => {
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  const upPort = upstream.address().port;

  // point the server's gateway at the fake one
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'mc_server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: '3993',
           MC_GATEWAY: `http://127.0.0.1:${upPort}`,
           MC_AUTH_TOKEN: 'dGVzdDp0ZXN0', MC_AES_KEY: 'lv39eptlvuhaqqer' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', d => log += d);
  srv.stderr.on('data', d => log += d);
  await new Promise(r => setTimeout(r, 1500));

  const cleanup = () => { try { srv.kill(); } catch (e) {} upstream.close(); };

  if (!/listening|running|3993/i.test(log)) {
    console.log('  server did not start:\n' + log.slice(0, 900));
    cleanup(); process.exit(1);
  }

  const lastQuote = () => {
    const q = seen.filter(s => !/location-details/.test(s.url));
    return q.length ? q[q.length - 1].payload : null;
  };
  const coverOf = p => (p && (p.preparedData || p).coverType) || null;
  const residentOf = p => {
    const d = p && (p.preparedData || p);
    return d ? d.allInsuredAreResidentIndian : null;
  };

  console.log('\n── the mapping reaches the wire ──');
  for (const [planType, code] of [['individual','INDI'],['FamilyFloater','INFF'],['multiindividual','INFI']]) {
    seen.length = 0;
    const r = await post(3993, '/api/premium/lifetime-health',
      { members: MEMBERS_2A, sumInsured: 5000000, pincode: '700041', tenure: '1', planType });
    ok(`lifetime-health  ${planType} → ${code}`, coverOf(lastQuote()) === code,
       { sent: coverOf(lastQuote()), report: r.coverTypeReport });
  }

  console.log('\n── every plan format honours it, not just lifetime ──');
  // Sarvah (viewPlansPath), ProHealth Prime (encrypted), Prime Senior (plain),
  // Super Top Up (stu) — all four used to ignore planType entirely.
  const OTHERS = [['sarvah', 5000000], ['prohealth-prime', 5000000], ['super-top-up', 5000000]];
  for (const [plan, si] of OTHERS) {
    seen.length = 0;
    await post(3993, `/api/premium/${plan}`,
      { members: MEMBERS_2A, sumInsured: si, pincode: '700041', tenure: '1', planType: 'individual' });
    ok(`${plan} honours planType`, coverOf(lastQuote()) === 'INDI', { sent: coverOf(lastQuote()) });
  }
  seen.length = 0;
  await post(3993, '/api/premium/prime-senior',
    { members: [{ type:'adult', age:60, gender:'male', relation:'self' },
                { type:'adult', age:58, gender:'female', relation:'spouse' }],
      sumInsured: 1000000, pincode: '700041', tenure: '1', planType: 'individual' });
  ok('prime-senior honours planType', coverOf(lastQuote()) === 'INDI', { sent: coverOf(lastQuote()) });

  console.log('\n── the resident flag ──');
  seen.length = 0;
  await post(3993, '/api/premium/lifetime-health',
    { members: MEMBERS_2A, sumInsured: 5000000, pincode: '700041', tenure: '1', residentIndian: 'NO' });
  ok('NO becomes N on the wire', residentOf(lastQuote()) === 'N', { sent: residentOf(lastQuote()) });
  seen.length = 0;
  await post(3993, '/api/premium/lifetime-health',
    { members: MEMBERS_2A, sumInsured: 5000000, pincode: '700041', tenure: '1', residentIndian: 'YES' });
  ok('YES becomes Y', residentOf(lastQuote()) === 'Y', { sent: residentOf(lastQuote()) });
  seen.length = 0;
  await post(3993, '/api/premium/lifetime-health',
    { members: MEMBERS_2A, sumInsured: 5000000, pincode: '700041', tenure: '1' });
  ok('omitted still defaults to Y', residentOf(lastQuote()) === 'Y', { sent: residentOf(lastQuote()) });

  console.log('\n── old behaviour is unchanged when nothing is asked for ──');
  seen.length = 0;
  let r = await post(3993, '/api/premium/lifetime-health',
    { members: MEMBERS_2A, sumInsured: 5000000, pincode: '700041', tenure: '1' });
  ok('2 members with no planType still gives INFF', coverOf(lastQuote()) === 'INFF', { sent: coverOf(lastQuote()) });
  ok('  → reported as derived from the member count', r.coverTypeReport && r.coverTypeReport.fromMemberCount === true,
     r.coverTypeReport);
  seen.length = 0;
  await post(3993, '/api/premium/lifetime-health',
    { members: [MEMBERS_2A[0]], sumInsured: 5000000, pincode: '700041', tenure: '1' });
  ok('1 member still gives INDI', coverOf(lastQuote()) === 'INDI', { sent: coverOf(lastQuote()) });
  seen.length = 0;
  await post(3993, '/api/premium/lifetime-health',
    { members: [...MEMBERS_2A, { type:'adult', age:70, gender:'male', relation:'father' }],
      sumInsured: 5000000, pincode: '700041', tenure: '1' });
  ok('3 members still gives INFI', coverOf(lastQuote()) === 'INFI', { sent: coverOf(lastQuote()) });

  console.log('\n── the unverified flag ──');
  r = await post(3993, '/api/premium/lifetime-health',
    { members: MEMBERS_2A, sumInsured: 5000000, pincode: '700041', tenure: '1', planType: 'multiindividual' });
  ok('multiindividual is flagged unverified', r.coverTypeReport && r.coverTypeReport.unverified === true, r.coverTypeReport);
  r = await post(3993, '/api/premium/lifetime-health',
    { members: MEMBERS_2A, sumInsured: 5000000, pincode: '700041', tenure: '1', planType: 'FamilyFloater' });
  ok('FamilyFloater is not flagged', r.coverTypeReport && r.coverTypeReport.unverified === false, r.coverTypeReport);
  r = await post(3993, '/api/premium/lifetime-health',
    { members: MEMBERS_2A, sumInsured: 5000000, pincode: '700041', tenure: '1', planType: 'individual' });
  ok('individual is not flagged', r.coverTypeReport && r.coverTypeReport.unverified === false, r.coverTypeReport);

  console.log('\n── a bad planType must not silently become something else ──');
  seen.length = 0;
  r = await post(3993, '/api/premium/lifetime-health',
    { members: MEMBERS_2A, sumInsured: 5000000, pincode: '700041', tenure: '1', planType: 'FLOATER_TYPO' });
  ok('falls back to the member count', coverOf(lastQuote()) === 'INFF', { sent: coverOf(lastQuote()) });
  ok('  → and says so in the report', r.coverTypeReport && r.coverTypeReport.fromMemberCount === true, r.coverTypeReport);
  ok('  → and warns on the console', /Unrecognised planType/.test(log));

  console.log('\n── raw API codes still accepted ──');
  seen.length = 0;
  await post(3993, '/api/premium/lifetime-health',
    { members: MEMBERS_2A, sumInsured: 5000000, pincode: '700041', tenure: '1', planType: 'INFI' });
  ok('INFI passes through', coverOf(lastQuote()) === 'INFI', { sent: coverOf(lastQuote()) });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR: ' + e.message + '\n' + e.stack); process.exit(1); });

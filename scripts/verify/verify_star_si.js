#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  verify_star_si.js — Star Health prices at the sum insured that was asked for
//
//  The defect this guards against: fetchAllPricing priced every result card at
//  getDefaultSI(product) — the value Star's own API nominates as that product's
//  default — and threw away lastPayload.sumInsured entirely. A hub request for
//  5 L, 15 L or 20 L came back priced at 10 L, with the card's own selector
//  also showing 10 L, so nothing on screen or in the hub contradicted it.
//
//  Needs jsdom, which is test-only and not a project dependency:
//      npm install --no-save jsdom
//  Run:  node verify_star_si.js
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const { JSDOM } = require('jsdom');
const W = __dirname + '/../../public/calculators/';

const dom = new JSDOM(fs.readFileSync(W + 'sh_index.html', 'utf8'), {
  runScripts: 'dangerously', url: 'http://localhost:3004/', pretendToBeVisual: true,
  beforeParse(w) {
    // The page must not reach the network during the test.
    w.fetch = () => Promise.reject(new Error('offline'));
  }
});
const w = dom.window;
const G = e => w.eval(e);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '\n          ' + JSON.stringify(extra) : '')); }
}

// A product shaped like Star's recommend-me response: its own ladder and its
// own nominated default, which is not what the operator asked for.
const LADDER = [300000, 500000, 750000, 1000000, 1500000, 2000000, 2500000, 5000000, 10000000];
function product(defaultSI, ladder) {
  return {
    uniqueId: 'u1', subProductCode: 'SP1', subTitle: 'Value Plus',
    productModifyOptions: { form: [{ fields: [
      { id: 'sumInsured',   defaultValue: String(defaultSI),
        options: (ladder || LADDER).map(v => ({ value: String(v), label: (v / 100000) + ' Lakhs' })) },
      { id: 'policyPeriod', defaultValue: '1',
        options: [{ value: '1', label: '1 Year' }, { value: '2', label: '2 Years' }, { value: '3', label: '3 Years' }] },
    ] }] },
  };
}
// A product with no productModifyOptions at all — Star returns these too.
const bare = { uniqueId: 'u2', subProductCode: 'SP2', subTitle: 'Bare' };

setTimeout(() => {
 try {
  console.log('\n── the requested sum insured wins when the product sells it ──');
  w.__p = product(1000000);
  [300000, 500000, 750000, 1000000, 1500000, 2000000, 2500000, 5000000, 10000000].forEach(si => {
    G(`lastPayload = {sumInsured:'${si}', policyPeriod:'1'}`);
    ok((si / 100000) + ' L is priced at ' + (si / 100000) + ' L',
       parseInt(G('wantedSI(window.__p)'), 10) === si, G('wantedSI(window.__p)'));
  });

  console.log('\n── the product default is no longer allowed to override it ──');
  G("lastPayload = {sumInsured:'2000000', policyPeriod:'1'}");
  ok('a 20 L request does not come back as the 10 L default',
     parseInt(G('wantedSI(window.__p)'), 10) !== 1000000);
  w.__p2 = product(500000);                 // a product defaulting to 5 L
  ok('and the same request wins against a 5 L default too',
     parseInt(G('wantedSI(window.__p2)'), 10) === 2000000, G('wantedSI(window.__p2)'));

  console.log('\n── a cover the product does not sell snaps to the nearest rung ──');
  w.__p3 = product(1000000, [500000, 1000000, 2000000]);   // no 15 L on this ladder
  G("lastPayload = {sumInsured:'1500000', policyPeriod:'1'}");
  const snapped = parseInt(G('wantedSI(window.__p3)'), 10);
  ok('15 L snaps to 10 L or 20 L, not to the default by accident',
     snapped === 1000000 || snapped === 2000000, snapped);
  G("lastPayload = {sumInsured:'1900000', policyPeriod:'1'}");
  ok('19 L snaps up to 20 L, the nearer rung',
     parseInt(G('wantedSI(window.__p3)'), 10) === 2000000, G('wantedSI(window.__p3)'));
  G("lastPayload = {sumInsured:'600000', policyPeriod:'1'}");
  ok('6 L snaps down to 5 L, the nearer rung',
     parseInt(G('wantedSI(window.__p3)'), 10) === 500000, G('wantedSI(window.__p3)'));

  console.log('\n── no ladder from the API: fall back, do not invent a value ──');
  G("lastPayload = {sumInsured:'1500000', policyPeriod:'2'}");
  ok('a product with no options falls back to the payload SI',
     String(G('wantedSI(window.__bare || ' + JSON.stringify(bare) + ')')) === '1500000',
     G('wantedSI(' + JSON.stringify(bare) + ')'));

  console.log('\n── policy period gets the same treatment ──');
  G("lastPayload = {sumInsured:'1000000', policyPeriod:'3'}");
  ok('a 3-year request is priced at 3 years', String(G('wantedPP(window.__p)')) === '3', G('wantedPP(window.__p)'));
  G("lastPayload = {sumInsured:'1000000', policyPeriod:'2'}");
  ok('a 2-year request is priced at 2 years', String(G('wantedPP(window.__p)')) === '2', G('wantedPP(window.__p)'));

  console.log('\n── missing or unusable input still yields the default ──');
  G("lastPayload = {sumInsured:'', policyPeriod:'1'}");
  ok('an empty SI falls back to the product default',
     parseInt(G('wantedSI(window.__p)'), 10) === 1000000, G('wantedSI(window.__p)'));
  G("lastPayload = {sumInsured:'not a number', policyPeriod:'1'}");
  ok('a non-numeric SI falls back to the product default',
     parseInt(G('wantedSI(window.__p)'), 10) === 1000000, G('wantedSI(window.__p)'));

  console.log('\n── the card selector agrees with the premium above it ──');
  // renderPlanSkeletons pre-selects wantedSI, so the dropdown under the premium
  // shows what was actually priced rather than the API's default.
  G("lastPayload = {sumInsured:'2000000', policyPeriod:'1', policyType:'FLOATER'}");
  G('lastProducts = [window.__p]');
  G('showSection("results")');
  G('renderPlanSkeletons(lastProducts)');
  const sel = w.document.getElementById('si_u1');
  ok('the card exists', !!sel);
  ok('  → and is pre-selected at the requested 20 L', sel && sel.value === '2000000', sel && sel.value);

  console.log('\n── the sum-insured label is not rounded to whole lakhs ──');
  // shAddToCompare formatted with (n/100000).toFixed(0), so Value Plus's real
  // 7.5 L floor reached the hub as "8 Lakhs" — a cover Star does not sell, and
  // one that misstates the policy by 50,000 in the client's quotation.
  const L = (v, u) => w.shFmtSI(v, u);
  ok('750000 is 7.5 Lakhs, not 8 Lakhs', L(750000,'long') === '7.5 Lakhs', L(750000,'long'));
  ok('  → and 7.5 L in short form',      L(750000) === '7.5 L', L(750000));
  ok('250000 keeps its half lakh',       L(250000,'long') === '2.5 Lakhs', L(250000,'long'));
  ok('whole lakhs gain no decimal',      L(1000000,'long') === '10 Lakhs', L(1000000,'long'));
  ok('  → and neither does 5 L',         L(500000,'long') === '5 Lakhs', L(500000,'long'));
  ok('1 crore reads as 1 Crore',         L(10000000,'long') === '1 Crore', L(10000000,'long'));
  ok('  → 1.5 crore keeps the half',     L(15000000,'long') === '1.5 Crore', L(15000000,'long'));
  ok('  → and 2 crore has no .0',        L(20000000,'long') === '2 Crore', L(20000000,'long'));
  // Star puts 9999999999 in its ladders to mean unlimited. Dividing it gave
  // "1000 Cr" from one formatter and "100000 Lakhs" from the other.
  ok('the unlimited sentinel is named, not divided', L(9999999999,'long') === 'Unlimited', L(9999999999,'long'));
  ok('  → the 9-digit sentinel too',     L(999999999,'long') === 'Unlimited', L(999999999,'long'));
  ok('sub-lakh amounts stay in rupees',  L(50000) === '50,000', L(50000));
  ok('rubbish input is passed through, not turned into NaN',
     L('') === '' && L(null) === '—', [L(''), L(null)]);

  // The label has to survive the round trip: whatever Star writes, the hub's
  // parseSIRupees must read back as the same number, or the report bands the
  // quote lands in are decided by a string the hub cannot parse.
  console.log('\n── the label round-trips through the hub\'s parser ──');
  function parseSIRupees(sa) {           // copy of the hub's parser, by contract
    const s = String(sa == null ? '' : sa).trim();
    if (!s) return null;
    const m = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    let n = parseFloat(m[1]);
    if (!isFinite(n) || n <= 0) return null;
    const sl = s.toLowerCase();
    if      (/\b(cr|crore|crores)\b/.test(sl))       n *= 10000000;
    else if (/\b(lakh|lakhs|lac|lacs|l)\b/.test(sl)) n *= 100000;
    else if (/\b(k|thousand|thousands)\b/.test(sl))  n *= 1000;
    else if (n < 1000)                               n *= 100000;
    return Math.round(n);
  }
  [750000, 500000, 1000000, 1500000, 2000000, 2500000, 5000000, 10000000, 20000000].forEach(v => {
    ok(v + ' survives the round trip', parseSIRupees(L(v,'long')) === v,
       [L(v,'long'), parseSIRupees(L(v,'long'))]);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
 } catch (e) {
  console.error('\nharness error:', e.stack);
  process.exit(2);
 }
}, 600);

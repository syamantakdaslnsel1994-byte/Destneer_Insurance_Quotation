#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  verify_care_plantype.js — Care's Plan Type (portal field_23) survives a
//  stale catalogue.
//
//  The options used to be hard-coded in care_index.html's PLAN_TYPE_MAP. They
//  now live in care_plans.json as each plan's planTypeOptions, so the hub's
//  picker and this form read one source. But care_server.js reads that file
//  once at boot, so a server left running after the file changed still serves
//  the old catalogue — and the first version of this change cleared
//  PLAN_TYPE_MAP unconditionally, which silently hid the Plan Type row for all
//  48 plans. This checks both directions: the catalogue wins when it has the
//  options, and the built-in map survives when it does not.
//
//  Needs jsdom, which is test-only and not a project dependency:
//      npm install --no-save jsdom
//  Run:  node verify_care_plantype.js
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const { JSDOM } = require('jsdom');
const ROOT = __dirname + '/../../';
const W = ROOT + 'public/calculators/';

const CAT = JSON.parse(fs.readFileSync(ROOT + 'data/care_plans.json', 'utf8'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '\n          ' + JSON.stringify(extra) : '')); }
}

// Boot care_index.html against a given /plans payload and report what
// PLAN_TYPE_MAP ended up as.
function boot(catalogue) {
  return new Promise(resolve => {
    const dom = new JSDOM(fs.readFileSync(W + 'care_index.html', 'utf8'), {
      runScripts: 'dangerously', url: 'http://localhost:3005/', pretendToBeVisual: true,
      beforeParse(w) {
        w.fetch = (u) => String(u).includes('/plans')
          ? Promise.resolve({ ok: true, json: () => Promise.resolve(catalogue) })
          : Promise.reject(new Error('offline'));
      },
    });
    setTimeout(() => resolve(dom.window), 700);
  });
}

// The same catalogue with planTypeOptions stripped from every plan — exactly
// what a server booted before the change serves.
function stale(cat) {
  return { ...cat, plans: cat.plans.map(p => { const q = { ...p }; delete q.planTypeOptions; return q; }) };
}

(async () => {
 try {
  console.log('\n── the catalogue is the source of truth ──');
  const fresh = await boot(CAT);
  const M = () => fresh.eval('PLAN_TYPE_MAP');
  ok('care_plans.json carries planTypeOptions',
     CAT.plans.some(p => Array.isArray(p.planTypeOptions)));
  ok('Care Supreme\'s three options load',
     (M()['2813'] || []).join('|') === 'Care Supreme|Senior Premium|Senior Super', M()['2813']);
  ok('Super Mediclaim\'s four load',
     (M()['362'] || []).join('|') === 'Cancer|Critical|Operation|Heart', M()['362']);
  ok('Supreme Enhance\'s two load', (M()['6434'] || []).join('|') === 'Option 1|Option 2', M()['6434']);
  ok('a plan without the field gets no entry', M()['3485'] === undefined);
  // 748 is flagged planTypeField but its options were never captured. It must
  // not acquire an entry, or the form would offer an empty dropdown.
  ok('an uncaptured field gets no entry either', M()['748'] === undefined, M()['748']);

  console.log('\n── a stale catalogue must not blank the map ──');
  const old = await boot(stale(CAT));
  const S = () => old.eval('PLAN_TYPE_MAP');
  ok('the built-in fallback survives', Object.keys(S()).length > 0, Object.keys(S()));
  ok('  → Care Supreme still has its options',
     (S()['2813'] || []).join('|') === 'Care Supreme|Senior Premium|Senior Super', S()['2813']);
  ok('  → Super Mediclaim too',
     (S()['362'] || []).join('|') === 'Cancer|Critical|Operation|Heart', S()['362']);

  console.log('\n── the row shows only for plans that have the field ──');
  // applyFieldConfig() reveals #plan-type-row from PLAN_TYPE_MAP, so with the
  // fresh catalogue it must appear for 2813 and stay hidden for plain Care.
  const doc = fresh.document;
  const row = doc.getElementById('plan-type-row');
  const sel = doc.getElementById('sel-plan-type');
  ok('the row and its select exist', !!row && !!sel);
  // applyFieldConfig(cfg, planId) — cfg only has to be truthy for the Plan Type
  // branch, which reads planId alone.
  const apply = id => fresh.applyFieldConfig({ hasBizType:false }, id);
  apply('2813');
  ok('shown for Care Supreme', row.style.display !== 'none', row.style.display);
  ok('  → populated with its three options',
     Array.from(sel.options).map(o => o.value).join('|') === 'Care Supreme|Senior Premium|Senior Super',
     Array.from(sel.options).map(o => o.value));
  apply('362');
  ok('shown for Super Mediclaim, with its own four options',
     row.style.display !== 'none'
     && Array.from(sel.options).map(o => o.value).join('|') === 'Cancer|Critical|Operation|Heart',
     [row.style.display, Array.from(sel.options).map(o => o.value)]);
  apply('3485');
  ok('hidden for plain Care', row.style.display === 'none', row.style.display);
  apply('748');
  ok('hidden for a flagged plan whose options are uncaptured',
     row.style.display === 'none', row.style.display);

  console.log('\n── every option the catalogue lists is a non-empty string ──');
  let bad = [];
  CAT.plans.forEach(p => {
    if (!Array.isArray(p.planTypeOptions)) return;
    p.planTypeOptions.forEach(o => { if (typeof o !== 'string' || !o.trim()) bad.push([p.id, o]); });
  });
  ok('no blank or non-string options', bad.length === 0, bad);
  const flagged = CAT.plans.filter(p => p.planTypeField).map(p => p.id);
  const listed  = CAT.plans.filter(p => Array.isArray(p.planTypeOptions)).map(p => p.id);
  ok('every plan with the field has the key (even if empty)',
     flagged.every(id => listed.indexOf(id) !== -1),
     flagged.filter(id => listed.indexOf(id) === -1));
  ok('and no plan without the field has options',
     CAT.plans.every(p => p.planTypeField || !(p.planTypeOptions || []).length),
     CAT.plans.filter(p => !p.planTypeField && (p.planTypeOptions || []).length).map(p => p.id));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
 } catch (e) {
  console.error('\nharness error:', e.stack);
  process.exit(2);
 }
})();

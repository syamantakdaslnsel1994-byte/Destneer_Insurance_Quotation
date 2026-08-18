#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  verify_feature_columns.js — the Feature Comparison sheet shows the insurers
//  in the quotation, and says so when a column is not the plan quoted.
//
//  The five columns were transcribed from one client's quotation: two
//  ManipalCigna plans, one Niva, one Care and one HDFC Ergo — an insurer this
//  hub has no calculator for. All five shipped with every report, so a client
//  received a column of terms for a policy that was never quoted, and Star
//  Health (which has no captured features) was silently absent from a table
//  headed "Feature Comparison".
//
//  Needs jsdom, which is test-only and not a project dependency:
//      npm install --no-save jsdom
//  Run:  node verify_feature_columns.js
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const { JSDOM } = require('jsdom');
const W = __dirname + '/';
const feat = JSON.parse(fs.readFileSync(W + 'feature_comparison.json', 'utf8'));
const cat  = JSON.parse(fs.readFileSync(W + 'care_plans.json', 'utf8'));

const dom = new JSDOM(fs.readFileSync(W + 'insurance_hub.html', 'utf8'), {
  runScripts: 'dangerously', url: 'http://localhost:3005/hub', pretendToBeVisual: true,
  beforeParse(w) {
    w.ExcelJS = require('exceljs');
    w.fetch = (u) => {
      const s = String(u);
      if (s.includes('feature_comparison.json')) return Promise.resolve({ok:true, json:()=>Promise.resolve(feat)});
      if (s.includes(':3005/plans'))             return Promise.resolve({ok:true, json:()=>Promise.resolve(cat)});
      return Promise.reject(new Error('offline'));
    };
  }
});
const w = dom.window;
const G = e => w.eval(e);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '\n          ' + JSON.stringify(extra) : '')); }
}

const row = (company, planName) => ({ company, planName, siKey:'10', premium:1, tenor:1 });
const cols = rows => w.featureColumns(rows);
const labels = rows => cols(rows).map(c => c.label.split('\n')[0].trim());
const provs  = rows => cols(rows).map(c => c.provider);

setTimeout(() => {
 try {
  console.log('\n── the file carries provider and plan tags ──');
  ok('all five columns are tagged', feat.plans.every(p => p.provider && p.plan), feat.plans.map(p=>p.provider));
  ok('HDFC Ergo is tagged as an insurer the hub cannot quote',
     feat.plans.some(p => p.provider === 'hdfc'));
  ok('no column claims to be Star', !feat.plans.some(p => p.provider === 'star'));
  ok('each carries its own width and fill',
     feat.plans.every(p => typeof p.width === 'number' && p.fill), feat.plans.map(p=>p.width));

  console.log('\n── only insurers in the quotation get a column ──');
  const careOnly = [row('Care Health', 'Care Supreme')];
  ok('a Care-only quote gets one column', labels(careOnly).length === 1, labels(careOnly));
  ok('  → and it is the Care one', provs(careOnly)[0] === 'care', provs(careOnly));
  ok('  → HDFC Ergo is nowhere in it', !provs(careOnly).includes('hdfc'));

  const three = [row('Care Health','Care'), row('Niva Bupa','Aspire Family Floater'),
                 row('ManipalCigna','ProHealth Prime — Protect')];
  // Four, not three: ManipalCigna has two columns in the file (Sarvah and
  // Lifetime), and quoting the insurer brings both — the operator can see how
  // the two MC products differ even when only one was priced.
  ok('three insurers give four columns, because MC has two',
     cols(three).filter(c => !c.missing).length === 4, labels(three));
  ok('  → both ManipalCigna columns are present',
     provs(three).filter(p => p === 'mc').length === 2, provs(three));
  ok('  → still no HDFC', !provs(three).includes('hdfc'));
  ok('  → and no Star column, since Star was not quoted',
     !provs(three).includes('star'), provs(three));

  console.log('\n── the S Das quotation: four insurers, no exact plan match ──');
  const sdas = three.concat([row('Star Health','Value Plus')]);
  const c4 = cols(sdas);
  ok('Star gets a column even with no data held',
     c4.some(c => c.provider === 'star' && c.missing), provs(sdas));
  ok('  → and it is last, after the columns that have content',
     c4[c4.length - 1].provider === 'star', provs(sdas));
  ok('  → labelled with the insurer name, not a plan',
     c4.find(c => c.provider === 'star').label === 'Star Health');
  ok('  → and its note names what was quoted',
     /No feature data held for Star Health/.test(w.featureColumnNote(c4.find(c=>c.provider==='star')))
     && /Value Plus/.test(w.featureColumnNote(c4.find(c=>c.provider==='star'))),
     w.featureColumnNote(c4.find(c=>c.provider==='star')));
  // None of Care/Niva/MC's columns describe the plan actually quoted here.
  ok('every content column is flagged as a different plan',
     c4.filter(c => !c.missing).every(c => c.matches === false),
     c4.filter(c=>!c.missing).map(c=>[c.plan, c.quotedPlans]));
  const note = w.featureColumnNote(c4.find(c => c.provider === 'care'));
  ok('  → the note names both the column\'s plan and the quoted one',
     /Care Supreme/.test(note) && /You quoted/.test(note) && /Care/.test(note), note);

  console.log('\n── an exact match is not flagged ──');
  const exact = [row('Care Health','Care Supreme'), row('Niva Bupa','ReAssure2.0 Bronze'),
                 row('ManipalCigna','Sarvah Param')];
  const ce = cols(exact);
  ok('Care Supreme matches its column', ce.find(c => c.plan === 'Care Supreme').matches === true);
  ok('  → and carries no note', w.featureColumnNote(ce.find(c => c.plan === 'Care Supreme')) === '');
  ok('ReAssure 2.0 matches too', ce.find(c => c.plan === 'ReAssure 2.0 Bronze').matches === true);
  ok('Sarvah matches its column', ce.find(c => c.plan === 'Sarvah Param').matches === true);
  // MC has two columns; quoting Sarvah must not mark the Lifetime column matched.
  ok('  → but the other ManipalCigna column is still flagged',
     ce.find(c => c.plan === 'Lifetime Health').matches === false,
     ce.filter(c=>c.provider==='mc').map(c=>[c.plan,c.matches]));

  console.log('\n── sourceIndex keeps values in their own column ──');
  // Every feature row's values are positional against the original five. This is
  // the invariant that stops a dropped column shifting one insurer's terms onto
  // another.
  ok('each column remembers where it was transcribed',
     cols(sdas).filter(c => !c.missing).every(c => typeof c.sourceIndex === 'number'));
  const careCol = cols(careOnly)[0];
  ok('Care sat in slot 3 of the original five', careCol.sourceIndex === 3, careCol.sourceIndex);
  const nivaCol = cols([row('Niva Bupa','Aspire')])[0];
  ok('  → and Niva in slot 2', nivaCol.sourceIndex === 2, nivaCol.sourceIndex);
  // Read the room-rent row through the surviving column and check it is Niva's.
  const roomRent = feat.features.find(f => f.feature === 'Room Rent').rows[0].values;
  ok('reading through sourceIndex yields that insurer\'s own value',
     roomRent[nivaCol.sourceIndex] === feat.features[0].rows[0].values[2],
     [roomRent[nivaCol.sourceIndex], roomRent]);

  console.log('\n── nothing quoted, nothing to compare ──');
  ok('an empty quotation yields no columns', cols([]).length === 0);
  ok('  → and an unrecognised insurer alone yields none',
     cols([row('Some Other Insurer','Whatever')]).length === 0,
     labels([row('Some Other Insurer','Whatever')]));

  console.log('\n── the sheet is last in the report ──');
  ok('buildReportSections puts features at the end',
     (() => { const s = G('buildReportSections()').sections; return s[s.length-1].kind === 'features'; })(),
     G('buildReportSections().sections.map(s=>s.kind)'));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
 } catch (e) {
  console.error('\nharness error:', e.stack);
  process.exit(2);
 }
}, 900);

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
const ROOT = __dirname + '/../../';
const feat = JSON.parse(fs.readFileSync(ROOT + 'data/feature_comparison.json', 'utf8'));
const cat  = JSON.parse(fs.readFileSync(ROOT + 'data/care_plans.json', 'utf8'));
const careLive = JSON.parse(fs.readFileSync(ROOT + 'data/care_features_mapped.json', 'utf8'));
const nivaLive = JSON.parse(fs.readFileSync(ROOT + 'data/niva_features_mapped.json', 'utf8'));
const mcLive = JSON.parse(fs.readFileSync(ROOT + 'data/mc_features_mapped.json', 'utf8'));
const starLive = JSON.parse(fs.readFileSync(ROOT + 'data/star_features_mapped.json', 'utf8'));

const dom = new JSDOM(fs.readFileSync(ROOT + 'public/hub/insurance_hub.html', 'utf8'), {
  runScripts: 'dangerously', url: 'http://localhost:3005/hub', pretendToBeVisual: true,
  beforeParse(w) {
    w.ExcelJS = require('exceljs');
    w.fetch = (u) => {
      const s = String(u);
      if (s.includes('feature_comparison.json'))    return Promise.resolve({ok:true, json:()=>Promise.resolve(feat)});
      if (s.includes('care_features_mapped.json'))  return Promise.resolve({ok:true, json:()=>Promise.resolve(careLive)});
      if (s.includes('niva_features_mapped.json'))  return Promise.resolve({ok:true, json:()=>Promise.resolve(nivaLive)});
      if (s.includes('mc_features_mapped.json'))     return Promise.resolve({ok:true, json:()=>Promise.resolve(mcLive)});
      if (s.includes('star_features_mapped.json'))   return Promise.resolve({ok:true, json:()=>Promise.resolve(starLive)});
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
  // 'Care Global' deliberately has no live mapping (see
  // build_care_feature_mapping.js's SKU_TO_SLUG) — used here specifically
  // so this section keeps testing the STATIC column/sourceIndex mechanism,
  // not the live-Care override (that has its own dedicated section below).
  const careOnly = [row('Care Health', 'Care Global')];
  ok('a Care-only quote gets one column', labels(careOnly).length === 1, labels(careOnly));
  ok('  → and it is the Care one', provs(careOnly)[0] === 'care', provs(careOnly));
  ok('  → HDFC Ergo is nowhere in it', !provs(careOnly).includes('hdfc'));

  // Same reasoning as careOnly above — 'Care Global' has no live mapping,
  // keeping this section's "no exact match" assertions meaningful.
  // 'Family First Cover' deliberately doesn't match any NIVA_SLUG_KEYWORDS
  // fragment either — same reasoning as 'Care Global' just above, keeps
  // this section testing the static/no-match path, not live data.
  // 'ProHealth Select A' (a real MC product — see manipalcigna.com's own
  // sitemap — that was never brought into scripts/scrape_mc_features.js)
  // deliberately doesn't match any MC_TIER_KEYWORDS entry either — keeps
  // this section on MC's static 2-column path, not live data.
  const three = [row('Care Health','Care Global'), row('Niva Bupa','Family First Cover'),
                 row('ManipalCigna','ProHealth Select A')];
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
  // 'Some Unrecognised Star Product' deliberately matches no
  // STAR_SLUG_KEYWORDS entry ('Value Plus' — the original name here — now
  // DOES have a confident live mapping and would break this section's
  // "no feature data held" assertions below; that path has its own
  // dedicated test in the Star live-data section instead).
  const sdas = three.concat([row('Star Health','Some Unrecognised Star Product')]);
  const c4 = cols(sdas);
  ok('Star gets a column even with no data held',
     c4.some(c => c.provider === 'star' && c.missing), provs(sdas));
  ok('  → and it is last, after the columns that have content',
     c4[c4.length - 1].provider === 'star', provs(sdas));
  ok('  → labelled with the insurer name, not a plan',
     c4.find(c => c.provider === 'star').label === 'Star Health');
  ok('  → and its note names what was quoted',
     /No feature data held for Star Health/.test(w.featureColumnNote(c4.find(c=>c.provider==='star')))
     && /Some Unrecognised Star Product/.test(w.featureColumnNote(c4.find(c=>c.provider==='star'))),
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
  // "ReAssure2.0 Bronze" now resolves to Niva's own LIVE column (see the
  // dedicated Niva live-data section below) rather than the static file's
  // "ReAssure 2.0 Bronze" entry — a step better than before, same as Care
  // Supreme's live column above. c.plan carries the ORIGINAL quoted string.
  const nivaExactCol = ce.find(c => c.provider === 'niva');
  ok('ReAssure2.0 Bronze matches too (now via live data)',
     nivaExactCol && nivaExactCol.matches === true && nivaExactCol.live === true, nivaExactCol);
  ok('Sarvah matches its column', ce.find(c => c.plan === 'Sarvah Param').matches === true);
  // MC has two columns; quoting Sarvah must not mark the Lifetime column matched.
  ok('  → but the other ManipalCigna column is still flagged',
     ce.find(c => c.plan === 'Lifetime Health').matches === false,
     ce.filter(c=>c.provider==='mc').map(c=>[c.plan,c.matches]));

  console.log('\n── sibling collisions never get a silent match ──');
  // Regression coverage for the false-positive class this session fixed: a
  // plain substring/fragment match can't tell a plan apart from a real
  // sibling product whose name also contains that fragment. None of these
  // should silently match — they must all fall through to the caveat.
  // "POS Care Supreme Shine" is itself live-mapped (see
  // build_care_feature_mapping.js), so this now resolves even better than
  // a caveat: its own accurately-labeled live column, never attributed to
  // the "Care Supreme" column's static data.
  const shineCol = cols([row('Care Health','POS Care Supreme Shine')]).find(c => c.provider === 'care');
  ok('a same-insurer sibling plan gets its OWN column, not Care Supreme\'s',
     shineCol.plan === 'POS Care Supreme Shine' && shineCol.plan !== 'Care Supreme', shineCol);
  ok('a different Sarvah tier does not match the Sarvah Param column',
     cols([row('ManipalCigna','Sarvah Uttam')])
       .find(c => c.plan === 'Sarvah Param').matches === false);
  // The static "Lifetime Health" column has no exact-match target on
  // purpose (nobody knows which variant its hand-typed data describes —
  // see data/feature_comparison.json's _exactMatchNote) — but MC's live
  // data (below) resolved this properly: "Lifetime India"/"Lifetime
  // Global" now each get their OWN correctly-labeled live column instead
  // of ever touching the static one, the same upgrade Care Supreme Shine
  // got above. Neither should show a caveat any more.
  const lifetimeIndiaCol = cols([row('ManipalCigna','Lifetime India')]).find(c => c.provider === 'mc' && c.live);
  ok('Lifetime India gets its own live column, not the static caveat',
     lifetimeIndiaCol && lifetimeIndiaCol.matches === true && lifetimeIndiaCol.plan !== 'Lifetime Health', lifetimeIndiaCol);
  const lifetimeGlobalCol = cols([row('ManipalCigna','Lifetime Global')]).find(c => c.provider === 'mc' && c.live);
  ok('Lifetime Global gets its own live column too',
     lifetimeGlobalCol && lifetimeGlobalCol.matches === true && lifetimeGlobalCol.plan !== 'Lifetime Health', lifetimeGlobalCol);

  console.log('\n── Care Health: live scraped data replaces the static column ──');
  // "Care Supreme" (portal id 2813) has a confident live mapping (see
  // data/care_features_mapped.json) — the column should show ITS real
  // scraped values, not the static file's, and carry no caveat.
  const careLiveRows = [row('Care Health', 'Care Supreme')];
  const careLiveCol = cols(careLiveRows).find(c => c.provider === 'care');
  ok('a live-mapped Care plan gets its own live column', !!(careLiveCol && careLiveCol.live), careLiveCol);
  ok('  → matches (no caveat)', careLiveCol && careLiveCol.matches === true);
  ok('  → note is empty', w.featureColumnNote(careLiveCol) === '');
  const roomRentFeature = G('FEATURE_DATA').features.find(f => f.feature === 'Room Rent');
  ok('  → Room Rent reads the LIVE scraped value at its own slot',
     roomRentFeature.rows[0].values[careLiveCol.sourceIndex] === careLive.plans['2813'].rows['Room Rent'],
     [roomRentFeature.rows[0].values[careLiveCol.sourceIndex], careLive.plans['2813'].rows['Room Rent']]);
  const coPayFeature = G('FEATURE_DATA').features.find(f => f.feature === 'Co-pay');
  ok('  → a row genuinely not found on the live page reads "N/A", not blank',
     coPayFeature.rows[0].values[careLiveCol.sourceIndex] === 'N/A',
     coPayFeature.rows[0].values[careLiveCol.sourceIndex]);

  // "Care Global" (portal id 5673) is deliberately left unmapped (see
  // SKU_TO_SLUG in build_care_feature_mapping.js) — must fall back to the
  // static column with its normal caveat, not silently show nothing or
  // crash.
  const careUnmappedCol = cols([row('Care Health', 'Care Global')]).find(c => c.provider === 'care');
  ok('an unmapped Care plan falls back to the static column',
     !!(careUnmappedCol && !careUnmappedCol.live), careUnmappedCol);
  ok('  → still caveated (does not silently claim to be Care Global)',
     careUnmappedCol && careUnmappedCol.matches === false);

  console.log('\n── Niva Bupa: live brochure-scraped data replaces the static column ──');
  // "ReAssure2.0 Bronze" resolves to the reassurev2-insurance brochure via
  // keyword match (see NIVA_SLUG_KEYWORDS — unlike Care, Niva's real
  // captured plan-name format was never confirmed live this pass, so this
  // is keyword, not exact-string, matching).
  const nivaLiveRows = [row('Niva Bupa', 'ReAssure2.0 Bronze')];
  const nivaLiveCol = cols(nivaLiveRows).find(c => c.provider === 'niva');
  ok('a keyword-matched Niva plan gets its own live column', !!(nivaLiveCol && nivaLiveCol.live), nivaLiveCol);
  ok('  → matches (no caveat)', nivaLiveCol && nivaLiveCol.matches === true);
  const nivaRoomRentFeature = G('FEATURE_DATA').features.find(f => f.feature === 'Room Rent');
  ok('  → Room Rent reads the LIVE brochure value at its own slot',
     nivaRoomRentFeature.rows[0].values[nivaLiveCol.sourceIndex] === nivaLive.plans['reassurev2-insurance'].rows['Room Rent'],
     [nivaRoomRentFeature.rows[0].values[nivaLiveCol.sourceIndex], nivaLive.plans['reassurev2-insurance'].rows['Room Rent']]);
  const nivaCoPayFeature = G('FEATURE_DATA').features.find(f => f.feature === 'Co-pay');
  ok('  → a row genuinely not found in the brochure reads "N/A", not blank',
     nivaCoPayFeature.rows[0].values[nivaLiveCol.sourceIndex] === 'N/A',
     nivaCoPayFeature.rows[0].values[nivaLiveCol.sourceIndex]);

  // A plan name matching no keyword at all falls back to the static column,
  // same principle as Care Global above.
  const nivaUnmappedCol = cols([row('Niva Bupa', 'Some Unrecognised Niva Product')]).find(c => c.provider === 'niva');
  ok('an unrecognised Niva plan falls back to the static column',
     !!(nivaUnmappedCol && !nivaUnmappedCol.live), nivaUnmappedCol);

  console.log('\n── ManipalCigna: live scraped data, both replacing and adding columns ──');
  // "Lifetime India" now REPLACES the static "Lifetime Health" column
  // (already exercised above), with real data instead of a permanent
  // caveat.
  const mcLifetimeCol = cols([row('ManipalCigna', 'Lifetime India')]).find(c => c.provider === 'mc' && c.live);
  const mcRoomRentFeature = G('FEATURE_DATA').features.find(f => f.feature === 'Room Rent');
  ok('  → Room Rent reads the LIVE scraped value at its own slot',
     mcRoomRentFeature.rows[0].values[mcLifetimeCol.sourceIndex] === mcLive.plans['lifetime-india'].rows['Room Rent'],
     [mcRoomRentFeature.rows[0].values[mcLifetimeCol.sourceIndex], mcLive.plans['lifetime-india'].rows['Room Rent']]);

  // "ProHealth Prime Protect" has NO existing static column at all (only
  // Sarvah and Lifetime do) — a live match here must be ADDED, not replace
  // anything, and Sarvah's own static column must still be there untouched.
  const withProHealth = cols([row('ManipalCigna', 'ProHealth Prime Protect')]);
  const proHealthCol = withProHealth.find(c => c.provider === 'mc' && c.live);
  const sarvahStillThere = withProHealth.find(c => c.provider === 'mc' && c.plan === 'Sarvah Param');
  ok('ProHealth Prime Protect is ADDED as a new live column', !!proHealthCol, withProHealth.filter(c=>c.provider==='mc'));
  ok('  → Sarvah\'s own static column is untouched alongside it', !!sarvahStillThere);

  // Sarvah has no public product page at all (confirmed live — see
  // scripts/scrape_mc_features.js's header comment) — must stay on its
  // existing static/exactMatch behavior, never claim live data for it.
  const sarvahCol = cols([row('ManipalCigna', 'Sarvah Param')]).find(c => c.provider === 'mc' && c.plan === 'Sarvah Param');
  ok('Sarvah never gets a live column (no public page exists for it)',
     sarvahCol && !sarvahCol.live && sarvahCol.matches === true, sarvahCol);

  console.log('\n── Star Health: live scraped data replaces the "no data held" placeholder ──');
  // "Value Plus" resolves to a real live-mapped product — Star previously
  // had NO static column at all (see the "S Das quotation" section above,
  // now using a genuinely-unmapped fixture instead), so this proves the
  // live match replaces the "missing" placeholder, not something that
  // never existed.
  const starLiveRows = [row('Star Health', 'Value Plus')];
  const starLiveCol = cols(starLiveRows).find(c => c.provider === 'star');
  ok('a keyword-matched Star plan gets its own live column, not "missing"',
     !!(starLiveCol && starLiveCol.live && !starLiveCol.missing), starLiveCol);
  ok('  → matches (no caveat)', starLiveCol && starLiveCol.matches === true);
  const starRoomRentFeature = G('FEATURE_DATA').features.find(f => f.feature === 'Room Rent');
  ok('  → Room Rent reads the LIVE scraped value at its own slot',
     starRoomRentFeature.rows[0].values[starLiveCol.sourceIndex] === starLive.plans['value-plus'].rows['Room Rent'],
     [starRoomRentFeature.rows[0].values[starLiveCol.sourceIndex], starLive.plans['value-plus'].rows['Room Rent']]);

  // A plan name matching no keyword at all still falls back to the
  // original "missing" placeholder, same as before this pass.
  const starUnmappedCol = cols([row('Star Health', 'Some Unrecognised Star Product')]).find(c => c.provider === 'star');
  ok('an unrecognised Star plan falls back to the "no data held" placeholder',
     !!(starUnmappedCol && starUnmappedCol.missing && !starUnmappedCol.live), starUnmappedCol);

  // A report with NO Care quote at all must not leave a stale live value
  // sitting in the shared FEATURE_DATA.features from an earlier call in
  // the same process (report generation reuses one cached FEATURE_DATA
  // for the whole session).
  cols(careLiveRows);                          // populate the live slot
  const afterNoCentre = cols([row('Niva Bupa', 'Aspire')]);   // no Care in this quotation
  const roomRentAfter = G('FEATURE_DATA').features.find(f => f.feature === 'Room Rent');
  ok('the live slot is reset when a later report has no Care quote',
     roomRentAfter.rows[0].values[5] == null, roomRentAfter.rows[0].values[5]);

  cols(nivaLiveRows);                          // populate Niva's live slot
  const afterNoNiva = cols([row('Care Health', 'Care Global')]);   // no Niva in this quotation
  const roomRentAfterNiva = G('FEATURE_DATA').features.find(f => f.feature === 'Room Rent');
  ok('the live slot is reset when a later report has no Niva quote',
     roomRentAfterNiva.rows[0].values[6] == null, roomRentAfterNiva.rows[0].values[6]);

  cols([row('ManipalCigna', 'Lifetime India')]);                 // populate MC's live slot
  const afterNoMc = cols([row('Care Health', 'Care Global')]);   // no MC in this quotation
  const roomRentAfterMc = G('FEATURE_DATA').features.find(f => f.feature === 'Room Rent');
  ok('the live slot is reset when a later report has no MC quote',
     roomRentAfterMc.rows[0].values[7] == null, roomRentAfterMc.rows[0].values[7]);

  cols(starLiveRows);                          // populate Star's live slot
  const afterNoStar = cols([row('Care Health', 'Care Global')]);   // no Star in this quotation
  const roomRentAfterStar = G('FEATURE_DATA').features.find(f => f.feature === 'Room Rent');
  ok('the live slot is reset when a later report has no Star quote',
     roomRentAfterStar.rows[0].values[8] == null, roomRentAfterStar.rows[0].values[8]);

  console.log('\n── sourceIndex keeps values in their own column ──');
  // Every feature row's values are positional against the original five. This is
  // the invariant that stops a dropped column shifting one insurer's terms onto
  // another.
  ok('each column remembers where it was transcribed',
     cols(sdas).filter(c => !c.missing).every(c => typeof c.sourceIndex === 'number'));
  const careCol = cols(careOnly)[0];
  ok('Care sat in slot 3 of the original five', careCol.sourceIndex === 3, careCol.sourceIndex);
  // 'Family First' deliberately doesn't match any NIVA_SLUG_KEYWORDS
  // fragment, keeping this test on the STATIC sourceIndex mechanism (Niva's
  // own live-data section below tests the live path instead).
  const nivaCol = cols([row('Niva Bupa','Family First')])[0];
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

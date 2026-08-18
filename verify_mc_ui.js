// verify_mc_ui.js
// ---------------------------------------------------------------------------
// Drives mc_multi.html headlessly: the Plan Type and resident-Indian controls
// exist with the portal's own values, both reach the request body, and the
// "unverified" caveat appears only for the option we have not confirmed.
//
//     npm install --no-save jsdom
//     node verify_mc_ui.js
//     npm prune
//
// Exits 1 on failure. The two "scrollIntoView is not a function" lines are
// jsdom not implementing that method; they are harmless.
// ---------------------------------------------------------------------------
const fs = require('fs');
const { JSDOM } = require('jsdom');
const W = __dirname + '/';

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (extra !== undefined ? '\n          ' + JSON.stringify(extra) : '')); } };

const bodies = [];
const dom = new JSDOM(fs.readFileSync(W + 'mc_multi.html', 'utf8'), {
  runScripts: 'dangerously', url: 'http://localhost:3003/multi', pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = (u, init) => {
      const url = String(u);
      if (init && init.body) bodies.push({ url, body: JSON.parse(init.body) });
      if (/location/.test(url))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ zone: 'ZONE2' }) });
      if (/\/api\/health/.test(url))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      if (/\/api\/addons/.test(url))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ cards: [], uniqueAddonNames: [] }) });
      // the quote
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        response: { zone: 'ZONE2', Card: [{ Status: 'Success', PlanName: 'Lifetime Health',
          SumInsured: '5000000', FinalPremiumTable: [{ Tenure: '1', FinalPremium: '12345' }] }] },
        coverTypeReport: { requested: 'multiindividual', applied: 'INFI',
                           fromMemberCount: false, unverified: true, residentIndian: 'Y' },
      }) });
    };
  },
});
const w = dom.window;
const $ = id => w.document.getElementById(id);

setTimeout(async () => {
 try {
  console.log('\n── the controls exist ──');
  ok('Plan Type select added', !!$('planType'));
  ok('resident-Indian select added', !!$('residentIndian'));
  const vals = $('planType') ? Array.from($('planType').options).map(o => o.value) : [];
  ok('options are the portal\'s own values',
     JSON.stringify(vals) === JSON.stringify(['', 'individual', 'FamilyFloater', 'multiindividual']), vals);
  const rvals = $('residentIndian') ? Array.from($('residentIndian').options).map(o => o.value) : [];
  ok('resident options are YES / NO', JSON.stringify(rvals) === JSON.stringify(['YES', 'NO']), rvals);
  ok('Plan Type defaults to auto (old behaviour)', $('planType').value === '');
  ok('resident defaults to YES', $('residentIndian').value === 'YES');

  console.log('\n── the unverified caveat, on the input ──');
  $('planType').value = 'multiindividual'; w.onPlanTypeChange();
  ok('shows for Multi Individual', $('planTypeNote').style.display !== 'none'
     && /not been confirmed/.test($('planTypeNote').textContent), $('planTypeNote').textContent);
  $('planType').value = 'FamilyFloater'; w.onPlanTypeChange();
  ok('hidden for Family Floater', $('planTypeNote').style.display === 'none');
  $('planType').value = 'individual'; w.onPlanTypeChange();
  ok('hidden for Individual', $('planTypeNote').style.display === 'none');
  $('planType').value = ''; w.onPlanTypeChange();
  ok('hidden for auto', $('planTypeNote').style.display === 'none');

  console.log('\n── both values reach the request body ──');
  w.selectPlan('lifetime-health');
  await new Promise(r => setTimeout(r, 250));
  w.addMember('adult'); w.addMember('adult');
  const ages = Array.from(w.document.querySelectorAll('#membersList input'));
  ages.forEach((el, i) => { if (/age/i.test(el.placeholder || el.name || '')) { el.value = String(40 + i);
    el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); } });
  $('pincode').value = '700041';
  if ($('sumInsured') && $('sumInsured').options.length) $('sumInsured').value = $('sumInsured').options[0].value;
  $('planType').value = 'multiindividual';
  $('residentIndian').value = 'NO';
  bodies.length = 0;
  await w.getQuote();
  await new Promise(r => setTimeout(r, 300));
  const q = bodies.find(b => /\/api\/premium\//.test(b.url));
  ok('a quote request was sent', !!q, bodies.map(b => b.url));
  if (q) {
    ok('planType included', q.body.planType === 'multiindividual', q.body.planType);
    ok('residentIndian included', q.body.residentIndian === 'NO', q.body.residentIndian);
  }

  console.log('\n── the caveat on the premium ──');
  ok('banner rendered from coverTypeReport', !!$('mcCoverNotice'));
  if ($('mcCoverNotice'))
    ok('  → names the code that was sent', /INFI/.test($('mcCoverNotice').textContent),
       $('mcCoverNotice').textContent.slice(0, 120));
  w.renderCoverTypeNotice({ requested: 'FamilyFloater', applied: 'INFF', unverified: false });
  ok('removed when the cover type is confirmed', !$('mcCoverNotice'));

  console.log('\n── auto still means auto ──');
  $('planType').value = '';
  bodies.length = 0;
  await w.getQuote();
  await new Promise(r => setTimeout(r, 300));
  const q2 = bodies.find(b => /\/api\/premium\//.test(b.url));
  ok('planType omitted entirely', q2 && !('planType' in q2.body), q2 && Object.keys(q2.body));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
 } catch (e) { console.log('HARNESS ERROR: ' + e.message + '\n' + e.stack); process.exit(1); }
}, 900);

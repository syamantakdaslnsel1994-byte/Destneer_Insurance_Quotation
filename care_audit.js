#!/usr/bin/env node
/**
 * care_audit.js — regression test for the Care Health integration.
 *
 * This used to be a report generator: it fetched every plan's field set,
 * wrote a 48-row HTML table, and exited 0 no matter what came back. Every
 * drift it ever found had to be spotted by a human reading 48 rows by eye,
 * and none of them were — the Business Type flags, the missing Plan Version
 * on plan 748, the Monthly Income gap on 7425/6740 and 26 wrong default sum
 * insureds were all sitting in its own output.
 *
 * It is now a test. It compares what the portal actually serves against
 * care_plans.json and exits non-zero when they disagree, so a change on
 * Care's side surfaces here rather than in a client's quotation.
 *
 *   node care_audit.js              # assert, write the report, exit 0/1
 *   node care_audit.js --report     # write the report only, always exit 0
 *   node care_audit.js --update     # print a patch for care_plans.json
 *   node care_audit.js --plan 2813  # check a single plan
 *
 * Requires care_server.js to be running on port 3005.
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = 3005;
const CATALOGUE_PATH = path.join(__dirname, 'care_plans.json');

const args      = process.argv.slice(2);
const REPORT_ONLY = args.includes('--report');
const UPDATE      = args.includes('--update');
const ONLY_PLAN   = (() => { const i = args.indexOf('--plan'); return i >= 0 ? args[i + 1] : null; })();

// ── Catalogue ────────────────────────────────────────────────────────────────
let catalogue;
try {
  catalogue = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf8'));
} catch (e) {
  console.error(`FATAL: cannot read care_plans.json — ${e.message}`);
  process.exit(2);
}
let PLANS = catalogue.plans;
if (ONLY_PLAN) PLANS = PLANS.filter(p => p.id === ONLY_PLAN);
if (!PLANS.length) { console.error(`No plan matched --plan ${ONLY_PLAN}`); process.exit(2); }

// Field ids that are part of the standard form; anything else is "extra".
const STANDARD_FIELDS = new Set([
  'field_75','field_23','field_54','field_9','field_1','field_10','field_3',
  'field_15','field_2','field_4','field_12','field_13','field_NS','field_GC',
  'newMem_2','newMem_3','newMem_4','newMem_5','newMem_6',
]);

// ── HTTP ─────────────────────────────────────────────────────────────────────
function fetchPlan(planId) {
  return new Promise(resolve => {
    const req = http.get(
      { host: HOST, port: PORT, path: `/debug-fields/${planId}`, timeout: 15000 },
      res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve({ ok: true, data: JSON.parse(body) }); }
          catch (e) { resolve({ ok: false, error: `bad JSON (HTTP ${res.statusCode})` }); }
        });
      });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timed out after 15s' }); });
    req.on('error', e => resolve({ ok: false, error: e.message }));
  });
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Assertions ───────────────────────────────────────────────────────────────
// Each returns null when it passes, or a human-readable difference.
function comparePlan(expected, actual) {
  const pf   = actual.parsedFields   || {};
  const all  = actual.allInputFields || [];
  const opts = actual.selectOptions  || {};
  const has  = id => all.includes(id) || Object.prototype.hasOwnProperty.call(opts, id);
  const diffs = [];

  const check = (label, want, got) => {
    if (want !== got) diffs.push({ label, want, got });
  };

  check('businessType', expected.businessType, !!pf.hasBizType);
  check('coverType',    expected.coverType,    !!pf.hasCoverType);
  check('planTypeField',expected.planTypeField,!!pf.hasPlanType);
  check('nationality',  expected.nationality,  has('field_NS'));
  check('annualIncome', expected.annualIncome, !!pf.hasAnnualIncome);
  check('monthlyIncome',expected.monthlyIncome,!!pf.hasMonthlyIncome);
  check('tenure',       expected.tenure,       !!pf.hasTenure);

  // Sum insured: presence, and the ladder itself when the portal exposes one.
  const portalHasSI = !!pf.hasSI;
  check('hasSumInsured', expected.sumInsured !== null, portalHasSI);

  if (expected.sumInsured && Array.isArray(pf.siValues) && pf.siValues.length && pf.siSource) {
    const want = expected.sumInsured.map(String).join(',');
    const got  = pf.siValues.map(String).join(',');
    if (want !== got) {
      diffs.push({ label: `sumInsured (${pf.siSource})`, want, got });
    }
  }

  // Extra field ids the live code does not know about.
  const unknown = all.filter(f => !STANDARD_FIELDS.has(f) && !/^field_[A-Z_]+$/.test(f));
  return { diffs, unknown, portalHasSI };
}

// ── Report ───────────────────────────────────────────────────────────────────
function buildReport(rows, summary) {
  const esc = t => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cell = (want, got) => want === got
    ? `<td class="ok">${want ? '✓' : '·'}</td>`
    : `<td class="bad">${got ? '✓' : '✗'}<br><small>expected ${want ? '✓' : '✗'}</small></td>`;

  const body = rows.map(r => {
    if (!r.ok) {
      return `<tr class="err"><td>${esc(r.id)}</td><td>${esc(r.name)}</td>
        <td colspan="8">⚠ ${esc(r.error)}</td></tr>`;
    }
    const e = r.expected, pf = r.actual.parsedFields || {};
    return `<tr class="${r.diffs.length ? 'drift' : ''}">
      <td>${esc(r.id)}</td><td>${esc(r.name)}</td>
      ${cell(e.businessType,  !!pf.hasBizType)}
      ${cell(e.coverType,     !!pf.hasCoverType)}
      ${cell(e.planTypeField, !!pf.hasPlanType)}
      ${cell(e.annualIncome,  !!pf.hasAnnualIncome)}
      ${cell(e.monthlyIncome, !!pf.hasMonthlyIncome)}
      ${cell(e.tenure,        !!pf.hasTenure)}
      <td>${esc((e.sumInsured || ['—']).join(', '))}<br><small>default ${esc(e.defaultSumInsured || '—')}</small></td>
      <td>${r.diffs.length
            ? r.diffs.map(d => `<b>${esc(d.label)}</b>: expected <code>${esc(d.want)}</code>, portal has <code>${esc(d.got)}</code>`).join('<br>')
            : '<span class="ok">matches catalogue</span>'}
          ${r.unknown.length ? `<br><small class="unk">unmapped: ${esc(r.unknown.join(', '))}</small>` : ''}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Care Health — Catalogue Regression</title>
<style>
 body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#0f172a}
 h1{font-size:20px;margin:0 0 4px} .meta{color:#64748b;font-size:12px;margin-bottom:16px}
 table{border-collapse:collapse;width:100%;font-size:12px}
 th{background:#f1f5f9;text-align:left;padding:7px;border-bottom:2px solid #cbd5e1;position:sticky;top:0}
 td{padding:6px 7px;border-bottom:1px solid #e2e8f0;vertical-align:top}
 .ok{color:#047857}.bad{color:#b91c1c;font-weight:700;background:#fef2f2}
 tr.drift{background:#fffbeb}tr.err{background:#fef2f2}
 .unk{color:#7c3aed}code{background:#f1f5f9;padding:1px 4px;border-radius:3px}
 .sum{padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px}
 .pass{background:#ecfdf5;border:1px solid #6ee7b7}.fail{background:#fef2f2;border:1px solid #fca5a5}
</style></head><body>
<h1>Care Health — Catalogue Regression</h1>
<div class="meta">Portal vs care_plans.json · generated ${new Date().toLocaleString()}</div>
<div class="sum ${summary.failed ? 'fail' : 'pass'}">
  <strong>${summary.failed ? '✗ DRIFT DETECTED' : '✓ PORTAL MATCHES CATALOGUE'}</strong> —
  ${summary.checked} plans checked, ${summary.drifted} with differences,
  ${summary.errored} unreachable.
  ${summary.failed ? 'The portal has changed, or the catalogue is wrong. Review the last column.' : ''}
</div>
<table><thead><tr>
 <th>ID</th><th>Plan</th><th>Biz</th><th>Cover</th><th>Plan&nbsp;Type</th>
 <th>Income</th><th>Mthly&nbsp;Inc</th><th>Tenure</th><th>Sum Insured (expected)</th><th>Result</th>
</tr></thead><tbody>
${body}
</tbody></table></body></html>`;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Care catalogue regression — ${PLANS.length} plan(s) against ${path.basename(CATALOGUE_PATH)}`);
  console.log(`Portal via http://${HOST}:${PORT}/debug-fields/<id>\n`);

  const rows = [];
  for (let i = 0; i < PLANS.length; i++) {
    const expected = PLANS[i];
    if (i > 0) await delay(250);           // be gentle with the portal
    const r = await fetchPlan(expected.id);
    process.stdout.write(`  [${String(i + 1).padStart(2)}/${PLANS.length}] ${expected.id.padEnd(5)} ${expected.name.slice(0, 34).padEnd(34)} `);

    if (!r.ok) {
      console.log(`⚠ ${r.error}`);
      rows.push({ id: expected.id, name: expected.name, ok: false, error: r.error, expected, diffs: [], unknown: [] });
      continue;
    }
    const { diffs, unknown } = comparePlan(expected, r.data);
    rows.push({ id: expected.id, name: expected.name, ok: true, expected, actual: r.data, diffs, unknown });
    console.log(diffs.length ? `✗ ${diffs.length} difference(s)` : (unknown.length ? `✓ (${unknown.length} unmapped field(s))` : '✓'));
    diffs.forEach(d => console.log(`         ${d.label}: expected ${JSON.stringify(d.want)}, portal has ${JSON.stringify(d.got)}`));
  }

  const drifted = rows.filter(r => r.ok && r.diffs.length).length;
  const errored = rows.filter(r => !r.ok).length;
  const summary = { checked: rows.length, drifted, errored, failed: !REPORT_ONLY && (drifted > 0 || errored > 0) };

  const outFile = path.join(__dirname, 'care_audit_report.html');
  fs.writeFileSync(outFile, buildReport(rows, summary), 'utf8');

  console.log('\n' + '─'.repeat(64));
  console.log(`  checked ${rows.length}   drift ${drifted}   unreachable ${errored}`);
  console.log(`  report: ${outFile}`);

  if (UPDATE && drifted) {
    console.log('\n  Suggested care_plans.json changes:');
    rows.filter(r => r.ok && r.diffs.length).forEach(r => {
      console.log(`    ${r.id} ${r.name}`);
      r.diffs.forEach(d => console.log(`      ${d.label}: ${JSON.stringify(d.want)} → ${JSON.stringify(d.got)}`));
    });
    console.log('\n  Verify each against the live portal before editing — the portal is\n'
              + '  authoritative, but a parse failure can look identical to a real change.');
  }

  if (summary.failed) {
    console.log('\n  RESULT: FAIL — the portal no longer matches care_plans.json.');
    console.log('  Re-run with --update to see the suggested changes.\n');
    process.exit(1);
  }
  console.log('\n  RESULT: PASS\n');
  process.exit(0);
}

main().catch(e => { console.error('\nFATAL:', e); process.exit(2); });

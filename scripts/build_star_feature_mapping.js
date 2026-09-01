// build_star_feature_mapping.js
// ---------------------------------------------------------------------------
// Projects data/star_features_live.json's scraped rows onto the sheet's 15
// canonical rows and writes data/star_features_mapped.json. Keyed by
// product slug (matches starhealth.in/health-insurance/<slug>/).
//
// Run:  node scripts/build_star_feature_mapping.js
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const liveFeatures = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'star_features_live.json'), 'utf8'));

// Same keyword-matching principle as Care/Niva/MC's own ROW_RULES — Star's
// own wording confirmed live: "In-Patient Hospitalisation" for Room Rent,
// "Automatic Restoration of Sum Insured" for Recharge, "Mandatory
// Co-payment" for Co-pay (with real numeric detail, unlike Care/Niva),
// "Preventive Health Check-up" for Annual Health Check-Up.
const ROW_RULES = {
  'Room Rent':                { any: ['in-patient hospitalisation', 'inpatient hospitalisation', 'shared accommodation', 'room rent'] },
  'Pre hospitalization':      { any: ['pre-hospitalisation', 'pre hospitalisation'] },
  'Post Hospitalisation':     { any: ['post-hospitalisation', 'post hospitalisation'] },
  'AYUSH Cover':              { any: ['ayush'] },
  'Day Care Treatments':      { any: ['day care'] },
  'Domiciliary':              { any: ['domiciliary'] },
  'Ambulance Cover':          { any: ['road ambulance'] },
  'Organ Donor Cover':        { any: ['organ donor'] },
  'Annual Health Check-Up':   { any: ['health check', 'preventive health check'] },
  'Recharge Of Sum Insured':  { any: ['restoration of sum insured', 'recharge benefit'] },
  'Modern Treatments':        { any: ['modern treatment'] },
  'Co-pay':                   { any: ['co-payment', 'co-pay', 'copay'], exclude: ['zone'] },
  'ICU Charges':              { any: ['icu'] },
  'Zone wise Co-pay':         { any: ['zone'] },
  'Waiting Period for PED':   { any: ['pre-existing disease waiting', 'ped waiting'] },
  'Add ons':                  { any: ['add on', 'add-on', 'optional cover'] },
};

function matches(label, rule) {
  const l = label.toLowerCase();
  if (rule.exclude && rule.exclude.some((kw) => l.includes(kw))) return false;
  return rule.any.some((kw) => l.includes(kw));
}

function projectRows(rows) {
  const out = {};
  for (const [canonical, rule] of Object.entries(ROW_RULES)) {
    const hit = rows.find((r) => matches(r.label, rule));
    out[canonical] = hit ? hit.value : null;
  }
  return out;
}

const mapped = {};
let mappedCount = 0, foundRowTotals = [];
for (const [slug, entry] of Object.entries(liveFeatures.plans)) {
  if (!entry.ok || !entry.rows) { mapped[slug] = { slug, rows: null, note: entry.error || 'scrape failed' }; continue; }
  const rows = projectRows(entry.rows);
  const foundCount = Object.values(rows).filter((v) => v !== null).length;
  foundRowTotals.push(foundCount);
  mapped[slug] = { slug, rows };
  mappedCount++;
}

const out = {
  _comment: 'Built from data/star_features_live.json — see scripts/build_star_feature_mapping.js. Keyed by product slug (matches starhealth.in/health-insurance/<slug>/).',
  _builtAt: new Date().toISOString(),
  _mappedCount: mappedCount,
  _avgRowsFoundPerMappedPlan: foundRowTotals.length ? (foundRowTotals.reduce((a, b) => a + b, 0) / foundRowTotals.length) : 0,
  plans: mapped,
};
fs.writeFileSync(path.join(ROOT, 'data', 'star_features_mapped.json'), JSON.stringify(out, null, 2));
console.log(`Mapped ${mappedCount}/${Object.keys(liveFeatures.plans).length} products. Wrote data/star_features_mapped.json.`);
console.log(`Average rows found per mapped plan: ${out._avgRowsFoundPerMappedPlan.toFixed(1)} / ${Object.keys(ROW_RULES).length}`);

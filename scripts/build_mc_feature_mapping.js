// build_mc_feature_mapping.js
// ---------------------------------------------------------------------------
// Projects data/mc_features_live.json's scraped rows onto the sheet's 15
// canonical rows, split out per real tier (Lifetime India/Global, ProHealth
// Prime Protect/Advantage/Active, Super Top-up Plus/Select, Prime Senior
// Classic/Elite), and writes data/mc_features_mapped.json.
//
// Two of the scraped pages hold MULTIPLE tiers in one table (columnHeaders
// tells us which values[] index is which tier); the rest are one page per
// tier (values[0] is the only column). TIER_COLUMNS below records which
// index each real tier occupies.
//
// Run:  node scripts/build_mc_feature_mapping.js
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const liveFeatures = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'mc_features_live.json'), 'utf8'));

// tierKey -> { pageKey, columnIndex } — columnIndex is into each row's
// `values` array. Confirmed live from data/mc_features_live.json's own
// columnHeaders field (e.g. lifetime-health: ["Compare Plans Of",
// "Lifetime HealthIndia...", "Lifetime HealthGlobal..."] -> India is
// values[0], Global is values[1]).
const TIER_COLUMNS = {
  'lifetime-india':          { pageKey: 'lifetime-health', columnIndex: 0 },
  'lifetime-global':         { pageKey: 'lifetime-health', columnIndex: 1 },
  'prohealth-prime-protect': { pageKey: 'prohealth-prime', columnIndex: 0 },
  'prohealth-prime-advantage': { pageKey: 'prohealth-prime', columnIndex: 1 },
  'prohealth-prime-active':  { pageKey: 'prohealth-prime', columnIndex: 2 },
  'super-top-up-plus':       { pageKey: 'super-top-up-plus', columnIndex: 0 },
  'super-top-up-select':     { pageKey: 'super-top-up-select', columnIndex: 0 },
  'prime-senior-classic':    { pageKey: 'prime-senior-classic', columnIndex: 0 },
  'prime-senior-elite':      { pageKey: 'prime-senior-elite', columnIndex: 0 },
};

// Same keyword-matching principle as Care/Niva's own ROW_RULES — MC's own
// wording confirmed live: "Room Accommodation" (ProHealth Prime) vs
// "Hospitalization Expenses" (Lifetime) both mean Room Rent; "PED Waiting
// Period" / "Pre-existing Disease waiting Period" for Waiting Period;
// "Mandatory Co-Payment" for Co-pay (Prime Senior — better Co-pay coverage
// than either Care or Niva managed).
const ROW_RULES = {
  'Room Rent':                { any: ['room accommodation', 'hospitalization expenses', 'inpatient hospitalization'] },
  'Pre hospitalization':      { any: ['pre - hospitalization', 'pre – hospitalization', 'pre & post hospitalization', 'pre-hospitalization'] },
  'Post Hospitalisation':     { any: ['post - hospitalization', 'post – hospitalization', 'post-hospitalization'] },
  'AYUSH Cover':              { any: ['ayush'] },
  'Day Care Treatments':      { any: ['day care', 'day-care'] },
  'Domiciliary':              { any: ['domiciliary'] },
  'Ambulance Cover':          { any: ['road ambulance'] },
  'Organ Donor Cover':        { any: ['donor expenses', 'donor expense'] },
  'Annual Health Check-Up':   { any: ['health check'] },
  'Recharge Of Sum Insured':  { any: ['restoration of sum insured', 'cumulative bonus'] },
  'Modern Treatments':        { any: ['robotic and cyber knife', 'modern and advanced treatments', 'modern treatment'] },
  'Co-pay':                   { any: ['co-payment', 'co-pay', 'copay'], exclude: ['zone'] },
  'ICU Charges':              { any: ['icu'] },
  'Zone wise Co-pay':         { any: ['zone'] },
  'Waiting Period for PED':   { any: ['ped waiting period', 'pre-existing disease waiting'] },
  'Add ons':                  { any: ['add on', 'add-on', 'optional package'] },
};

function matches(label, rule) {
  const l = label.toLowerCase();
  if (rule.exclude && rule.exclude.some((kw) => l.includes(kw))) return false;
  return rule.any.some((kw) => l.includes(kw));
}

function projectRows(rows, columnIndex) {
  const out = {};
  for (const [canonical, rule] of Object.entries(ROW_RULES)) {
    const hit = rows.find((r) => matches(r.label, rule));
    out[canonical] = (hit && hit.values[columnIndex]) || null;
  }
  return out;
}

const mapped = {};
let mappedCount = 0, foundRowTotals = [];
for (const [tierKey, { pageKey, columnIndex }] of Object.entries(TIER_COLUMNS)) {
  const page = liveFeatures.plans[pageKey];
  if (!page || !page.ok) { mapped[tierKey] = { tierKey, rows: null, note: `source page "${pageKey}" not scraped` }; continue; }
  const rows = projectRows(page.rows, columnIndex);
  const foundCount = Object.values(rows).filter((v) => v !== null).length;
  foundRowTotals.push(foundCount);
  mapped[tierKey] = { tierKey, rows };
  mappedCount++;
}

const out = {
  _comment: 'Built from data/mc_features_live.json — see scripts/build_mc_feature_mapping.js. Keyed by tier (e.g. "lifetime-india", "prohealth-prime-protect"). Sarvah has no public product page and is not covered.',
  _builtAt: new Date().toISOString(),
  _mappedCount: mappedCount,
  _avgRowsFoundPerMappedPlan: foundRowTotals.length ? (foundRowTotals.reduce((a, b) => a + b, 0) / foundRowTotals.length) : 0,
  plans: mapped,
};
fs.writeFileSync(path.join(ROOT, 'data', 'mc_features_mapped.json'), JSON.stringify(out, null, 2));
console.log(`Mapped ${mappedCount}/${Object.keys(TIER_COLUMNS).length} tiers. Wrote data/mc_features_mapped.json.`);
console.log(`Average rows found per mapped tier: ${out._avgRowsFoundPerMappedPlan.toFixed(1)} / ${Object.keys(ROW_RULES).length}`);

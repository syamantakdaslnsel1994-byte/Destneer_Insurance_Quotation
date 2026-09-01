// build_care_feature_mapping.js
// ---------------------------------------------------------------------------
// Combines data/care_plans.json (the 48 real plans quotable through the
// portal) with data/care_features_live.json (44 scraped public product
// pages — see scripts/scrape_care_features.js) into
// data/care_features_mapped.json: for each of the 48 portal plans, which
// scraped page's feature data applies, and the 15 sheet rows projected out
// of that page's raw labels.
//
// The 48 portal plans and the 44 public pages are NOT the same 48 things —
// Care's public site markets ~40 product pages covering families/variants;
// several portal SKUs (POS variants, EMI variants, older superseded plans)
// share a public page with a sibling SKU rather than each having a unique
// one. SKU_TO_SLUG below is a manually reviewed mapping, not a fuzzy-string
// guess — anything not confidently resolved is left unmapped (the plan's
// column falls back to N/A / no live data) rather than silently attributed
// to the nearest-sounding page. This mirrors the exactMatch principle
// applied earlier to the Feature Comparison sheet's collision bug: no
// silent wrong attribution.
//
// Run:  node scripts/build_care_feature_mapping.js
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const carePlans = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'care_plans.json'), 'utf8'));
const liveFeatures = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'care_features_live.json'), 'utf8'));

// Portal plan id → scraped slug. 'pos-shares-base' entries are POS
// (Point-of-Sale / simplified-underwriting) variants of a regular plan —
// industry-standard practice is that a POS variant carries the SAME cover
// terms as its base plan, just a simpler buying process, so it's mapped to
// the same page. This is a documented assumption, not a silent guess —
// flag it for review if a client ever disputes specific POS-plan terms.
const SKU_TO_SLUG = {
  '3485': 'care',                                            // Care
  '6196': 'care-advantage',                                  // Care Advantage
  '1734': 'care-advantage',                                  // Super Care Advantage (variant of Advantage family)
  '1432': 'care-classic',                                    // Care Classic
  '1992': 'care-classic',                                    // Care Classic - Instant Cover
  '5412': 'care-freedom',                                    // Care Freedom
  '425':  'care-heart',                                      // Care Heart
  '1187': 'care-plus-the-complete-health-insurance-plan',    // Care Plus - Complete Plan
  '1186': 'care-plus-youth-health-insurance-plan',           // Care Plus - Youth Plan
  '3487': 'care-senior',                                     // Care Senior
  '3488': 'care-senior',                                     // POS Care Senior
  '2813': 'care-supreme',                                    // Care Supreme
  '5399': 'care-supreme',                                    // POS Care Supreme
  '6541': 'care-supreme-super-saver',                        // Care Supreme - Super Saver
  '7159': 'care-supreme-super-saver',                        // POS Care Supreme - Super Saver
  '6043': 'care-supreme-value',                              // Care Supreme - VFM
  '6217': 'care-supreme-value',                              // POS Care Supreme - VFM
  '6674': 'care-supreme-value-plus',                         // Care Supreme - VFM 2
  '6675': 'care-supreme-value-plus',                         // POS Care Supreme - VFM 2
  '7218': 'care-supreme-shine',                              // Care Supreme Shine
  '7484': 'care-supreme-shine',                               // POS Care Supreme Shine
  '748':  'enhance',                                         // Enhance
  '6434': 'care-supreme-enhance',                            // Supreme Enhance
  '102':  'joy',                                             // Joy
  '5833': 'explore',                                         // New Explore
  '5834': 'explore',                                         // POS Explore
  '3486': 'care',                                            // POS Care
  '573':  'secure',                                          // POS Secure — no distinct "POS " page exists; shares the base secure page
  '188':  'secure',                                          // Secure
  '6740': 'secure-child',                                    // Secure Child
  '7425': 'secure-child',                                    // POS Secure Child
  '6384': 'secure-plus',                                     // Secure Plus
  '7424': 'secure-plus',                                     // POS Secure Plus
  '6725': 'ultimate-care',                                   // POS Ultimate Care
  '6619': 'ultimate-care',                                   // Ultimate Care
  '7172': 'ultimate-care-senior',                            // Ultimate Care Senior
  '2534': 'senior-health-advantage',                         // Sr Health Advantage - Silver
  '107':  'student-explore',                                 // Student Explore
  '5674': 'explore-health-unlimited-for-students',           // Student Explore-Health Unlimited
  // Left UNMAPPED deliberately — no confidently-matching public page found.
  // "Care Supreme - VFM 3" / "POS Care Supreme - VFM 3" could plausibly be
  // care-supreme-vikas/-new/-old/-digital-15/-senior, but none of those
  // names correspond to "VFM 3" clearly enough to state as fact — needs a
  // human who knows Care's product naming to confirm, not a guess.
  '6676': null, // Care Supreme - VFM 3
  '6677': null, // POS Care Supreme - VFM 3
  '5334': null, // Care Smart Select — no "smart-select" page found in the sitemap
  '5335': null, // POS Care Smart Select
  '5673': null, // Care Global — no matching page found
  '585':  null, // Cancer Mediclaim (Advance) — care-cancer-mediclaim exists but "(Advance)" suffix unconfirmed as the same product
  '5955': null, // Joy Tomorrow — distinct from "joy" and "ultimate-joy", unconfirmed which (if either) it maps to
  '362':  null, // Super Mediclaim — no matching page found; likely a legacy/discontinued product
  '6395': null, // Surrogacy and Oocyte Donor — reads like a rider/add-on, not a standalone plan page
};

// Canonical sheet row → keyword rules used to find it among a page's raw
// labels. Matching is substring-based (not exact-string lookup) because
// the same concept is worded differently across Care's 44 product pages —
// confirmed live, e.g. "In-Patient Care" vs "In-Patient Hospitalization",
// "Domiciliary Hospitalisation" vs "Domiciliary Hospitalization" (British/
// American spelling), "AYUSH Treatment" (singular) vs "AYUSH Treatments"
// (plural), "Pre-Hospitalisation Medical Expenses" vs "Pre-hospitalization"
// — an exact-string candidate list missed most of these on first try.
// `exclude` keeps a broader keyword from grabbing the wrong row (e.g.
// "ambulance" alone would match "Air Ambulance Cover" before the page's
// own plain "Ambulance Cover" row, depending on DOM order).
const ROW_RULES = {
  'Room Rent':                { any: ['in-patient', 'inpatient', 'room rent'] },
  'Pre hospitalization':      { any: ['pre-hospital', 'pre hospital'] },
  'Post Hospitalisation':     { any: ['post-hospital', 'post hospital'] },
  'AYUSH Cover':              { any: ['ayush'] },
  'Day Care Treatments':      { any: ['day care'] },
  'Domiciliary':              { any: ['domiciliary'] },
  'Ambulance Cover':          { any: ['ambulance'], exclude: ['air ambulance'] },
  'Organ Donor Cover':        { any: ['organ donor'] },
  'Annual Health Check-Up':   { any: ['health check'] },
  'Recharge Of Sum Insured':  { any: ['recharge', 'restoration', 'refill'] },
  'Modern Treatments':        { any: ['advance technology', 'advanced technology', 'modern treatment'] },
  'Co-pay':                   { any: ['co-pay', 'copay', 'co pay'], exclude: ['zone'] },
  'ICU Charges':              { any: ['icu'] },
  'Zone wise Co-pay':         { any: ['zone'] },
  'Waiting Period for PED':   { any: ['pre-existing', 'pre existing', 'ped waiting', 'waiting period for ped'] },
  'Add ons':                  { any: ['add on', 'add-on', 'optional cover'] },
};

function matches(label, rule) {
  const l = label.toLowerCase();
  if (rule.exclude && rule.exclude.some((kw) => l.includes(kw))) return false;
  return rule.any.some((kw) => l.includes(kw));
}

function projectRows(rawRows) {
  const out = {};
  for (const [canonical, rule] of Object.entries(ROW_RULES)) {
    const hit = rawRows.find((r) => matches(r.label, rule));
    out[canonical] = hit ? hit.value : null; // null → not found on this plan's page, shown as N/A downstream
  }
  return out;
}

const mapped = {};
let mappedCount = 0, unmappedCount = 0, foundRowTotals = [];
for (const plan of carePlans.plans) {
  const slug = SKU_TO_SLUG[plan.id];
  if (slug === undefined) {
    console.warn(`[build_care_feature_mapping] plan id ${plan.id} ("${plan.name}") has no SKU_TO_SLUG entry at all — treating as unmapped. Add it explicitly (even as null) so this isn't silently skipped.`);
  }
  if (!slug) {
    mapped[plan.id] = { name: plan.name, slug: null, rows: null };
    unmappedCount++;
    continue;
  }
  const source = liveFeatures.plans[slug];
  if (!source || !source.ok) {
    mapped[plan.id] = { name: plan.name, slug, rows: null, note: `scrape for "${slug}" failed or unavailable` };
    unmappedCount++;
    continue;
  }
  const rows = projectRows(source.rows);
  const foundCount = Object.values(rows).filter((v) => v !== null).length;
  foundRowTotals.push(foundCount);
  mapped[plan.id] = { name: plan.name, slug, sourceTitle: source.title, rows };
  mappedCount++;
}

const out = {
  _comment: 'Built from data/care_plans.json + data/care_features_live.json — see scripts/build_care_feature_mapping.js for the SKU→page mapping and label projection. Keyed by the portal plan id (matches data/care_plans.json).',
  _builtAt: new Date().toISOString(),
  _mappedCount: mappedCount,
  _unmappedCount: unmappedCount,
  _avgRowsFoundPerMappedPlan: foundRowTotals.length ? (foundRowTotals.reduce((a, b) => a + b, 0) / foundRowTotals.length) : 0,
  plans: mapped,
};
fs.writeFileSync(path.join(ROOT, 'data', 'care_features_mapped.json'), JSON.stringify(out, null, 2));
console.log(`Mapped ${mappedCount}/${carePlans.plans.length} plans (${unmappedCount} unmapped). Wrote data/care_features_mapped.json.`);
console.log(`Average rows found per mapped plan: ${out._avgRowsFoundPerMappedPlan.toFixed(1)} / ${Object.keys(ROW_RULES).length}`);

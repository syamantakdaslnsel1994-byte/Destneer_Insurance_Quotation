// build_niva_feature_mapping.js
// ---------------------------------------------------------------------------
// Parses the raw brochure text scraped by scripts/scrape_niva_features.js
// (data/niva_features_live.json) into the sheet's 15 canonical rows, and
// writes data/niva_features_mapped.json.
//
// Niva's brochures have no table markup to read (pdfminer extracts a flat
// text stream) — but confirmed live, splitting on blank lines yields a
// clean, consistent alternating (label block, value block) sequence, e.g.
// block "Pre-Hospitalisation" immediately followed by block "60 Days.
// Covered up to Sum Insured." This is a genuinely different extraction
// shape from Care's DOM-table rows (scripts/build_care_feature_mapping.js),
// so it gets its own parser, but reuses the SAME keyword-matching
// principle (ROW_RULES) once label/value pairs exist.
//
// Run:  node scripts/build_niva_feature_mapping.js
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const liveFeatures = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'niva_features_live.json'), 'utf8'));

// Same canonical rows as Care's mapping, same principle: substring keyword
// matching against Niva's OWN wording, which differs from Care's in real
// ways confirmed live — "Home Care/Domiciliary" not "Domiciliary
// Hospitalisation", "In-patient Care (including AYUSH)" bundles what Care
// keeps as two separate rows (Room Rent and AYUSH share one Niva row).
const ROW_RULES = {
  'Room Rent':                { any: ['in-patient', 'inpatient', 'room rent'] },
  'Pre hospitalization':      { any: ['pre-hospital', 'pre hospital'] },
  'Post Hospitalisation':     { any: ['post-hospital', 'post hospital'] },
  // Niva bundles AYUSH into the In-patient Care row rather than giving it
  // its own line (confirmed live) — no separate row to point to, so this
  // stays unmapped rather than reusing Room Rent's value under a different
  // name (that would misrepresent it as a distinct confirmed row).
  'AYUSH Cover':              { any: ['ayush cover', 'ayush treatment'] },
  'Day Care Treatments':      { any: ['day care'] },
  'Domiciliary':              { any: ['domiciliary', 'home care'] },
  'Ambulance Cover':          { any: ['ambulance'], exclude: ['air ambulance'] },
  'Organ Donor Cover':        { any: ['organ donor'] },
  'Annual Health Check-Up':   { any: ['health checkup', 'health check-up', 'health check up'] },
  // 'reassure+'/'booster+' deliberately excluded: confirmed live these are
  // section HEADINGS covering multiple sub-features (Lock the Clock,
  // Booster+, ReAssure Forever each with their own value), not a single
  // label->value pair — matching the heading text would grab whichever
  // sub-feature's paragraph happens to come first, misattributing it.
  'Recharge Of Sum Insured':  { any: ['restoration', 'unlimited recharge', 'refill'] },
  'Modern Treatments':        { any: ['modern treatment'] },
  'Co-pay':                   { any: ['co-pay', 'copay', 'co pay'], exclude: ['zone'] },
  'ICU Charges':              { any: ['icu'] },
  'Zone wise Co-pay':         { any: ['zone'] },
  'Waiting Period for PED':   { any: ['pre-existing', 'pre existing', 'ped waiting'] },
  'Add ons':                  { any: ['add on', 'add-on', 'optional benefit', 'optional cover'] },
};

function matches(label, rule) {
  const l = label.toLowerCase();
  if (rule.exclude && rule.exclude.some((kw) => l.includes(kw))) return false;
  return rule.any.some((kw) => l.includes(kw));
}

// A "label block" is short (a heading, not a paragraph) — a length cap
// keeps this from mistaking a short VALUE block (e.g. "Covered up to Sum
// Insured.") for a label when it happens to also contain a matched
// keyword. 60 chars covers every real label seen live (longest was
// "Annual Health Checkup\n(Day 1)"), well under typical value-sentence
// length.
const MAX_LABEL_LEN = 60;

// Value blocks are often SHORTER than some labels ("Covered up to Sum
// Insured." is 27 chars, "Annual Health Checkup\n(Day 1)" is longer) — so
// length alone can't tell label from value in general, and an early
// version of this function that tried "skip every short block" ended up
// skipping past genuinely-short correct values instead. The one real,
// narrow exception confirmed live: a bare footnote marker block ("(7)")
// sometimes sits between a label and its real value — skip ONLY that
// exact pattern, nothing else.
function parseLabelValuePairs(text) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const isFootnoteMarker = (b) => /^\(\d+\)$/.test(b);
  const pairs = [];
  for (let i = 0; i < blocks.length - 1; i++) {
    if (blocks[i].length > MAX_LABEL_LEN) continue;
    let j = i + 1;
    if (isFootnoteMarker(blocks[j]) && j + 1 < blocks.length) j++;
    pairs.push({ label: blocks[i].replace(/\s+/g, ' '), value: blocks[j].replace(/\s+/g, ' ') });
  }
  return pairs;
}

function projectRows(text) {
  const pairs = parseLabelValuePairs(text);
  const out = {};
  for (const [canonical, rule] of Object.entries(ROW_RULES)) {
    const hit = pairs.find((p) => matches(p.label, rule));
    out[canonical] = hit ? hit.value : null;
  }
  return out;
}

const mapped = {};
let mappedCount = 0, unmappedCount = 0, foundRowTotals = [];
for (const [slug, entry] of Object.entries(liveFeatures.plans)) {
  if (!entry.ok || !entry.text) { mapped[slug] = { slug, rows: null, note: entry.error || 'scrape failed' }; unmappedCount++; continue; }
  const rows = projectRows(entry.text);
  const foundCount = Object.values(rows).filter((v) => v !== null).length;
  foundRowTotals.push(foundCount);
  mapped[slug] = { slug, rows };
  mappedCount++;
}

const out = {
  _comment: 'Built from data/niva_features_live.json (brochure PDF text) — see scripts/build_niva_feature_mapping.js. Keyed by product slug (matches nivabupa.com/family-health-insurance-plans/<slug>.html).',
  _builtAt: new Date().toISOString(),
  _mappedCount: mappedCount,
  _unmappedCount: unmappedCount,
  _avgRowsFoundPerMappedPlan: foundRowTotals.length ? (foundRowTotals.reduce((a, b) => a + b, 0) / foundRowTotals.length) : 0,
  plans: mapped,
};
fs.writeFileSync(path.join(ROOT, 'data', 'niva_features_mapped.json'), JSON.stringify(out, null, 2));
console.log(`Mapped ${mappedCount}/${Object.keys(liveFeatures.plans).length} products (${unmappedCount} unmapped). Wrote data/niva_features_mapped.json.`);
console.log(`Average rows found per mapped plan: ${out._avgRowsFoundPerMappedPlan.toFixed(1)} / ${Object.keys(ROW_RULES).length}`);

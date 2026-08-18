/**
 * mc_decode_url.js
 * ---------------------------------------------------------------------------
 * Reads the encrypted `q=` value out of a ManipalCigna quick-quote URL and
 * prints what the real portal put on the wire — in particular the `coverType`
 * code behind each "Plan Type" option, which is the one thing the replica
 * cannot know without a capture.
 *
 * Usage (Command Prompt, from the project folder):
 *
 *   node mc_decode_url.js "<paste the whole URL or just the q= value>"
 *
 * Several at once, so the options can be compared side by side — give each a
 * label with LABEL=value:
 *
 *   node mc_decode_url.js "Floater=AbC123..." "Individual=XyZ789..."
 *
 * Or put one per line in a text file and pass the file:
 *
 *   node mc_decode_url.js --file captures.txt
 *
 * Add --json to dump the whole decrypted payload for one capture:
 *
 *   node mc_decode_url.js --json "AbC123..." > payload.json
 *
 * Nothing is sent anywhere. This only decrypts a string you already have.
 * The key comes from .env (MC_AES_KEY) — run create_env.bat if you have not.
 * ---------------------------------------------------------------------------
 */
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

// ── .env loader — same zero-dependency one mc_server.js uses ────────────────
(function loadEnv() {
  for (const p of [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
    break;
  }
})();

const KEY_STR = process.env.MC_AES_KEY;
if (!KEY_STR) {
  console.error('\n[config] Missing MC_AES_KEY.');
  console.error('[config] Run create_env.bat once, then try again.\n');
  process.exit(1);
}
const AES_KEY = Buffer.from(KEY_STR, 'utf8');

// ── Getting a clean base64 string out of whatever was pasted ────────────────
// The address bar is a lossy channel for base64. Depending on how it was
// copied, `+` may survive as `+`, arrive percent-encoded as `%2B`, or have been
// turned into a space. All three have to end up as `+` again, and that has to
// happen in the right order — decode the percent-escapes first, and only then
// treat spaces as plus signs, or a genuine `%20` would become `+` too.
function normaliseB64(input) {
  let s = String(input || '').trim().replace(/^["']|["']$/g, '');

  // A whole URL? Pull the q= parameter out of it.
  if (/^https?:\/\//i.test(s) || s.includes('?') || s.includes('&q=')) {
    const m = s.match(/[?&#]q=([^&#]*)/) || s.match(/q=([^&#]*)/);
    if (m) s = m[1];
  }
  if (s.startsWith('q=')) s = s.slice(2);

  if (s.includes('%')) { try { s = decodeURIComponent(s); } catch (_) {} }
  s = s.replace(/ /g, '+');                    // space was a + before copying
  s = s.replace(/[\r\n\t]/g, '');
  s = s.replace(/-/g, '+').replace(/_/g, '/'); // url-safe base64, just in case
  return s;
}

function decrypt(b64) {
  const d = crypto.createDecipheriv('aes-128-ecb', AES_KEY, Buffer.alloc(0));
  d.setAutoPadding(true);
  return JSON.parse(d.update(b64, 'base64', 'utf8') + d.final('utf8'));
}

// ── What we actually want out of a capture ──────────────────────────────────
// Two different schemas come out of the same AES key, and they do not agree on
// field names. The `q=` value in the address bar is the *page state* — it uses
// All_Insured_Are_Resident_Indian: "YES", details[].GENDER: "MALE". The body of
// the viewPlans request the page then makes is what mc_server.js reproduces —
// allInsuredAreResidentIndian: "Y", details[].gender: "M". Read either.
function pick(obj, names) {
  for (const n of names) if (obj && obj[n] !== undefined && obj[n] !== '') return obj[n];
  return undefined;
}

// The Plan Type field's name is the thing we are trying to learn, so hunt for it
// rather than assuming. Any key anywhere whose name mentions cover/plan/type, or
// whose value looks like one of ManipalCigna's cover codes, gets reported.
const COVER_CODE = /^(INDI|INFF|INFI|IND|FF|FI)$/i;
function huntCoverKeys(node, out, trail){
  out = out || []; trail = trail || '';
  if (Array.isArray(node)) {
    node.slice(0, 2).forEach((v, i) => huntCoverKeys(v, out, trail + '[' + i + ']'));
    return out;
  }
  if (node && typeof node === 'object') {
    Object.keys(node).forEach(k => {
      const v = node[k], p = trail + '.' + k;
      if (v && typeof v === 'object') { huntCoverKeys(v, out, p); return; }
      const nameHit = /cover.*type|plan.?type|policy.?type|product.?type/i.test(k);
      const valHit  = typeof v === 'string' && COVER_CODE.test(v.trim());
      if ((nameHit || valHit) && v !== '' && v != null) out.push({ path: p, value: v });
    });
  }
  return out;
}

function summarise(p) {
  const pd  = p.preparedData || p;
  const cti = pd.coverTypeInfo || pd.CoverTypeInfo || {};
  const det = cti.details || cti.Details || pd.details || [];
  const hits = huntCoverKeys(p);
  const cover = pick(pd, ['coverType','CoverType','cover_type','planType','PlanType','plan_type'])
             || pick(p,  ['coverType','planType','plan_type'])
             || (hits.length ? hits[0].value : undefined);
  return {
    coverType:  cover !== undefined ? cover : '—none—',
    resident:   pick(pd, ['allInsuredAreResidentIndian','All_Insured_Are_Resident_Indian',
                          'AllInsuredAreResidentIndian'])
             || pick(p,  ['allInsuredAreResidentIndian','All_Insured_Are_Resident_Indian']) || '?',
    sumInsured: pick(pd, ['sumInsured','SumInsured','sum_insured']) || pick(p, ['sumInsured']) || '?',
    pinCode:    pick(pd, ['pinCode','PinCode','pincode']) || pick(p, ['pinCode','pincode']) || '?',
    zone:       pick(pd, ['zone','Zone']) || pick(p, ['zone']) || '?',
    tenure:     pick(p, ['tenure','Tenure']) || pick(pd, ['tenure','Tenure']) || '?',
    adults:     cti.adultCount != null ? cti.adultCount : '?',
    children:   cti.childCount != null ? cti.childCount : 0,
    people:     cti.peopleCount != null ? cti.peopleCount : det.length,
    relations:  det.map(m => pick(m, ['insuredRelationShip','INSURED_RELATIONSHIP','Relationship',
                                      'relationship','adult','Adult']) || '?').join(','),
    dobs:       det.map(m => pick(m, ['dob','DOB']) || '?').join(','),
    product:    p.product || '',
    code:       p.product_code || '',
    port:       pick(pd, ['portability','Portability']) || pick(p, ['portability']) || '?',
    _hits:      hits,
  };
}

// ── Input ───────────────────────────────────────────────────────────────────
const argv    = process.argv.slice(2);
const wantJson = argv.includes('--json');
let items = [];

const fileIdx = argv.indexOf('--file');
if (fileIdx !== -1) {
  const fp = argv[fileIdx + 1];
  if (!fp || !fs.existsSync(fp)) {
    console.error('\n  --file needs a path to an existing text file.\n');
    process.exit(1);
  }
  items = fs.readFileSync(fp, 'utf8').split(/\r?\n/)
            .map(l => l.trim()).filter(l => l && !l.startsWith('#'));
} else {
  items = argv.filter(a => !a.startsWith('--'));
}

if (!items.length) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, ''));
  process.exit(2);
}

// LABEL=value, where the value itself is base64 and may contain '='. Only treat
// the first '=' as the separator, and only when what precedes it looks like a
// label rather than base64 — base64 has no spaces and is long.
function splitLabel(raw) {
  const m = raw.match(/^([A-Za-z][A-Za-z0-9 _\-]{0,30})=(.+)$/s);
  if (m && m[2].length > 40) return { label: m[1].trim(), value: m[2] };
  return { label: '', value: raw };
}

const rows = [];
items.forEach((raw, i) => {
  const { label, value } = splitLabel(raw);
  const name = label || ('capture ' + (i + 1));
  let payload;
  try {
    payload = decrypt(normaliseB64(value));
  } catch (e) {
    rows.push({ name, error: e.message });
    return;
  }
  if (wantJson && items.length === 1) {
    console.log(JSON.stringify(payload, null, 2));
    process.exit(0);
  }
  rows.push(Object.assign({ name }, summarise(payload), { _full: payload }));
});

// ── Output ──────────────────────────────────────────────────────────────────
const bad = rows.filter(r => r.error);
const good = rows.filter(r => !r.error);

if (good.length) {
  const cols = [
    ['name',       'CAPTURE'],
    ['coverType',  'coverType'],
    ['adults',     'A'],
    ['children',   'C'],
    ['sumInsured', 'sumInsured'],
    ['tenure',     'yr'],
    ['pinCode',    'pin'],
    ['zone',       'zone'],
    ['resident',   'resIndian'],
    ['port',       'port'],
    ['relations',  'relationships'],
  ];
  const w = {};
  cols.forEach(([k, h]) => {
    w[k] = Math.max(h.length, ...good.map(r => String(r[k]).length));
  });
  const line = cols.map(([k, h]) => h.padEnd(w[k])).join('  ');
  console.log('\n' + line);
  console.log(cols.map(([k]) => '-'.repeat(w[k])).join('  '));
  good.forEach(r => console.log(cols.map(([k]) => String(r[k]).padEnd(w[k])).join('  ')));

  const types = Array.from(new Set(good.map(r => r.coverType)));
  console.log('\n  cover type codes seen: ' + types.join(', '));

  // Every field that looked like a plan/cover type, wherever it turned up.
  good.forEach(r => {
    if (r._hits && r._hits.length)
      console.log('  ' + r.name + ' — plan/cover-type-shaped fields: '
        + r._hits.map(h => h.path + '=' + JSON.stringify(h.value)).join(', '));
  });

  if (types.length === 1 && types[0] === '—none—')
    console.log('\n  This capture carries NO plan/cover type at all. The `q=` value in the\n'
              + '  address bar is only the page state; the cover type is decided when the\n'
              + '  page posts to viewPlans. To see it, capture the request body instead —\n'
              + '  F12 → Network → the viewPlans request → Payload → copy the long\n'
              + '  "encodedString" value and pass that to this script.');
  else if (types.length === 1 && good.length > 1)
    console.log('  ⚠️  every capture shows the same code — either the Plan Type was not\n'
              + '      changed between captures, or it is not what varies the code.');

  const res = Array.from(new Set(good.map(r => r.resident).filter(v => v && v !== '?')));
  if (res.length) console.log('  resident-Indian values seen: ' + res.join(', '));
}

if (bad.length) {
  console.log('\n  could not decrypt:');
  bad.forEach(r => console.log('    ' + r.name + ' — ' + r.error));
  console.log('\n  Usually this means the value was truncated, or the `+` characters were\n'
            + '  lost on the way. Copy the address bar with Ctrl+L then Ctrl+C, paste the\n'
            + '  whole URL in quotes, and let this script find the q= itself.');
}
console.log('');
process.exit(bad.length && !good.length ? 1 : 0);

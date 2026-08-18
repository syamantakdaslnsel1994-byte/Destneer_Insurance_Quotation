/**
 * Care Insurance Premium Calculator – Backend
 *
 * Endpoints:
 *   GET  /api/plan-fields?plan=2813            → init session + visible fields
 *   POST /api/update-fields                    → re-post with current values → returns updated fields
 *   POST /api/premium                          → calculate premium
 *
 * Setup:
 *   npm install express node-fetch@2 cheerio cors
 *   node server.js  →  http://localhost:3001
 */

const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

/* ─────────────────────────────────────────────────────────
   Hardcoded Sum Insured options per plan (from live scan of all 48 plans).
   Used as authoritative source — avoids relying on cheerio parsing the
   jQuery custom-range component (which can be fragile).
   Values are in Lakhs. "N/A" means this plan has no Sum Insured selector.
   ──────────────────────────────────────────────────────── */
const PLAN_SUM_INSURED = {
  '7484': ['5','7','10','15'],                                         // POS Care Supreme Shine
  '6434': ['20','45','50','85','90','93','95','100'],                  // Supreme Enhance
  '5412': ['3','5'],                                                   // Care Freedom
  '5399': ['5','7','10','15'],                                         // POS Care Supreme
  '3488': ['3','5'],                                                   // POS Care Senior
  '3487': ['3','5','7','10'],                                          // Care Senior
  '3486': ['5'],                                                       // POS Care
  '3485': ['5','7','10','15','20','25','30','40','50','60','75'],       // Care
  '2813': ['5','7','10','15','25','50','100'],                         // Care Supreme
  '1432': ['5','7','10','15'],                                         // Care Classic
  '362':  ['10','25','50','100','200'],                                // Super Mediclaim
  '425':  ['3','5','7','10'],                                          // Care Heart
  '107':  ['30'],                                                      // Student Explore
  '188':  ['10','15','20','25','30','50','100','200','300'],           // Secure
  '748':  ['2','3','4','5','6','7','8','9','10'],                      // Enhance (SI1)
  '102':  ['3','5'],                                                   // Joy
  '573':  ['10','15','20','25','30','50'],                             // POS Secure
  '585':  ['25','50','100','200'],                                     // Cancer Mediclaim (Advance)
  '1186': ['3','5','7','10','25'],                                     // Care Plus - Youth Plan
  '1187': ['3','5','7','10','25'],                                     // Care Plus - Complete Plan
  '1734': ['100'],                                                     // Super Care Advantage
  '1992': ['5','7','10','15'],                                         // Care Classic - Instant Cover
  '2534': ['5','10'],                                                  // Sr Health Advantage - Silver
  '5334': ['7','10','15','20','25','30','40','50','60','75'],          // Care Smart Select
  '5335': null,                                                        // POS Care Smart Select (N/A)
  '5673': ['100','200','300','600'],                                   // Care Global
  '5674': ['Unlimited'],                                               // Student Explore-Health Unlimited
  '5833': ['10','25','50','100','250','500'],                          // New Explore
  '5834': ['10','25','50','100','250'],                                // POS Explore
  '5955': ['3','5'],                                                   // Joy Tomorrow
  '6196': ['25','50','100'],                                           // Care Advantage
  '6384': null,                                                        // Secure Plus (N/A)
  '6395': ['2','5','10'],                                              // Surrogacy and Ooctye Donor
  '6541': ['5','7','10','15','25'],                                    // Care Supreme - Super Saver
  '6619': ['5','7','10','15','20','25','50','100','UNLIMITED'],        // Ultimate Care
  '6043': ['5','7','10','15'],                                         // Care Supreme - VFM
  '6676': ['5','7','10','15'],                                         // Care Supreme - VFM 3
  '6674': ['5','7','10','15'],                                         // Care Supreme - VFM 2
  '6675': ['5'],                                                       // POS Care Supreme - VFM 2
  '6677': ['5'],                                                       // POS Care Supreme - VFM 3
  '6217': ['5'],                                                       // POS Care Supreme - VFM
  '6725': ['5','7','10','15'],                                         // POS Ultimate Care
  '6740': null,                                                        // Secure Child (N/A)
  '7159': ['5','7','10','15'],                                         // POS Care Supreme - Super Saver
  '7172': ['5','7','10','15','20','25','50','100'],                    // Ultimate Care Senior
  '7218': ['5','7','10','15','25','50'],                               // Care Supreme Shine
  '7424': null,                                                        // POS Secure Plus (N/A)
  '7425': null,                                                        // POS Secure Child (N/A)
};

/* Extra non-SI sliders per plan (field_id → { label, values[] }) */
const PLAN_EXTRA_SLIDERS = {
  '748': {
    field_11: { label: 'Deductible (in Lakhs)', values: ['2','3','4','5','6','7','8','9','10'] },
  },
};
const cheerio = require('cheerio');
const cors    = require('cors');

const app  = express();
const PORT = 3001;

const BASE_URL   = 'https://abacus.careinsurance.com';
const PAGE_URL   = `${BASE_URL}/religare/partner/generic-religare-know-popup`;
const API_URL    = `${BASE_URL}/religare/partner-abacus/calculate-premium`;
const PARTNER_ID = '3';

const BROWSER_HEADERS = {
  'User-Agent':        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language':   'en-IN,en;q=0.9',
  'Accept-Encoding':   'gzip, deflate, br',
  'Connection':        'keep-alive',
  'Sec-Fetch-Site':    'same-origin',
  'Sec-Fetch-Mode':    'cors',
  'Sec-Fetch-Dest':    'empty',
  'Sec-Ch-Ua':         '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  'Sec-Ch-Ua-Mobile':  '?0',
  'Sec-Ch-Ua-Platform':'"Windows"',
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', '..', 'public', 'legacy')));

/* ─────────────────────────────────────────────────────────
   Core helper: POST to calculate-premium, return text
   ──────────────────────────────────────────────────────── */
async function postCalc(params, cookies) {
  const resp = await fetch(API_URL, {
    method: 'POST', redirect: 'follow',
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept':           'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer':          PAGE_URL,
      'Origin':           BASE_URL,
      'Cookie':           cookies,
    },
    body: params.toString()
  });
  const text = await resp.text();

  // Merge any new cookies
  const newCookieHeaders = resp.headers.raw()['set-cookie'] || [];
  let updatedCookies = cookies;
  if (newCookieHeaders.length > 0) {
    const map = {};
    cookies.split('; ').forEach(c => { const i = c.indexOf('='); if(i>0) map[c.slice(0,i).trim()] = c.slice(i+1); });
    newCookieHeaders.forEach(c => { const part = c.split(';')[0]; const i = part.indexOf('='); if(i>0) map[part.slice(0,i).trim()] = part.slice(i+1); });
    updatedCookies = Object.entries(map).map(([k,v]) => `${k}=${v}`).join('; ');
  }

  return { text, cookies: updatedCookies };
}

/* ─────────────────────────────────────────────────────────
   Helper: check if a cheerio element is hidden (inline style)
   ──────────────────────────────────────────────────────── */
function isHiddenEl($, el) {
  let node = el;
  while (node && node.type === 'tag') {
    const style = $(node).attr('style') || '';
    if (style.includes('display:none') || style.includes('display: none')) return true;
    node = node.parent;
  }
  return false;
}

/* ─────────────────────────────────────────────────────────
   Helper: get label text for a field element
   ──────────────────────────────────────────────────────── */
function getLabelFor($, el) {
  // Try closest li container first
  const li = $(el).closest('li');
  if (li.length) {
    const lbl = li.find('label').first().text().trim().replace(/\s+/g, ' ').replace(/\?/g, '').trim();
    if (lbl && lbl.length > 1) return lbl;
  }
  // Fallback: parent chain
  let node = el.parent;
  for (let depth = 0; depth < 5 && node && node.type === 'tag'; depth++) {
    const lbl = $(node).find('label').first().text().trim().replace(/\s+/g, ' ').replace(/\?/g, '').trim();
    if (lbl && lbl.length > 1 && lbl.length < 80) return lbl;
    node = node.parent;
  }
  return '';
}

/* ─────────────────────────────────────────────────────────
   Helper: extract visible input fields + their labels/options
   Uses FIELD-FIRST approach (not label-first) for reliability
   ──────────────────────────────────────────────────────── */
function extractVisibleFields($) {
  const fields = [];
  const seen   = new Set();

  // ── 1. SELECT fields (field_XX and newMem_XX dynamic members) ──
  $('select').each((_, el) => {
    const name = $(el).attr('name') || '';
    // Accept field_XX and newMem_XX patterns
    if (!name.match(/\[(field_\w+|newMem_\w+)\]\[field_value\]/)) return;
    if (seen.has(name)) return;
    seen.add(name);
    if (isHiddenEl($, el)) return;

    const match = name.match(/\[((?:field|newMem)_\w+)\]\[field_value\]/);
    if (!match) return;
    const fieldId = match[1];

    const opts = [];
    $(el).find('option').each((_, o) => {
      const v = $(o).attr('value');
      const t = $(o).text().trim();
      if (v !== undefined && v !== '') opts.push({ value: v, label: t });
    });
    if (opts.length === 0) return;

    const label = getLabelFor($, el) || fieldId;
    fields.push({ id: fieldId, label, type: 'select', options: opts, default: opts[0].value });
  });

  // ── 2. TEXT inputs (pincode etc.) ──
  $('input[type="text"]').each((_, el) => {
    const name = $(el).attr('name') || '';
    const match = name.match(/\[field_(\w+)\]\[field_value\]/);
    if (!match) return;
    if (seen.has(name)) return;
    seen.add(name);
    if (isHiddenEl($, el)) return;
    const fieldId = 'field_' + match[1];
    fields.push({ id: fieldId, label: getLabelFor($, el) || fieldId, type: 'text', default: '' });
  });

  // ── 3. CUSTOM RANGE sliders (div.custom-range[data-values]) ──
  // Care Insurance uses a jQuery-based custom slider, not a native <input type="range">.
  // The div.custom-range holds data-values="[5,7,10,...]" and contains a hidden backing field.
  $('.custom-range').each((_, el) => {
    if (isHiddenEl($, el)) return;

    // Parse the discrete value list from data-values attribute
    let values = [];
    const raw = $(el).attr('data-values') || '';
    if (raw) {
      try { values = JSON.parse(raw); } catch(e) {}
    }
    if (values.length === 0) return; // no options — skip

    // Find the hidden backing field inside the slider div
    const backing = $(el).find('input[type="hidden"][name*="field_"]').first();
    const bname   = backing.attr('name') || '';
    const match   = bname.match(/\[field_(\w+)\]\[field_value\]/);
    if (!match) return;
    const fieldId = 'field_' + match[1];
    if (seen.has(fieldId)) return;
    seen.add(fieldId);

    // Label is in the parent .form-group > label.control-label
    const fgLabel = $(el).closest('.form-group').find('label').first().text()
                       .trim().replace(/\s+/g, ' ').replace(/\?/g, '').trim();
    const label   = fgLabel || getLabelFor($, el) || 'Sum Insured (₹ In Lakhs)';

    const opts = values.map(v => ({ value: String(v), label: `₹${v} Lakhs` }));
    fields.push({ id: fieldId, label, type: 'select', options: opts, default: opts[0].value });
  });

  // ── 4. RADIO groups (Tenure etc.) ──
  const radioNames = new Set();
  $('input[type="radio"]').each((_, el) => {
    const name  = $(el).attr('name') || '';
    const match = name.match(/\[field_(\w+)\]\[field_value\]/);
    if (!match || radioNames.has(name)) return;
    radioNames.add(name);
    if (isHiddenEl($, el)) return;
    const fieldId = 'field_' + match[1];
    if (seen.has(fieldId)) return;
    seen.add(fieldId);

    const vals = [];
    $(`input[name="${name}"]`).each((_, r) => {
      const v = $(r).attr('value');
      if (v) vals.push({ value: v, label: v });
    });
    if (vals.length === 0) return;
    const label = getLabelFor($, el) || fieldId;
    fields.push({ id: fieldId, label, type: 'radio', options: vals, default: vals[0].value });
  });

  return fields;
}

/* ─────────────────────────────────────────────────────────
   Helper: extract add-on checkboxes from response HTML
   Add-ons use PartnerPreviewForm[extra][fieldId][field_value]
   Returns array: [{ id, label, checked }]
   ──────────────────────────────────────────────────────── */
function extractAddons($) {
  const addons = [];
  const seen   = new Set();

  $('input[type="checkbox"]').each((_, el) => {
    const name  = $(el).attr('name') || '';
    const match = name.match(/\[extra\]\[(\w+)\]\[field_value\]/);
    if (!match) return;
    const fieldId = match[1];
    if (seen.has(fieldId)) return;
    seen.add(fieldId);
    if (isHiddenEl($, el)) return;

    const label   = getLabelFor($, el) || fieldId;
    const checked = $(el).attr('checked') !== undefined;
    addons.push({ id: fieldId, label, checked });
  });

  return addons;
}

/* ─────────────────────────────────────────────────────────
   Helper: extract hidden session fields from response HTML
   ──────────────────────────────────────────────────────── */
function extractHiddenFields($) {
  const hidden = {};
  $('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr('name');
    const val  = $(el).attr('value') || '';
    if (name && !name.includes('_csrf')) hidden[name] = val;
  });
  // Output fields (radio outPutField)
  $('input[type="radio"][name*="outPutField"]').each((_, el) => {
    const name = $(el).attr('name');
    const val  = $(el).attr('value') || '';
    if (name) hidden[name] = val;
  });
  return hidden;
}

/* ─────────────────────────────────────────────────────────
   Helper: parse premium from response HTML
   ──────────────────────────────────────────────────────── */
function parsePremium($) {
  const basePremium = $('input[name="PartnerPreviewForm[premium_amount]"]').val() || '----';

  let discountPremium = null;
  $('input[type="radio"][name*="selectedBasePremium"]').each((_, el) => {
    if ($(el).attr('checked') || $(el).is(':checked')) {
      const t = $(el).parent().text().trim().replace(/\s+/g, ' ');
      if (t.toLowerCase().includes('after') || t.toLowerCase().includes('discount')) discountPremium = t;
    }
  });

  let totalPremium = null;
  $('*').each((_, el) => {
    if ($(el).children().length > 0) return;
    const t = $(el).text().trim().replace(/\s+/g, ' ');
    if (/Total Premium/i.test(t) && /[\d,]+/.test(t)) { totalPremium = t; }
  });

  const addons = [];
  $('input[type="checkbox"]').each((_, el) => {
    if ($(el).attr('checked')) {
      const t = $(el).closest('div, li, label').text().trim().replace(/\s+/g, ' ');
      if (t && t.length > 1 && t.length < 80) addons.push(t);
    }
  });

  return { basePremium, discountPremium, totalPremium, addons };
}

/* ─────────────────────────────────────────────────────────
   Shared: build URLSearchParams from session + user fields
   addons: { field_WB: true, field_35: false, ... }  (only checked ones are sent)
   ──────────────────────────────────────────────────────── */
function buildParams({ csrf, plan, hiddenFields, fields, addons }) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(hiddenFields || {})) params.append(k, v);
  params.set('_csrf-frontend',                      csrf);
  params.set('assignedAbacus',                      plan);
  params.set('PartnerPreviewForm[partnerAbacusId]', PARTNER_ID);
  params.set('PartnerPreviewForm[agentCode]',       '');
  params.set('PartnerPreviewForm[source]',          'GenericAbacus');
  for (const [key, value] of Object.entries(fields || {})) {
    params.set(`PartnerPreviewForm[input][${key}][field_value]`, value);
  }
  // Add-ons — only send the ones that are checked
  for (const [key, isChecked] of Object.entries(addons || {})) {
    if (isChecked) {
      params.set(`PartnerPreviewForm[extra][${key}][field_value]`, 'checked');
    }
  }
  return params;
}

/* ─────────────────────────────────────────────────────────
   Helper: inject Sum Insured (and any extra slider fields) from the lookup
   tables. Replaces any slider fields that extractVisibleFields might have
   missed (jQuery custom-range component is unreliable under cheerio).
   ──────────────────────────────────────────────────────── */
function injectSumInsured(fields, planId) {
  const pid    = String(planId);
  const siVals = PLAN_SUM_INSURED[pid];
  const extra  = PLAN_EXTRA_SLIDERS[pid] || {};

  // Build set of slider field IDs to replace
  const sliderIds = new Set(Object.keys(extra));
  if (siVals !== undefined) sliderIds.add('field_2');

  // Remove all existing slider entries (we will re-inject from lookup)
  let result = fields.filter(f => !sliderIds.has(f.id));

  // Helper to build a select field from a value list
  function makeSliderField(id, label, values) {
    if (!values || values.length === 0) return null;
    return {
      id, label, type: 'select',
      options: values.map(v => ({
        value: String(v),
        label: String(v).toUpperCase() === 'UNLIMITED' ? '₹ Unlimited' : `₹${v} Lakhs`,
      })),
      default: values[0],
    };
  }

  // Inject Sum Insured (field_2) right after Cover Type / Total Members group
  if (siVals && siVals.length > 0) {
    const insertAfter = ['field_1', 'field_23', 'field_75', 'field_9'];
    let insertIdx = result.length;
    for (let i = 0; i < result.length; i++) {
      if (insertAfter.includes(result[i].id)) insertIdx = i + 1;
    }
    const siField = makeSliderField('field_2', 'Sum Insured (in Lakhs)', siVals);
    if (siField) result.splice(insertIdx, 0, siField);
  }

  // Inject extra sliders (e.g. Deductible for Enhance) — append at end
  for (const [fieldId, meta] of Object.entries(extra)) {
    const f = makeSliderField(fieldId, meta.label, meta.values);
    if (f) result.push(f);
  }

  return result;
}

/* ═══════════════════════════════════════════════════════
   GET /api/plan-fields?plan=2813
   Returns session info + visible field definitions
   ═══════════════════════════════════════════════════════ */
app.get('/api/plan-fields', async (req, res) => {
  const plan = req.query.plan;
  if (!plan) return res.status(400).json({ error: 'plan param required' });

  try {
    // 1. Get page for CSRF + session cookie
    const pageResp = await fetch(PAGE_URL, {
      redirect: 'follow',
      headers: { ...BROWSER_HEADERS, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' }
    });
    const rawCookies = pageResp.headers.raw()['set-cookie'] || [];
    const cookies    = rawCookies.map(c => c.split(';')[0]).join('; ');
    const pageHtml   = await pageResp.text();
    const $page      = cheerio.load(pageHtml);
    const csrf       = $page('input[name="_csrf-frontend"]').first().val();
    if (!csrf) return res.status(500).json({ error: 'CSRF token not found on page' });

    // 2. Init plan — POST with just the plan
    const initParams = new URLSearchParams();
    initParams.append('_csrf-frontend',                      csrf);
    initParams.append('assignedAbacus',                      plan);
    initParams.append('PartnerPreviewForm[partnerAbacusId]', PARTNER_ID);
    initParams.append('PartnerPreviewForm[agentCode]',       '');
    initParams.append('PartnerPreviewForm[source]',          'GenericAbacus');

    const { text: initText, cookies: updatedCookies } = await postCalc(initParams, cookies);

    let initData;
    try { initData = JSON.parse(initText); }
    catch(e) {
      return res.status(500).json({ error: 'Care Insurance blocked request. Raw: ' + initText.substring(0, 300) });
    }

    const $form      = cheerio.load(initData.content || '');
    const hiddenFields = extractHiddenFields($form);
    const freshCsrf  = $form('input[name="_csrf-frontend"]').first().val() || csrf;
    const rawFields  = extractVisibleFields($form);
    const fields     = injectSumInsured(rawFields, plan);
    const addons     = extractAddons($form);

    res.json({ csrf: freshCsrf, cookies: updatedCookies, hiddenFields, fields, addons });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════
   POST /api/update-fields
   Body: { csrf, cookies, hiddenFields, plan, fields }
   Re-posts with current field values → returns updated field definitions
   Call this when user changes a dropdown (Cover Type, Total Members etc.)
   ═══════════════════════════════════════════════════════ */
app.post('/api/update-fields', async (req, res) => {
  const { csrf, cookies, hiddenFields, plan, fields, addons } = req.body;

  const params = buildParams({ csrf, plan, hiddenFields, fields, addons });

  try {
    const { text: rawText, cookies: newCookies } = await postCalc(params, cookies);
    let data;
    try { data = JSON.parse(rawText); }
    catch(e) {
      return res.status(500).json({ error: 'Non-JSON from Care Insurance: ' + rawText.substring(0, 200) });
    }

    const $form       = cheerio.load(data.content || '');
    const hiddenFieldsNew = extractHiddenFields($form);
    const freshCsrf   = $form('input[name="_csrf-frontend"]').first().val() || csrf;
    const rawUpdated  = extractVisibleFields($form);
    const updatedFields = injectSumInsured(rawUpdated, plan);
    const updatedAddons = extractAddons($form);

    res.json({ csrf: freshCsrf, cookies: newCookies, hiddenFields: hiddenFieldsNew, fields: updatedFields, addons: updatedAddons });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════
   POST /api/premium
   Body: { csrf, cookies, hiddenFields, plan, fields }
   ═══════════════════════════════════════════════════════ */
app.post('/api/premium', async (req, res) => {
  const { csrf, cookies, hiddenFields, plan, fields, addons } = req.body;

  const params = buildParams({ csrf, plan, hiddenFields, fields, addons });

  try {
    const { text: rawText } = await postCalc(params, cookies);
    let data;
    try { data = JSON.parse(rawText); }
    catch(e) { return res.status(500).json({ error: 'Non-JSON from Care Insurance: ' + rawText.substring(0, 200) }); }

    const $ = cheerio.load(data.content || '');
    res.json({ ...parsePremium($), planContent: data.plan_content || '' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`\n✅  Care Premium Portal → http://localhost:${PORT}\n`));

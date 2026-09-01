// ── Care Health: real-browser automation ────────────────────────────────────
// Drives Care's own live calculator page directly instead of reverse-
// engineering their raw calculate-premium POST. Confirmed live (spike,
// 2026-08-21): the page at INIT_URL is a full standalone form — selecting a
// plan, changing Business/Plan/Cover Type, Nationality, Global Coverage,
// members, ages, Sum Insured (via the ion.rangeSlider's own update() API,
// no synthetic event needed) all correctly re-trigger the SAME
// calculate-premium AJAX call the page's own JS makes, so results are
// exactly what a human operator would see — no more guessing cascade rules.
//
// Scope: covers the standard health-plan flow (Business Type, Plan Type,
// Cover Type, Nationality Status, Global Coverage, Total Members, per-
// member ages, Children, Sum Insured, Tenure, add-ons, dynamically
// discovered extra fields). Travel plans (107/5833/5834) and the Secure/
// income-band family (7425/7424/6740/6384/188/573) are NOT yet covered —
// callers should keep those on the old raw-POST path (care_server.js
// checks NOT_YET_AUTOMATED before calling in here) until a follow-up pass.
const { chromium } = require('playwright');
const { parsePremium, parseAddons, parseFields, parseDynamicExtraFields } = require('./care_scrapers');

const INIT_URL = 'https://abacus.careinsurance.com/religare/partner/generic-religare-know-popup';
const CASCADE_URL_PART = 'calculate-premium';
const CASCADE_TIMEOUT = 12000;

let browserPromise = null;
let pagePromise = null;
let queue = Promise.resolve();

// Every operation (preview or full quote) runs through this single page, one
// at a time — matches actual usage (one operator per machine) and avoids two
// in-flight fills corrupting each other's cascade state on the same page.
function withQueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.then(() => {}, () => {});
  return run;
}

async function getBrowser() {
  if (browserPromise) return browserPromise;
  browserPromise = chromium.launch({ channel: 'msedge', headless: false }).catch(async (e) => {
    console.warn('[CareAutomation] msedge unavailable, falling back to chrome:', e.message);
    return chromium.launch({ channel: 'chrome', headless: false });
  });
  return browserPromise;
}

async function freshPage() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.goto(INIT_URL, { waitUntil: 'domcontentloaded' });
  return page;
}

// Reload the SAME page before every top-level operation (not just when
// something looks broken). The whole point of keeping one page/browser warm
// is to skip the multi-second Edge *process* cold-start — but reusing a page
// across calls means Care's own form state (Plan Type, Business Type,
// whatever the last caller touched) silently persists into the next,
// unrelated call unless every field happens to be re-specified. Confirmed
// live: previewing businessType=PORT right after previewing
// planType="Senior Premium" incorrectly carried the Senior Premium state
// forward and revealed field_PED alongside field_PORT_TENURE, even though
// this call never asked for a Plan Type at all. A fresh navigation resets
// every field to Care's own true defaults — the ~1s cost is a fair price for
// not silently answering the wrong question.
async function getReadyPage() {
  if (!pagePromise) pagePromise = freshPage();
  let page = await pagePromise;
  try {
    await page.goto(INIT_URL, { waitUntil: 'domcontentloaded' });
    const alive = await page.locator('#partnerAbacus').count().catch(() => 0);
    if (alive) return page;
    console.warn('[CareAutomation] canary (#partnerAbacus) missing after reload.');
  } catch (e) {
    console.warn('[CareAutomation] reload failed, opening a fresh page:', e.message);
  }
  pagePromise = freshPage();
  page = await pagePromise;
  const aliveFresh = await page.locator('#partnerAbacus').count().catch(() => 0);
  if (!aliveFresh) throw new Error("Care's page structure changed — #partnerAbacus not found after a fresh load.");
  return page;
}

async function waitCascade(page, action) {
  const waiter = page.waitForResponse(r => r.url().includes(CASCADE_URL_PART), { timeout: CASCADE_TIMEOUT }).catch(() => null);
  await action();
  await waiter;
  await page.waitForTimeout(250); // let the DOM finish re-rendering after the response lands
}

// Exact-field selectors use `[NAME]` (with brackets) rather than a bare
// substring — field_2 is also a substring of field_20/field_21/field_221
// (all real Care field IDs used on other plans), so a loose match would hit
// the wrong element.
const bracketed = (field) => `[${field}]`;

async function trySelect(page, field, value) {
  const sel = `select[name*="${bracketed(field)}"]`;
  if (!(await page.locator(sel).count())) return false;
  await waitCascade(page, () => page.selectOption(sel, String(value), { force: true }));
  return true;
}

async function tryRadio(page, field, value) {
  const sel = `input[type="radio"][name*="${bracketed(field)}"][value="${value}"]`;
  if (!(await page.locator(sel).count())) return false;
  // Not page.check() — same "Element is not visible" issue as
  // setAddonChecked below (Care hides these behind custom-styled radio
  // pills); drive the DOM directly instead.
  await waitCascade(page, () => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.checked = true;
    el.dispatchEvent(new Event('click', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    const $ = window.jQuery || window.$;
    if ($) { try { $(el).trigger('change'); } catch (e) {} }
  }, sel));
  return true;
}

async function tryTextInput(page, field, value) {
  const sel = `input[name*="${bracketed(field)}"]:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])`;
  if (!(await page.locator(sel).count())) return false;
  // Not page.fill() — same visibility risk as setAddonChecked/tryRadio
  // above once a text field turns out to be behind a custom overlay too;
  // set the value and dispatch events directly to avoid a third instance
  // of that bug.
  await waitCascade(page, () => page.evaluate(({ sel, value }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    const $ = window.jQuery || window.$;
    if ($) { try { $(el).trigger('change'); } catch (e) {} }
  }, { sel, value: String(value) }));
  return true;
}

// Generic "set this field to this value, whatever shape it turns out to be
// rendered as" — a real field can be a <select>, a radio group (confirmed:
// plan 748's Plan Type), or a plain text input (pincode), and which one a
// given plan uses isn't something we should hardcode.
async function setField(page, field, value) {
  if (value === undefined || value === null || value === '') return false;
  if (await trySelect(page, field, value)) return true;
  if (await tryRadio(page, field, value)) return true;
  if (await tryTextInput(page, field, value)) return true;
  return false;
}

async function selectPlan(page, abacusId) {
  const sel = '#partnerAbacus';
  const current = await page.locator(sel).inputValue().catch(() => null);
  if (current === String(abacusId)) return;
  await waitCascade(page, () => page.selectOption(sel, String(abacusId), { force: true }));
}

// Sum Insured is an ion.rangeSlider, not a native input — confirmed live
// (spike) that calling its own update({from: index}) API alone produces a
// real calculate-premium request carrying the correct new value; no
// synthetic event needed.
async function setSumInsured(page, lakhValue) {
  if (lakhValue === undefined || lakhValue === null || lakhValue === '') return { ok: false, reason: 'no value given' };
  const waiter = page.waitForResponse(r => r.url().includes(CASCADE_URL_PART), { timeout: CASCADE_TIMEOUT }).catch(() => null);
  const result = await page.evaluate((val) => {
    const input = document.querySelector('input[name*="[field_2]"]');
    if (!input) return { ok: false, reason: 'no SI input found' };
    const $ = window.jQuery || window.$;
    if (!$) return { ok: false, reason: 'no jQuery on page' };
    const data = $(input).data('ionRangeSlider');
    if (!data) return { ok: false, reason: 'no ionRangeSlider instance' };
    const values = (data.options && data.options.values) || [];
    const idx = values.findIndex(v => String(v) === String(val));
    if (idx === -1) return { ok: false, reason: 'value not in this plan\'s ladder', values };
    data.update({ from: idx });
    return { ok: true, idx };
  }, String(lakhValue));
  if (result.ok) await waiter;
  await page.waitForTimeout(250);
  return result;
}

async function setAddonChecked(page, field, checked) {
  const sel = `input[type="checkbox"][name*="[extra][${field}]"]`;
  if (!(await page.locator(sel).count())) return false;
  const isChecked = await page.isChecked(sel).catch(() => null);
  if (isChecked === checked) return true; // already in the right state, no cascade needed
  // NOT page.check()/page.uncheck() — confirmed live these throw "Element is
  // not visible" even with force:true (Playwright still enforces visibility
  // for these two convenience methods specifically; force only skips it for
  // plain .click()). These add-on checkboxes are real inputs but hidden
  // behind Care's own custom-styled overlay, so drive the DOM directly
  // instead, same technique already used for the Sum Insured slider above.
  await waitCascade(page, () => page.evaluate(({ sel, checked }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.checked = checked;
    el.dispatchEvent(new Event('click', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    const $ = window.jQuery || window.$;
    if ($) { try { $(el).trigger('change'); } catch (e) {} }
  }, { sel, checked }));
  return true;
}

// ── Cascade preview — used by /addons ────────────────────────────────────────
// Drives only the field(s) the caller specified, leaving everything else at
// whatever the real page's own defaults already are — more faithful than the
// old code's hardcoded placeholder defaults (Floater/2/0/30/28/10/1 Year),
// since those were always a guess and this isn't.
async function previewCascade({ abacusId, businessType, planType, coverType, nationalityStatus, globalCoverage }) {
  return withQueue(async () => {
    const page = await getReadyPage();
    await selectPlan(page, abacusId);
    if (planType)          await setField(page, 'field_23', planType);
    if (businessType)      await setField(page, 'field_75', businessType);
    if (coverType)          await setField(page, 'field_9',  coverType);
    if (nationalityStatus)  await setField(page, 'field_NS', nationalityStatus);
    if (globalCoverage)     await setField(page, 'field_GC', globalCoverage);

    const html = await page.content();
    const addons = parseAddons(html);
    const fields = parseFields(html);
    const catalogueExtra = []; // care_server.js merges its own catalogue-known list in
    const dynamicExtraFields = parseDynamicExtraFields(html, catalogueExtra);
    return { ok: true, addons, fields, dynamicExtraFields };
  });
}

// ── Full quote — used by /calculate ─────────────────────────────────────────
async function runQuote(inputs) {
  const {
    abacusId, pincode, coverType, totalMembers, children, eldestAge,
    member2Age, member3Age, member4Age, member5Age, member6Age,
    sumInsured, tenure, businessType, planType, nationalityStatus, globalCoverage,
    addons = {}, subValues = {}, extraFields = {},
  } = inputs;

  return withQueue(async () => {
    const page = await getReadyPage();
    await selectPlan(page, abacusId);

    // Structural fields first — these can change what add-ons/extra fields
    // even exist, so they must settle before we touch anything downstream.
    if (planType)         await setField(page, 'field_23', planType);
    if (businessType)     await setField(page, 'field_75', businessType);
    if (coverType)         await setField(page, 'field_9',  coverType);
    if (nationalityStatus) await setField(page, 'field_NS', nationalityStatus);
    if (globalCoverage)    await setField(page, 'field_GC', globalCoverage);
    if (totalMembers)      await setField(page, 'field_1',  totalMembers);
    if (children !== undefined) await setField(page, 'field_10', children);
    if (eldestAge)         await setField(page, 'field_3',  eldestAge);

    const total = parseInt(totalMembers, 10) || 1;
    const memberAges = { 2: member2Age, 3: member3Age, 4: member4Age, 5: member5Age, 6: member6Age };
    for (let n = 2; n <= 6; n++) {
      if (total >= n && memberAges[n]) await setField(page, `newMem_${n}`, memberAges[n]);
    }

    if (pincode) await setField(page, 'field_54', pincode);
    if (sumInsured) await setSumInsured(page, sumInsured);
    if (tenure) await setField(page, 'field_4', tenure);

    // Add-ons and their sub-value choices, once the structural fields (and
    // therefore the real add-on list) have settled.
    for (const [field, checked] of Object.entries(addons)) {
      await setAddonChecked(page, field, !!checked);
      if (checked && subValues[`${field}_Value`]) {
        await setField(page, `${field}_Value`, subValues[`${field}_Value`]);
      }
    }
    for (const [field, value] of Object.entries(subValues)) {
      if (value) await setField(page, field, value);
    }
    for (const [field, value] of Object.entries(extraFields)) {
      if (value) await setField(page, field, value);
    }

    await page.waitForTimeout(300);
    const html = await page.content();
    return parsePremium(html, null);
  });
}

module.exports = { previewCascade, runQuote };

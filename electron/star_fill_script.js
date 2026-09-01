// Builds the JS source injected into the Star Health BrowserView via
// webContents.executeJavaScript() to auto-fill the real quote form at
// atompro.starhealth.in/v1/quickquote/ — product category, product,
// policy plan/type, member counts, per-member ages, and PED. Pincode is
// NOT handled here — confirmed live it needs genuinely trusted keyboard
// input (a synthetic native-setter + input/change event, and even a full
// synthetic keydown/keypress/input/keyup sequence per character, both
// left the city-lookup/Continue step never appearing), the same
// situation mc_fill_script.js/mc-view.js already solved with real
// webContents.sendInputEvent() keystrokes — star-view.js's IPC handler
// does that part before injecting this script.
//
// Confirmed live: unlike Niva's plain buttons/native inputs, this is a
// Next.js/MUI app — every dropdown (`ion-select`-equivalent here is MUI's
// <Select>) and every radio option needs a FULL synthetic pointer+mouse
// event sequence (pointerdown/mousedown/pointerup/mouseup/click) to
// register at all — a bare `.click()` silently does nothing (confirmed
// live: 0 options rendered after a bare click, vs. the full sequence
// reliably opening the menu every time). No trusted sendInputEvent is
// needed for these, though — the fuller synthetic dispatch is enough, a
// meaningfully smaller lift than MC's Sarvah page needed for its own
// dropdowns.
//
// MUI Select options render as `<li role="option" data-value="...">` in a
// portal appended to the document (not inside the trigger element) —
// confirmed live for the product/parents/adults/child/*.age selects, all
// using the same interaction pattern: click the `#mui-component-select-*`
// trigger div, wait for the listbox, click the matching `data-value` li.
//
// Radio groups (productCategory, policyPlan, policyType, pedButton) exist
// as DUPLICATE pairs per option in the DOM (confirmed live — a responsive-
// layout artifact, not a bug in this script) — clicking either duplicate's
// wrapping <label> reliably lands on the correct final value regardless of
// which one is clicked, so no attempt is made to pick "the right" one.
function buildStarSetupScript(params) {
  const json = JSON.stringify(params || {});
  return `
(async () => {
  const P = ${json};
  const applied = [];
  const errors = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function fireClick(el) {
    const rect = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  async function pickRadio(name, value) {
    const radio = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (!radio) return false;
    fireClick(radio.closest('label') || radio.parentElement);
    await sleep(400);
    return true;
  }

  async function pickSelect(triggerId, value) {
    const trigger = document.querySelector('[id="' + triggerId + '"]');
    if (!trigger) return false;
    fireClick(trigger);
    await sleep(500);
    const opt = Array.from(document.querySelectorAll('li[role="option"]')).find((li) => li.getAttribute('data-value') === String(value));
    if (!opt) { fireClick(trigger); await sleep(200); return false; } // close the menu before giving up, don't leave it stuck open
    fireClick(opt);
    await sleep(500);
    return true;
  }

  try {
    if (P.productCategory) {
      if (await pickRadio('productCategory', P.productCategory)) applied.push('productCategory');
      else errors.push({ field: 'productCategory', reason: 'radio not found' });
    }
    if (P.product) {
      if (await pickSelect('mui-component-select-product', P.product)) applied.push('product');
      else errors.push({ field: 'product', reason: 'option not found for "' + P.product + '"' });
    }
    if (P.policyPlan) {
      if (await pickRadio('policyPlan', P.policyPlan)) applied.push('policyPlan');
      else errors.push({ field: 'policyPlan', reason: 'radio not found' });
    }
    if (P.policyType) {
      if (await pickRadio('policyType', P.policyType)) applied.push('policyType');
      else errors.push({ field: 'policyType', reason: 'radio not found' });
    }

    const parents = Math.max(0, parseInt(P.parents, 10) || 0);
    const adults = Math.max(1, parseInt(P.adults, 10) || 1);
    const children = Math.max(0, parseInt(P.children, 10) || 0);
    if (parents > 0) {
      if (await pickSelect('mui-component-select-parents', parents)) applied.push('parents=' + parents);
      else errors.push({ field: 'parents', reason: 'count option not found' });
    }
    if (await pickSelect('mui-component-select-adults', adults)) applied.push('adults=' + adults);
    else errors.push({ field: 'adults', reason: 'count option not found' });
    if (children > 0) {
      if (await pickSelect('mui-component-select-child', children)) applied.push('children=' + children);
      else errors.push({ field: 'children', reason: 'count option not found' });
    }
    // The per-member age selects only render once their member's count is
    // set (confirmed live: setting adults=2 dynamically added an "Adult 2"
    // age field that didn't exist before) — give the re-render a moment.
    await sleep(600);

    // Ages are plain integer years for both adults (18-100) and children
    // (0-25, "<1 year" itself is data-value="0") — confirmed live via each
    // dropdown's real option list, not assumed from one sample.
    const adultAges = Array.isArray(P.adultAges) ? P.adultAges : [];
    const childAges = Array.isArray(P.childAges) ? P.childAges : [];
    for (let i = 0; i < adults && i < adultAges.length; i++) {
      const label = 'adult' + (i + 1) + '.age';
      const age = Math.max(18, Math.min(100, parseInt(adultAges[i], 10) || 30));
      if (await pickSelect('mui-component-select-' + label, age)) applied.push(label + '=' + age);
      else errors.push({ field: label, reason: 'age option not found for ' + age });
    }
    for (let i = 0; i < children && i < childAges.length; i++) {
      const label = 'child' + (i + 1) + '.age';
      const age = Math.max(0, Math.min(25, parseInt(childAges[i], 10) || 10));
      if (await pickSelect('mui-component-select-' + label, age)) applied.push(label + '=' + age);
      else errors.push({ field: label, reason: 'age option not found for ' + age });
    }

    if (P.ped) {
      if (await pickRadio('pedButton', P.ped)) applied.push('ped');
      else errors.push({ field: 'ped', reason: 'radio not found' });
    }

    return { ok: errors.length === 0, applied, errors };
  } catch (e) {
    return { ok: false, applied, errors: errors.concat([{ field: '(setup)', reason: String(e && e.message || e) }]) };
  }
})()`;
}

// Gets the pincode field's on-screen center point for star-view.js's
// trusted-click-then-type orchestration — same pattern as
// mc_fill_script.js's buildMcPincodeRectScript().
function buildStarPincodeRectScript() {
  return `
(() => {
  const el = document.querySelector('input[name="pinCode"]');
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;
}

// Reads back the pincode field's real current value after trusted typing —
// confirms it actually stuck rather than trusting that the input events
// were merely issued.
function buildStarPincodeReadScript() {
  return `(document.querySelector('input[name="pinCode"]')||{}).value`;
}

// Confirmed live: after typing the pincode, the "Continue" button is what
// reveals the rest of the form (product/plan/members/PED) — a plain
// MuiButton, clicked via the same trusted sendInputEvent mouse click used
// for the pincode field itself (star-view.js), not this synthetic-dispatch
// script, to avoid any doubt about whether a MUI Button tolerates a
// synthetic click the way Selects/radios were confirmed to.
function buildStarContinueRectScript() {
  return `
(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Continue' && b.offsetParent);
  if (!btn) return null;
  btn.scrollIntoView({ block: 'center' });
  const r = btn.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;
}

module.exports = {
  buildStarSetupScript,
  buildStarPincodeRectScript,
  buildStarPincodeReadScript,
  buildStarContinueRectScript,
};

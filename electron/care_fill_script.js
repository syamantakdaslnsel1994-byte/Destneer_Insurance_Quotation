// Builds the JS source string injected into the Care BrowserView via
// webContents.executeJavaScript() to auto-fill Care's REAL live page.
// Ported from server/care_automation.js's field-setting techniques — same
// "try select, then radio, then text input" shape, same ionRangeSlider
// trick for Sum Insured — but rewritten against plain DOM + dispatched
// events (native + jQuery, since Care's own handlers may be jQuery-bound
// and a native-only dispatch risks silently doing nothing), because a
// BrowserView has no Playwright page object to drive it with.
//
// runQuote-shaped params in, one big async IIFE string out. The IIFE
// resolves with { ok, appliedFields, errors } once every field has been
// set and its cascade has settled.
function buildFillScript(params) {
  const json = JSON.stringify(params || {});
  return `
(async () => {
  const P = ${json};
  const applied = [];
  const errors = [];
  const bracketed = (f) => '[' + f + ']';

  function fireNative(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }
  function fireJQuery(el, type) {
    const $ = window.jQuery || window.$;
    if ($) { try { $(el).trigger(type); } catch (e) {} }
  }

  // One-time cascade-completion hook — monkey-patch fetch/XHR to bump a
  // counter whenever a calculate-premium request's response lands. Mirrors
  // care_automation.js's page.waitForResponse, event-counter style since
  // there's no Promise-based network-wait API available in-page.
  if (!window.__careCascadeHooked) {
    window.__careCascadeHooked = true;
    window.__careCascadeSeq = 0;
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function(...args) {
        const p = origFetch.apply(this, args);
        const url = String(args[0] || '');
        if (url.includes('calculate-premium')) p.then(() => { window.__careCascadeSeq++; }, () => { window.__careCascadeSeq++; });
        return p;
      };
    }
    const OrigXHR = window.XMLHttpRequest;
    const origOpen = OrigXHR.prototype.open;
    OrigXHR.prototype.open = function(method, url, ...rest) {
      this.__careIsCascade = String(url || '').includes('calculate-premium');
      return origOpen.call(this, method, url, ...rest);
    };
    const origSend = OrigXHR.prototype.send;
    OrigXHR.prototype.send = function(...args) {
      if (this.__careIsCascade) {
        this.addEventListener('loadend', () => { window.__careCascadeSeq++; });
      }
      return origSend.apply(this, args);
    };
  }

  async function waitCascade(action) {
    const before = window.__careCascadeSeq;
    await action();
    const start = Date.now();
    while (window.__careCascadeSeq === before && Date.now() - start < 12000) {
      await new Promise(r => setTimeout(r, 100));
    }
    await new Promise(r => setTimeout(r, 250)); // settle, mirrors care_automation.js
  }

  function trySelect(field, value) {
    const el = document.querySelector('select[name*="' + bracketed(field) + '"]');
    if (!el) return false;
    const opt = Array.from(el.options).find(o => o.value === String(value));
    if (!opt) return false;
    el.value = opt.value;
    fireNative(el, 'change');
    fireJQuery(el, 'change');
    return true;
  }
  function tryRadio(field, value) {
    const el = document.querySelector('input[type="radio"][name*="' + bracketed(field) + '"][value="' + value + '"]');
    if (!el) return false;
    el.checked = true;
    fireNative(el, 'click');
    fireNative(el, 'change');
    fireJQuery(el, 'change');
    return true;
  }
  function tryTextInput(field, value) {
    const el = document.querySelector('input[name*="' + bracketed(field) + '"]:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])');
    if (!el) return false;
    el.value = String(value);
    fireNative(el, 'input');
    fireNative(el, 'change');
    fireJQuery(el, 'change');
    return true;
  }
  async function setField(field, value) {
    if (value === undefined || value === null || value === '') return false;
    let did = false;
    await waitCascade(async () => {
      did = trySelect(field, value) || tryRadio(field, value) || tryTextInput(field, value);
    });
    return did;
  }

  async function selectPlan(abacusId) {
    const el = document.querySelector('#partnerAbacus');
    if (!el) throw new Error('#partnerAbacus not found — page structure changed');
    if (el.value === String(abacusId)) return;
    await waitCascade(async () => {
      const opt = Array.from(el.options).find(o => o.value === String(abacusId));
      if (!opt) throw new Error('plan ' + abacusId + ' not offered on this page');
      el.value = opt.value;
      fireNative(el, 'change');
      fireJQuery(el, 'change');
    });
  }

  async function setSumInsured(lakhValue) {
    if (lakhValue === undefined || lakhValue === null || lakhValue === '') return { ok: false, reason: 'no value given' };
    const before = window.__careCascadeSeq;
    const input = document.querySelector('input[name*="[field_2]"]');
    if (!input) return { ok: false, reason: 'no SI input found' };
    const $ = window.jQuery || window.$;
    if (!$) return { ok: false, reason: 'no jQuery on page' };
    const data = $(input).data('ionRangeSlider');
    if (!data) return { ok: false, reason: 'no ionRangeSlider instance' };
    const values = (data.options && data.options.values) || [];
    const idx = values.findIndex(v => String(v) === String(lakhValue));
    if (idx === -1) return { ok: false, reason: "value not in this plan's ladder", values };
    data.update({ from: idx });
    const start = Date.now();
    while (window.__careCascadeSeq === before && Date.now() - start < 12000) {
      await new Promise(r => setTimeout(r, 100));
    }
    await new Promise(r => setTimeout(r, 250));
    return { ok: true, idx };
  }

  async function setAddonChecked(field, checked) {
    const el = document.querySelector('input[type="checkbox"][name*="[extra][' + field + ']"]');
    if (!el) return false;
    if (el.checked === !!checked) return true;
    await waitCascade(async () => {
      el.checked = !!checked;
      fireNative(el, 'click');
      fireNative(el, 'change');
      fireJQuery(el, 'change');
    });
    return true;
  }

  try {
    await selectPlan(P.abacusId);
    if (P.planType)          { if (await setField('field_23', P.planType)) applied.push('planType'); }
    if (P.businessType)      { if (await setField('field_75', P.businessType)) applied.push('businessType'); }
    if (P.coverType)         { if (await setField('field_9',  P.coverType)) applied.push('coverType'); }
    if (P.nationalityStatus) { if (await setField('field_NS', P.nationalityStatus)) applied.push('nationalityStatus'); }
    if (P.globalCoverage)    { if (await setField('field_GC', P.globalCoverage)) applied.push('globalCoverage'); }
    if (P.totalMembers)      { if (await setField('field_1',  P.totalMembers)) applied.push('totalMembers'); }
    if (P.children !== undefined) { if (await setField('field_10', P.children)) applied.push('children'); }
    if (P.eldestAge)         { if (await setField('field_3',  P.eldestAge)) applied.push('eldestAge'); }

    const total = parseInt(P.totalMembers, 10) || 1;
    const memberAges = { 2: P.member2Age, 3: P.member3Age, 4: P.member4Age, 5: P.member5Age, 6: P.member6Age };
    for (let n = 2; n <= 6; n++) {
      if (total >= n && memberAges[n]) { if (await setField('newMem_' + n, memberAges[n])) applied.push('member' + n + 'Age'); }
    }

    if (P.pincode)    { if (await setField('field_54', P.pincode)) applied.push('pincode'); }
    if (P.sumInsured) { const r = await setSumInsured(P.sumInsured); if (r.ok) applied.push('sumInsured'); else errors.push({ field: 'sumInsured', reason: r.reason }); }
    if (P.tenure)     { if (await setField('field_4', P.tenure)) applied.push('tenure'); }

    const addons = P.addons || {};
    const subValues = P.subValues || {};
    for (const field of Object.keys(addons)) {
      await setAddonChecked(field, !!addons[field]);
      applied.push('addon:' + field);
      if (addons[field] && subValues[field + '_Value']) {
        await setField(field + '_Value', subValues[field + '_Value']);
      }
    }
    for (const field of Object.keys(subValues)) {
      if (subValues[field]) await setField(field, subValues[field]);
    }
    const extraFields = P.extraFields || {};
    for (const field of Object.keys(extraFields)) {
      if (extraFields[field]) { if (await setField(field, extraFields[field])) applied.push('extra:' + field); }
    }

    return { ok: true, appliedFields: applied, errors };
  } catch (e) {
    return { ok: false, appliedFields: applied, errors: errors.concat([{ field: '(fill)', reason: String(e && e.message || e) }]) };
  }
})()`;
}

module.exports = { buildFillScript };

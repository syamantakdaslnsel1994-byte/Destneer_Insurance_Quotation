// Builds the JS source string injected into the Niva Bupa BrowserView via
// webContents.executeJavaScript() to auto-fill Step 1 ("Basic Details") of
// Niva's REAL live calculator — member counts (Adult/Child) and each
// member's Date of Birth. Deliberately stops there — Steps 2-4 (Premium
// Details, Customize Your Plan, Plan Summary) stay manual, same scope
// discipline as this session's Care/MC work.
//
// Confirmed live before writing this: unlike ManipalCigna's Sarvah page
// (which needed Electron's trusted sendInputEvent machinery because
// synthetic TEXT INPUT typing got silently reverted), Niva's DOB field is
// an Angular Material datepicker driven entirely by CLICKS (calendar icon
// -> year grid -> month grid -> day grid), and plain synthetic .click()
// calls work correctly for every step of that — clicks fire an app's bound
// handler regardless of "trusted" origin, unlike text-input value changes,
// which need the native property setter. So this file needs none of
// mc-view.js's sendInputEvent orchestration; a single executeJavaScript
// call handles the whole thing, same shape as care_fill_script.js.
//
// Member counters (Adult/Child, class="plusminus") are plain buttons, the
// same proven-reliable pattern as Care/MC's own +/- counters.
function buildNivaFillScript(params) {
  const json = JSON.stringify(params || {});
  return `
(async () => {
  const P = ${json};
  const applied = [];
  const errors = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function setCounter(index, target) {
    const buttons = Array.from(document.querySelectorAll('button.plusminus')).filter((b) => b.offsetParent);
    const plusBtn  = buttons.filter((b) => b.textContent.trim() === '+')[index];
    const minusBtn = buttons.filter((b) => b.textContent.trim() === '-')[index];
    if (!plusBtn) return false;
    const readCurrent = () => {
      const container = plusBtn.closest('div');
      const m = (container ? container.textContent : '').match(/(\\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    };
    let guard = 0;
    while (readCurrent() < target && guard < 20) { plusBtn.click(); await sleep(350); guard++; }
    while (readCurrent() > target && minusBtn && guard < 40) { minusBtn.click(); await sleep(350); guard++; }
    return true;
  }

  // The page renders FIXED slots — Adult1-4 DOB, Child1-5 DOB — all present
  // in the DOM at once regardless of the current Adult/Child counter values
  // (confirmed live: with adults=2, Adult3/Adult4's DOB inputs still exist
  // with a real layout box). So a flat "index among visible DD/MM/YYYY
  // inputs" scheme silently misfires once any child is involved — a live
  // test filling adults=2, kids=1 landed the child's DOB on index 2, which
  // is actually the dormant "Adult3 DOB" field (confirmed by its distinct
  // max="2008-08-26" 18+-eligibility date, vs the real Child1 field's
  // max="2026-08-26"). Each input's own small ancestor text reads exactly
  // "Adult1 DOB" / "Child1 DOB" etc. — that label is what to target, not
  // position.
  function findDobInputByLabel(label) {
    const inputs = Array.from(document.querySelectorAll('input[placeholder="DD/MM/YYYY"]'));
    for (const el of inputs) {
      let node = el;
      for (let d = 0; d < 6; d++) {
        node = node && node.parentElement;
        if (!node) break;
        const txt = (node.textContent || '').trim();
        if (txt && txt.length < 40) {
          if (txt === label) return el;
          break; // first short-text ancestor found — that's this input's own label, stop climbing
        }
      }
    }
    return null;
  }

  const RANGE_PATTERN = /^\\d{4}\\s*[\\u2013-]\\s*\\d{4}$/; // e.g. "1985 – 2008"

  // A calendar left open by an earlier failed field (this field's own
  // retry, or a previous field in the same fill run) sits on top of the
  // page and intercepts whatever setDOB queries next — confirmed live as
  // the cause of a cross-field failure (a second field's year/month
  // lookups silently missed because the first field's own stale calendar
  // was still the one actually open). Close it before opening a new one.
  async function closeAnyOpenCalendar() {
    const backdrop = document.querySelector('.cdk-overlay-backdrop');
    if (backdrop) { backdrop.click(); await sleep(300); }
  }

  // Poll instead of a fixed sleep — confirmed live that a flat delay after
  // each calendar transition is not reliably enough time for the next
  // view's cells to render (worked on a fresh field, silently broke on a
  // field being re-filled a second time in the same run, which opens on a
  // different starting view and animates differently).
  async function waitUntil(predicate, maxMs) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (predicate()) return true;
      await sleep(100);
    }
    return predicate();
  }

  // A freshly-opened calendar can land on the day view, the single-year
  // (12-month) view, or already the year-range view, depending on whether
  // this field already holds a value (confirmed live: a field being
  // re-filled opens scoped to its existing date, not on the range view a
  // single period-button click reliably reaches for an empty field). Click
  // the period button until its own label reads as a year range, rather
  // than assuming a fixed number of clicks gets there.
  async function ensureRangeView() {
    for (let i = 0; i < 4; i++) {
      const btn = document.querySelector('.mat-calendar-period-button');
      if (!btn) return false;
      if (RANGE_PATTERN.test(btn.textContent.trim())) return true;
      btn.click();
      await sleep(350);
    }
    const btn = document.querySelector('.mat-calendar-period-button');
    return !!btn && RANGE_PATTERN.test(btn.textContent.trim());
  }

  // Sets one DOB field via the Material datepicker's own click-driven
  // calendar — confirmed live more reliable than typing into the text
  // field directly (the field's input mask misparsed typed digits in a
  // live test: typing "15011990" landed on "AUG 2008", not the intended
  // date).
  async function setDOB(dobInput, fieldLabel, day, month, year) {
    // Confirmed live: this datepicker abbreviates September as "SEPT" (4
    // letters) — every other month is the standard 3-letter form.
    const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEPT','OCT','NOV','DEC'];
    if (!dobInput) return { ok: false, reason: 'DOB field not found for ' + fieldLabel };

    await closeAnyOpenCalendar();

    // The calendar-icon button sits immediately after its own DOB input in
    // the DOM (confirmed live) — walk forward from the input rather than
    // relying on a fixed global index, which breaks once more than one DOB
    // field is on the page (each member gets its own icon button too).
    let calBtn = null;
    let node = dobInput;
    for (let i = 0; i < 5 && !calBtn; i++) {
      node = node.nextElementSibling;
      if (!node) break;
      calBtn = node.matches && node.matches('button.mat-mdc-icon-button') ? node
             : node.querySelector && node.querySelector('button.mat-mdc-icon-button');
    }
    if (!calBtn) return { ok: false, reason: 'calendar icon button not found near ' + fieldLabel };
    calBtn.click();
    const opened = await waitUntil(() => !!document.querySelector('.mat-calendar-period-button'), 2000);
    if (!opened) return { ok: false, reason: 'calendar did not open for ' + fieldLabel };

    if (!(await ensureRangeView())) {
      return { ok: false, reason: 'could not reach the year-range view for ' + fieldLabel };
    }

    // Page through the 24-year range grid (< / >) until the target year is
    // visible, guarded against runaway loops.
    let guard = 0;
    let yearClicked = false;
    while (guard < 20) {
      const cells = Array.from(document.querySelectorAll('.mat-calendar-body-cell'));
      const yearCell = cells.find((c) => c.textContent.trim() === String(year));
      if (yearCell) { yearCell.click(); yearClicked = true; break; }
      const rangeLabel = (document.querySelector('.mat-calendar-period-button') || {}).textContent || '';
      const m = rangeLabel.match(/(\\d{4})\\s*[\\u2013-]\\s*(\\d{4})/);
      if (!m) return { ok: false, reason: 'lost the year-range view while paging for ' + fieldLabel };
      const nav = year < parseInt(m[1], 10)
        ? document.querySelector('.mat-calendar-previous-button')
        : document.querySelector('.mat-calendar-next-button');
      if (!nav || nav.disabled) return { ok: false, reason: 'year ' + year + ' not reachable — nav button missing or disabled (' + rangeLabel + ')' };
      const rangeBefore = rangeLabel;
      nav.click();
      await waitUntil(() => {
        const b = document.querySelector('.mat-calendar-period-button');
        return !!b && b.textContent.trim() !== rangeBefore;
      }, 1000);
      guard++;
    }
    if (!yearClicked) return { ok: false, reason: 'year ' + year + ' not found after paging the range grid' };

    const monthName = MONTH_NAMES[month - 1];
    const monthReady = await waitUntil(() => {
      const cells = Array.from(document.querySelectorAll('.mat-calendar-body-cell'));
      return cells.some((c) => MONTH_NAMES.includes(c.textContent.trim()));
    }, 2000);
    if (!monthReady) return { ok: false, reason: 'month grid did not render for ' + fieldLabel };
    const monthCells = Array.from(document.querySelectorAll('.mat-calendar-body-cell'));
    const monthCell = monthCells.find((c) => c.textContent.trim() === monthName);
    if (!monthCell) return { ok: false, reason: 'month ' + monthName + ' not found' };
    monthCell.click();

    const dayReady = await waitUntil(() => {
      const cells = Array.from(document.querySelectorAll('.mat-calendar-body-cell'));
      return cells.some((c) => /^\\d{1,2}$/.test(c.textContent.trim()));
    }, 2000);
    if (!dayReady) return { ok: false, reason: 'day grid did not render for ' + fieldLabel };
    const dayCells = Array.from(document.querySelectorAll('.mat-calendar-body-cell'));
    const dayCell = dayCells.find((c) => c.textContent.trim() === String(day));
    if (!dayCell) return { ok: false, reason: 'day ' + day + ' not found' };
    dayCell.click();
    await waitUntil(() => !document.querySelector('.cdk-overlay-backdrop-showing'), 1500);

    const finalValue = dobInput.value;
    return { ok: !!finalValue, value: finalValue };
  }

  try {
    const adults = Math.max(1, parseInt(P.adults, 10) || 1);
    const kids = Math.max(0, parseInt(P.kids, 10) || 0);
    await setCounter(0, adults); applied.push('adults=' + adults);
    await setCounter(1, kids);   applied.push('kids=' + kids);
    await sleep(400); // let the DOB-field-per-member list finish re-rendering before locating them

    const adultDobs = Array.isArray(P.adultDobs) ? P.adultDobs : []; // [{day,month,year}, ...] in Adult1, Adult2, ... order
    const childDobs = Array.isArray(P.childDobs) ? P.childDobs : []; // in Child1, Child2, ... order
    for (let i = 0; i < adultDobs.length; i++) {
      const d = adultDobs[i];
      if (!d || !d.day || !d.month || !d.year) continue;
      const label = 'Adult' + (i + 1) + ' DOB';
      const r = await setDOB(findDobInputByLabel(label), label, d.day, d.month, d.year);
      if (r.ok) applied.push(label + '=' + r.value);
      else errors.push({ field: label, reason: r.reason });
    }
    for (let i = 0; i < childDobs.length; i++) {
      const d = childDobs[i];
      if (!d || !d.day || !d.month || !d.year) continue;
      const label = 'Child' + (i + 1) + ' DOB';
      const r = await setDOB(findDobInputByLabel(label), label, d.day, d.month, d.year);
      if (r.ok) applied.push(label + '=' + r.value);
      else errors.push({ field: label, reason: r.reason });
    }

    return { ok: true, appliedFields: applied, errors };
  } catch (e) {
    return { ok: false, appliedFields: applied, errors: errors.concat([{ field: '(fill)', reason: String(e && e.message || e) }]) };
  }
})()`;
}

module.exports = { buildNivaFillScript };

// Builds the page-JS snippets used to auto-fill a slice of ManipalCigna's
// REAL live Sarvah entry form — Adults/Kids counts, per-member Age,
// Gender, and Pincode. Still deliberately does NOT click "Ok"/"GET
// QUOTES" — see the note at the bottom of this file for why.
//
// IMPORTANT ARCHITECTURE NOTE: the Age and Pincode fields cannot be filled
// via injected-JS synthetic events (`el.value = x; el.dispatchEvent(new
// Event('input'))`). A live re-verification found the real page silently
// reverts that kind of untrusted write on its next re-render — it only
// keeps a value that arrived through a real, trusted input event. Adults/
// Kids counters are unaffected (they're plain button clicks, not a
// validated controlled text value) and stay as simple injected-JS clicks
// below. Age and Pincode are instead driven from the MAIN PROCESS via
// webContents.sendInputEvent() — real mouse/keyboard events Chromium's own
// input pipeline treats as trusted, the same mechanism Playwright's own
// keyboard.type() uses under the hood. See electron/mc-view.js's
// `mc-autofill` handler for that orchestration; this file only supplies
// the page-JS run via executeJavaScript for the parts around it (counters,
// opening the panel, reading element rects, reading back real values).
const sleep = null; // (unused placeholder kept out of page-JS strings below)

// Sets Adults/Kids counters to the target counts and opens the "Enter AGE &
// Gender" panel. Plain injected clicks only — proven reliable across every
// live run so far, unlike the text-input fields below.
function buildMcSetupScript(params) {
  const json = JSON.stringify(params || {});
  return `
(async () => {
  const P = ${json};
  const applied = [];
  const errors = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function setCounter(index, target) {
    const buttons = Array.from(document.querySelectorAll('input[type="button"][value="+"], input[type="button"][value="-"]'))
      .filter((b) => b.offsetParent);
    const plusBtn  = buttons.filter((b) => b.value === '+')[index];
    const minusBtn = buttons.filter((b) => b.value === '-')[index];
    if (!plusBtn) return false;
    const readCurrent = () => {
      const container = plusBtn.closest('div');
      const m = (container ? container.textContent : '').match(/(\\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    };
    let guard = 0;
    while (readCurrent() < target && guard < 20) { plusBtn.click(); await sleep(400); guard++; }
    while (readCurrent() > target && minusBtn && guard < 40) { minusBtn.click(); await sleep(400); guard++; }
    return true;
  }

  try {
    const adults = Math.max(1, parseInt(P.adults, 10) || 1);
    const kids = Math.max(0, parseInt(P.kids, 10) || 0);
    await setCounter(0, adults); applied.push('adults=' + adults);
    await setCounter(1, kids);   applied.push('kids=' + kids);

    const trigger = document.querySelector('input[placeholder="Enter AGE & Gender"]');
    if (!trigger) { errors.push({ field: 'age-gender-panel', reason: 'trigger field not found' }); return { ok: false, applied, errors }; }
    trigger.click();
    await sleep(1500); // panel open + settle — confirmed live this needs to be generous, not the 600ms tried earlier

    // Gender is deliberately NOT set here — see buildMcGenderScript() below
    // and this file's trailing comment for why it has to run LAST, after
    // Age/Pincode are typed, not during this setup step.

    const ageFieldCount = Array.from(document.querySelectorAll('input[placeholder="Enter Age"]')).filter((e) => e.offsetParent).length;
    return { ok: true, applied, errors, ageFieldCount };
  } catch (e) {
    return { ok: false, applied, errors: errors.concat([{ field: '(setup)', reason: String(e && e.message || e) }]) };
  }
})()`;
}

// Sets each visible Gender <select> — MUST run after Age/Pincode have
// already been typed (see the trailing comment for why), never during
// buildMcSetupScript(). A pure synthetic set (native property setter +
// dispatched 'change' event, no trusted sendInputEvent) is enough — this
// part was never the problem, only the timing was.
function buildMcGenderScript(genders) {
  const json = JSON.stringify(Array.isArray(genders) ? genders : []);
  return `
(() => {
  const genders = ${json};
  const applied = [];
  const errors = [];
  const selects = Array.from(document.querySelectorAll('select.form-select')).filter((e) => e.offsetParent);
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  genders.forEach((g, i) => {
    const sel = selects[i];
    if (!sel) { errors.push({ field: 'gender[' + i + ']', reason: 'select not found' }); return; }
    const value = g === 'FEMALE' ? 'FEMALE' : g === 'OTHER' ? 'OTHER' : 'MALE';
    nativeSetter.call(sel, value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    applied.push('gender[' + i + ']=' + value);
  });
  return { ok: errors.length === 0, applied, errors };
})()`;
}

// Returns the current on-screen center point of visible age input `index`,
// re-read fresh right before each click/type — not cached from an earlier
// snapshot, since layout can shift slightly as the panel settles.
function buildMcAgeRectScript(index) {
  return `
(() => {
  const el = Array.from(document.querySelectorAll('input[placeholder="Enter Age"]')).filter((e) => e.offsetParent)[${index}];
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;
}

function buildMcPincodeRectScript() {
  return `
(() => {
  const el = document.querySelector('input[placeholder="Enter Pincode"]');
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;
}

// Reads back the REAL current DOM values after the trusted-input typing is
// done, so the result we hand back reflects what actually stuck — not just
// that we issued the commands. This is the difference from the first
// version of this file, which reported ok:true / fields "applied" even
// when the page had silently reverted them.
function buildMcVerifyScript(ageCount) {
  return `
(() => {
  const ages = Array.from(document.querySelectorAll('input[placeholder="Enter Age"]')).filter((e) => e.offsetParent).map((e) => e.value);
  const genders = Array.from(document.querySelectorAll('select.form-select')).filter((e) => e.offsetParent).map((e) => e.value);
  const pin = document.querySelector('input[placeholder="Enter Pincode"]');
  return { ages, genders, pincode: pin ? pin.value : null };
})()`;
}

module.exports = { buildMcSetupScript, buildMcGenderScript, buildMcAgeRectScript, buildMcPincodeRectScript, buildMcVerifyScript };

// Gender WAS left untouched across four earlier attempts this session, all
// of which generalized the Age/Pincode finding above ("synthetic writes get
// silently reverted on this page") to the whole AGE & Gender panel without
// separately testing the Gender control itself. Gender is a plain native
// `<select class="form-select form-select-sm">`, not the same kind of
// validated controlled text input Age/Pincode are, and a pure synthetic set
// (native property setter + dispatched 'change' event) does set it.
//
// CORRECTION, found on a later live re-test while chasing a different bug
// (ManipalCigna's Multi Individual capture): setting Gender that way DURING
// buildMcSetupScript() — i.e. before Age/Pincode are typed — does NOT
// actually survive. It looked like it held in isolation (read back right
// after setting it, nothing else happening), but confirmed live in the
// REAL end-to-end sequence: each subsequent trusted keystroke into Age or
// Pincode triggers a fresh React re-render, and Gender gets silently wiped
// back to empty one field at a time as those re-renders land — by the time
// Pincode is done, both Gender selects are back to blank. React's own
// component state was never updated by the synthetic 'change' event (only
// the DOM was), so each re-render "corrects" the select back to what React
// believes it is: unset. This is the exact same class of problem as Age/
// Pincode's own untrusted-write issue, just with a wider blast radius that
// an isolated one-shot readback test didn't expose.
//
// Fix: set Gender LAST, strictly after Age and Pincode are both typed and
// no further trusted-input-triggered re-render is expected — confirmed live
// this holds cleanly, including after a settle period with nothing else
// touching the page. `buildMcGenderScript()` above is the isolated,
// last-step version of this; `electron/mc-view.js`'s `mc-autofill` handler
// calls it after the Age/Pincode typing loop, not inside setup.
//
// The "Ok"/"GET QUOTES" buttons are still deliberately left unclicked:
// - A live test found clicking "Ok" automatically WHILE Gender was still
//   empty triggered the page's own validation error toast ("Please provide
//   required information") and, as a side effect, silently cleared the
//   first age field back to blank — actively destructive, not just a
//   no-op. Gender no longer being empty removes the specific trigger for
//   that failure, but final submission is still left to the operator by
//   design, not just because it was once unsafe — this pass didn't revisit
//   that call.

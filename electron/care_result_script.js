// Injected once per navigation into the Care BrowserView (idempotent guard)
// to catch the case where the OPERATOR finishes a quote by hand on Care's
// real page, without going through auto-fill at all — the auto-fill path
// doesn't need this, it reads document.documentElement.outerHTML directly
// right after its own fill script resolves.
//
// Confirmed live this observer never fired in practice: it used to grab
// #grand_total/.outputPremium ONCE at arm time and observe those specific
// node references. Care's page re-renders its form via AJAX on every
// field change (same cascade behavior this whole project reverse-
// engineered) — that replaces those nodes outright rather than mutating
// them in place, so the observer ended up watching elements already
// removed from the live document. Since reaching a final premium means
// changing several fields first, it was dead long before any real result
// ever appeared.
//
// Fix: observe a stable ancestor that survives the re-render
// (document.body) instead of the specific nodes, and re-query fresh on
// every debounced check rather than trusting references captured at arm
// time. Dedupes on the actual premium text so settling noise after a
// real result doesn't re-report the same thing repeatedly.
const RESULT_OBSERVER_SCRIPT = `
(() => {
  if (window.__careResultObserverArmed) return 'already-armed';
  window.__careResultObserverArmed = true;
  let timer = null;
  let lastReported = null;

  const check = () => {
    const targets = [];
    const gt = document.querySelector('#grand_total');
    if (gt) targets.push(gt);
    document.querySelectorAll('.outputPremium').forEach(el => targets.push(el));
    if (!targets.length) return;
    const text = targets.map(t => t.textContent || '').join(' ');
    if (!/\\d/.test(text)) return; // still a placeholder/dash state — not ready
    if (text === lastReported) return; // already reported this exact result
    lastReported = text;
    if (window.__careBridge && window.__careBridge.reportResult) {
      // #partnerAbacus's own live .value is the only reliable way to know
      // which plan is actually selected right now — confirmed live that
      // PartnerPreviewForm[plan_id]'s hidden field does NOT update when
      // the operator switches plans (it stays frozen at whatever value
      // the page loaded with, e.g. "110"), even though the visible plan
      // picker and the calculated premium both update correctly. Sending
      // it separately rather than trying to regex it out of the
      // serialized HTML, since the hidden field's value is simply wrong.
      const planSel = document.querySelector('#partnerAbacus');
      window.__careBridge.reportResult(JSON.stringify({
        html: document.documentElement.outerHTML,
        livePlanId: planSel ? planSel.value : null,
      }));
    }
  };
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(check, 500);
  });
  observer.observe(document.body, { characterData: true, childList: true, subtree: true });
  return 'armed';
})()`;

module.exports = { RESULT_OBSERVER_SCRIPT };

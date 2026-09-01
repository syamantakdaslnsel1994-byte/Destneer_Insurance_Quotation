// Injected once per navigation into the Star Health BrowserView (idempotent
// guard) to catch the single-plan detail screen that appears after the
// operator clicks "Proceed" on one card from the product-recommendations
// list (auto-fill stops well short of that — see star_fill_script.js).
//
// An earlier version of this file captured the /v1/product-recommendations/
// list itself (several plans at once) and reported every card, which
// insurance_hub.html's addStarToComparison() then added all of in one
// click. The user reported that's wrong — the intended flow (matching
// Niva's own Plan Summary + Key Add-Ons pattern) is: pick ONE plan first
// (click "Proceed"), let ITS OWN detail screen render, and capture only
// that. "Proceed" navigates to /v1/product-customize/ — confirmed live
// this is genuinely the real single-plan detail screen once reached with
// an active guest quote session behind it (earlier in this session, the
// same URL only ever showed a login-walled shell with no session).
//
// Exact selectors confirmed live from a real product-customize screen's
// outerHTML (not guessed):
//   A landmark <p> whose exact text is "Premium Breakup" — its parent is
//   the whole summary card. Scoping everything below to THIS card matters:
//   a bare, unscoped `.MuiCardHeader-content p` query on the page matched
//   3 elements, not the 2 that make up this card's own plan name — there's
//   an unrelated header elsewhere on the same screen.
//     .MuiCardHeader-content p         -> plan name (scoped to the card)
//     "Sum Insured" <p>, next sibling  -> value, e.g. "10 Lakh"
//     "Policy Period" <p>, next sibling -> value, e.g. "1 Year"
//     "Total Premium" <p>, next sibling -> value, e.g. "₹11,327"
//   (each label/value pair is two sibling <p> elements in one wrapping
//   div — confirmed for both the Sum Insured/Policy Period pair and the
//   Bundle/Total Premium pair)
//
//   Add-ons ("Additional Covers") live OUTSIDE this card, as separate rows
//   elsewhere on the page. Confirmed live for both an already-added cover
//   ("Room rent Modification") and a not-added one ("Voluntary
//   Deductible"): the button's own text is the signal — exactly "Added"
//   (and disabled) means included, "Add" means not. Each row's cover name
//   is the first <p> found by climbing up from the button (2 levels
//   reached the row in both samples) — not the compiled css-* class names,
//   which aren't guaranteed stable across deployments.
const RESULT_OBSERVER_SCRIPT = `
(() => {
  if (window.__starResultObserverArmed) return 'already-armed';
  window.__starResultObserverArmed = true;
  let timer = null;
  let lastReported = null;

  const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();

  function valueForLabel(card, labelText) {
    const labelP = Array.from(card.querySelectorAll('p')).find((p) => clean(p.textContent) === labelText);
    const valueP = labelP && labelP.nextElementSibling;
    return valueP ? clean(valueP.textContent) : '';
  }

  const check = () => {
    const breakupLabel = Array.from(document.querySelectorAll('p')).find((p) => clean(p.textContent) === 'Premium Breakup');
    const card = breakupLabel ? breakupLabel.closest('.MuiCard-root') : null;
    if (!card) return; // not on a single-plan detail screen (yet, or not this page)

    const nameEl = card.querySelector('.MuiCardHeader-content p');
    const planName = nameEl ? clean(nameEl.textContent) : 'Star Health';
    const amount = valueForLabel(card, 'Total Premium');
    if (!amount) return;
    const sumInsured = valueForLabel(card, 'Sum Insured');
    const term = valueForLabel(card, 'Policy Period');

    const addonButtons = Array.from(document.querySelectorAll('button')).filter((b) => {
      const t = clean(b.textContent);
      return t === 'Add' || t === 'Added';
    });
    const included = [];
    addonButtons.forEach((btn) => {
      let node = btn;
      let nameP = null;
      for (let d = 0; d < 6 && !nameP; d++) {
        node = node.parentElement;
        if (!node) break;
        const ps = node.querySelectorAll('p');
        if (ps.length) nameP = ps[0];
      }
      if (nameP && clean(btn.textContent) === 'Added') included.push(clean(nameP.textContent));
    });
    const addons = included.join(', ');

    const dedupeKey = planName + '|' + amount + '|' + addons;
    if (dedupeKey === lastReported) return;
    lastReported = dedupeKey;
    if (window.__starBridge && window.__starBridge.reportResult) {
      window.__starBridge.reportResult(JSON.stringify({
        planName, amount, sumInsured, term, addons,
        pageTitle: document.title || '',
        url: location.href,
      }));
    }
  };
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(check, 600);
  });
  observer.observe(document.body, { characterData: true, childList: true, subtree: true });
  return 'armed';
})()`;

module.exports = { RESULT_OBSERVER_SCRIPT };

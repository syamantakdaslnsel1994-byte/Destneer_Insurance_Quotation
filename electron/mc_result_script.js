// Injected once per navigation into the ManipalCigna BrowserView (idempotent
// guard) to catch whenever the operator finishes a quote by hand — there is
// no auto-fill path for MC at all (see mc-view.js), so this is the ONLY way
// a result ever gets captured.
//
// Unlike Care (electron/care_result_script.js), there is no known, stable
// selector to key off — confirmed live that get-quick-quote/ covers 8
// different products, each presumably rendering its own results-page shape,
// and MC's React SPA emits no id/name attributes on its own controls at
// all. So instead of a fixed selector, this scans the page's own rendered
// text for a Rupee-formatted amount sitting near a premium-indicating
// keyword — generic by construction, verified per-product as each one is
// actually exercised (see the plan notes), not assumed correct everywhere.
//
// Confirmed live (user screenshot) this was capturing the WRONG figure on
// a real "Summary" panel shaped like: Base Premium ₹95,319 / Add Ons
// ₹-8,523.00 / Final Amount ₹86,795.1. The old KEYWORDS list had no entry
// for "final amount" at all, so it fell through to the generic "premium"
// fallback — which matched "Base Premium" (the FIRST "premium" occurrence
// in the text), the pre-add-on figure, not the real total. Same class of
// bug as Care's grandTotal-vs-discounted priority mixup earlier this
// session: always prefer the final/total figure over a base one.
//
// Fixed two ways: (1) added "final amount" and other final-total synonyms
// AHEAD of generic "premium" in priority order, so a real total is found
// before the fallback ever triggers: (2) any keyword match whose preceding
// text reads "base ..." is explicitly skipped, so "Base Premium"/"Base
// Amount" can never win even via the generic fallback on a page that omits
// all the specific synonyms.
//
// Observes document.body with a debounce, same pattern proven on Care to
// survive a SPA's re-renders (which replace DOM nodes outright rather than
// mutating them in place) — re-scans fresh text on every settled check
// rather than trusting anything captured at arm time.
//
// Also collects selected add-ons — confirmed live (radio inputs carry an
// "ant-radio-input" class) that MC's real UI is built on Ant Design, whose
// Checkbox component always wraps its <input> in its own <label> containing
// the visible label text (nothing else contributes text inside that label,
// since the checkbox itself renders none) — so cb.closest('label') is a
// reliable, generic way to recover an add-on's name without needing a
// per-product selector, the same way the amount detector above works.
// Genuinely unverified against MC's own real add-ons panel specifically
// (only the radio-input class was seen live) — tighten this once the
// operator flags a case it gets wrong, same as the Final Amount fix.
const RESULT_OBSERVER_SCRIPT = `
(() => {
  if (window.__mcResultObserverArmed) return 'already-armed';
  window.__mcResultObserverArmed = true;
  let timer = null;
  let lastReported = null;

  // Intercepts MC's own quote/viewPlans XHR response — confirmed live via
  // the user's own DevTools Network tab (Type: xhr, not fetch — hence
  // patching XMLHttpRequest here, the same technique already proven in
  // server/care_automation.js's cascade detection) at a real endpoint
  // (".../sarvahpolicyproposal/quote/viewPlans"). This is ground truth
  // from MC's own backend: each entry in its Card array carries
  // { SuggestionName: "UTTAM"/"PARAM"/"PRATHAM", FinalPremiumTable: [{
  // MODAL_PREM_TAX, BASE_PREM, ... }], AddOns, Riders } — far more
  // reliable than guessing at rendered page text, which is why two
  // earlier DOM-text-based attempts at the plan name both failed
  // silently on the real page. The response does NOT say which card is
  // currently selected/displayed, though (confirmed from the real
  // payload) — that still has to be resolved separately, by matching
  // each card's own premium against whatever the page is showing (see
  // findTierFromViewPlans below), not by reading this response alone.
  let viewPlansCards = null;
  const OrigXHR = window.XMLHttpRequest;
  if (OrigXHR && !window.__mcViewPlansHooked) {
    window.__mcViewPlansHooked = true;
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;
    OrigXHR.prototype.open = function(method, url) {
      this.__mcIsViewPlans = /viewplans/i.test(String(url || ''));
      return origOpen.apply(this, arguments);
    };
    OrigXHR.prototype.send = function() {
      if (this.__mcIsViewPlans) {
        this.addEventListener('load', () => {
          try {
            const json = JSON.parse(this.responseText);
            const cards = json && json.response && json.response.Card;
            if (Array.isArray(cards) && cards.length) viewPlansCards = cards;
          } catch (e) { /* not JSON this time, or the shape changed — ignore */ }
        });
      }
      return origSend.apply(this, arguments);
    };
  }

  // Ordered most- to least-authoritative — the final/total figure the
  // operator actually cares about, checked well before the generic
  // "premium" fallback that used to grab "Base Premium" instead.
  const KEYWORDS = [
    'final amount', 'final premium', 'total premium', 'amount payable',
    'payable amount', 'premium payable', 'payable premium', 'grand total',
    'net premium', 'total amount', 'premium',
  ];
  const AMOUNT_RE = /(?:\\u20b9|Rs\\.?|INR)\\s?-?[\\d,]+(?:\\.\\d+)?/i;
  const EXCLUDE_BEFORE_RE = /\\bbase\\s*$/i;

  // Confirmed live (user screenshot of the real results page) that Sum
  // Insured and Policy Duration are genuine <select> dropdowns, e.g.
  // "Sum Insured" -> a select showing "10.0 Lakhs" as the CURRENT
  // selection. The old text-scan approach read \\u20b9/₹ or Lakh/Crore
  // text within 100 chars of the keyword — but a collapsed <select>'s
  // text can include the OTHER (unselected) option strings too (confirmed
  // on this same page earlier this session, for Gender), so the scan
  // grabbed the wrong figure (5.0 Lakhs, an unselected option) instead of
  // the real 10.0 Lakhs selection. Fixed by reading the actual selected
  // <option> off the <select> element itself, not scanning nearby text.
  //
  // Finds the label by exact text match on a leaf element, then looks for
  // a <select> in its immediate container (parent, then grandparent —
  // deliberately narrow, not a wide ancestor search) — wide enough for a
  // typical "label + control" wrapper div, narrow enough to avoid
  // crossing into a NEIGHBOURING field's own select when several fields
  // share one row container (Plan Type / Sum Insured / Pincode all sit
  // side by side on the real page).
  const findSelectValueNear = (labelText) => {
    const kw = labelText.toLowerCase();
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      if (el.children.length !== 0) continue; // leaf nodes only — the label itself
      if ((el.textContent || '').trim().toLowerCase() !== kw) continue;
      const containers = [el.parentElement, el.parentElement && el.parentElement.parentElement];
      for (const container of containers) {
        if (!container) continue;
        const sel = container.querySelector('select');
        if (sel) {
          const opt = sel.options[sel.selectedIndex];
          const v = (opt && opt.text) || sel.value;
          if (v) return v.trim();
        }
      }
    }
    return null;
  };

  // Sum Insured — reported to the hub as a raw snippet (e.g. "10.0 Lakhs"
  // or "\\u20b91,00,00,000"), not a parsed number: the hub's own
  // parseSIRupees() (insurance_hub.html) already handles every one of
  // these formats for the other 3 insurers, so there's no need to
  // duplicate that parsing here. Tries the real <select> first (see
  // above); falls back to the old text-scan only if no matching select is
  // found, in case some other MC product renders this as plain text
  // instead of a dropdown.
  const SI_KEYWORDS = ['sum insured', 'sum assured', 'coverage amount', 'cover amount'];
  const SI_AMOUNT_RE = /(?:\\u20b9\\s?-?[\\d,]+(?:\\.\\d+)?|-?[\\d,]+(?:\\.\\d+)?\\s?(?:l|lac|lacs|lakh|lakhs|cr|crore|crores)\\b)/i;
  const collectSelectedSI = (text, lower) => {
    for (const kw of SI_KEYWORDS) {
      const bySelect = findSelectValueNear(kw);
      if (bySelect) return bySelect;
    }
    for (const kw of SI_KEYWORDS) {
      const idx = lower.indexOf(kw);
      if (idx === -1) continue;
      const m = text.slice(idx, idx + 100).match(SI_AMOUNT_RE);
      if (m) return m[0].trim();
    }
    return null;
  };

  // Tenure/policy term — same <select>-first approach as Sum Insured.
  // Confirmed live the real label reads "Policy Duration" (not "Tenure"
  // or "Policy Term", the only keywords the previous version knew), which
  // is why tenure never showed up in the hint at all on a real quote —
  // added it and a couple of likely siblings up front.
  const TENURE_KEYWORDS = ['policy duration', 'policy term', 'policy tenure', 'plan tenure', 'duration', 'tenure'];
  const TENURE_RE = /\\d+\\s*year(?:s)?\\b/i;
  const collectTenure = (text, lower) => {
    for (const kw of TENURE_KEYWORDS) {
      const bySelect = findSelectValueNear(kw);
      if (bySelect) return bySelect;
    }
    for (const kw of TENURE_KEYWORDS) {
      const idx = lower.indexOf(kw);
      if (idx === -1) continue;
      const m = text.slice(idx, idx + 60).match(TENURE_RE);
      if (m) return m[0].trim();
    }
    return null;
  };

  // MC's document.title is the only per-product signal for a plan name
  // (confirmed live it does vary by product), but carries boilerplate that
  // just clutters the comparison table (the company name is already shown
  // separately there). Strips only recognized boilerplate — never invents
  // or guesses at a different name — so a title this doesn't recognize
  // still comes through as-is rather than being mangled. Used as a
  // fallback only — see findSelectedPlanCardName() below, which is
  // preferred whenever it finds something, since document.title alone
  // can't say which SUB-plan tier (e.g. Sarvah's Pratham/Uttam/Param) was
  // actually chosen.
  const cleanPlanName = (title) => {
    let s = String(title || '').trim();
    s = s.replace(/\\s*[-|]\\s*get\\s+quick\\s+quotes?\\s+online\\s*$/i, '');
    s = s.replace(/^manipal\\s*cigna\\s+/i, '');
    return s.trim();
  };

  // Confirmed live (user screenshot of the real results page) that Sarvah
  // offers named SUB-plan tiers (Pratham/Uttam/Param) as a stack of cards
  // under a "Plans" section, each with its own price and action button.
  // Exactly one card is the currently-selected tier — its button reads
  // "RECALCULATE"; every other card's button reads "SELECT NOW". This is
  // what actually determines which tier the Summary panel's premium
  // belongs to, so it's a more precise plan name than document.title can
  // ever give (which only ever names the PRODUCT, not the tier).
  // Confirmed the selected card's price matched the Summary panel's Final
  // Amount, corroborating this is the right signal.
  //
  // Two earlier versions of this both assumed the card heading's exact
  // text shape ("ManipalCigna <Product> - <Tier>") and just kept failing
  // to find anything on the real page (confirmed live: plan name stayed
  // on the generic document.title fallback both times) — a strong sign
  // the heading assumption itself is wrong (maybe the company name is a
  // separate logo image, not page text; maybe the separator or spacing
  // differs from what a screenshot alone could confirm), not just a
  // markup-nesting detail. Rebuilt on a weaker, safer assumption instead:
  // don't guess the heading's shape at all — start from the RECALCULATE
  // button (confirmed exact text, since it's a literal button label) and
  // just look for one of the three known tier words anywhere in its own
  // nearby container. Widens one ancestor level at a time, stopping the
  // moment a container contains MORE THAN ONE of the three tier words —
  // that means it has widened into sibling cards' text too, so it stops
  // rather than guessing which one is right.
  const TIER_WORDS = ['Pratham', 'Uttam', 'Param'];
  const RECALCULATE_RE = /recalculate/i;
  const findSelectedPlanCardName = () => {
    const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'))
      .filter((b) => RECALCULATE_RE.test((b.textContent || b.value || '').trim()));
    for (const btn of buttons) {
      let container = btn.parentElement;
      for (let hops = 0; hops < 6 && container; hops++) {
        // Plain substring match, not a \\bword\\b regex — confirmed live
        // (via a same-shaped test) that React's own render output commonly
        // places zero whitespace between adjacent elements' text nodes, so
        // a tier word can run directly into neighbouring text with no word
        // boundary between them (e.g. "...UttamRECALCULATE"), which \\b
        // silently fails to match. The "more than one hit means stop, don't
        // guess" safety net below still protects against ambiguity either way.
        const lowerText = (container.textContent || '').toLowerCase();
        const hits = TIER_WORDS.filter((w) => lowerText.indexOf(w.toLowerCase()) !== -1);
        if (hits.length > 1) break; // widened into more than one card's tier word — stop, don't guess
        if (hits.length === 1) {
          const base = cleanPlanName(document.title).split(/\\s+/)[0] || 'Sarvah';
          return base + ' ' + hits[0];
        }
        container = container.parentElement;
      }
    }
    return null;
  };

  // Ground-truth tier resolver, using the intercepted viewPlans response
  // above (preferred whenever it's available) — cross-checks each card's
  // OWN premium against the amount actually showing on the page right
  // now, since the API response itself never says which one is selected.
  // Matched against BASE PREMIUM specifically, not the Final Amount used
  // for the reported result: Base Premium is the tier's own intrinsic
  // number, unaffected by whichever extra add-ons the operator has
  // additionally toggled since viewPlans was fetched, whereas Final
  // Amount would drift away from FinalPremiumTable's numbers the moment
  // the operator changes anything — a small numeric tolerance (a few
  // rupees) absorbs rounding, not a wide fuzzy match, so three genuinely
  // different tiers' premiums can't accidentally tie.
  const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const parseAmountNumber = (s) => {
    const n = parseFloat(String(s || '').replace(/[^\\d.]/g, ''));
    return isFinite(n) ? n : null;
  };
  const BASE_PREMIUM_RE = /base\\s*premium/i;
  const findBasePremiumAmount = (text, lower) => {
    const idx = lower.search(BASE_PREMIUM_RE);
    if (idx === -1) return null;
    const m = text.slice(idx, idx + 60).match(AMOUNT_RE);
    return m ? m[0] : null;
  };
  const findTierFromViewPlans = (amountStr) => {
    if (!viewPlansCards || !viewPlansCards.length) return null;
    const target = parseAmountNumber(amountStr);
    if (target == null) return null;
    let best = null;
    let bestDiff = Infinity;
    viewPlansCards.forEach((card) => {
      const table = card.FinalPremiumTable && card.FinalPremiumTable[0];
      if (!table) return;
      [table.BASE_PREM, table.MODAL_PREM_TAX].forEach((prem) => {
        if (prem == null) return;
        const diff = Math.abs(prem - target);
        if (diff < bestDiff) { bestDiff = diff; best = card; }
      });
    });
    if (best && bestDiff <= 5 && best.SuggestionName) return titleCase(String(best.SuggestionName));
    return null;
  };

  const collectSelectedAddons = () => {
    const seen = new Set();
    const out = [];
    document.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
      let label = '';
      const lab = cb.closest('label');
      if (lab) label = lab.textContent;
      if (!label && cb.id) {
        const byFor = document.querySelector('label[for="' + cb.id + '"]');
        if (byFor) label = byFor.textContent;
      }
      if (!label && cb.parentElement) label = cb.parentElement.textContent;
      label = (label || '').replace(/\\s+/g, ' ').trim();
      if (label && !seen.has(label)) { seen.add(label); out.push(label); }
    });
    return out;
  };

  const check = () => {
    const text = document.body.innerText || '';
    const lower = text.toLowerCase();
    let bestMatch = null;
    for (const kw of KEYWORDS) {
      let searchFrom = 0;
      let idx;
      while ((idx = lower.indexOf(kw, searchFrom)) !== -1) {
        const precedingText = text.slice(Math.max(0, idx - 12), idx);
        if (EXCLUDE_BEFORE_RE.test(precedingText)) { searchFrom = idx + kw.length; continue; }
        const windowText = text.slice(idx, idx + 200);
        const m = windowText.match(AMOUNT_RE);
        if (m) bestMatch = { keyword: kw, amount: m[0], context: windowText.slice(0, 140).trim() };
        break;
      }
      if (bestMatch) break;
    }
    if (!bestMatch) return;
    const addons = collectSelectedAddons();
    const selectedSI = collectSelectedSI(text, lower);
    const tenure = collectTenure(text, lower);
    // Three-tier fallback chain, most trustworthy first: the intercepted
    // API response (ground truth, cross-checked numerically against
    // Base Premium) — then the DOM "which card says RECALCULATE" guess —
    // then the generic document.title-based name as a last resort.
    const baseAmount = findBasePremiumAmount(text, lower);
    const tierFromApi = findTierFromViewPlans(baseAmount) || findTierFromViewPlans(bestMatch.amount);
    const productWord = cleanPlanName(document.title).split(/\\s+/)[0] || '';
    const planName = (tierFromApi && productWord ? productWord + ' ' + tierFromApi : null)
      || findSelectedPlanCardName()
      || cleanPlanName(document.title);
    const dedupeKey = bestMatch.amount + '|' + bestMatch.keyword + '|' + addons.join(',')
      + '|' + selectedSI + '|' + tenure + '|' + planName;
    if (dedupeKey === lastReported) return;
    lastReported = dedupeKey;
    if (window.__mcBridge && window.__mcBridge.reportResult) {
      window.__mcBridge.reportResult(JSON.stringify({
        ...bestMatch,
        addons,
        selectedSI,
        tenure,
        planName,
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

// Injected once per navigation into the Niva Bupa BrowserView (idempotent
// guard) to catch whenever the operator finishes a quote by hand — auto-fill
// only covers Step 1 (Basic Details, see niva_fill_script.js), so Steps 2-4
// (Premium Details, Customize Your Plan, Plan Summary) are always manual,
// and this is the only way a result gets captured.
//
// Uses exact selectors from a real Plan Summary + Key Add-Ons screen (the
// user supplied the live outerHTML directly), not a generic keyword scan —
// this is the same specific-selector approach Care's result script uses,
// now that real ground truth exists for Niva too (it didn't when this file
// was first written, hence the earlier generic-scan placeholder).
//
// Plan card (`.pds-prdtDtl`):
//   .pds-prdtDtl-title  -> plan name, e.g. "ReAssure2.0 Titanium+"
//   .pds-yrPrc strong   -> premium, e.g. "₹22,421"
//   .pds-yrPrc p        -> term, e.g. "For 1 Year"
//   .pds-YrSi strong    -> sum insured, e.g. "₹500,000"
//
// Key Add-Ons (`.keyAddon-sec`): one `.kaRider-Sec` per rider row.
//   .kaRider-title p       -> rider name (has a trailing chevron icon with
//                             no text, safe to read via textContent + trim)
//   .kaRider-addBtn        -> "+ Add" (not included) or "Show more" (a
//                             dropdown/radio-configured rider — always
//                             present with a default value rather than a
//                             plain add/remove toggle, so its presence
//                             alone doesn't mean the operator actively
//                             added it; deliberately excluded rather than
//                             guessed).
//   .kaRider-removeBtn     -> a DIFFERENT class (not the same span with
//                             different text — confirmed live from real
//                             "selected" markup) that only exists once the
//                             operator has actually added that rider. This
//                             is the real signal for "included" — an
//                             earlier version of this file assumed the
//                             same `.kaRider-addBtn` element's text just
//                             changed to "Remove", which silently matched
//                             nothing once tested against real toggled-on
//                             markup (the class itself changes, not just
//                             the text).
// Only rows with a `.kaRider-removeBtn` (riders the operator explicitly
// added) are joined into the addons string reported to the hub.
//
// A separate class of rider (Acute Care Option, Room Category, Deductable)
// isn't add/remove at all — it's an inline `<ion-select>` dropdown inside
// `.kaRider-SlctBtns`. Confirmed live (the user picked a real value):
// the currently selected value shows up in a hidden
// `input.aux-input[value=...]` sibling inside the `<ion-select>` — e.g.
// picking "10000" for Deductable set that input's value to "10000". Each
// `<ion-select-option>`'s own `.value` property (an Ionic API — falls back
// to its own text when no explicit value was bound) is matched against
// that to recover the human-readable label. The FIRST option is always
// the untouched/neutral default (confirmed: Deductable defaults to its
// first option, "0") — if the current value still matches it, nothing
// was actively picked, so it's excluded the same way an un-added "+ Add"
// rider is.
//
// A THIRD class (Disease Management Option, Personal Accident — Tiered
// Network's row has no such element and isn't covered here) opens a "Show
// more" modal (its own radio groups/member checkboxes, entirely outside
// this row) that's removed from the DOM once closed. Confirmed live: the
// row's own `.kaRider-editMembr` div — present but EMPTY (just an Angular
// comment placeholder) before any selection — gets populated with one
// `.krMember-cap` (member name + DOB) per member the operator confirmed
// coverage for. That's a stable signal that survives the modal closing,
// even though the modal's OTHER choices there (e.g. a Gold/Platinum plan
// type) aren't reflected back into this row at all, so aren't captured.
//
// Observes document.body with a debounce — proven on both Care and MC to
// survive an SPA's re-renders (which replace DOM nodes outright), and this
// app (Angular/Ionic/Material) is exactly that kind of SPA.
const RESULT_OBSERVER_SCRIPT = `
(() => {
  if (window.__nivaResultObserverArmed) return 'already-armed';
  window.__nivaResultObserverArmed = true;
  let timer = null;
  let lastReported = null;

  const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();

  const check = () => {
    const titleEl = document.querySelector('.pds-prdtDtl-title');
    const premiumEl = document.querySelector('.pds-yrPrc strong');
    const siEl = document.querySelector('.pds-YrSi strong');
    if (!titleEl || !premiumEl) return; // Plan Summary card not on screen (yet, or not this page)

    const planName = clean(titleEl.textContent) || 'Niva Bupa';
    const amount = clean(premiumEl.textContent);
    if (!amount) return;
    const term = clean((document.querySelector('.pds-yrPrc p') || {}).textContent);
    const sumInsured = siEl ? clean(siEl.textContent) : '';

    const addonRows = Array.from(document.querySelectorAll('.keyAddon-sec .kaRider-Sec'));
    const includedAddons = [];
    addonRows.forEach((row) => {
      const nameEl = row.querySelector('.kaRider-title p');
      if (!nameEl) return;
      const name = clean(nameEl.textContent);

      if (row.querySelector('.kaRider-removeBtn')) { includedAddons.push(name); return; }

      const memberCaps = Array.from(row.querySelectorAll('.kaRider-editMembr .krMember-cap'));
      if (memberCaps.length) {
        // Two confirmed shapes: a per-member cap (<span>Adult1</span><p>DOB</p>
        // — Disease Management Option/Personal Accident, take the span, the
        // member's name) and a single plan-description cap with no span at
        // all (<p>Resassure 2.0 Tiered List (...)</p> — Tiered Network, take
        // the p instead). Fall back to the cap's own full text if neither
        // is there, rather than silently dropping it.
        const capLabel = (cap) => {
          const span = cap.querySelector('span');
          if (span) return clean(span.textContent);
          const p = cap.querySelector('p');
          if (p) return clean(p.textContent);
          return clean(cap.textContent);
        };
        const details = memberCaps.map(capLabel).filter(Boolean);
        includedAddons.push(name + (details.length ? ' (' + details.join(', ') + ')' : ''));
        return;
      }

      const selectEl = row.querySelector('.kaRider-SlctBtns ion-select');
      const hiddenInput = selectEl && selectEl.querySelector('input.aux-input');
      if (!selectEl || !hiddenInput) return; // "Show more"-modal rider, or nothing selectable here
      const options = Array.from(selectEl.querySelectorAll('ion-select-option'));
      if (!options.length) return;
      const optionValue = (o) => (o.value !== undefined && o.value !== '' ? o.value : clean(o.textContent));
      const currentValue = hiddenInput.value;
      if (!currentValue || currentValue === optionValue(options[0])) return; // still the untouched default
      const matched = options.find((o) => optionValue(o) === currentValue);
      includedAddons.push(name + ': ' + (matched ? clean(matched.textContent) : currentValue));
    });
    const addons = includedAddons.join(', ');

    const dedupeKey = planName + '|' + amount + '|' + addons;
    if (dedupeKey === lastReported) return;
    lastReported = dedupeKey;
    if (window.__nivaBridge && window.__nivaBridge.reportResult) {
      window.__nivaBridge.reportResult(JSON.stringify({
        keyword: 'premium', amount, planName, term, sumInsured, addons,
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

// ── Care Health: shared HTML scrapers ────────────────────────────────────────
// Pulled out of care_server.js so both the raw-POST path (postCalc + these
// scrapers) and the browser-automation path (care_automation.js, driving the
// real page and reading page.content()) can share the exact same,
// painstakingly-refined extraction logic. Neither path cares where the HTML
// string came from — these functions work on the string alone.

/** Extract _csrf-frontend form token from HTML. */
function extractCSRF(html) {
  const m = html.match(/name="_csrf-frontend"\s+value="([^"]+)"/);
  return m ? m[1] : '';
}

function parsePremium(html, sess) {
  if (!html) return { ok: false };

  // Rotate CSRF for the next request in THIS session only. Passing no session
  // makes the parse read-only, which is what the diagnostic routes want.
  const csrf = extractCSRF(html);
  if (csrf && sess) sess.csrf = csrf;

  // plan_id hidden field
  const pidM   = html.match(/name="PartnerPreviewForm\[plan_id\]"\s+value="([^"]+)"/);
  const planId = pidM?.[1] ?? null;

  // field_2 hidden field — the Sum Insured slider's own current value (in
  // Lakhs, e.g. "10" = 10L), always reflecting whatever the operator has
  // it set to on the real page right now. Same "read the page's own live
  // state instead of trusting stale hub-side pending params" fix already
  // applied to planId above — confirmed live this is what was missing
  // whenever a Care Health comparison row showed a blank Sum Insured.
  const siM = html.match(/name="PartnerPreviewForm\[input\]\[field_2\]\[field_value\]"\s+value="([^"]*)"/);
  const selectedSI = siM?.[1] ?? null;

  // Check for "pincode required" state
  const needsPincode = html.includes('Enter Above Pincode') || html.includes('---- ') ||
    (html.includes('outputPremium') && html.includes('----'));

  // Premium spans: first = discounted (after welcome discount), second = original
  const premSpans = [...html.matchAll(/<span class="outputPremium">([\d,]+)<\/span>/g)];
  const discounted = premSpans[0]?.[1] ?? null;
  const original   = premSpans[1]?.[1] ?? discounted;

  // Grand total from #grand_total
  const gtM      = html.match(/id="grand_total"[\s\S]{0,400}?<span>([\d,]+)<\/span>/);
  const grandTotal = gtM?.[1] ?? discounted;

  // Numeric base premium
  const baseM = html.match(/data-basePremium="([\d.]+)"/);
  const base  = baseM ? parseFloat(baseM[1]) : null;

  // Discount %
  const discPctM = html.match(/data-basepremiumdiscountpercent="([^"]+)"/);
  const discPct  = discPctM?.[1] ?? null;

  // Tenure (field_4) — which radio is actually CHECKED right now, not just
  // which values are on offer. parseFields() below already collects the
  // available options (tenureOptions), but never checked which one is
  // selected, and that was never wired into the captured-quote object at
  // all — confirmed this is why a comparison row's tenure never reflected
  // what the operator had picked on the real page, only the hub's own
  // tenure chip from whenever the fill happened. Same "read the page's own
  // live state" fix already applied to selectedSI above.
  const tenureInputs = [...html.matchAll(/<input[^>]*name="PartnerPreviewForm\[input\]\[field_4\][^"]*"[^>]*>/gi)];
  let tenure = null;
  for (const m of tenureInputs) {
    if (!/\bchecked\b/i.test(m[0])) continue;
    const vm = m[0].match(/value="([^"]+)"/);
    if (vm && /year/i.test(vm[1])) { tenure = vm[1]; break; }
  }

  return { planId, selectedSI, discounted, original, grandTotal, base, discPct, needsPincode, tenure, ok: !!discounted };
}

const FIELD_LABELS = {
  // Confirmed exact field names from DOM
  'field_35':    'Air Ambulance',
  'field_WB':    'Wellness Benefit',
  'field_COPAY': 'Co Payment',          // confirmed: NOT field_CP
  'field_SL':    'Sub Limit',
  'field_RR':    'Recharge Remover',
  'field_BR':    'Bonus Remover',       // confirmed: NOT field_NCB for this label
  'field_34':    'Room Rent Modification', // confirmed: NOT field_RRM
  'field_AHC':   'Annual Health Check-up',
  'field_BFB':   'Be-Fit Benefit',
  'field_OPD':   'Care OPD',
  'field_PB':    'Plus Benefit',
  // Care Supreme / non-POS plans
  'field_NCB':   'Bonus Benefits',
  'field_43':    'PED Modification',
  'field_UC':    'Unlimited Care',
  'field_IC':    'Instant Cover',
  'field_CS':    'Claim Shield',
  'field_SS':    'Super Restore',
  // Other possible fields
  'field_CP':    'Co Payment',
  'field_RRM':   'Room Rent Modification',
  'field_NMB':   'No Medical Benefit',
  'field_LD':    'Loading Discount',
  'field_DAB':   'Daily Allowance Benefit',
  'field_HCB':   'Hospital Cash Benefit',
  'field_MW':    'Maternity & Newborn',
  'field_DC':    'Domiciliary Cover',
  'field_EMI':   'EMI Benefit',
  'field_PW':    'Plus Wellness',
  'field_GR':    'Global Recharge',
  'field_OC':    'OPD Cover',
};

// ── parseAddons — extract add-on checkboxes from form HTML ───────────────────
function parseAddons(html) {
  const addons = [];
  const seen   = new Set();

  // Match every checkbox for PartnerPreviewForm[extra][FIELD][field_value] value="checked"
  const re = /name="PartnerPreviewForm\[extra\]\[([^\]]+)\]\[field_value\]"\s+value="checked"([^>]*?)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const field     = m[1];   // e.g. "field_WB" or "field_COPAY"
    if (seen.has(field)) continue;
    seen.add(field);
    const isChecked = / checked/i.test(m[2]);

    // 1. Hardcoded map (most reliable — confirmed from live DOM)
    let label = FIELD_LABELS[field];

    // 2. Yii2 generates IDs like: partnerpreviewform-extra-field_wb-field_value
    //    Labels use for="<yii2-id>"
    if (!label) {
      const yiiId = 'partnerpreviewform-extra-' + field.toLowerCase() + '-field_value';
      const lbRe  = new RegExp(`for="${yiiId}"[^>]*>([^<]+)<`, 'i');
      const lbM   = html.match(lbRe);
      if (lbM) label = lbM[1].trim();
    }

    // 3. Adjacent label within 400 chars
    if (!label) {
      const nearby = html.slice(re.lastIndex, re.lastIndex + 400);
      const nearLb = nearby.match(/<label[^>]*>([^<]{3,60})<\/label>/i);
      if (nearLb) label = nearLb[1].trim();
    }

    // 4. Absolute fallback: strip "field_" prefix
    if (!label) label = field.replace(/^field_/i, '');

    addons.push({ field, label, checked: isChecked });
  }
  return addons;
}

// ── parseFields — extract visible input fields and SI options from form HTML ──
function parseFields(html) {
  const result = {
    hasBizType:   false,
    hasCoverType: false,
    hasMembers:   false,
    hasChildren:  false,
    hasSI:        false,
    hasTenure:    false,
    siValues:     [],    // e.g. [5, 7, 10, 15, 25, 50, 100]
    coverOptions: [],    // e.g. ['Individual', 'Floater']
    memberOptions:[],
    tenureOptions:[],
    planTypeOptions: [],
    hasPlanType:  false,
  };

  // Business Type field_75
  result.hasBizType = /name="PartnerPreviewForm\[input\]\[field_75\]/.test(html);

  // Cover Type field_9
  result.hasCoverType = /name="PartnerPreviewForm\[input\]\[field_9\]/.test(html);
  if (result.hasCoverType) {
    const opts = [...html.matchAll(/<option[^>]*value="([^"]+)"[^>]*>([^<]+)<\/option>/gi)]
      .filter(m => ['Individual','Floater','individual','floater'].includes(m[1]))
      .map(m => m[1]);
    result.coverOptions = [...new Set(opts)];
  }

  // Total Members field_1
  result.hasMembers = /name="PartnerPreviewForm\[input\]\[field_1\]/.test(html);

  // Children field_10
  result.hasChildren = /name="PartnerPreviewForm\[input\]\[field_10\]/.test(html);

  // Sum Insured field_2 — look for range slider or select options
  result.hasSI = /name="PartnerPreviewForm\[input\]\[field_2\]/.test(html);
  if (result.hasSI) {
    // Try range input min/max
    const rangeM = html.match(/name="PartnerPreviewForm\[input\]\[field_2\][^"]*"[^>]*type="range"[^>]*>/i)
                || html.match(/type="range"[^>]*name="PartnerPreviewForm\[input\]\[field_2\][^"]*"[^>]*>/i);
    if (rangeM) {
      const minM  = rangeM[0].match(/min="(\d+)"/i);
      const maxM  = rangeM[0].match(/max="(\d+)"/i);
      if (minM && maxM) {
        // Record the range only. We deliberately do NOT invent a ladder here.
        // The previous version did `[5,7,10,15,25,50,100].filter(in range)`,
        // which fabricated sum-insured options the plan may not sell — and
        // the front-end preferred that fabrication over the curated table.
        result.siMin = +minM[1];
        result.siMax = +maxM[1];
      }
    }

    // ── The real ladder: Care renders a jQuery slider, not a native range
    // input, and the discrete options live in data-values='[5,7,10,...]' on
    // the .custom-range div — note it's SINGLE-quoted on the live portal
    // (confirmed while building the Plan-Type cascade), which the previous
    // double-quote-only pattern never matched, so this always fell through
    // to the catalogue/default ladder silently. This reader is ported from
    // the v1 backend (server.js), which is the only place in the project
    // that ever read the true values off the portal.
    if (!result.siValues.length) {
      // data-values is single-quoted on the live portal while the JSON array
      // inside it uses double quotes for each entry (data-values='["5",...]'),
      // so the capture has to stop at a matching CLOSE quote of whichever
      // kind opened it, not "any quote character" — a plain [^'"]+ class
      // stops after just "[" the moment it hits the first "5"'s quote.
      const dv = [...html.matchAll(/class="[^"]*custom-range[^"]*"[^>]*data-values=(['"])([\s\S]*?)\1/gi)]
        .concat([...html.matchAll(/data-values=(['"])([\s\S]*?)\1[^>]*class="[^"]*custom-range[^"]*"/gi)])
        .map(m => [m[0], m[2]]);
      for (const m of dv) {
        try {
          const parsed = JSON.parse(m[1].replace(/&quot;/g, '"'));
          if (Array.isArray(parsed) && parsed.length) {
            result.siValues  = parsed.map(v => (typeof v === 'number' ? v : String(v)));
            result.siSource  = 'portal slider data-values';
            break;
          }
        } catch (e) { /* not JSON — try the next match */ }
      }
    }

    // Try select options for field_2
    if (!result.siValues.length) {
      const selBlock = html.match(/name="PartnerPreviewForm\[input\]\[field_2\][^"]*"[\s\S]{0,2000}?<\/select>/i);
      if (selBlock) {
        result.siValues = [...selBlock[0].matchAll(/<option[^>]*value="([\d.]+)"/gi)]
          .map(m => parseFloat(m[1])).filter(Boolean);
        if (result.siValues.length) result.siSource = 'portal select options';
      }
    }

    // Try data-slider-values or similar JSON in nearby script
    if (!result.siValues.length) {
      const dvM = html.match(/data-slider-values?="([^"]+)"/i)
               || html.match(/siValues?\s*=\s*(\[[^\]]+\])/i);
      if (dvM) {
        try {
          result.siValues = JSON.parse(dvM[1]);
          if (result.siValues.length) result.siSource = 'portal data-slider-values';
        } catch {}
      }
    }

    // Try step marks / ticks in HTML
    if (!result.siValues.length) {
      const tickMs = [...html.matchAll(/class="[^"]*step-mark[^"]*"[^>]*data-value="([\d.]+)"/gi)];
      if (tickMs.length) {
        result.siValues = tickMs.map(m => parseFloat(m[1]));
        result.siSource = 'portal step marks';
      }
    }
  }

  // Tenure field_4
  result.hasTenure = /name="PartnerPreviewForm\[input\]\[field_4\]/.test(html);
  if (result.hasTenure) {
    const tenMs = [...html.matchAll(/<input[^>]*name="PartnerPreviewForm\[input\]\[field_4\][^"]*"[^>]*value="([^"]+)"/gi)];
    result.tenureOptions = tenMs.map(m => m[1]).filter(v => /year/i.test(v));
  }

  // Plan Type field_23
  result.hasPlanType = /name="PartnerPreviewForm\[input\]\[field_23\]/.test(html);

  // ── Income fields (Secure family plans) ────────────────────────────────────
  // Search FORWARD from the label to correctly identify the field that follows it.
  // (Searching backward is unreliable — it picks up the previous field in the form.)

  // Annual Income — label text "Annual Income", then the field_XX input follows
  result.hasAnnualIncome = false;
  result.annualIncomeField = null;
  {
    const pos = html.search(/annual\s*income/i);
    if (pos !== -1) {
      result.hasAnnualIncome = true;
      // Search FORWARD from label to find the input field that belongs to it
      const ctx = html.slice(pos, pos + 600);
      const fm  = ctx.match(/name="PartnerPreviewForm\[input\]\[(field_\d+)\]\[field_value\]"/i);
      result.annualIncomeField = fm?.[1] || null;
    }
  }

  // Job Type — label text "Job Type", then radio field follows
  result.hasJobType = false;
  result.jobTypeField = null;
  {
    const pos = html.search(/job\s*type/i);
    if (pos !== -1) {
      result.hasJobType = true;
      const ctx = html.slice(pos, pos + 600);
      // Match either a standard input name or a radio id like id="radio_field_13"
      const fm  = ctx.match(/name="PartnerPreviewForm\[input\]\[(field_\d+)\]\[field_value\]"/i)
               || ctx.match(/id="radio_(field_\d+)"/i);
      result.jobTypeField = fm?.[1] || null;
    }
  }

  // Monthly Income — label text "Monthly Income", then range slider follows
  result.hasMonthlyIncome = false;
  result.monthlyIncomeField = null;
  result.monthlyIncomeMin = 30;
  result.monthlyIncomeMax = 50;
  {
    const pos = html.search(/monthly\s*income/i);
    if (pos !== -1) {
      result.hasMonthlyIncome = true;
      const ctx = html.slice(pos, pos + 600);
      const fm  = ctx.match(/name="PartnerPreviewForm\[input\]\[(field_\d+)\]\[field_value\]"/i);
      result.monthlyIncomeField = fm?.[1] || null;
      const minM = ctx.match(/min="(\d+)"/i);
      const maxM = ctx.match(/max="(\d+)"/i);
      if (minM) result.monthlyIncomeMin = +minM[1];
      if (maxM) result.monthlyIncomeMax = +maxM[1];
    }
  }

  return result;
}

// ── parseDynamicExtraFields — fields that only appear for a specific Plan
// Type / Business Type combination ───────────────────────────────────────────
// Discovered on Care Supreme (2813): selecting Plan Type "Senior Premium"
// reveals a "PED" dropdown (HEART/DIABETES/OTHERS) that isn't there for the
// base "Care Supreme" plan type at all; selecting Business Type "PORT"
// separately reveals a "Port Tenure (in Years)" dropdown. Neither is
// specific to 2813's field IDs — this scans for ANY PartnerPreviewForm[input]
// field not already accounted for elsewhere, so the same mechanism should
// pick up whatever the next plan's own cascade turns out to need, without
// hardcoding field_PED/field_PORT_TENURE by name.
const KNOWN_BASE_FIELDS = new Set([
  'field_75','field_23','field_9','field_1','field_10','field_2','field_3',
  'field_4','field_54','field_NS','field_GC','field_11',
  // Add-on sub-value fields (field_NCB -> field_NCB_Value, etc.) — already
  // surfaced inline next to their checkbox via ADDON_SUBVALUE_MAP on the
  // frontend; without this they'd double up as a second, redundant row.
  'field_NCB_Value','field_IC_Value','field_OPD_Value','field_CS_Value','field_PED_TENURE',
]);
function parseDynamicExtraFields(html, extraKnown) {
  const ignore = new Set([...KNOWN_BASE_FIELDS, ...(extraKnown || [])]);
  const seen = new Set();
  const re = /name="PartnerPreviewForm\[input\]\[([^\]]+)\]\[field_value\]"/gi;
  let m;
  const occurrences = {};
  while ((m = re.exec(html)) !== null) {
    if (/^newMem_/.test(m[1]) || ignore.has(m[1])) continue;
    (occurrences[m[1]] = occurrences[m[1]] || []).push(m.index);
  }
  const found = [];
  for (const [field, idxs] of Object.entries(occurrences)) {
    if (seen.has(field)) continue;
    seen.add(field);
    const idx = idxs[0];
    const before = html.slice(Math.max(0, idx - 700), idx);
    const labelM = before.match(/<label[^>]*>([^<]+)</g);
    const label = labelM && labelM.length
      ? labelM[labelM.length - 1].replace(/<[^>]*>/g, '').replace(/<i\b.*$/, '').trim()
      : field.replace(/^field_/i, '');

    const tagBefore = before.match(/<(select|input)\b[^>]*$/i);
    const tagName = tagBefore ? tagBefore[1].toLowerCase() : null;
    let options = [], def = null;

    if (tagName === 'select') {
      const afterTag = html.slice(idx);
      const closeIdx = afterTag.indexOf('</select>');
      const block = closeIdx !== -1 ? afterTag.slice(0, closeIdx) : '';
      const opts = [...block.matchAll(/<option[^>]*value="([^"]*)"([^>]*)>([^<]*)</gi)];
      options = opts.map(o => o[1]);
      def = (opts.find(o => /selected/i.test(o[2])) || opts[0] || [])[1] ?? null;
    } else {
      const radioRe = new RegExp(`name\\s*=\\s*"PartnerPreviewForm\\[input\\]\\[${field}\\]\\[field_value\\]"\\s+value\\s*=\\s*"([^"]+)"([^>]*)`, 'gi');
      let rm; const radios = [];
      while ((rm = radioRe.exec(html)) !== null) radios.push({ value: rm[1], checked: /checked/i.test(rm[2]) });
      if (radios.length) {
        options = radios.map(r => r.value);
        def = (radios.find(r => r.checked) || radios[0] || {}).value ?? null;
      }
    }
    if (options.length) found.push({ field, label, options, default: def });
  }
  return found;
}

module.exports = {
  extractCSRF, parsePremium, parseAddons, parseFields, parseDynamicExtraFields,
  FIELD_LABELS, KNOWN_BASE_FIELDS,
};

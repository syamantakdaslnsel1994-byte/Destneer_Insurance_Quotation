# Reference Quotation Format

Where the Excel output comes from, and what the legacy files still hold.

Extracted 7 Aug 2026 so the source files can be archived without losing anything.

---

## Provenance

The spreadsheet layout is not a design decision — it is a transcription of a real
client quotation. `analyze_excel.py` line 294 points at:

```
Vivek Bhaia_Quote.xlsx
```

a file supplied by the client, sitting in the `uploads/` folder of an earlier
working session. `analyze_excel.py` dumped its full structure (fonts, fills,
borders, merges, column widths) and `quote_generator.html` is the transcription
of that dump. Every generator since is a re-implementation of it.

**Both the source workbook and the `excel_report.json` dump it produced are
missing from the project.** If `Vivek Bhaia_Quote.xlsx` can be found, re-running
`analyze_excel.py` against it restores the ground truth. Until then this
document and `quote_generator.html` are the only record.

---

## Sheet geometry

17 columns, dual block, separated by a narrow spacer:

```
A        B          C           D          E          F          G-H     I    J-Q
Company  Plan name  Sum Assure  Prem 1Yr   Prem 2Yr   Prem 3Yr   Addon   —    (mirror)
└──────────── Family Floater ────────────────────────────┘            └── Multi Individual ──┘
```

Column widths in the original (character units): `16, 22, 13, 14, 14, 14, 22, 6, 2,
16, 22, 13, 14, 14, 14, 22, 6`. Default row height 15.

Row order:

1. `Dear Sir/Madam,`
2. *(blank)*
3. Greeting — italic grey `#808080`
4. *(blank)*
5. Intro line — italic
6. *(blank)*
7. Member table header — yellow fill
8+ One row per member; DOB formatted `DD.MM.YYYY`
   *(blank)*
   Existing Policy Details — bold underline, then a yellow header row, then one data row
   *(blank ×2)*
   **Per sum-insured block ×5:** merged title row, header row, one row per insurer, blank

## Palette

| Purpose | ARGB |
|---|---|
| Header fill | `FFFFFF00` yellow |
| Plan name / add-on text | `FF0070C0` blue, bold, underlined |
| Greeting and intro | `FF808080` grey, italic |
| Body text | `FF000000` |

Declared but never used in the original: `FF1F3864` dark blue, `FFFFFFFF` white.

## Conventions

- **`NA` for zero** — `fmtPrem()` returns the string `NA` for any premium that is
  absent, zero or unparseable. Blank cells are not used.
- **`Sum Assure`** — the header is misspelled in the client's original. Kept.
- Sum insured is written as a raw integer (`1000000`), not a formatted string.
- **No formulas anywhere.** Every cell is a literal. No number formats, no
  conditional formatting, no data validation.
- Workbook creator: `Desteneer` in the original; `Lee & Nee Softwares` since.
- Filename: `<ClientName>_Quote.xlsx`.
- With more than one member, one extra sheet per member, named
  `<name> <relation>` truncated to 30 characters.

---

## Data held only in `quote_generator.html`

### HDFC Ergo — a fifth insurer with no calculator

The hub can *recognise* HDFC Ergo (`insurance_hub.html` maps "hdfc"/"ergo" to a
display name and a colour) but has no way to create such a row. Only
`quote_generator.html` can, by manual entry.

### Competitor plan names and add-on strings

| Insurer | Plan | Add-on text |
|---|---|---|
| Manipal Cigna | Sarvah Param | Coverage for Non-Medical Items and Durable Medical Equipment's, Room Rent Modification |
| Niva Bupa | Reassure2.0 Bronze | safeguard plus, |
| Care | Care Supreme | Air Ambulance, Annual Health Checkup, Wellness Benefit, Bonus Benefit, Claim Shield |
| Star Health | Assure | NA |
| HDFC Ergo | Optima secure | Unlimited Restore |

### Reference premium ladder

Real figures from the source quotation, useful as a sanity check on multi-year
discounting:

| | 1 Year | 2 Years | 3 Years |
|---|---|---|---|
| Family Floater | 60,041 | 1,13,789 | 1,70,159 |
| Multi Individual | 71,853 | 1,35,038 | 2,00,548 |

The 2-year figure is ≈1.895× the 1-year and the 3-year ≈2.834× — i.e. roughly
5% and 5.5% multi-year discounts.

### Existing-policy defaults

```
Company        The New India Assurance Co. Ltd.
Plan           New India Flexi Floater Group Mediclaim Policy
Sum Assured    10,00,000
Premium        43,319
```

### Capability the hub still lacks

`quote_generator.html` presents a **150-cell manual grid** (5 SI × 5 insurers ×
FF/MI × 3 years) and always emits all five sum-insured blocks and all five
insurers, whether or not a quote exists. The hub only emits what was actually
quoted. Two things follow that the hub cannot currently do:

1. Enter a competitor's premium by hand (HDFC Ergo, or any insurer without a
   calculator).
2. Fill the 2-year and 3-year columns for an insurer whose calculator only
   returned a 1-year figure.

Keep `quote_generator.html` until the hub can do both, or accept that those
cases are handled by editing the exported `.xls` directly.

---

## Open questions from the portal audit

Carried over from `care_plan_audit_report.html`, which has no generator and
cannot be reproduced. Several are now answered by `care_plans.json`:

| # | Question | Status |
|---|---|---|
| 1 | SI ranges for 7159, 6725, 6677, 6675, 6217, 5335, 7424, 6384, 7425, 6740, 5674 — audit captured only the default | Partly answered: `care_plans.json` records 7425/7424/6740/6384/5335 as having **no SI selector at all**, confirmed by the v1 scrape |
| 2 | 573 (POS Secure) default SI = 50 L seems high for a POS plan | Open — verify on the portal |
| 3 | 188 (Secure) SI = 300 — is that ₹300 L, or ₹3 L stored in thousands? | Answered: the v1 scrape lists `10,15,20,25,30,50,100,200,300`, so 300 is a genuine ₹300 L option |
| 4 | 107 (Student Explore) — Cover Type options are unusual and tenure is in **months**, not years | **Open and live** — the calculator still posts `1 Year` for this plan |
| 5 | 1734 (Super Care Advantage) default SI = 100 L needs confirmation | Open |
| 6 | 5673 (Care Global) — SI is in **USD thousands**, not lakhs | Open — the hub converts rupees to lakhs unconditionally |
| 7 | 5674 (Student Explore-Health Unlimited) — tenure is in **days** | **Open and live** — still posts `1 Year` |

Items 4, 6 and 7 are the ones that can still produce a wrong quote.

---

## Portal fields the calculator does not handle

Now recorded per plan in `care_plans.json` as `unmappedPortalFields`. 26 of the
48 plans serve at least one input the calculator never builds — the operator
cannot set them, so the portal's default applies silently.

Most common:

- `field_PED_TENURE` — pre-existing disease waiting-period modifier (Supreme family)
- `field_OPD_SI` — OPD sum insured (Care / Senior / Classic / Smart Select)
- `field_NCB_Value`, `field_CS_Value`, `field_IC_Value` — bonus, claim shield and instant cover variants
- `field_Deductible_SI` / `field_deductible_si` — **both casings appear on the portal**
- `field_11` — deductible slider on plans 748 and 6434. Plan 748's range
  (₹2–10 L) survives only in the v1 backend and is preserved in
  `care_plans.json` under `extraSliders`
- `field_16`–`field_21`, `field_221`, `field_MTD` — the Explore travel block
  (New Explore, POS Explore, Student Explore)

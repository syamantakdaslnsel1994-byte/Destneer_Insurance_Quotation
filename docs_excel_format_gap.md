# Excel Format — Reference vs Current Output

Analysis of `Vivek Bhaia_Quote.xlsx` (the real client quotation) against what
`insurance_hub.html` generates today.

7 Aug 2026. Source file and full structural dump (`excel_report.json`) are now
in the project folder — both were missing before.

---

## 1. The reference file is a 5-sheet workbook

| # | Sheet | Scope | Layout |
|---|---|---|---|
| 1 | `Four Member Quote` | whole family | dual — Family Floater ‖ Multi Individual |
| 2 | **`Feature Comparison`** | — | 19-row feature matrix across 5 insurer plans |
| 3 | `Vivek & Pratibha Bhaia Quote` | the two parents | dual |
| 4 | `Shivangi  Bhaia` | one member | single block, "Individual Quotation For …" |
| 5 | `Shourya Bhaia` | one member | single block |

The sheet model is **one sheet per quoting scope**: the whole family, any
meaningful sub-group, and each individual — plus a feature comparison.

Two things the hub cannot currently express:

- **Sub-group sheets.** "Vivek & Pratibha" is two of the four members quoted
  together. The hub offers only *family* (all members) or *one tagged member*.
- **The Feature Comparison sheet.** Nothing like it exists in the hub.

Note also that the insurer set differs per sheet — the family sheets carry
4 insurers (Manipal Cigna, Niva Bupa, Care, HDFC Ergo) while the individual
sheets carry 5 (adding Star Health). The hub already emits only what was
quoted, so that behaviour is correct.

---

## 2. Column geometry — the hub is wrong

**Reference: 15 columns (A–O).** Add-on is a *single* column.

```
A        B          C           D          E          F          G        H       I        …  O
Company  Plan name  Sum Assure  Prem 1Yr   Prem 2Yr   Prem 3Yr   Addon    spacer  Company  …  Addon
└────────────── Family Floater (A–G) ───────────────────────┘            └── Multi Individual (I–O) ──┘
```

**Hub today: 17 columns (A–Q)**, with Add-on merged across two columns
(`G:H`, `P:Q`) and the spacer at `I`.

Block titles are merged **A:D** and **I:L** in the reference — four columns,
not the full block width the hub uses.

### Column widths (reference, character units)

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 58.7 | 58.6 | 14.5 | 23.8 | 35.3 | 24.8 | 107.3 | 9.0 | 18.2 | 25.5 | 14.3 | 22.8 | 24.0 | *default* | 101.0 |

The hub writes widths in **points** (`150, 180, 105 …`), which is a different
unit entirely.

---

## 3. Row structure

Rows 1–6 are blank. Content starts at row 7. Both match the hub.

| Row | Content | Style |
|---|---|---|
| 7 | `Dear Sir/Madam,` | Calibri 14, centred |
| 9 | `Greetings from Plan my life.` | Calibri 14, centred |
| 11 | `As per your requirement we have drafted quotation that will suit your needs.` | Calibri 14, left |
| 13 | Member header: Name ‖ Relation ‖ D.O.B ‖ Age ‖ PED ‖ Pin Code | **Times New Roman 14**, yellow, bordered |
| 14+ | one row per member | Calibri 14, centred, bordered |
| 19 | `Existing Policy Details` | underlined, centred — *not bold* |
| 20 | Company ‖ Plan name ‖ Sum Assure ‖ Premium ‖ Renewal date ‖ Renewal Premium ‖ Type of Cover | Calibri 14 bold-less, yellow |
| 21 | existing policy data | centred, bordered |
| 25, 32, 39, 46, 53 | block titles — **every 7 rows** | bold + underline, theme accent fill |
| +1 | block header row | **bold**, yellow |
| +2…+5 | one row per insurer | centred, bordered |

Block = title + header + N insurers + blank. With 4 insurers that is exactly
7 rows, which is why the titles land on 25/32/39/46/53.

Sum-insured labels: `10 Lacs`, `15 Lacs`, `25 Lacs`, `50 Lacs`, `1 cr`. The
right-hand block uses lowercase `lacs` and `1 cr` — inconsistent in the
original, and worth reproducing exactly if the goal is a byte-match.

---

## 4. Styling differences

| Aspect | Reference | Hub today |
|---|---|---|
| Font size | **14pt throughout** | 10–11pt |
| Font | Calibri; member header **Times New Roman** | Calibri only |
| Alignment | **centred everywhere**, including plan names and add-ons | plan names and add-ons left-aligned |
| Plan name colour | **plain black** | blue `#0070C0`, bold, underlined |
| Add-on colour | **plain black** | blue when present |
| Number format | **`#,##0`** on every premium and sum insured — displays `60,041` | none; raw digits |
| Block title | bold + underline, **theme accent fill** | yellow fill, no underline |
| Header rows | yellow `FFFFFF00` ✓ | yellow ✓ |
| Borders | thin, all sides ✓ | thin, all sides ✓ |
| DOB | number-formatted `dd/mm/yyyy` | text `DD.MM.YYYY` |

**The blue underlined plan names are not in the original.** That styling came
from `quote_generator.html`'s transcription and has been carried forward ever
since. The real file uses plain black, centred.

---

## 5. Wording

| | Reference | Hub today |
|---|---|---|
| Greeting | `Greetings from Plan my life.` | `Greetings from Lee & Nee Softwares.` |
| Intro | `…we have drafted quotation that will suit your needs.` | `…we have drafted a quotation…` |

The greeting is a deliberate branding choice — "Plan my life" is presumably the
client-facing brand. Worth confirming which you want before matching.

---

## 6. The Feature Comparison sheet

19 rows × 5 insurer columns. Column A holds the feature name; column B is a
sub-qualifier used only for Room Rent (Shared / Single AC room / Suite), merged
`A2:A4`. Columns C–G are one plan each.

Features: Room Rent, Pre hospitalization, Post Hospitalisation, AYUSH Cover,
Day Care Treatments, Domiciliary, Ambulance Cover, Organ Donor Cover, Annual
Health Check-Up, Recharge Of Sum Insured, Modern Treatments, Co-pay, ICU
Charges, Zone wise Co-pay, Waiting Period for PED, Add ons.

**This is hand-written product knowledge, not calculator output.** None of the
four insurer APIs returns it. Producing this sheet requires a maintained
feature table keyed by plan — a data-entry job, not an integration one.

---

## 7. What matching the format requires

### A. Layout and styling — contained

Rewrite `buildQuoteWorksheet()` in `insurance_hub.html`:

1. 15 columns, single add-on column, spacer at H
2. Reference column widths in character units
3. Calibri 14 throughout; Times New Roman 14 for the member header
4. Centre everything
5. `#,##0` number format on premiums and sum insured
6. Drop the blue plan-name and add-on styling
7. Block titles merged A:D / I:L, bold + underlined, accent fill
8. Fixed 7-row block pitch
9. Match the greeting and intro wording

**Recommendation: switch the output from SpreadsheetML `.xls` to real `.xlsx`
via ExcelJS**, which is now installed. The reference is `.xlsx`, and number
formats, theme fills and per-sheet column widths are far cleaner to express.
The current hand-built XML would need every one of those added by hand.

### B. Sub-group sheets — small UI change

The Report tab's member tag dropdown is single-select (`— Family —` or one
member). Matching the reference needs named groups: pick several members,
name the sheet, and quote them together.

### C. Feature Comparison sheet — needs a data source

Requires a `feature_comparison.json` keyed by plan with the 16 feature rows.
The reference file's content is a starting point; keeping it current is
ongoing manual work, since no API provides it.

---

## 8. Files restored to the project

| File | Note |
|---|---|
| `Vivek Bhaia_Quote.xlsx` | The reference quotation. Was missing; now the ground truth for any format work. |
| `excel_report.json` | Full structural dump — every cell's font, fill, border, alignment, number format and merge. 2.7 MB. |
| `analyze_excel.py` | Fixed: `diagonalDirection` → `diagonal_direction` (renamed in openpyxl 3.x, the script crashed before), and it now takes file paths as arguments instead of hardcoded session paths. Re-run with `python analyze_excel.py "<file>.xlsx" out.json`. |

---

# Part 2 — the work, and what it verifies against

10 Aug 2026. Everything in section 7 above is now implemented. This part records
what was built, how it is checked, and the differences from the reference that
were left in deliberately.

## 9. The output is now a real `.xlsx`

`insurance_hub.html` no longer hand-writes SpreadsheetML. It builds the workbook
with **ExcelJS**, which is what makes theme fills, per-sheet column widths and
number formats expressible at all. ExcelJS is served from `care_server.js` at
`/exceljs.js` with the CDN as a fallback, so the hub works offline.

## 10. How to check it

Two files in the project folder, both re-runnable:

```
npm install --no-save jsdom
node verify_excel_fixture.js
python verify_excel_format.py _test_output.xlsx
npm prune
```

`verify_excel_fixture.js` drives the hub headlessly with **exactly the reference
file's data** — the same four members, the same existing policy, the same 5 bands
x 4 insurers x 2 cover modes x 3 tenures, plus a named two-member group and one
individual so all three sheet shapes are produced.

`verify_excel_format.py` then compares every cell of the generated
`Four Member Quote` sheet against `Vivek Bhaia_Quote.xlsx` — value, font, fill,
alignment, number format and all four borders — plus merges, column widths,
`defaultColWidth` and row heights, and asserts that each remaining difference
falls into one of eight named categories. **Anything it cannot classify is a
format regression and the script exits 1.**

jsdom is deliberately not a dependency: it is test-only and pulls in ~135
packages. Install it for the run, `npm prune` after.

### What it reports today

```
sheet "Four Member Quote"
  dimensions       ref 58x15   out 58x15   OK
  merged ranges    10   IDENTICAL
  column widths    15 explicit   default-width on H,P
  defaultColWidth  ref 9.0   out 9.0
  row heights      51 explicit   OK

sheet "Feature Comparison"
  dimensions / merges / widths / heights / fills   ALL IDENTICAL

sheet shapes (first block title row)
  Four Member Quote              title row 25, 15 columns  OK
  Vivek & Pratibha Bhaia Quote   title row 23, 15 columns  OK
  Shivangi Bhaia                 title row 22,  7 columns  OK

PASS — every difference from the reference is a known, deliberate one.
```

## 11. The eight accepted difference categories

| Category | n | What it is |
|---|---|---|
| `blank-cell` | 55 | The reference carries font / fill / alignment / number formats on **empty** cells, left over from selecting whole ranges. Never visible. Reproduced where it is regular (rows 7-12 A-G, every row's base font, 18.75pt heights); the irregular dribbles — G13:G18, F18, the accounting format on C22:C24 — are not. |
| `addon-align` | 49 | The reference's add-on and premium cells are inconsistently vertically aligned and carry stray number formats (`#,##0.00` on the first insurer row of each block, `#,##0` on the rest, nothing on some). Ours are uniformly centred and wrapped. |
| `border-gap` | 44 | The reference is **missing** internal borders — D27, F27 have no bottom, E27 has none at all, and all of rows 49 and 56 are unbordered. Ours are complete. |
| `branding` | 40 | Company names are normalised. The reference spells the same insurer three ways (`Care`, `Niva Bupa ` with a trailing space, `Star Health ` / `Star  Health`). `coKey()` gives one spelling per insurer. |
| `autofit-height` | 26 | The reference stores Excel's **cached** auto-fit heights on wrapped rows (25.5, 37.5, 24.75 …). Those numbers depend on the text, the font metrics and the column width, so we leave those rows without an explicit height and let Excel recompute — which is how the reference's own numbers were produced. Every non-wrapped row is an explicit 18.75, matching exactly. |
| `date-drift` | 2 | Ages are computed from date of birth, so they advance past the reference's 2025 values. |
| `default-width` | 2 | H and P are an explicit 9 in the reference; ours inherit `defaultColWidth=9`. Identical on screen — and ExcelJS omits any width equal to the sheet default regardless. |
| `source-typo` | 2 | `Premium ` with a trailing space in the header, and a stray single space in E24. |

Nothing in that list is visible to a client opening the file. Everything that is
visible — the 15-column geometry, all ten merges, every column width, the
Calibri 14 / Times New Roman 14 split, the yellow header fills, the accent-6
block-title fill, `#,##0` on every premium, the `10 Lacs` / `10 lacs` / `1 cr`
label inconsistency, and the row on which every block starts — matches.

## 12. Bugs the comparison found

Working against the real file surfaced six defects that no amount of reading
would have:

1. **Blocks were ordered by first-seen row, not by insurer.** A plan sold only at
   50 L landed *below* the other insurers in that band instead of beside its own
   company's rows. `_buildDataMap()` now sorts by insurer, keeping each
   insurer's plans in first-seen order.
2. **The single-member sheets used a 2-row gap before the first block.** All four
   reference quotation sheets use 3 — family 21→25, group 19→23, individual
   18→22. Now uniformly 3.
3. **Add-ons vanished from a cover mode with no premium.** Care's Family Floater
   column is `NA` on every premium in the reference yet still lists the plan's
   add-ons, because add-ons are a property of the plan, not the cover mode. Each
   side now falls back to the other.
4. **Pin codes were written as text.** The reference stores them as numbers.
5. **Unfilled existing-policy fields were written as `—`.** The reference leaves
   them empty; an em dash in a Renewal Premium column reads as a real value.
6. **The Feature Comparison header was missing its `A1:B1` merge.**

## 13. Still not reproducible from calculator output

- **HDFC Ergo** appears in every reference block but is not one of the four
  replicated calculators. It has to be entered by hand — `quote_generator.html`
  is the only current way in, and it does not feed the hub. A "add a competitor
  row" control on the Report tab is the missing piece.
- **`feature_comparison.json` is hand-maintained.** No insurer API returns any of
  it. Its content is transcribed from the reference file and will go stale.

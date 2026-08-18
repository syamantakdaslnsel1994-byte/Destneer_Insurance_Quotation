# Insurance Premium Hub

Health insurance premium comparison across Care Health, Niva Bupa, ManipalCigna
and Star Health. Four replicated calculators behind one hub, producing a
client-ready quotation spreadsheet.

Lee & Nee Softwares · last updated 14 Aug 2026

---

## ⚠️ Before the first run

Two things are outstanding. **ManipalCigna will not start without the first one.**

### 1. Create `.env` — required

`mc_server.js` reads its credentials from `.env` and exits with an error if they
are missing. Run this once, in PowerShell, from the project folder:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Destineer Project\Fresh_Approch"
@"
MC_AUTH_TOKEN=Z01GMkx0amJZUDVGNTVuUnBVdzUrU09hWktTZTNhc1Y6UFFRZE1oaG5wTHUvS2wwMzNUUHNhT25heEZpRW14YXo=
MC_AES_KEY=lv39eptlvuhaqqer
"@ | Set-Content -Encoding ASCII .env
```

See `.env.example` for every supported setting. `.env` is git-ignored and must
never be committed.

### 2. Install dependencies

```powershell
npm install
```

**`exceljs` and `jspdf` are both required.** The hub builds the workbook with
ExcelJS and the PDF with jsPDF, and `care_server.js` serves them at
`/exceljs.js` and `/jspdf.js`. Without `npm install` the two download buttons
fail with "ExcelJS could not be loaded" / "jsPDF could not be loaded".

### 3. Version control — recommended

There is still no git repository. `.gitignore` is in place and correct.

```powershell
git init
git add .
git commit -m "Fresh_Approch after Tier 1-5 fixes"
```

Check `git status` shows **no** `.env` before committing.

---

## Running it

```
start_all.bat
```

Starts all four servers and opens the hub. Or individually:

| Command | Insurer | Port | Upstream |
|---|---|---|---|
| `npm run niva` | Niva Bupa | 3002 | `otc.nivabupa.com` |
| `npm run mc` | ManipalCigna | 3003 | `online.gateway.manipalcigna.com` |
| `npm run star` | Star Health | 3004 | `shapi.starhealth.in` |
| `npm run care` | Care Health | 3005 | `abacus.careinsurance.com` |

**The hub is at `http://localhost:3005/hub`.** `start_all.bat` opens it for you.
`/unified` is the superseded 14 July hub and now redirects to `/hub`.

**It asks you to sign in.** The first time anyone opens it, `/login` shows a
setup screen to create the accounts — see "Sign-in" below. There is no default
password.

All four servers bind to `127.0.0.1` only and accept requests from localhost
origins. They are not reachable from the network.

### Other commands

| Command | What it does |
|---|---|
| `npm run audit:care` | Check the live Care portal against `care_plans.json`. Exits 1 on drift. |
| `node care_audit.js --plan 2813` | Check one plan |
| `node care_audit.js --update` | Print suggested catalogue changes |
| `node care_audit.js --report` | Write the report, always exit 0 |
| `npm run verify:picker` | Check the plan picker's eligibility rules, guard and overrides. Exits 1 on failure. |
| `npm run verify:mc` | Check ManipalCigna's Plan Type and resident-Indian handling, server and UI. Exits 1 on failure. |
| `npm run verify:excel` | Check the spreadsheet format against the client reference file. Exits 1 on drift. |
| `npm run verify:pdf` | Build the Excel and the PDF from one fixture and check they agree, cell for cell. Exits 1 on drift. |
| `npm run verify` | All four of the above. |
| `decode_mc_url.bat` | Decode a captured ManipalCigna quick-quote payload. See `docs_mc_plan_type_capture.md`. |
| `archive_legacy.bat` | Move superseded files into `_old\` |

The verify scripts need jsdom, which is test-only and not a dependency
(`verify_mc_plantype.js` is the exception — it needs nothing extra):

```powershell
npm install --no-save jsdom
npm run verify
npm prune
```

None of them touches a live insurer. The Care catalogue and feature table are
read from disk, the four calculator iframes are stubbed, and the ManipalCigna
test starts a second copy of `mc_server.js` pointed at a stand-in gateway on
localhost via `MC_GATEWAY`.

---

## Typical workflow

1. **Members** — name, DOB (or age), gender, PED, pincode. Entered once.
2. **Reference** — sum insured band, policy term, cover type.
3. **Fill All + Calculate** — pushes the details into all four calculators.
   Watch the status chips; an amber note appears under them listing anything a
   calculator had to change.
4. **Comparison** — review the quotes, remove any that are wrong.
5. **Report** — tag members if needed, add existing-policy details, then
   **Generate Excel Report**. An amber banner above the table warns about
   anything that will not appear in the file.
6. **Print / PDF** — a printable comparison sheet, on the Comparison tab.

---

## What changed — Tiers 1 to 5

35 items. Grouped by what they fix rather than by tier.

### Wrong numbers in front of a client

| # | Fix |
|---|---|
| 5 | **Care** no longer leaves the previous plan's premium on screen after a failed calculation. The figure is blanked and Add-to-Comparison is hidden. |
| 6 | **Care** blanks the premium when an add-on is ticked — it used to export the old price alongside the new add-on labels. |
| 7 | **ManipalCigna** now reports what the server *applied*, not what you ticked. On ProHealth Prime, Critical Illness, PA and Accident Shield no add-on can be priced at all; the UI now says so, unticks them, and refuses to export until you recalculate. |
| 9 | **Star** attaches your selected covers when the policy period changes — it used to silently reprice the base plan. |
| 8 | **Star** reports `failed` when no card priced, instead of showing a green tick over "Premium not available". |
| 24 | **Star** errors instead of silently substituting Super Star cards for an unrecognised response. |
| 16 | Label corrections: Care no longer claims "incl. 18% GST" on figures its own note says may be exempt; ManipalCigna's "Add Ons" row (which was GST) is relabelled; multi-year premiums say "Total Premium for N Years". |

### The spreadsheet

| # | Fix |
|---|---|
| 10 | Quotes outside the report bands are **listed with a reason** instead of vanishing. Amber banner above the table, plus a count in the download toast. |
| 11 | Sum-insured parsing rewritten. A ₹1.5 Cr quote used to be filed under 50 Lacs. Band tolerance is ±1 lakh — enough for display rounding, never enough to swallow a real 45 L or 90 L. |
| 12 | Report rows keyed by company **and plan**, so two Care plans at the same sum insured no longer overwrite each other. |
| 13 | Cover mode is stored with each quote instead of re-derived at export. The Family Floater and Multi Individual blocks can now both fill in one pass. |
| 14 | All four calculators echo the tenure they actually priced; Care, Star and Niva also echo cover type. |
| 15 | Member DOB written as `DD.MM.YYYY`, matching the reference template. |
| 35 | **Print / PDF** comparison sheet, ported from `unified.html`. |

### The spreadsheet now matches the client's own format

The output is a real **`.xlsx`** built with ExcelJS, reproducing
`Vivek Bhaia_Quote.xlsx` cell for cell: 15 columns with the reference's exact
widths, all ten merges, Calibri 14 throughout with Times New Roman 14 on the
member header, the yellow header fills and accent-6 block titles as **theme**
colours, `#,##0` on every premium, and the same row for every block title on all
three sheet shapes. It also emits the **Feature Comparison** sheet and
**named sub-group sheets** ("Vivek & Pratibha Bhaia Quote"), neither of which the
hub could produce before.

`npm run verify:excel` proves it. Six defects it caught along the way:

| Fix |
|---|
| Blocks were ordered by first-seen row, so a plan sold only at 50 L landed below the other insurers instead of beside its own company's rows |
| Single-member sheets left a 2-row gap before the first block; all four reference sheets use 3 |
| Add-ons vanished from a cover mode with no premium — they belong to the plan, not the mode, so each side now falls back to the other |
| Pin codes were written as text; the reference stores numbers |
| Unfilled existing-policy fields were written as `—`, which reads as a real value in a Renewal Premium column |
| The Feature Comparison header was missing its `A1:B1` merge |

Differences from the reference that were left in deliberately — its missing
internal borders, its three spellings of the same insurer, its stray formatting
on empty cells — are enumerated with counts in `docs_excel_format_gap.md`.
None is visible to a client opening the file.

### The plan picker

**📋 Pick Plan Names** is now one card per provider rather than one dropdown per
provider, and it checks the plan against the people on screen *before* anything
is sent. One press is still exactly one live calculation — nothing here fans out
into a batch, because the premiums have to be the insurer's real figures.

| Fix |
|---|
| **It refused nothing before.** Forget to tick a sum-insured band and `buildParams()` fell back to `si: 1000000`, so a whole quotation came out silently priced at 10 Lacs. The dialog now names the problem and disables both Fill buttons. |
| **Eligibility is checked up front**, from `care_plans.json`: the plan's age range against each member's age, its `memberOptions` against your member count, whether it takes children at all, whether it is 5-year-only, and whether it even sells the sum insured you picked. You used to find out by waiting for a failure. |
| **Plans that cannot be quoted are blocked, not offered.** ManipalCigna's Critical Illness, Personal Accident and Accident Shield have no product code, so their card is outlined red, both buttons are disabled, and Fill All skips them and says so. |
| **The three unit mismatches are called out by name.** Pick plan 107, 5674 or 5673 and the card says the premium will be for a different policy. These return a number rather than an error, which is worse. |
| **Per-row sum insured, tenure and cover type.** Care at 15 Lacs Floater and ManipalCigna at 50 Lacs Individual in the same pass. The row's chips now actually reach the calculator — the old rows could not override anything, because they went through `fillCalculator()`, which reads only the hub's globals. |
| **One answer per provider.** `_planSel` and `_po.prod` / `_po.plan` / `_po.cat` both claimed to hold "the selected plan" and `buildParamsForProvider` preferred `_po`, so the two dialogs could disagree and the last writer won. Both now write `_planSel`, and it is what gets sent. |
| **A searchable Care list.** Type to filter the 48 plans; the 12 POS variants sit in their own group instead of interleaved. |
| **What the portal will decide for you**, per row: the plan's real default sum insured, and how many portal inputs the calculator does not set (recorded for 26 of the 48 plans). |
| **Live status on each card**, so a calculation can be watched without closing the dialog. |
| A summary line above the buttons — members, pincode, and the plan, sum insured, tenure and cover type each provider is about to receive. |

The older **Plan Config** dialog is still there for the per-provider extras this
one does not cover (Care's business type, Niva's payment mode, ManipalCigna's
portability flag, Star's PED). Both write the same state, so they cannot drift.

Covered by `npm run verify:picker` — 69 assertions.

### ManipalCigna — Plan Type and resident-Indian

The real quick-quote flow has **two** pages, and the replica only ever copied the
first. The entry form asks for members, ages, pincode and portability; **Plan
Type**, *All Insured are resident Indian*, Sum Insured and Policy Duration live
on the **results** page. So those controls were not merely unwired — they were
never on the page being reproduced.

| Fix |
|---|
| **A Plan Type control**, with the values read off the live portal: `individual` / `FamilyFloater` / `multiindividual`. Default is "Auto — from member count", which is exactly the old behaviour, so nothing changes unless it is set. |
| **An All Insured are resident Indian control.** It was hardcoded to `'Y'` in all five payload builders with no way to say otherwise, so an NRI member could not be expressed and nothing flagged it. |
| **`planType` now reaches every plan.** It was honoured only inside the `lifetime` branch; Sarvah, ProHealth Prime, Prime Senior and Super Top Up each called `getCoverType(members)` and discarded the caller's choice in silence. |
| **The calculator stops claiming the cover type was ignored.** It reported that unconditionally to the hub — true before, a lie now. It only reports a clamp when there genuinely is no corresponding plan type. |
| **Quotes carry the cover type they were priced with**, so a Family Floater and a Multi Individual quote for the same family land in the right blocks of the spreadsheet instead of overwriting each other. |
| `PORT` is env-overridable, so a second instance can run against a test gateway without disturbing the one on 3003. |

**One of the three codes is not confirmed, and the UI says so.** `individual → INDI`
and `FamilyFloater → INFF` are well supported: a one-member quote can only be
individual, a real 2-adult Family Floater quote was captured from the portal, and
those are the codes we already send for one and two members with valid premiums
coming back. `multiindividual → INFI` is an inference — `INFI` is what we send for
3+ members, but a 3+ member quote may equally be a floater, so nothing
establishes that it means "multi individual". Pick it and the calculator shows an
amber caveat on both the control and the premium. `docs_mc_live_capture_findings.md`
has the evidence for each, and what one capture would settle.

Covered by `npm run verify:mc` — 21 assertions against the server with a
stand-in gateway, 17 against the UI.

### The same report as a PDF

**📄 Download PDF**, beside Generate Excel Report on the Report tab. Same data,
same section order, same filename but `.pdf` — landscape A4, one section per
sheet, page numbers, and the Feature Comparison last.

It reproduces the template rather than approximating it: the yellow header rows,
the accent-6 block titles bold and underlined, Times New Roman on the member
header and Calibri elsewhere (Helvetica stands in — jsPDF has no Calibri and
embedding it would mean shipping the font), thin borders on every cell, `#,##0`
grouping on premiums, and the reference's own inconsistent `10 Lacs` / `10 lacs`
/ `1 cr` labels. Fill colours the sheet stores as a theme index plus a tint are
resolved through the reference workbook's own palette, so they come out the same
shade rather than a guess.

**One structural difference, and it is unavoidable.** The spreadsheet puts the
Family Floater and Multi Individual blocks side by side, columns A–G and I–O.
That pair needs about 1,234pt of width at 14pt; landscape A4 with the file's own
0.7" margins gives 741pt. So the PDF **stacks** them — Family Floater, then Multi
Individual beneath it, per sum insured. Every cell is present and the pairing
stays adjacent; only the reading order changes. Reproducing the widths instead
would put the sheet at about 3.5pt, since the reference's columns total 40.7
inches (column A is 58.7 characters wide to hold "Care").

Column widths are sized to their content for the same reason. Long blocks
continue onto the next page with the header row repeated, and a block never
starts so late that its header is stranded alone at the foot of a page.

`npm run verify:pdf` is the guard that matters: it builds **both** files from one
fixture and asserts that every one of the 468 values in the spreadsheet appears
in the PDF, and that every grouped number in the PDF comes from the spreadsheet.
The two cannot drift apart without the test failing.

Two defects surfaced while building it:

| Fix |
|---|
| **The Feature Comparison sheet was written at 14pt; the reference has it at Calibri 11.** The Excel output had this wrong too — the format test compared that sheet's dimensions, merges, widths, heights and fills but never its fonts. Both writers now use 11, and the test checks fonts. |
| **The report's client name — and so the download filename — was being wiped.** `syncClientName()` copied the Members tab's name box across on every `updateAll()`, with no test for whether it was empty, so adding a quote blanked it. `rpSync()` always had that guard; the two mirrors of the same value disagreed. |

### Branding

The **Desteneer** logo appears in three places, from one definition:

| Where | How |
|---|---|
| Portal header | On a small white tile — the artwork is dark green and orange on white, so on the near-black header it needs one to read at all |
| Excel | Top-left of every quotation sheet, in rows 1–6. The reference workbook leaves those rows empty on every sheet, so it is a letterhead area already and nothing shifts — the format check still matches cell for cell |
| PDF | A ~35mm letterhead at the top of each section |

It is embedded as base64 in `insurance_hub.html` (`LOGO_PNG_B64`) rather than
referenced as a file, so all three get it from one place with no extra server
route and nothing to go missing.

The supplied file was `Group-11 (1).jpeg`, which is **actually a WebP** despite
the name — ExcelJS cannot embed WebP at all. It is flattened onto white (it had
partial transparency, which would have rendered three different ways) and
trimmed, giving `logo.png`, 130×97.

To replace the logo, drop a new `logo.png` in this folder and regenerate the
constant:

```powershell
node -e "const fs=require('fs');const b=fs.readFileSync('logo.png').toString('base64');const p='insurance_hub.html';const s=fs.readFileSync(p,'utf8');fs.writeFileSync(p,s.replace(/const LOGO_PNG_B64 = '[^']*'/,\"const LOGO_PNG_B64 = '\"+b+\"'\"));console.log('logo updated',b.length,'chars')"
```

Then update `LOGO_W` / `LOGO_H` beside it if the new file's proportions differ.

**One caveat worth knowing:** the artwork is only 130×97 after trimming, so at
letterhead size it works out around 94dpi — fine on screen and acceptable in
print, but not crisp. A larger PNG or an SVG would print noticeably better and
nothing else would need to change. The Feature Comparison sheet deliberately has
no logo: its header is row 1, so making room would shift the whole layout.

### Sum-insured bands — 5 to 13

`RP_SI_LIST` does double duty: it is the chip row in the plan picker **and** the
set of bands the report groups quotes into. A quote at an amount not on the list
cannot appear in the spreadsheet — it lands in the amber "excluded" banner
instead. So widening the picker meant widening the report bands, and both moved
together.

The values were read off what the four providers actually sell, not chosen as
round numbers:

| Provider | Source | Distinct values |
|---|---|---|
| Care Health | `care_plans.json`, 43 plans with a lakhs ladder | 2 – 600 L |
| ManipalCigna | `PLAN_CONFIG` `siOptions` in `mc_server.js`, 8 plans | 2 – 300 L |
| Niva Bupa | `floatercover` / `individualCover` options in `niva_bupa_premium_calculator_research.json`, 6 categories | 1 – 1000 L |
| Star Health | builds its list from the live API per product — **no ladder on disk**; the Plan Config modal's hand-entered chips are the only observed set | 3 – 100 L |

Sold by **all four**: 5, 10, 15, 20, 25, 50, 100 L.
Sold by **three of four**: 3, 30, 75, 200, 300 L (also 2 L, dropped — accident
plans only). 7.5 L is Niva and Star only but is a standard Indian band, so it is
in. That gives the thirteen now on the chip row.

**The band tolerance had to get tighter.** It was a flat ±1 lakh, which was right
for five widely spaced bands. With 3 L and 5 L only two lakhs apart, that would
have filed a genuine 4 L quote — which Care sells — into one of them at random.
It is now the smaller of ±1 lakh and just under half the distance to the
neighbouring band, so display rounding is still absorbed (₹10,50,000 → 10 L) but
an amount that is not really one of the bands is reported as excluded rather than
quietly becoming its neighbour. Covered by `npm run verify:picker`.

The five bands the client's reference quotation used — 10, 15, 25, 50 L and
1 Cr — keep their exact wording, including its lowercase `1 cr`, so the format
check still matches the reference cell for cell.

### Second-level plan choices

The picker's dropdown is not always the whole answer to "which plan". Three
providers carry a level below it, and the hub used to send nothing for any of
them — so whatever headed each list was quoted, silently.

**Niva Bupa** — its top dropdown is a *category*, not a product. The card now
cascades **category → plan name → variant**, both lists fetched live from
`/api/products/<category>` on port 3002, which returns each product's variant
tier in the same response. Measured on a 32/28 couple, ReAssure 3.0 Family
Floater at 10 L: Classic ₹10,245 · Elite ₹14,194 · Black ₹14,617 — a 43%
spread that was previously decided by list order. Changing product resets the
tier, because tier `3` means Platinum+ on Aspire and Elite on ReAssure 3.0.

**Care Health** — five of the 48 plans carry the portal's **Plan Type**
(`field_23`), and the hub never sent it:

| Plan | Options |
|---|---|
| Care Supreme, POS Care Supreme | Care Supreme · Senior Premium · Senior Super |
| Supreme Enhance | Option 1 · Option 2 |
| Super Mediclaim | Cancer · Critical · Operation · Heart |
| Surrogacy and Oocyte Donor | SURROGACY (the only option) |

Super Mediclaim was the worst case: always quoted as the Cancer policy. Care
Supreme at 10 L floater prices at ₹11,461 as "Care Supreme" and ₹40,056 as
"Senior Premium".

These options used to be hard-coded in `PLAN_TYPE_MAP` in `care_index.html`.
They now live in `care_plans.json` as each plan's `planTypeOptions`, so the
picker and the calculator read one source. The built-in map remains as a
fallback and is kept — not cleared — when the catalogue does not carry the
field, because `care_server.js` reads `care_plans.json` once at boot: a server
left running after the file changed would otherwise blank the map and hide the
row for all 48 plans. **Restart `care_server.js` after editing the catalogue.**
Covered by `node verify_care_plantype.js`, which boots the form against both a
fresh and a stripped catalogue.

`Enhance` (748) is flagged `planTypeField: true` but its options were never
captured. Nothing is invented for it; the picker says so and names both
possible causes.

In both providers, leaving a sub-selector untouched is now stated rather than
assumed: an amber note names the value that will go out and how many it was the
first of.

**Not done — ManipalCigna and Star Health.** Both have a real second level, but
neither is knowable before quoting: MC returns 2–3 variant cards in the premium
response, Star returns sub-products from `recommend-me`. A pre-flight dropdown
would mean quoting twice. Measured spreads, same couple:

| | Variants at 10 L (first = what the hub takes) |
|---|---|
| MC ProHealth Prime | **Protect ₹17,919** · Advantage ₹21,073 |
| MC Lifetime Health (50 L) | **India ₹17,857** · Global ₹24,519 |
| MC Sarvah | **UTTAM ₹12,777** · PARAM ₹20,052 · PRATHAM ₹2,241 |
| Star Super Star | **Value Plus ₹9,872** · Essential ₹12,224 · Preferred ₹12,776 · Secure ₹13,091 · Classic ₹16,209 |

The hub takes the first card in each case, which for Star is the cheapest of
five — a 64% spread. The fix for these two is not a picker dropdown but a
choice *after* the calculation: let the operator pick which returned card goes
into the comparison, instead of auto-adding the first. The premiums are already
on screen, so it costs no extra API calls.

### The Feature Comparison sheet

Three problems, all from the sheet being a verbatim transcription of one
client's quotation.

**It showed insurers that were never quoted.** The five columns are specific
products: ManipalCigna Sarvah Param, ManipalCigna Lifetime, Niva ReAssure 2.0
Bronze, Care Supreme, and **HDFC Ergo Optima Secure** — an insurer this hub has
no calculator for. All five shipped with every report.

Columns are now chosen from the quotation. Each entry in
`feature_comparison.json` carries a `provider`, the `plan` it describes, and
`planMatch` fragments; an insurer with no rows in the report gets no column.
HDFC therefore disappears unless something in the quotation is HDFC, which
nothing can be.

**A column could describe a different plan from the one quoted.** Quoting Care
(plain) while the only Care column describes Care Supreme is a real risk — the
client reads Care Supreme's terms as applying to what they were offered. Rather
than dropping such columns (which for a typical quotation leaves the sheet
empty) they are kept and a **"Please note"** row under the header says *Features
shown are for Care Supreme. You quoted Care.*

Star Health has no column at all, because its features have never been
captured. It now gets one that says so, since an insurer missing from a table
headed "Feature Comparison" reads as "nothing to compare".

The load-bearing detail: every feature row's `values` array is positional
against the original five columns, so each surviving column carries a
`sourceIndex` and reads its own slot. Using the post-filter position would shift
every value one column left the moment HDFC is dropped and silently attribute
one insurer's terms to another. `verify_excel_format.py` now compares the
feature sheet **by column header rather than by position**, and asserts that
each surviving column's values are unchanged.

**It came second.** The reference put it straight after the family sheet, which
buried the per-member premiums behind a page of product terms. It is now the
last sheet in the workbook and the last section in the PDF; the premiums are
what the client opens the file for.

Covered by `npm run verify:features` (29 assertions) and the format check.

#### Getting live feature data

There is none to get, and that is worth being plain about: **no insurer API
returns any of this.** Every value in `feature_comparison.json` is manual
product knowledge, transcribed once from a client quotation in August 2026. The
four calculators return premiums, sum-insured ladders, plan lists and add-on
names — nothing about room rent limits, co-pay, waiting periods or AYUSH cover.
Those live in policy wordings and brochures, which are PDFs.

So the options, cheapest first:

1. **Maintain the file by hand, per plan you actually sell.** Add one entry per
   column under `plans` with its `provider`, `plan` and `planMatch`, and one
   value per column in each feature row. This is the honest answer and the only
   one that is correct today. The 16 features are already the right skeleton.
2. **Scrape the add-on and benefit names the APIs *do* return.** ManipalCigna
   has `/api/addons/:planId`, Care's catalogue records `unmappedPortalFields`,
   Star returns add-on cards. That fills perhaps a quarter of the rows — the
   add-on row and some benefit flags — and nothing about limits.
3. **Parse the policy wordings.** Each insurer publishes a brochure and a policy
   document per product. Extracting a comparison table from those is a real
   project, and the result still needs a human to check before it goes to a
   client.

Until one of those is done, the "Please note" row is the safeguard: it states
which plan each column actually describes, so a mismatch is visible to whoever
reads the quotation rather than hidden.

### Quotation history and the save location

A new **History** tab, sixth in the right-hand panel. It exists because the hub
kept every quote in memory only: a tab reload lost the lot, which is how 55 live
quotes disappeared in one sitting.

**Where it lives.** Not browser storage — `care_server.js` writes a
`quotations/` folder beside itself, one subfolder per quotation holding
`quotation.json` (client, members, and every premium as quoted that day) plus
the generated `.xlsx` and `.pdf`. So history survives a reload, a cache clear
and a new machine, and is visible to everyone using that hub rather than to one
Chrome profile. `quotations/` is in `.gitignore` — it holds real client names,
dates of birth and pincodes.

**Premiums are a snapshot.** Loading a quotation back restores the rows,
members and report header so you can amend or re-quote. It deliberately does
**not** re-price: a record that quietly refreshed itself every time someone
opened it would stop being a record of what was quoted.

**The save location.** A web page cannot choose a save folder, so the server
does it. Type a full path in the History tab, press Check, and the server
confirms the folder exists and is writable by writing a probe file and removing
it — permission bits are unreliable on Windows shares. From then on every
generated report is copied there as well as archived.

Guards on that path, because it is typed by a person and the filename comes from
a client name they also typed:

- A relative path is refused. It would resolve against wherever node happened to
  be started, not where the operator meant.
- A folder that does not exist is refused rather than created. An HTTP request
  should not be able to make arbitrary directories.
- Filenames are **rebuilt**, not sanitised: anything that is not a letter,
  digit, space, dash or underscore is dropped, which removes path separators,
  `..`, drive letters and the Windows reserved characters in one pass. Windows
  device names (`CON`, `PRN`, `LPT1` …) are prefixed.
- Archiving happens **after** the browser download, and a failure is reported
  rather than thrown — a store that is down or a folder that has moved must
  never stop the operator getting the file they just asked for.
- Deleting a history entry removes the archive only. Copies already written to
  the operator's own folder are left alone, and the confirmation says so.

Endpoints: `GET/POST /quotations`, `GET/DELETE /quotations/:id`,
`GET /quotations/:id/file/:kind`, `GET/POST /save-destination`.

Covered by `npm run verify:history` — 50 route assertions including the
traversal and reserved-name cases, and 38 that a quotation reloads into the hub
field-for-field with no premium moving.

One race fixed while testing: saving a destination and clearing it straight
after left two refreshes in flight, and the slower reply put the old folder back
in a box the operator had just emptied. Refreshes are now sequenced and a stale
reply is discarded.

### Sign-in

`login.html`, served at **`http://localhost:3005/login`** with the Desteneer
logo. The hub bounces there when there is no valid session and returns to
whatever page was asked for.

**There is no default account, and no password anywhere in the code.** On a
fresh install nobody can sign in, and the login page shows a one-time setup
screen instead: add a row per person, minimum 8 characters. Passwords are stored
in `quotations/users.json` as **scrypt hashes with a per-user random salt**
(N=16384), so the plain text is not kept and cannot be recovered. Setup refuses
to run once any account exists, so it cannot be used later to add an account or
overwrite the existing ones. Forgotten everything? Delete `users.json` and
reload the login page.

Details that matter more than they look:

- A wrong password and an unknown username return the **same** message, and the
  unknown-username path still computes a throwaway hash — otherwise the reply
  time alone tells anyone probing which of the ten names are real.
- Hash comparison is `crypto.timingSafeEqual`. A plain `===` leaks how much of
  the hash matched through how long it took.
- The token lives in **`sessionStorage`**, so closing the tab signs out. On a
  desk several people share that is the right default.
- Sessions are held in memory and expire after 12 hours; restarting the server
  signs everyone out.
- Only the **quotation** routes are gated. The four calculator proxies stay open
  because they store no client data and gating them would break the
  calculators' own standalone pages, which operators use directly.
- `createdBy` on a history entry comes from the session, never from the request
  body, so it cannot be spoofed by whatever posts the quotation.
- A 401 mid-session (the usual cause is a server restart) sends the operator
  back to sign in, rather than showing an empty History panel that reads as
  "you have no quotations".
- The `?next=` parameter is only honoured for a same-origin path, so a crafted
  link cannot bounce anyone to another site after signing in.

A signed-in user can change their own password (`POST /auth/password`, current
password required). Nothing can change anyone else's — an admin-reset endpoint
is an endpoint that sets other people's passwords, which is worse than the
inconvenience it saves.

### One history entry per quotation

Generating the Excel archived once and the PDF archived again, so one quotation
produced **two** history rows with one file each. A quotation is now identified
by a fingerprint of its content — client, members and rows, sorted so row order
cannot split it — and a second export merges into the existing entry. `savedAt`
stays as when the quotation was produced; `updatedAt` records the later export.

The row shows the two formats as states rather than as separate entries: green
with a tick when the file exists, amber "not saved" when it was never generated.
Changing anything real — a premium, a member, the client — is a different
quotation and gets its own entry.

### The developer credit moved

"Lee & Nee Softwares · Kolkata" sat directly under the product name in the
header, where it read as part of the product. It is now a small fixed credit in
the bottom-right corner, with `pointer-events:none` so it can never intercept a
click. The header carries the signed-in user and a Sign out button instead.

### Reliability

| # | Fix |
|---|---|
| 17 | **Care's upstream session is per-request.** It was a shared global, so two concurrent calculations interleaved cookies and CSRF — and "Fill All" is exactly that. Verified: old code sent one request's second POST under the other's session. |
| 18 | **Entered ages survive.** Care, Star and ManipalCigna each wiped them on a member-count or plan change, for three different reasons. ManipalCigna also keeps the roster and sum insured across a plan switch. |
| 19 | Calculators send a `params-applied` acknowledgement. The hub shows what was clamped instead of "✅ Parameters sent". Care now **awaits** its plan load before applying values — that race silently replaced hub ages and sum insured with plan defaults. |
| 20 | The Plan Config modal actually works. It was setting keys no calculator reads and never setting the plan at all. |
| 21 | Pending parameters are per-provider, so ManipalCigna's ₹50 L floor cannot leak into Care. |
| 22 | ManipalCigna's health check is cached for 10 minutes with in-flight deduplication. It cost **16 upstream requests on every page load**. |
| 23 | Plans with no product code show "⚙️ Not configured" rather than "⚠️ API Error", and cannot be selected. The `zone` fix your probes found for PA/AS in June is now shipped. |
| 34 | All four calculators grey out the premium and prompt to recalculate when an input changes. |

### Data integrity

| # | Fix |
|---|---|
| 26 | **`care_plans.json` is the single source of truth.** The 48-plan catalogue lived in five places and had drifted. Built by merging all five against the 7 July portal audit; the measured portal won every disagreement. Fixed three real gaps: plan 748's Plan Version field, Monthly Income on 7425/6740, and the `Ooctye` typo. |
| 27 | The fabricated sum-insured ladder is gone. Replaced with the `.custom-range[data-values]` reader ported from the v1 backend — the only code that ever read the real values off the portal. |
| 28 | Each plan opens at its **actual portal default**. 26 of 48 were wrong (Supreme Enhance showed 50 L against a portal default of 45; Secure showed 20 against 300). |
| 29 | `care_audit.js` is a **test**. It compares the live portal to the catalogue and exits non-zero on drift. Verified against all four historical drifts. |
| 30 | Sum insured and tenure survive a plan change, falling back to the portal default when the new plan does not sell the current value. |

### Setup, security and housekeeping

| # | Fix |
|---|---|
| 1–4 | `.gitignore`, credentials moved to `.env` with a zero-dependency loader, `start_all.bat` opens the current hub, `package.json` corrected. |
| 25 | All four servers bound to `127.0.0.1`; wildcard CORS replaced with a localhost allowlist; the AES decryption endpoints gated behind `MC_ENABLE_DECRYPT_TOOLS`; origin checks on all six `postMessage` receivers. |
| 31–33 | Niva has a pincode box and accepts ages as well as dates. Star can apply one sum insured and period to every card at once. |
| 35 | Legacy data extracted into `care_plans.json` and `docs_reference_quotation_format.md`; `archive_legacy.bat` supplied. |

---

## Known issues — not yet fixed

Documented during the work, deliberately left for a later batch.

### Three unit mismatches that can produce a wrong quote

| Plan | Problem |
|---|---|
| 107 Student Explore | Policy tenure is in **months** on the portal; the calculator posts `1 Year` |
| 5674 Student Explore-Health Unlimited | Tenure is in **days**; the calculator posts `1 Year` |
| 5673 Care Global | Sum insured is in **USD thousands**; the hub converts rupees to lakhs unconditionally |

### Other open items

- **`care_plans.json` is a 7 July snapshot.** It is now checkable but has not
  been checked against the live portal. Run `npm run audit:care` with the
  servers up — that is the single most useful next step.
- **ManipalCigna Critical Illness, Personal Accident and Accident Shield** ship
  with empty product codes and cannot quote. The `zone` fix is in; a real
  product code is still needed. Cheapest test: supply one and see. The plan
  picker now blocks these rather than offering them.
- **ManipalCigna's Multi Individual cover code is unverified.** The control now
  exists and `individual` / `FamilyFloater` are well supported, but
  `multiindividual → INFI` is an inference. The calculator flags it on screen.
  One capture of a real `viewPlans` request body with Plan Type set to Multi
  Individual would settle it — see `docs_mc_plan_type_capture.md` for how, and
  `docs_mc_live_capture_findings.md` for what is already known.
- **26 of 48 Care plans serve inputs the calculator does not build**, recorded
  per plan in `care_plans.json` as `unmappedPortalFields`. The portal's default
  applies silently for each.
- Some catalogue ladders are marked `"v1 scrape (single value — unverified)"` —
  the original scrape captured only the slider's opening position. The audit
  will flag them; `--update` shows the real values.
- Star has **no captured response fixtures**. Every assumption about its
  response shape is unverified.
- **ManipalCigna and Star Health have no variant chooser.** Both return 2–5
  priced variants per quote and the hub adds the first — for Star, the cheapest
  of five. See "Second-level plan choices" above for the measured spreads and
  the proposed shape of the fix.
- **Care's Super Mediclaim (362) returns no premium at all** for a two-adult
  10-lakh request, with or without a Plan Type. It is a fixed-benefit plan and
  likely wants different inputs; the failure predates the Plan Type work and is
  not caused by it.

---

## Where things live

| File | Role |
|---|---|
| `insurance_hub.html` | The hub — members, comparison, report, Excel, PDF, history |
| `login.html` | The sign-in page, served at `/login`. Also runs first-time account setup |
| `quotations/` | Saved quotations, plus `users.json` and `config.json`. Gitignored — real client data |
| `care_index.html` · `niva_index.html` · `mc_multi.html` · `sh_index.html` | The four replica calculators |
| `care_server.js` · `niva_server.js` · `mc_server.js` · `sh_server.js` | Backend proxies |
| `care_plans.json` | **Single source of truth** for the 48 Care plans |
| `feature_comparison.json` | Hand-maintained feature matrix — the Feature Comparison sheet's only source |
| `care_audit.js` | Portal regression test |
| `verify_excel_fixture.js` · `verify_excel_format.py` | Spreadsheet format regression test |
| `verify_plan_picker.js` | Plan picker regression test |
| `Vivek Bhaia_Quote.xlsx` | The client reference file the format is checked against |
| `docs_reference_quotation_format.md` | Excel format provenance, competitor data, open portal questions |
| `docs_mc_plan_type_capture.md` | How to capture ManipalCigna's Plan Type codes, and why it cannot be inferred |
| `mc_decode_url.js` · `decode_mc_url.bat` · `mc_captures.txt` | Offline decoder for captured ManipalCigna payloads |
| `mc_capture_snippet.js` | Paste into Chrome's Console on the real ManipalCigna page to capture payloads without using the Network tab |
| `docs_mc_live_capture_findings.md` | What the live portal actually sends — field names, values, and what is still unverified |
| `verify_mc_plantype.js` · `verify_mc_ui.js` | ManipalCigna Plan Type regression tests |
| `verify_pdf_report.js` | Checks the PDF and the Excel agree, cell for cell, and that the logo reaches all three outputs |
| `logo.png` | The brand mark. `insurance_hub.html` carries a base64 copy; this is the source for regenerating it |
| `.env` / `.env.example` | Credentials and configuration |
| `archive_legacy.bat` | Moves superseded files to `_old\` |
| `_backup_pre_tier*.zip` | Rollback points, one per tier |

Kept on purpose despite being superseded: `server.js` (the only cheerio
reference implementation), `quote_generator.html` (the only way to hand-enter a
competitor premium), `mc_probe*.js` (the only documentation of ManipalCigna's
API contract), `analyze_excel.py` (needed if `Vivek Bhaia_Quote.xlsx` resurfaces).

---

## If something breaks

| Symptom | Cause |
|---|---|
| ManipalCigna exits immediately with `[config] Missing MC_AUTH_TOKEN` | `.env` not created — see step 1 |
| `[Care] FATAL: could not load care_plans.json` | The catalogue file is missing. Restore it from a `_backup_pre_tier*.zip`. |
| A calculator shows "Origin not allowed" | You are serving from a port other than 3002–3005. Add it to `LOCAL_ORIGINS` in all four servers. |
| "ExcelJS could not be loaded" / `/exceljs.js` returns 404 | `npm install` not run |
| A verify script fails with `Cannot find module 'jsdom'` | `npm install --no-save jsdom` first |
| The plan picker shows "No catalogue record for this plan" | `care_server.js` is not running, so `care_plans.json` never loaded. Start it and reopen the dialog. |
| A ManipalCigna plan is outlined red and cannot be filled | Its `product_code` is empty in `PLAN_CONFIG` in `mc_server.js`. Supply one. |
| `npm run verify:excel` reports unexplained differences | The Excel generator changed. The listed cells say what drifted; `--verbose` shows every accepted difference too. |
| Care quotes fail intermittently under "Fill All" | Should be fixed by the per-request session. If it recurs, check the server console for CSRF errors. |
| `npm run audit:care` fails with drift | The portal changed, or the catalogue is wrong. Run `--update`, verify against the real portal, then edit `care_plans.json`. |

**Rolling back:** each tier has a zip and an extracted folder
(`_backup_pre_tier3_2026-08-07`). Copy the files you want back over the current
ones. Tiers build on each other, so rolling back an early tier without the later
ones will not work cleanly.

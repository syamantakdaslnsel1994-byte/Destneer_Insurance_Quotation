# Capturing ManipalCigna's Plan Type codes

The real quick-quote page at `online.manipalcigna.com/get-quick-quote/` has two
controls the replica does not:

| Real form | Replica |
|---|---|
| **Plan Type** — a dropdown (Family Floater, …) | nothing; the cover type is computed from the member count |
| **All Insured are resident Indian** — YES / NO | nothing; hardcoded `'Y'` in all five payload builders |

Adding them needs one fact we cannot get from the code: **which code the portal
sends for each Plan Type label.** `INDI`, `INFF` and `INFI` are the three values
proven to work (an earlier probe, `mc_test_covertype.js`, tested seven candidates
and established that `FamilyFloater` is rejected outright) — but nothing on disk
says which label maps to which, or whether a fourth exists.

Guessing is the wrong move here. A wrong cover code does not error; it returns a
premium, for a different policy, looking entirely valid.

10 Aug 2026.

---

## What we already know, from the one capture on disk

`mc_test_covertype.js` carries a genuine `q=` value captured from a browser.
Decoding it (`node mc_decode_url.js --file mc_captures.txt`) shows the address
bar carries the **page state**, which is a different schema from the request
body our server reproduces:

| | Real page state (`q=`) | What `mc_server.js` builds |
|---|---|---|
| resident flag | `All_Insured_Are_Resident_Indian: "YES"` | `allInsuredAreResidentIndian: "Y"` |
| portability | `portability: "NO"`, inside `preparedData` | `portability: "N"`, top level |
| member gender | `GENDER: "MALE"` | `gender: "M"` |
| member DOB | `DOB: "24/06/1991"` | `dob: …` |
| adult marker | `Adult: "YES"` | `adult: "A"` |
| tenure | inside `preparedData` | top level |
| **cover type** | **absent** | `coverType: "INDI"` |

Two things follow.

1. The resident flag's real values are **`YES` / `NO`** in the page state. The
   API takes `Y` / `N`. Worth getting right in both places.
2. **The `q=` value alone will not answer the Plan Type question** — that
   capture has one adult and carries no cover type at all. The cover type is
   decided when the page posts to `viewPlans`. So the capture that matters is
   the **request body**, not the URL.

---

## The easiest route — paste one file into the Console

`mc_capture_snippet.js` watches the requests the page is already making and
pulls the encrypted payload out for you, so there is no Network tab to navigate.

1. Open `https://online.manipalcigna.com/get-quick-quote/` in Chrome.
2. Press **F12**, click the **Console** tab.
3. Open `mc_capture_snippet.js` in Notepad, select all, copy, paste into the
   Console, press Enter. It answers **capture armed**.
4. Set **two adults**, sum insured, pincode `700041`, 1 Year.
5. Set **Plan Type** to its first option and let the premiums load. The console
   prints `captured 1` with the Plan Type it detected.
6. Change Plan Type to the next option. Repeat for every option.
7. Type `mcCaptures()` and press Enter. It prints every capture as
   `LABEL=value` lines and copies them to your clipboard.
8. Paste into `mc_captures.txt` and double-click `decode_mc_url.bat`.

The label comes from whatever the Plan Type control reads at the moment of
capture, so the output table is already a translation key. `mcReset()` clears
the captures if you want to start again.

It catches all five ways a page can send a body — a string, a `Blob`, a
`Request` object, a plain `XMLHttpRequest`, and the axios-style XHR that sets
headers between `open` and `send`. That is tested, not assumed: the
`Request`-object case was missed by the first version, and it is the shape a
modern single-page app is most likely to use.

Nothing is uploaded. The snippet only reads requests the page makes anyway.

---

## The manual route — about five minutes

Do this with **two adults**, because that is where the ambiguity lives: two
adults is the one roster where "floater" and "individually" are both sensible
answers, and where our `getCoverType()` always picks `INFF`.

1. Open `https://online.manipalcigna.com/get-quick-quote/` in Chrome.
2. Press **F12** to open DevTools, and click the **Network** tab. Leave it open.
3. In the **Filter** box at the top of the Network tab, type `viewPlans`.
4. On the page: **Edit Members** → two adults, any ages. Set Sum Insured, Pincode
   `700041`, Policy Duration 1 Year. Leave Portability NO.
5. Set **Plan Type** to its first option and let the premiums load.
6. In the Network tab, click the `viewPlans` request that appears → the
   **Payload** tab (Chrome may call it **Request**) → find `encodedString` →
   right-click its value → **Copy value**. It is a long block of letters,
   digits, `+`, `/` and `=`.
7. Open `mc_captures.txt` in Notepad and add a line:

   ```
   FamilyFloater=<paste here>
   ```

   Use whatever the Plan Type option was actually called as the label.
8. **Repeat steps 5–7 for every other option in the Plan Type dropdown**,
   changing nothing else. One line per option. That "changing nothing else"
   part is what makes the comparison mean anything.
9. Save the file and double-click **`decode_mc_url.bat`**.

You get a table with one row per option and the `coverType` each one sent. That
table is the mapping, and it is not a guess.

### If even the Console is a step too far

The address bar alone is still worth having — it gives us the resident-Indian
field and confirms the page-state schema. Click in the address bar, `Ctrl+A`,
`Ctrl+C`, and paste that whole URL as one line in `mc_captures.txt`. Do it once
per Plan Type option. If the cover type turns out to be in there after all, the
decoder will find it: it reports **any** field whose name mentions cover / plan /
type, or whose value looks like one of the codes, wherever in the payload it
sits. That is why it does not simply print `coverType` and stop.

---

## Also worth capturing while you are in there

Not needed for Plan Type, but each is a field the replica currently pins to a
default, and one capture each would settle it:

- **All Insured are resident Indian → NO.** Confirms the API value (`N`?) and
  whether the premium actually moves.
- **Portability → YES.** We send `'Y'`; the page state says `"YES"`.
- **A Super Top Up quote**, to check `deductibleSI` — the replica sends the
  deductible you choose but the payload also carries a separate
  `deductibleSI: '10000'` that is hardcoded, and it is not clear which one the
  gateway honours.

---

## What happens once the mapping is known

Small and contained, in this order:

1. `mc_multi.html` — add a **Plan Type** select (options and values straight from
   the captured table) and an **All Insured are resident Indian** select; include
   both in the `/api/premium/:planId` request body.
2. `mc_server.js` — honour `planType` in **all five** payload builders, not only
   the `lifetime` branch, and thread the resident flag through in place of the
   hardcoded `'Y'`.
3. `mc_multi.html` — stop reporting `coverType` as clamped, since it will no
   longer be ignored. That amber note is at the `params-applied` handler.
4. The hub's ManipalCigna cover-type chip starts working, so a Family Floater and
   a Multi Individual quote for the same family become two presses instead of a
   trip to the real portal.

Point 4 is the one that shows up in the client's spreadsheet.
`Vivek Bhaia_Quote.xlsx` has ManipalCigna in both blocks for the same family —
₹60,041 floater and ₹71,853 multi-individual at 10 Lacs. Today the replica can
only produce the first of those.

---

## Safety notes

- `mc_decode_url.js` is **offline**. It decrypts a string you paste and prints
  it. It makes no network request of any kind.
- `mc_capture_snippet.js` makes no request either. It wraps `fetch` and
  `XMLHttpRequest` to read bodies the page was already sending, keeps them in a
  variable, and prints them when asked. Reloading the page removes it.
- It reads the AES key from `.env` (`MC_AES_KEY`) rather than carrying a copy.
- **`mc_captures.txt` will contain real captured payloads** — pincodes, dates of
  birth. It is listed in `.gitignore`. Do not commit it, and clear it out when
  the mapping is settled.

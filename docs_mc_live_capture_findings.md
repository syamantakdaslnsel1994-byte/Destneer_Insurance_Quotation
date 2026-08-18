# ManipalCigna — what the live portal actually sends

Captured 13 Aug 2026 by driving `online.manipalcigna.com` in a real browser
session. Everything below is **read from the live page or decoded from its own
payload** — none of it is inferred.

Plan used: **Lifetime Health**, 2 adults (45 M, 42 F), pincode 700041, 1 year,
sum insured 50 L, portability NO.

---

## 1. The finding that explains the whole gap

**Plan Type is not on the form the replica models.** The real flow has two pages:

| Page | URL | Controls |
|---|---|---|
| Entry form | `/get-quick-quote/lifetime-health` | Adults, Kids, ages + genders, Pincode, Port/Migrate. **That is all.** |
| Results page | `/get-product-quote/.../your-quote?q=<encrypted>` | Plan Type, All Insured are resident Indian, Sum Insured, Pincode, Policy Duration, Portability, Payment Frequency — plus the premiums |

`mc_multi.html` reproduces the **entry form** and then shows premiums in the same
view. The parameter bar in the screenshots is the **results page**, which is
where Plan Type, resident-Indian and Policy Duration live. That is why those
controls were missing rather than merely unwired.

## 2. Plan Type — the values, read off the live DOM

```
Individual        →  individual
Family Floater    →  FamilyFloater
Multi Individual  →  multiindividual
```

Note the inconsistent casing. It is the portal's, not a transcription error.

## 3. All Insured are resident Indian

```
YES → YES        NO → NO
```

`mc_server.js` hardcodes `allInsuredAreResidentIndian: 'Y'` in all five payload
builders. The page state spells it `All_Insured_Are_Resident_Indian` with the
value `YES`.

## 4. A real decoded payload

The `q=` value on the results page, decrypted with `mc_decode_url.js`:

```json
{ "preparedData": {
  "coverType": "familyfloater",
  "All_Insured_Are_Resident_Indian": "YES",
  "sumInsured": "5000000",
  "sumInsured2": "5000000",
  "zone": "ZONE2",
  "pinCode": "700041",
  "tenure": "1",
  "portability": "NO",
  "isPort": "NO",
  "flowType": "advisor",
  "createDate": "2026-08-13",
  "skip": false,
  "coverTypeInfo": {
    "adultCount": 2, "peopleCount": 2, "childCount": 0,
    "details": [
      { "DOB": "13/08/1981", "GENDER": "MALE",   "Adult": "YES" },
      { "DOB": "13/08/1984", "GENDER": "FEMALE", "Adult": "YES" }
    ] } } }
```

Points worth noting:

- **`coverType` here is `familyfloater`** — lowercase, one word. Not `INFF`.
- The dropdown value is `FamilyFloater`; the payload carries `familyfloater`.
  The page evidently lowercases it. Whether `individual` and `multiindividual`
  pass through unchanged is an inference, **not** something observed.
- `DOB` is derived as today minus the entered age: 45 → `13/08/1981` on
  13/08/2026. Day and month are today's.
- `GENDER` is the full word `MALE` / `FEMALE`; `Adult` is `YES` / `NO`.
- Pincode 700041 resolves to **ZONE2**.
- `sumInsured` is duplicated into `sumInsured2`.

## 5. Lifetime Health's real sum-insured ladder

```
50 L · 75 L · 100 L · 150 L · 200 L · 300 L
```

This confirms the ₹50 L floor `buildParamsForProvider` enforces for
ManipalCigna is genuine and not a workaround. The replica's own SI list for
Lifetime Health should be exactly these six.

Payment Frequency offers only `Single [single]`, matching `frequency: 'single'`.

---

## 6. What is still open — one small capture

There are **two layers**, and only the first is now settled:

| Layer | Field | Values | Status |
|---|---|---|---|
| Page state (`q=` in the URL) | `coverType` | `individual` / `familyfloater` / `multiindividual` | **known** |
| API request (`viewPlans` body) | `coverType` | `INDI` / `INFF` / `INFI` | known to work, but which maps to Multi Individual is **not** established |

`mc_server.js` sends `INDI`/`INFF`/`INFI` in the API body and gets valid quotes,
so that layer is real too — the page evidently translates its own vocabulary
into those codes before calling the API. What is missing is the translation for
**Multi Individual** specifically.

Still needed: one capture of the `viewPlans` request body with Plan Type set to
Multi Individual. `mc_capture_snippet.js` does this — paste it into the Console
on a freshly loaded results page, change Plan Type, then run `mcCaptures()`.

Why the browser session did not get it: the results page is a React app that
discards programmatic input, so setting the dropdown from script changed the DOM
without triggering the app's re-fetch. Real keyboard events were tried too. After
that the tab's renderer stopped responding to screenshots and network tracking
altogether, and pushing further on a live production portal was not worth it.

## 7. Correction — one thing that was claimed too early

An earlier draft of this file said a **synthesised** `?q=` URL loads the results
page in the corresponding Plan Type state. **That was wrong, and it was my
misreading.** What happened: a `form_input` call had set the dropdown's DOM value
to `multiindividual` without React registering it, so when the value was read
back afterwards it looked like the synthesised URL had taken effect. It had not —
the address bar still held the original `familyfloater` payload, 1088 characters,
unchanged.

So this is **not** established:

- that the portal accepts a URL we build ourselves
- that `individual` and `multiindividual` are the payload spellings (only
  `familyfloater` was seen in a real payload; the other two are the *dropdown*
  values, and lowercasing is an inference)
- the API-body `coverType` for Multi Individual

Round-trip encryption is verified only in the sense that `mc_decode_url.js`
decodes what it encrypts. That proves the crypto matches. It says nothing about
whether the gateway accepts a hand-built payload.

The idea of driving the real results page by building the `?q=` URL is still
worth considering — but it rests on a capability that has not been demonstrated,
so it stays an idea.

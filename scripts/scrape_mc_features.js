// scrape_mc_features.js
// ---------------------------------------------------------------------------
// Scrapes ManipalCigna's own public product pages (manipalcigna.com, NOT the
// online.manipalcigna.com quotation portal server/mc_server.js already talks
// to — that API only ever returns pricing + add-on/rider NAMES, confirmed
// earlier this session, never descriptive feature text) for real per-plan
// feature data, and writes data/mc_features_live.json.
//
// Two real page shapes, confirmed live — both are plain <table> elements
// with the same tr>td structure, so one generic extractor handles both:
//   1. Multi-column "Compare Plans Of" tables — one page lists every tier of
//      a product family side by side (e.g. lifetime-health-india's table has
//      both an India and a Global column; prohealthprime-protect's table has
//      Protect/Advantage/Active). ONE page covers the whole family.
//   2. Single "KEY FEATURES / INFORMATION" tables — one page per specific
//      tier (super-topup-plus, super-topup-select, senior-classic,
//      senior-elite all needed individually).
//
// Sarvah has NO public product page on this site (confirmed live: sitemap.xml
// has zero /sarvah/ URLs, and a direct URL guess 404'd) — left out entirely,
// not guessed at.
//
// Refreshable cache, not fetched at report time — same pattern as Care/Niva.
// Run:  node scripts/scrape_mc_features.js
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'mc_features_live.json');

// Confirmed live 27 Aug 2026 against manipalcigna.com's own sitemap.xml /
// direct navigation — covers 4 of the 5 products server/mc_server.js's raw
// API already quotes (all but Sarvah, which has no public page).
const PAGES = [
  { url: 'https://www.manipalcigna.com/hospitalization-cover/lifetime-health/lifetime-health-india', key: 'lifetime-health' },
  { url: 'https://www.manipalcigna.com/hospitalization-cover/prohealth-insurance/prohealthprime-protect', key: 'prohealth-prime' },
  { url: 'https://www.manipalcigna.com/hospitalization-cover/super-topup/super-topup-plus', key: 'super-top-up-plus' },
  { url: 'https://www.manipalcigna.com/hospitalization-cover/super-topup/super-topup-select', key: 'super-top-up-select' },
  { url: 'https://www.manipalcigna.com/hospitalization-cover/senior-citizen-health-insurance/senior-classic', key: 'prime-senior-classic' },
  { url: 'https://www.manipalcigna.com/hospitalization-cover/senior-citizen-health-insurance/senior-elite', key: 'prime-senior-elite' },
];

// Generic table reader: label = first cell's text (a small decorative dot-
// icon span sits inside it on some rows — stripped like Care's tooltip/icon
// elements), values = every other cell in the row, in column order. Handles
// both the multi-column "Compare Plans" tables and the single-column
// "Key Features/Information" tables the same way — the multi-column case
// just yields a longer values array per row (mirrors the same choice made
// for Care's multi-SI-band table).
async function scrapeTable(page) {
  return page.evaluate(() => {
    const NOISE_SELECTOR = 'img, svg, .flex-shrink-0';
    function cellText(cell) {
      const clone = cell.cloneNode(true);
      clone.querySelectorAll(NOISE_SELECTOR).forEach((el) => el.remove());
      return clone.textContent.replace(/\s+/g, ' ').trim();
    }
    const tables = Array.from(document.querySelectorAll('table'));
    const out = [];
    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll('tr'));
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td'));
        if (!cells.length) continue; // header row (th only) — skip
        const label = cellText(cells[0]);
        if (!label) continue;
        const values = cells.slice(1).map(cellText).filter(Boolean);
        if (values.length) out.push({ label, values });
      }
    }
    return out;
  });
}

async function scrapePage(entry, browser) {
  const page = await browser.newPage();
  try {
    const resp = await page.goto(entry.url, { waitUntil: 'networkidle', timeout: 30000 });
    const status = resp ? resp.status() : null;
    if (!status || status >= 400) return { ...entry, ok: false, status };
    await page.waitForTimeout(800);
    const headerRow = await page.evaluate(() => {
      const t = document.querySelectorAll('table')[0];
      const th = t ? t.querySelector('tr') : null;
      return th ? Array.from(th.querySelectorAll('th')).map((c) => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
    });
    const rows = await scrapeTable(page);
    return { ...entry, ok: true, status, columnHeaders: headerRow, rows };
  } catch (e) {
    return { ...entry, ok: false, error: String(e && e.message || e) };
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: false });
  console.log(`Scraping ${PAGES.length} ManipalCigna product pages...`);
  const results = {};
  for (const entry of PAGES) {
    process.stdout.write(`  ${entry.key} ... `);
    const r = await scrapePage(entry, browser);
    results[entry.key] = r;
    console.log(r.ok ? `OK (${r.rows.length} rows, columns: ${JSON.stringify(r.columnHeaders)})` : `FAILED (${r.status || r.error})`);
    await new Promise((res) => setTimeout(res, 1500)); // pace requests — no confirmed CAPTCHA/WAF here, but stay conservative
  }
  await browser.close();

  const ok = Object.values(results).filter((r) => r.ok);
  const out = {
    _comment: 'Scraped live from manipalcigna.com\'s own public product pages (NOT the online.manipalcigna.com quotation portal, which never returns descriptive feature text) — see scripts/scrape_mc_features.js. Sarvah has no public page and is not covered. Refreshable cache, not fetched at report time.',
    _scrapedAt: new Date().toISOString(),
    _pageCount: PAGES.length,
    _okCount: ok.length,
    plans: results,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT_FILE} — ${ok.length}/${PAGES.length} pages scraped OK.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

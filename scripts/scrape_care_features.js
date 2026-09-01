// scrape_care_features.js
// ---------------------------------------------------------------------------
// Scrapes Care Health's own public product pages (careinsurance.com/product/
// <slug>) for real, current per-plan feature data — Room Rent, AYUSH Cover,
// Waiting Periods, Ambulance Cover, etc. — and writes data/care_features_live.json.
//
// This is a refreshable-cache tool, not something run at report-generation
// time: re-run it on demand (e.g. every few months, or when Care changes a
// plan) and the app picks up the new file. Report generation itself stays
// instant/offline-safe, independent of Care's site being reachable.
//
// WHY A REAL BROWSER: careinsurance.com's WAF returns 403 to plain HTTP
// clients (confirmed live — even /robots.txt was blocked to a bare fetch)
// but lets real browser traffic through cleanly. This mirrors exactly why
// electron/care-view.js already embeds a real BrowserView for the
// quotation flow instead of hitting the portal with a plain HTTP client.
//
// Run:  node scripts/scrape_care_features.js
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'care_features_live.json');

// Every /product/ URL found in careinsurance.com's own sitemap.xml
// (confirmed live 27 Aug 2026 — re-run against the live sitemap to refresh
// this list itself if Care adds/removes products; see fetchSitemapSlugs()).
const KNOWN_SLUGS = [
  'arogya-sanjeevani', 'care', 'care-advantage', 'care-cancer-mediclaim',
  'care-classic', 'care-critical-mediclaim', 'care-freedom', 'care-heart',
  'care-heart-mediclaim', 'care-operation-mediclaim',
  'care-plus-the-complete-health-insurance-plan',
  'care-plus-youth-health-insurance-plan', 'care-senior', 'care-supreme',
  'care-supreme-digital-15', 'care-supreme-emi', 'care-supreme-enhance',
  'care-supreme-new', 'care-supreme-old', 'care-supreme-senior',
  'care-supreme-shine', 'care-supreme-super-saver', 'care-supreme-value',
  'care-supreme-value-plus', 'care-supreme-vikas', 'en-ultimate-care',
  'enhance', 'explore', 'explore-health-unlimited-for-students', 'joy',
  'secure', 'secure-child', 'secure-plus', 'senior-health-advantage',
  'student-explore', 'travel-explore', 'ultimate-care',
  'ultimate-care-bonanza', 'ultimate-care-digital-15', 'ultimate-care-emi',
  'ultimate-care-new', 'ultimate-care-senior',
  'ultimate-care-unlimited-coverage', 'ultimate-joy',
];

async function fetchSitemapSlugs(page) {
  await page.goto('https://www.careinsurance.com/sitemap.xml', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const xml = await page.content();
  const matches = [...xml.matchAll(/https:\/\/www\.careinsurance\.com\/product\/([a-z0-9-]+)/gi)];
  return [...new Set(matches.map((m) => m[1]))].sort();
}

// The "Key Features" table's rows are a repeating (label, description,
// value) pattern, but the exact markup differs across product pages —
// confirmed live scraping all 44: newer pages use
//   <td class="d-flex"><span>LABEL</span><div class="tooltip-body">
//     <div class="tooltip...">DESCRIPTION</div></div></td><td>VALUE</td>
// while older pages (e.g. care-plus-the-complete-health-insurance-plan)
// use
//   <td class="hard_left">LABEL<div class="img_hover ..."><i class=
//     "material-icons info"></i><span class="max_tooltip">DESCRIPTION
//     </span></div></td><td>VALUE</td><td>VALUE</td>...
// (older pages can also have MULTIPLE value columns, one per SI band).
// A selector tuned to one template silently mis-extracts on the other —
// confirmed live: the first version of this scraper got 0 usable rows
// from care-plus's page despite it clearly having the data, because
// `.querySelector('span')` picked up nested tooltip/icon spans instead of
// the plain label text. Fixed by reading the label cell's OWN text with
// all known tooltip/icon descendants stripped out first, which works
// regardless of which template a given page uses.
async function scrapeKeyFeaturesTable(page) {
  return page.evaluate(() => {
    const NOISE_SELECTOR = '.tooltip-body, .tooltip, .max_tooltip, .img_hover, .material-icons, i.info, svg';
    function labelTextOf(cell) {
      const clone = cell.cloneNode(true);
      clone.querySelectorAll(NOISE_SELECTOR).forEach((el) => el.remove());
      return clone.textContent.replace(/\s+/g, ' ').trim();
    }
    function descriptionOf(cell) {
      const tip = cell.querySelector('.tooltip-body .tooltip, .tooltip, .max_tooltip');
      return tip ? tip.textContent.replace(/\s+/g, ' ').trim() : '';
    }
    const tables = Array.from(document.querySelectorAll('table'));
    const out = [];
    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll('tr'));
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td'));
        if (!cells.length) continue; // header row (th only) — skip
        const labelCell = cells[0];
        const label = labelTextOf(labelCell);
        if (!label) continue;
        const description = descriptionOf(labelCell);
        // Multiple value columns (older, multi-SI-band template) all get
        // captured; the LAST one is used as the representative single
        // value downstream (the highest/most complete SI tier), matching
        // what the newer single-value-column template already gives.
        const values = cells.slice(1).map((c) => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
        const value = values[values.length - 1] || '';
        if (value) out.push({ label, description, value, allValues: values.length > 1 ? values : undefined });
      }
    }
    return out;
  });
}

async function scrapePlanTitle(page) {
  return page.evaluate(() => {
    const h1 = document.querySelector('h1');
    return h1 ? h1.textContent.trim() : document.title;
  });
}

async function scrapeSlug(slug, browser) {
  const page = await browser.newPage();
  try {
    const resp = await page.goto(`https://www.careinsurance.com/product/${slug}`, {
      waitUntil: 'networkidle', timeout: 30000,
    });
    const status = resp ? resp.status() : null;
    if (!status || status >= 400) return { slug, ok: false, status };
    await page.waitForTimeout(800);
    const title = await scrapePlanTitle(page);
    const rows = await scrapeKeyFeaturesTable(page);
    return { slug, ok: true, status, title, rows };
  } catch (e) {
    return { slug, ok: false, error: String(e && e.message || e) };
  } finally {
    await page.close();
  }
}

async function main() {
  // headless:true gets a flat 403 from Care's WAF on every single request —
  // confirmed live (0/44 pages) — while headless:false (a real, visible
  // browser window) succeeds; the WAF is almost certainly fingerprinting
  // headless Chromium specifically, not blocking Playwright/automation
  // generally. This has to stay headed.
  const browser = await chromium.launch({ channel: 'msedge', headless: false });
  const bootstrapPage = await browser.newPage();
  let slugs = KNOWN_SLUGS;
  try {
    const live = await fetchSitemapSlugs(bootstrapPage);
    if (live.length) slugs = live;
  } catch (e) {
    console.warn('[scrape_care_features] sitemap fetch failed, falling back to the known-slug list from', KNOWN_SLUGS.length, 'entries:', e.message);
  }
  await bootstrapPage.close();

  console.log(`Scraping ${slugs.length} Care Health product pages...`);
  const results = {};
  for (const slug of slugs) {
    process.stdout.write(`  ${slug} ... `);
    const r = await scrapeSlug(slug, browser);
    results[slug] = r;
    console.log(r.ok ? `OK (${r.rows.length} rows)` : `FAILED (${r.status || r.error})`);
  }
  await browser.close();

  const ok = Object.values(results).filter((r) => r.ok);
  const out = {
    _comment: 'Scraped live from careinsurance.com/product/<slug> — see scripts/scrape_care_features.js. Refreshable cache, not fetched at report time; re-run this script to refresh.',
    _scrapedAt: new Date().toISOString(),
    _slugCount: slugs.length,
    _okCount: ok.length,
    plans: results,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT_FILE} — ${ok.length}/${slugs.length} pages scraped OK.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

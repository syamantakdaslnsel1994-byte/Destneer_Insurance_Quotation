// scrape_star_features.js
// ---------------------------------------------------------------------------
// Scrapes Star Health's own public product pages (starhealth.in) for real
// per-plan feature data, and writes data/star_features_live.json.
//
// Unlike Care/MC (multi-column comparison tables) and Niva (brochure PDFs),
// Star's product pages each have ONE single-column "Plan Essentials" table —
// confirmed live, a consistent repeating <tr><td><h4>LABEL</h4><div
// class="text-sm">VALUE</div></td></tr> structure across every product page
// checked. server/sh_server.js is a thin proxy to Star's own live API with
// no hardcoded product catalogue (unlike Care/MC's PLAN_CONFIG), so the
// product list here comes straight from starhealth.in's own sitemap.xml.
//
// Refreshable cache, not fetched at report time — same pattern as Care/
// Niva/MC.
// Run:  node scripts/scrape_star_features.js
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'star_features_live.json');

// Real product pages found in starhealth.in's own sitemap.xml under
// /health-insurance/ and /accident-insurance/ (confirmed live 27 Aug 2026),
// excluding generic category/landing pages (health-insurance/ itself,
// health-insurance-for-parents, maternity-insurance, health-insurance-for-
// senior-citizens — informational pages, not individual products).
const KNOWN_SLUGS = [
  'arogya-sanjeevani', 'autism-care', 'cancer-care-platinum',
  'cardiac-care-platinum', 'cardiac-care', 'critical-illness-insurance',
  'diabetes-health-insurance', 'extra-protect', 'family-health-optima',
  'health-gain', 'health-premier', 'mediclassic',
  'micro-rural-and-farmers-care', 'opd-health-insurance', 'smart-health-pro',
  'special-care-gold', 'star-assure', 'super-star', 'women-care',
  'young-star-add-on', 'youngstar', 'value-plus',
];

async function fetchSitemapSlugs(page) {
  await page.goto('https://www.starhealth.in/sitemap.xml', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const xml = await page.content();
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  const EXCLUDE = /^(health-insurance|health-insurance-for-parents|maternity-insurance|health-insurance-for-senior-citizens)$/;
  return locs
    .filter((l) => /\/health-insurance\/[a-z0-9-]+\/?$/i.test(l))
    .map((l) => l.match(/\/health-insurance\/([a-z0-9-]+)\/?$/i)[1])
    .filter((s) => !EXCLUDE.test(s))
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .sort();
}

// Same cellText-stripping principle as Care/MC's extractors — no known
// noise elements on this page's cells (label is a clean <h4>, value a
// clean <div class="text-sm">), so this is simpler than either of those.
async function scrapeTable(page) {
  return page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    const out = [];
    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll('tr'));
      for (const row of rows) {
        const cell = row.querySelector('td');
        if (!cell) continue; // header row (th only) — skip
        const h4 = cell.querySelector('h4');
        const valueEl = cell.querySelector('div');
        const label = (h4 ? h4.textContent : '').replace(/\s+/g, ' ').trim();
        const value = (valueEl ? valueEl.textContent : '').replace(/\s+/g, ' ').trim();
        if (label && value) out.push({ label, value });
      }
    }
    return out;
  });
}

async function scrapeSlug(slug, browser) {
  const page = await browser.newPage();
  try {
    const resp = await page.goto(`https://www.starhealth.in/health-insurance/${slug}/`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    const status = resp ? resp.status() : null;
    if (!status || status >= 400) return { slug, ok: false, status };
    await page.waitForTimeout(2500); // this site's tables render after DOMContentLoaded — confirmed live, networkidle timed out on every page tried
    const rows = await scrapeTable(page);
    return { slug, ok: true, status, rows };
  } catch (e) {
    return { slug, ok: false, error: String(e && e.message || e) };
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: false });
  const bootstrapPage = await browser.newPage();
  let slugs = KNOWN_SLUGS;
  try {
    const live = await fetchSitemapSlugs(bootstrapPage);
    if (live.length) slugs = live;
  } catch (e) {
    console.warn('[scrape_star_features] sitemap fetch failed, falling back to the known-slug list:', e.message);
  }
  await bootstrapPage.close();

  console.log(`Scraping ${slugs.length} Star Health product pages...`);
  const results = {};
  for (const slug of slugs) {
    process.stdout.write(`  ${slug} ... `);
    const r = await scrapeSlug(slug, browser);
    results[slug] = r;
    console.log(r.ok ? `OK (${r.rows.length} rows)` : `FAILED (${r.status || r.error})`);
    await new Promise((res) => setTimeout(res, 1200)); // pace requests — no confirmed CAPTCHA/WAF here, but stay conservative after Niva's lesson
  }
  await browser.close();

  const ok = Object.values(results).filter((r) => r.ok);
  const out = {
    _comment: 'Scraped live from starhealth.in\'s own public product pages — see scripts/scrape_star_features.js. Refreshable cache, not fetched at report time.',
    _scrapedAt: new Date().toISOString(),
    _slugCount: slugs.length,
    _okCount: ok.length,
    plans: results,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT_FILE} — ${ok.length}/${slugs.length} pages scraped OK.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

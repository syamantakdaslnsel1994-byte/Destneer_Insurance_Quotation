// scrape_niva_features.js
// ---------------------------------------------------------------------------
// Scrapes Niva Bupa's own product brochures (linked from
// nivabupa.com/family-health-insurance-plans/<slug>.html) for real, current
// per-plan feature data, and writes data/niva_features_live.json.
//
// Unlike Care (server/mc_server.js's sibling, scripts/scrape_care_features.js),
// Niva's product pages have no <table> — the real feature data usable for
// this sheet lives in the plan's downloadable brochure PDF instead (confirmed
// live: the page's own "Compare variants" section is div/card-based and uses
// different vocabulary — "Lock the Clock", "Booster+" — than the brochure's
// "Product Benefit Table", which uses near-identical wording to Care's own
// pages: "In-patient Care", "Pre-Hospitalisation", "Ambulance", etc).
//
// Refreshable cache, not fetched at report time — same pattern as Care's.
// Run:  node scripts/scrape_niva_features.js
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'data', 'niva_features_live.json');

// Real product pages found in nivabupa.com's own sitemap.xml (confirmed live
// 27 Aug 2026 under /family-health-insurance-plans/) — excludes get-quote/
// article/test pages, which aren't product pages.
const KNOWN_SLUGS = [
  'heart-beat', 'health-pulse', 'money-saver', 'super-saver', 'aspire-max',
  'accident-care', 'criti-care', 'corona-kavach',
  'health-companion-family-floater', 'reassure', 'senior-citizen-family-floater',
  'goactive', 'health-recharge-family-floater', 'health-premia',
  'reassurev2-insurance', 'reassurev3-insurance', 'rise', 'saral-suraksha-bima',
  'aspire',
];

async function fetchSitemapSlugs(page) {
  await page.goto('https://www.nivabupa.com/sitemap.xml', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const xml = await page.content();
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  return locs
    .filter((l) => /\/family-health-insurance-plans\/[a-z0-9-]+\.html$/i.test(l))
    .filter((l) => !/sitemaptest/i.test(l))
    .map((l) => l.match(/\/family-health-insurance-plans\/([a-z0-9-]+)\.html$/i)[1])
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .sort();
}

// A live check found the FIRST .pdf link on a product page is not
// necessarily the brochure (one attempt grabbed an unrelated short pricing-
// revision notice) — the real brochure link has "brochure" in its own URL
// path, confirmed live: .../pages/doc/brochure/ReAssure_2.0_....pdf.
async function findBrochureUrl(page) {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'))
      .filter((a) => /\.pdf(\?|$)/i.test(a.href));
    const byUrl = links.find((a) => /\/brochure\//i.test(a.href) || /brochure/i.test(a.href));
    const byText = links.find((a) => /brochure/i.test(a.textContent || ''));
    return (byUrl || byText || null) && (byUrl || byText).href;
  });
}

async function scrapeSlug(slug, browser, context) {
  const page = await context.newPage();
  try {
    const resp = await page.goto(`https://www.nivabupa.com/family-health-insurance-plans/${slug}.html`, {
      waitUntil: 'networkidle', timeout: 30000,
    });
    const status = resp ? resp.status() : null;
    if (!status || status >= 400) return { slug, ok: false, status };
    await page.waitForTimeout(800);
    // Distinguish "this plan genuinely has no brochure link" from "a
    // CAPTCHA blocked the real page from rendering" — confirmed live this
    // happens on nivabupa.com under load. Reported honestly, not silently
    // treated as the same kind of failure.
    const captcha = await page.evaluate(() =>
      /select all images|verify you are human|i'm not a robot/i.test(document.body.innerText || ''));
    if (captcha) return { slug, ok: false, error: 'CAPTCHA challenge blocked the page — not attempted to solve' };
    const brochureUrl = await findBrochureUrl(page);
    if (!brochureUrl) return { slug, ok: false, error: 'no brochure link found on page' };

    const pdfResp = await context.request.get(brochureUrl);
    if (!pdfResp.ok()) return { slug, ok: false, brochureUrl, error: `brochure fetch ${pdfResp.status()}` };
    const buf = await pdfResp.body();
    const tmpPath = path.join(ROOT, `_niva_tmp_${slug}.pdf`);
    fs.writeFileSync(tmpPath, buf);
    return { slug, ok: true, brochureUrl, pdfBytes: buf.length, tmpPath };
  } catch (e) {
    return { slug, ok: false, error: String(e && e.message || e) };
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: false });
  const context = await browser.newContext();
  const bootstrapPage = await context.newPage();
  let slugs = KNOWN_SLUGS;
  try {
    const live = await fetchSitemapSlugs(bootstrapPage);
    if (live.length) slugs = live;
  } catch (e) {
    console.warn('[scrape_niva_features] sitemap fetch failed, falling back to the known-slug list:', e.message);
  }
  await bootstrapPage.close();

  console.log(`Scraping ${slugs.length} Niva Bupa product pages for brochure links...`);
  const results = {};
  for (const slug of slugs) {
    process.stdout.write(`  ${slug} ... `);
    const r = await scrapeSlug(slug, browser, context);
    results[slug] = r;
    console.log(r.ok ? `OK (brochure ${r.pdfBytes} bytes)` : `FAILED (${r.status || r.error})`);
    // Confirmed live: a burst of ~19 rapid requests triggered a reCAPTCHA
    // wall on nivabupa.com (Care's site never showed this — a different,
    // more aggressive bot-detection layer). This does NOT attempt to solve
    // or bypass it — just paces requests to avoid re-triggering it. If a
    // CAPTCHA still appears, this script fails that page honestly rather
    // than working around the challenge.
    await new Promise((r2) => setTimeout(r2, 4000));
  }
  await browser.close();

  // Extract text from every downloaded brochure via pdfminer (Python, already
  // confirmed available in this environment), then delete the temp PDFs —
  // only the extracted text is kept in the output file.
  const { execFileSync } = require('child_process');
  for (const [slug, r] of Object.entries(results)) {
    if (!r.ok || !r.tmpPath) continue;
    try {
      // Windows' console codepage (cp1252) can't encode ligature characters
      // PDFs commonly embed (e.g. the "fi" ligature, U+FB01) — confirmed
      // live: plain print() crashed with UnicodeEncodeError on every real
      // brochure. Writing UTF-8 bytes straight to stdout's buffer sidesteps
      // the console codepage entirely.
      const text = execFileSync('python3', ['-c', `
from pdfminer.high_level import extract_text
import sys
sys.stdout.buffer.write(extract_text(sys.argv[1]).encode('utf-8'))
`, r.tmpPath], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
      r.text = text;
    } catch (e) {
      r.ok = false;
      r.error = 'pdfminer extraction failed: ' + String(e && e.message || e);
    } finally {
      fs.unlinkSync(r.tmpPath);
      delete r.tmpPath;
    }
  }

  const ok = Object.values(results).filter((r) => r.ok);
  const out = {
    _comment: 'Scraped live from Niva Bupa product brochure PDFs (nivabupa.com/family-health-insurance-plans/<slug>.html → its brochure link) — see scripts/scrape_niva_features.js. Refreshable cache, not fetched at report time.',
    _scrapedAt: new Date().toISOString(),
    _slugCount: slugs.length,
    _okCount: ok.length,
    plans: results,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT_FILE} — ${ok.length}/${slugs.length} brochures scraped OK.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

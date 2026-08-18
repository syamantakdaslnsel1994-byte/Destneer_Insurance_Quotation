// verify_pdf_report.js
// ---------------------------------------------------------------------------
// The PDF and the Excel are two renderings of one report, so the thing worth
// testing is that they cannot disagree. This drives insurance_hub.html once,
// produces BOTH files from the same data, and asserts that every value in the
// spreadsheet appears in the PDF — and that the PDF's tables stay inside the
// page.
//
//     npm install --no-save jsdom
//     node verify_pdf_report.js
//     npm prune
//
// Writes _test_output.xlsx and _test_output.pdf. Exits 1 on failure.
// ---------------------------------------------------------------------------
const fs = require('fs');
const { JSDOM } = require('jsdom');
const W = __dirname + '/';
const ROOT = __dirname + '/../../';

const feat = JSON.parse(fs.readFileSync(ROOT + 'data/feature_comparison.json', 'utf8'));
const cat  = JSON.parse(fs.readFileSync(ROOT + 'data/care_plans.json', 'utf8'));

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (extra !== undefined ? '\n          ' + JSON.stringify(extra).slice(0, 400) : '')); } };

const saved = {};
const dom = new JSDOM(fs.readFileSync(ROOT + 'public/hub/insurance_hub.html', 'utf8'), {
  runScripts: 'dangerously', url: 'http://localhost:3005/hub', pretendToBeVisual: true,
  beforeParse(w) {
    w.ExcelJS = require('exceljs');
    w.jspdf   = require('jspdf');
    w.confirm = () => true;
    w.fetch = u => {
      const s = String(u);
      if (s.includes('feature_comparison.json')) return Promise.resolve({ ok: true, json: () => Promise.resolve(feat) });
      // ':3003/api/plans' also contains '/plans', so the Care branch below was
      // answering ManipalCigna's request with Care's 48-plan catalogue and
      // MC_PLAN_META ended up keyed by Care plan ids.
      if (s.includes(':3003/api/plans'))          return Promise.resolve({ ok: true, json: () => Promise.resolve({ plans: [] }) });
      if (s.includes(':3002/api/products/'))      return Promise.resolve({ ok: true, json: () => Promise.resolve({ products: [] }) });
      if (s.includes('/plans'))                  return Promise.resolve({ ok: true, json: () => Promise.resolve(cat) });
      return Promise.reject(new Error('offline'));
    };
  },
});
const w = dom.window;
const G = e => w.eval(e);

// capture the Excel download
let xlBlob = null;
w.URL.createObjectURL = b => { xlBlob = b; return 'blob:x'; };
w.URL.revokeObjectURL = () => {};
const RealBlob = w.Blob;
w.Blob = function (parts, opts) { const b = new RealBlob(parts, opts); b._parts = parts; return b; };

const MC_ADD   = " Coverage for Non-Medical Items and Durable Medical Equipment's,Room Rent Modification";
const NIVA_ADD = 'safeguard plus,';
const CARE_ADD = 'Air Ambulance,Annual Health Checkup, Wellness Benefit,Bonus Benefit,Claim Shield';
const HDFC_ADD = 'Unlimited Restore';

setTimeout(async () => {
 try {
  // Capture the PDF instead of letting jsPDF trigger a download. jsPDF puts
  // save() on each instance rather than the prototype, so the constructor has to
  // be wrapped — patching the prototype silently does nothing.
  const RealPDF = w.jspdf.jsPDF;
  function CapturingPDF(){
    const d = new RealPDF(...arguments);
    d.save = function (name) { saved.name = name; saved.doc = d; return d; };
    return d;
  }
  w.jspdf = { jsPDF: CapturingPDF };

  const setM = (id, n, rel, dob, g, ped, pin) => {
    w.memberField(id, 'name', n); w.memberField(id, 'relation', rel);
    w.memberField(id, 'gender', g); w.memberField(id, 'ped', ped);
    w.memberField(id, 'pin', pin); w.memberDOB(id, dob);
  };
  setM(1, 'Vivek Bhaia', 'Self', '1971-05-19', 'Male', 'Hypertension since 6 years', '700019');
  w.addMember(); setM(2, 'Pratibha Bhaia', 'wife', '1973-12-04', 'Female', 'Uterus Removal - 6 yrs back', '700019');
  w.addMember(); setM(3, 'Shivangi Bhaia', 'Daughter', '1997-08-29', 'Female', 'Na', '700019');
  w.addMember(); setM(4, 'Shourya Bhaia', 'Son', '2004-06-03', 'Male', 'Skin rashes', '700019');

  const $ = i => w.document.getElementById(i);
  $('rp_client_name').value    = 'Vivek Bhaia';
  $('rp_existing_policy').value = 'The New India Assurance Co. Ltd.';
  $('rp_ep_plan').value         = 'New India Flexi Floater Group Mediclaim Policy';
  $('rp_existing_si').value     = '1000000';
  $('rp_existing_prem').value   = '43319';
  $('rp_ep_renewal_date').value = '05.01.2026';
  $('rp_ep_type').value         = 'Floater';

  const BANDS = [
    ['10 Lacs', [['Manipal Cigna','Sarvah Param',MC_ADD,[60041,113789,170159],[71853,135038,200548]],
                 ['Niva Bupa','Reassure2.0 Bronze',NIVA_ADD,[38504,73158,111461],[60256,114487,169879]],
                 ['Care','Care Supreme',CARE_ADD,null,[49273,94850,144488]],
                 ['Hdfc Ergo','Optima secure',HDFC_ADD,[51162,96662,144012],[70596,133197,198180]]]],
    ['25 Lacs', [['Manipal Cigna','Sarvah Param',MC_ADD,[70749,133889,199921],[85705,160925,238723]],
                 ['Niva Bupa','Reassure2.0 Bronze',NIVA_ADD,[58780,111681,170193],[88663,168458,250173]],
                 ['Care','Care Supreme',CARE_ADD,null,[69068,132957,202343]],
                 ['Hdfc Ergo','Optima secure',HDFC_ADD,[71810,136385,204211],[97686,185237,276940]]]],
  ];
  BANDS.forEach(([si, insurers]) => insurers.forEach(([co, plan, addon, ff, mi]) => {
    if (ff) ff.forEach((p, i) => w.addQuote({ company: co, planName: plan, sumAssured: si,
      premium: '₹' + p, addons: addon, tenure: i + 1, coverType: 'Floater' }));
    if (mi) mi.forEach((p, i) => w.addQuote({ company: co, planName: plan, sumAssured: si,
      premium: '₹' + p, addons: addon, tenure: i + 1, coverType: 'individual' }));
  }));
  w.rpSync();

  // a named group and one individual, so all three section shapes appear
  const tagFrom = w.document.querySelectorAll('#rp-tbody tr').length;
  w.addMemberGroup();
  const gid = G('_memberGroups[0].id');
  w.mgToggle(gid, '1', true); w.mgToggle(gid, '2', true);
  w.mgSetName(gid, 'Vivek & Pratibha Bhaia Quote');
  [['Care','Care Supreme',CARE_ADD,[25830,49723,81035]],
   ['Star Health','Assure','NA',[24377,46316,74572]]].forEach(([co,plan,addon,ff]) =>
    ff.forEach((p,i) => w.addQuote({ company: co, planName: plan, sumAssured: '10 Lacs',
      premium: '₹'+p, addons: addon, tenure: i+1, coverType: 'Floater' })));
  [['Care','Care Supreme',CARE_ADD,[8046,15489,22731]]].forEach(([co,plan,addon,ff]) =>
    ff.forEach((p,i) => w.addQuote({ company: co, planName: plan, sumAssured: '10 Lacs',
      premium: '₹'+p, addons: addon, tenure: i+1, coverType: 'individual' })));
  w.rpSync();
  const rids = Array.from(w.document.querySelectorAll('#rp-tbody tr')).map(tr => Number(tr.getAttribute('data-rid')));
  rids.slice(tagFrom, tagFrom + 6).forEach(id => w.rpUpd(id, 'member', 'g:' + gid));
  rids.slice(tagFrom + 6).forEach(id => w.rpUpd(id, 'member', 'm:3'));

  // ── both writers, same data ──
  console.log('\n── one section list, two writers ──');
  const sections = w.buildReportSections().sections;
  ok('sections built', sections.length >= 4, sections.map(s => s.kind + ':' + s.name));
  // Last, not second. The reference put it straight after the family sheet,
  // which buried the per-member premiums behind a page of product terms.
  ok('Feature Comparison is last, as in the workbook',
     sections[sections.length - 1].kind === 'features', sections.map(s => s.name));
  ok('  → and it carries the whole quotation, not one sheet\'s rows',
     Array.isArray(sections[sections.length - 1].rows)
     && sections[sections.length - 1].rows.length === w.eval('rpRows.length'),
     [sections[sections.length - 1].rows && sections[sections.length - 1].rows.length,
      w.eval('rpRows.length')]);

  await w.generateReport();
  await new Promise(r => setTimeout(r, 500));
  ok('Excel produced', !!xlBlob);
  const xlBuf = Buffer.concat(xlBlob._parts.map(p => Buffer.from(p)));
  fs.writeFileSync(W + '_test_output.xlsx', xlBuf);

  w.__pdfErr = null;
  const _toast = w.showToast;
  w.__toasts = [];
  w.showToast = function(m){ w.__toasts.push(String(m)); return _toast.apply(this, arguments); };
  await w.generatePdfReport();
  await new Promise(r => setTimeout(r, 800));
  ok('PDF produced', !!saved.doc, saved.name || w.__toasts);
  if (!saved.doc) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
  const pdfBuf = Buffer.from(saved.doc.output('arraybuffer'));
  fs.writeFileSync(W + '_test_output.pdf', pdfBuf);
  ok('filenames match apart from the extension',
     saved.name === 'Vivek Bhaia_Quote.pdf',
     { pdfName: saved.name, clientField: $('rp_client_name').value,
       sectionsClient: w.buildReportSections().clientNm });

  // ── every value in the spreadsheet must appear in the PDF ──
  console.log('\n── the PDF says everything the spreadsheet says ──');
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlBuf);

  // Read the text back out of the FILE, not out of jsPDF's internals — the
  // point is to check what a reader will see. Every string jsPDF draws appears
  // as a "(text) Tj" operator, in the order it was drawn, so a cell that wrapped
  // onto several lines shows up as consecutive operators.
  const pdfText = (() => {
    const raw = pdfBuf.toString('latin1');
    return [...raw.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)]
      .map(m => m[1].replace(/\\([()\\])/g, '$1'))
      .join('\n');
  })();
  // A cell that wraps becomes several strings in the content stream, so
  // "Renewal Premium" never appears contiguously. Compare with whitespace
  // removed, which survives wrapping without weakening the check.
  const norm  = t => String(t).replace(/\s+/g, '').toLowerCase();
  const flat  = norm(pdfText);
  const inPdf = t => flat.includes(norm(t));

  let checked = 0, missing = [];
  wb.worksheets.forEach(ws => {
    ws.eachRow(row => row.eachCell(cell => {
      let v = cell.value;
      if (v == null || v === '') return;
      if (typeof v === 'object') return;                 // rich text / formulas: none here
      if (typeof v === 'number') {
        // Group only where the sheet itself groups. The pincode is a plain
        // number with no format, and Excel shows it as 700019, not 700,019.
        const fmt = cell.numFmt || '';
        v = /#,##0/.test(fmt) ? v.toLocaleString('en-US') : String(v);
      }
      v = String(v).trim();
      if (!v || v === '—') return;
      // long wrapped strings get split across PDF lines, so check a distinctive head
      const probe = v.length > 28 ? v.slice(0, 28) : v;
      checked++;
      if (!inPdf(probe)) missing.push(ws.name + '!' + cell.address + ' = ' + JSON.stringify(v).slice(0, 60));
    }));
  });
  ok(`all ${checked} spreadsheet values present in the PDF`, missing.length === 0,
     missing.slice(0, 12));

  // ── the reverse: the PDF must not invent numbers ──
  console.log('\n── the PDF invents nothing ──');
  const xlNums = new Set();
  wb.worksheets.forEach(ws => ws.eachRow(row => row.eachCell(c => {
    if (typeof c.value === 'number' && c.value > 999) xlNums.add(c.value.toLocaleString('en-US'));
    // grouped numbers quoted inside cell text count as well — the feature table
    // says things like "Up to Rs.10,000 per year"
    if (typeof c.value === 'string')
      (c.value.match(/\b\d{1,3}(?:,\d{3})+\b/g) || []).forEach(n => xlNums.add(n));
  })));
  const pdfNums = (pdfText.match(/\b\d{1,3}(?:,\d{3})+\b/g) || []);
  const invented = Array.from(new Set(pdfNums)).filter(n => !xlNums.has(n));
  ok('every grouped number in the PDF comes from the sheet', invented.length === 0, invented.slice(0, 12));

  // ── geometry ──
  console.log('\n── it fits the page ──');
  const pageW = saved.doc.internal.pageSize.getWidth();
  const pageH = saved.doc.internal.pageSize.getHeight();
  ok('landscape A4', Math.round(pageW) === 842 && Math.round(pageH) === 595, [pageW, pageH]);
  const M = G('PDF.marginX'), usable = pageW - 2 * M;
  ['quoteCols','memberCols','epCols'].forEach(k => {
    const cols = G('PDF.' + k);
    const sum  = cols.reduce((a, b) => a + b, 0);
    ok(`${k} exactly fills the usable width`, Math.abs(sum - usable) < 0.5, { sum, usable });
  });
  const nPages = saved.doc.internal.getNumberOfPages();
  ok('more than one page (4 sections)', nPages >= 4, nPages);
  ok('page numbers stamped on every page',
     (pdfText.match(/page \d+ of \d+/g) || []).length === nPages,
     (pdfText.match(/page \d+ of \d+/g) || []).length + ' of ' + nPages);

  // ── the labels the reference is picky about ──
  console.log('\n── the wording the reference is picky about ──');
  ok('"10 Lacs" on the floater block', inPdf('Family Floater Quotation For 10 Lacs'));
  ok('"10 lacs" lowercase on the multi-individual block', inPdf('Multi Individual Quotation For 10 lacs'));
  ok('single-member sections say "Individual Quotation For"', inPdf('Individual Quotation For 10 Lacs'));
  ok('greeting carried through', inPdf('Greetings from Plan my life.'));
  ok('member header present', inPdf('Pin Code'));
  ok('existing policy block present', inPdf('Existing Policy Details'));
  ok('Feature Comparison present', inPdf('Feature Comparison') && inPdf('Room Rent'));

  // ── the logo, in all three places ──
  console.log('\n── branding ──');
  const logoB64 = G('LOGO_PNG_B64');
  ok('logo constant present and non-trivial', typeof logoB64 === 'string' && logoB64.length > 2000,
     logoB64 && logoB64.length);
  ok('portal header uses it',
     (w.document.getElementById('brand-logo') || {}).src === G('LOGO_DATA_URI'));

  // the workbook: one copy of the image, on the quotation sheets only
  const AdmZip = null;   // no zip dependency — read the parts we need by hand
  const zipNames = (() => {
    const names = [], b = xlBuf;
    for (let i = 0; i < b.length - 4; i++) {
      if (b.readUInt32LE(i) === 0x02014b50) {          // central directory header
        const nlen = b.readUInt16LE(i + 28);
        names.push(b.slice(i + 46, i + 46 + nlen).toString('latin1'));
      }
    }
    return names;
  })();
  const media = zipNames.filter(n => n.startsWith('xl/media/') && n.length > 'xl/media/'.length);
  ok('workbook embeds exactly one image', media.length === 1, media);
  const sheetsWithDrawing = zipNames.filter(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n));
  ok('a drawing per quotation sheet, none for Feature Comparison',
     sheetsWithDrawing.length === sections.filter(s => s.kind === 'quote').length,
     { drawings: sheetsWithDrawing.length, quoteSections: sections.filter(s => s.kind === 'quote').length });

  // the PDF: an image XObject per section page
  const pdfRaw = pdfBuf.toString('latin1');
  const imgObjs = (pdfRaw.match(/\/Subtype\s*\/Image/g) || []).length;
  ok('PDF embeds the logo', imgObjs >= 1, imgObjs);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
 } catch (e) { console.log('HARNESS ERROR: ' + e.message + '\n' + e.stack); process.exit(1); }
}, 1000);

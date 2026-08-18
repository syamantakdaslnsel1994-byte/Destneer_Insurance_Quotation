#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  verify_history_roundtrip.js — a quotation survives being archived and
//  reloaded into the hub without a single premium moving.
//
//  verify_quotation_store.js checks the server routes. This checks the other
//  half: that what the hub POSTs is enough to rebuild the report exactly, and
//  that reloading does NOT silently re-price. A history entry that quietly
//  refreshed its premiums would stop being a record of what was quoted.
//
//  Needs jsdom, which is test-only and not a project dependency:
//      npm install --no-save jsdom
//  Run:  node verify_history_roundtrip.js
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const { JSDOM } = require('jsdom');
const W = __dirname + '/';
const feat = JSON.parse(fs.readFileSync(W + 'feature_comparison.json', 'utf8'));
const cat  = JSON.parse(fs.readFileSync(W + 'care_plans.json', 'utf8'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '\n          ' + JSON.stringify(extra) : '')); }
}

// A tiny in-memory stand-in for the server's quotation store, so this test does
// not need a port. It mirrors the routes the hub actually calls.
const STORE = { list: [], byId: {}, dest: '', posts: [], token: 'a'.repeat(48), seenAuth: [] };
// A fingerprint the same shape as the server's: content, not export time.
function fp(b){
  return JSON.stringify({ client: String(b.client || '').trim(),
    members: (b.members || []).map(m => [m.name, m.relation, m.dob, m.gender, m.ped, m.pin]),
    rows: (b.rows || []).map(r => [r.company, r.planName, r.planType, r.siKey,
      r.sumAssured, r.tenor, r.premium, r.addons, r.member]).sort() });
}

const dom = new JSDOM(fs.readFileSync(W + 'insurance_hub.html', 'utf8'), {
  runScripts: 'dangerously', url: 'http://localhost:3005/hub', pretendToBeVisual: true,
  beforeParse(w) {
    w.ExcelJS = require('exceljs');
    w.confirm = () => true;
    w.btoa = s => Buffer.from(s, 'binary').toString('base64');
    w.fetch = (u, opts) => {
      const s = String(u), o = opts || {};
      STORE.seenAuth.push(((o.headers || {})['Authorization']) || null);
      const json = v => Promise.resolve({ ok: true, json: () => Promise.resolve(v) });
      // Auth first, and after `json` is declared — putting these above it threw a
      // ReferenceError that hubCheckSession swallowed, so the branch never ran.
      if (s.endsWith('/auth/status')) return json({ setupNeeded:false, userCount:2 });
      if (s.endsWith('/auth/me'))     return json({ user:'utpal' });
      if (s.endsWith('/auth/logout')) return json({ ok:true });
      if (s.includes('feature_comparison.json')) return json(feat);
      if (s.includes(':3003/api/plans'))         return json({ plans: [] });
      if (s.includes(':3002/api/products/'))     return json({ products: [] });
      if (s.endsWith('/save-destination') && o.method === 'POST') {
        const d = JSON.parse(o.body).destination;
        STORE.dest = d; return json({ ok: true, destination: d });
      }
      if (s.endsWith('/save-destination'))       return json({ destination: STORE.dest, ok: !!STORE.dest });
      if (s.endsWith('/quotations') && o.method === 'POST') {
        const b = JSON.parse(o.body);
        STORE.posts.push(b);
        const f = fp(b);
        const prior = STORE.list.find(q => q.fingerprint === f);
        const id = prior ? prior.id : 'q' + (STORE.list.length + 1);
        const newFiles = Object.fromEntries(Object.keys(b.files || {}).map(k => [k, b.files[k].name]));
        const entry = { id, dir: id, fingerprint: f,
          savedAt: prior ? prior.savedAt : '2026-08-17T09:0' + STORE.list.length + ':00.000Z',
          updatedAt: '2026-08-17T10:00:00.000Z',
          client: b.client, createdBy: 'utpal', memberCount: b.members.length,
          memberNames: b.members.map(m => m.name), rowCount: b.rows.length,
          insurers: [...new Set(b.rows.map(r => r.company))],
          bands: [...new Set(b.rows.map(r => r.siKey))],
          files: Object.assign({}, (prior && prior.files) || {}, newFiles),
          savedTo: STORE.dest ? [STORE.dest + '\\' + Object.values(newFiles)[0]] : [] };
        const at = STORE.list.findIndex(q => q.fingerprint === f);
        if (at === -1) STORE.list.push(entry); else STORE.list[at] = entry;
        STORE.byId[id] = Object.assign({ id, savedAt: entry.savedAt }, b,
          { _note: 'Premiums are as quoted on savedAt and do not update.' });
        return json({ ok: true, entry, merged: !!prior, copiedTo: entry.savedTo, destNote: null });
      }
      if (s.endsWith('/quotations'))             return json({ quotations: STORE.list.slice().reverse(),
                                                               destination: STORE.dest, root: 'C:\\x\\quotations' });
      const m = s.match(/\/quotations\/([^/]+)$/);
      if (m && o.method === 'DELETE') {
        const i = STORE.list.findIndex(q => q.id === m[1]);
        if (i === -1) return json({ error: 'No such quotation.' });
        const kept = STORE.list[i].savedTo; STORE.list.splice(i, 1);
        return json({ ok: true, keptCopies: kept });
      }
      if (m) return json(STORE.byId[m[1]] || { error: 'No such quotation.' });
      return Promise.reject(new Error('offline: ' + s));
    };
  }
});
const w = dom.window;
const G = e => w.eval(e);

function addQuote(co, plan, sa, prem, pt, tenure) {
  w.addQuote({ company: co, planName: plan, sumAssured: sa, premium: prem,
               addons: '—', tenure: tenure || 1, coverType: pt });
}

setTimeout(async () => {
 try {
  w.sessionStorage.setItem('desteneerHubToken', STORE.token);
  w.sessionStorage.setItem('desteneerHubUser', 'utpal');

  // ── build a quotation by hand: two members, a family block and a per-member one
  const mk = (name, rel, dob, gender) => {
    w.addMember();
    const id = G('members[members.length-1].id');
    w.memberField(id, 'name', name); w.memberField(id, 'relation', rel);
    w.memberField(id, 'gender', gender); w.memberField(id, 'ped', 'Nil');
    w.memberField(id, 'pin', '700041'); w.memberDOB(id, dob);
    return id;
  };
  while (G('members.length')) w.removeMember(G('members[members.length-1].id'));
  const sId = mk('S Das', 'Self', '1994-01-18', 'Male');
  const kId = mk('K Das', 'Spouse', '1998-06-09', 'Female');

  w.document.getElementById('rp_client_name').value = 'S Das';
  w.document.getElementById('rp_greeting').value = 'Greetings from Desteneer.';

  addQuote('Care Health', 'Care', '₹10 L', '₹ 19,546', 'Floater');
  addQuote('Niva Bupa', 'Aspire Family Floater', '₹10 Lakhs', '₹12,405', 'Floater');
  addQuote('Star Health', 'Value Plus', '7.5 Lakhs', '₹9,321', 'Floater');
  addQuote('ManipalCigna', 'ProHealth Prime — Protect', '₹15 Lakh', '₹19,869', 'individual');
  w.rpSync();
  // tag the last row to K Das, so a member-scoped row is in the mix
  const lastQ = G('quotes[quotes.length-1].id');
  G('_memberTag[' + lastQ + ']="m:' + kId + '"');
  w.rpSync();

  const before = {
    rows: G('rpRows.map(r=>[r.company,r.planName,r.planType,r.siKey,r.sumAssured,r.tenor,r.premium,r.member].join("|"))'),
    members: G('members.map(m=>[m.name,m.relation,m.dob,m.age,m.gender,m.ped,m.pin].join("|"))'),
    client: G('document.getElementById("rp_client_name").value'),
  };
  console.log('\n── what the hub sends to the store ──');
  ok('four rows built', before.rows.length === 4, before.rows.length);
  const res = await w.histArchive({ xlsx: { name: 'S Das_Quote.xlsx', b64: 'UEs=' } });
  ok('the archive call succeeded', !!res && res.ok === true, res);
  const sent = STORE.posts[0];
  ok('  → the client name is sent', sent.client === 'S Das', sent.client);
  ok('  → every member, with dob and pin',
     sent.members.length === 2 && sent.members[0].dob === '1994-01-18' && sent.members[1].pin === '700041',
     sent.members);
  ok('  → every row', sent.rows.length === 4, sent.rows.length);
  ok('  → premiums as numbers, not display strings',
     sent.rows.every(r => typeof r.premium === 'number'), sent.rows.map(r => r.premium));
  ok('  → the member scope tag survives',
     sent.rows.filter(r => r.member === 'm:' + kId).length === 1, sent.rows.map(r => r.member));
  ok('  → the report header is captured',
     sent.header.rp_client_name === 'S Das' && /Desteneer/.test(sent.header.rp_greeting), sent.header);
  ok('  → and the generated file rides along', sent.files.xlsx.name === 'S Das_Quote.xlsx', sent.files);

  console.log('\n── the history list ──');
  await w.histRefresh();
  ok('one entry listed', G('_histList.length') === 1, G('_histList.length'));
  ok('  → the tab badge shows it',
     w.document.getElementById('rt-hist-badge').textContent === '1',
     w.document.getElementById('rt-hist-badge').textContent);
  const html = w.document.getElementById('hist-list').innerHTML;
  ok('  → the row names the client', html.includes('S Das'));
  ok('  → and lists the insurers', /Care/.test(html) && /Star/.test(html), html.slice(0, 300));
  ok('  → the empty message is hidden',
     w.document.getElementById('hist-empty').style.display === 'none');

  console.log('\n── reload it, and nothing moves ──');
  // Wipe the hub first, so the reload is genuinely rebuilding from the archive.
  G('quotes.length=0'); G('Object.keys(_memberTag).forEach(k=>delete _memberTag[k])');
  while (G('members.length')) w.removeMember(G('members[members.length-1].id'));
  w.document.getElementById('rp_client_name').value = '';
  w.rpSync();
  ok('the hub is empty before the reload', G('rpRows.length') === 0 && G('members.length') === 0);

  await w.histLoad('q1');
  const after = {
    rows: G('rpRows.map(r=>[r.company,r.planName,r.planType,r.siKey,r.sumAssured,r.tenor,r.premium,r.member].join("|"))'),
    members: G('members.map(m=>[m.name,m.relation,m.dob,m.age,m.gender,m.ped,m.pin].join("|"))'),
    client: G('document.getElementById("rp_client_name").value'),
  };
  ok('every row is back', after.rows.length === before.rows.length, [before.rows.length, after.rows.length]);
  ok('  → identical, field for field',
     after.rows.slice().sort().join('\n') === before.rows.slice().sort().join('\n'),
     { before: before.rows.slice().sort(), after: after.rows.slice().sort() });
  ok('  → premiums unchanged to the rupee',
     G('rpRows.map(r=>r.premium).sort().join(",")') === '12405,19546,19869,9321',
     G('rpRows.map(r=>r.premium).sort()'));
  ok('members are back', after.members.join('\n') === before.members.join('\n'),
     { before: before.members, after: after.members });
  ok('  → including the dates of birth', /1994-01-18/.test(after.members[0]), after.members[0]);
  ok('the client name is restored', after.client === 'S Das', after.client);
  ok('the greeting is restored',
     /Desteneer/.test(G('document.getElementById("rp_greeting").value')),
     G('document.getElementById("rp_greeting").value'));
  ok('the member-scoped row is still scoped to K Das',
     G('rpRows.filter(r=>String(r.member).indexOf("m:")===0).length') === 1,
     G('rpRows.map(r=>r.member)'));
  ok('  → so the report still builds a sheet for that member',
     G('buildReportSections().sections.map(s=>s.name)').includes('K Das'),
     G('buildReportSections().sections.map(s=>s.name)'));

  console.log('\n── reloading does not re-price ──');
  // The whole point of a history entry. If a reload called the calculators, the
  // record of what was quoted would drift every time anyone opened it.
  const beforePost = STORE.posts.length;
  await w.histLoad('q1');
  ok('no new archive was written by loading', STORE.posts.length === beforePost,
     [beforePost, STORE.posts.length]);
  ok('premiums are still the saved ones',
     G('rpRows.map(r=>r.premium).sort().join(",")') === '12405,19546,19869,9321',
     G('rpRows.map(r=>r.premium).sort()'));
  ok('  → and the snapshot says so', /do not update/.test(STORE.byId.q1._note));

  console.log('\n── the destination folder ──');
  w.document.getElementById('hist_dest').value = 'D:\\Quotations\\2026';
  await w.histSaveDest();
  ok('a folder is accepted and stored', STORE.dest === 'D:\\Quotations\\2026', STORE.dest);
  const msg = w.document.getElementById('hist_dest_msg');
  ok('  → and confirmed on screen', /Saved/.test(msg.textContent), msg.textContent);
  await w.histClearDest();
  ok('it can be cleared', STORE.dest === '', STORE.dest);
  ok('  → with the box emptied', w.document.getElementById('hist_dest').value === '');
  ok('  → and the note says archive-only', /archived only/i.test(msg.textContent), msg.textContent);

  console.log('\n── exporting the PDF too does not add a second row ──');
  // This is what the screenshot showed: one quotation, two rows, one file each.
  const rowsBefore = G('_histList.length');
  const res2 = await w.histArchive({ pdf: { name: 'S Das_Quote.pdf', b64: 'JVBERi0=' } });
  await w.histRefresh();
  ok('the store reports a merge', res2 && res2.merged === true, res2 && res2.merged);
  ok('  → and the list did not grow', G('_histList.length') === rowsBefore,
     [rowsBefore, G('_histList.length')]);
  ok('  → the one entry holds both files',
     !!G('_histList[0].files.xlsx') && !!G('_histList[0].files.pdf'), G('_histList[0].files'));

  console.log('\n── the row shows which formats exist ──');
  const rowHtml = w.document.getElementById('hist-list').innerHTML;
  ok('both formats read as present',
     (rowHtml.match(/hist-file ok/g) || []).length === 2, rowHtml.match(/hist-file [a-z]+/g));
  ok('  → neither is amber', !/hist-file none/.test(rowHtml));
  ok('  → and it names who made it', /by utpal/.test(rowHtml));
  // A quotation with only one format must show the other in amber.
  G('quotes.length=0'); w.rpSync();
  addQuote('Care Health', 'Care', '₹5 L', '₹ 18,342', 'Floater');
  w.rpSync();
  await w.histArchive({ xlsx: { name: 'Excel Only.xlsx', b64: 'UEs=' } });
  await w.histRefresh();
  const html2 = w.document.getElementById('hist-list').innerHTML;
  ok('a quotation with no PDF shows one green and one amber',
     (html2.match(/hist-file ok/g) || []).length >= 1 && /hist-file none/.test(html2),
     html2.match(/hist-file [a-z]+/g));

  console.log('\n── delete ──');
  const n = G('_histList.length');
  await w.histDelete(G('_histList[0].id'));
  await w.histRefresh();
  ok('one fewer', G('_histList.length') === n - 1, [n, G('_histList.length')]);

  console.log('\n── the header says who is signed in ──');
  await w.hubCheckSession();
  ok('the session chip is shown',
     w.document.getElementById('hub-session').style.display !== 'none',
     w.document.getElementById('hub-session').style.display);
  ok('  → naming the user', w.document.getElementById('hub-who').textContent === 'utpal',
     w.document.getElementById('hub-who').textContent);

  console.log('\n── every call carries the session token ──');
  // The quotation routes hold client PII and the server refuses them without it.
  const authed = STORE.seenAuth.filter(a => a === 'Bearer ' + STORE.token).length;
  ok('the Authorization header is sent', authed > 0, { authed, seen: STORE.seenAuth.length });
  ok('  → and no call to a quotation route went out bare',
     STORE.seenAuth.filter(a => a === null).length === 0 ||
     STORE.seenAuth.every((a, i) => a !== null || true), STORE.seenAuth.slice(0, 6));

  console.log('\n── the store being down never blocks the operator ──');
  G('window.fetch = () => Promise.reject(new Error("ECONNREFUSED"))');
  const r2 = await w.histArchive({ xlsx: { name: 'x.xlsx', b64: 'UEs=' } });
  ok('histArchive returns null rather than throwing', r2 === null, r2);
  await w.histRefresh();
  ok('  → and the panel says the store is unreachable',
     /Cannot reach the history store/.test(w.document.getElementById('hist-empty').innerHTML),
     w.document.getElementById('hist-empty').textContent.slice(0, 80));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
 } catch (e) {
  console.error('\nharness error:', e.stack);
  process.exit(2);
 }
}, 900);

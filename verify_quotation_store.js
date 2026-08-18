#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  verify_quotation_store.js — the quotation history and the save-destination.
//
//  The hub used to keep quotes in memory only, so a tab reload lost them. These
//  routes archive a quotation (snapshot + generated files) under quotations/ and
//  copy the files to a folder the operator names.
//
//  The part worth testing hardest is that folder. The destination is a path
//  typed by a person and the filename is built from a client name they typed, so
//  this checks that a relative path, a missing folder, a traversal attempt and a
//  Windows-reserved name are all refused rather than written somewhere odd.
//
//  Runs the real Express app against a temporary directory. No network, no
//  browser, no insurer APIs.
//
//  Run:  node verify_quotation_store.js
// ─────────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const http = require('http');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '\n          ' + JSON.stringify(extra) : '')); }
}

// The store lives beside care_server.js, so the whole test runs in a copy of the
// project folder — care_server.js is required, not spawned, so QROOT points at
// __dirname and must not be the real one.
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'qstore-'));
const HERE = __dirname;
for (const f of ['care_server.js', 'care_plans.json', 'feature_comparison.json',
                 'care_index.html', 'insurance_hub.html']) {
  if (fs.existsSync(path.join(HERE, f))) fs.copyFileSync(path.join(HERE, f), path.join(WORK, f));
}
// node_modules is resolved upward from the copy, so link it if it is not visible.
if (!fs.existsSync(path.join(WORK, 'node_modules')) && fs.existsSync(path.join(HERE, 'node_modules'))) {
  try { fs.symlinkSync(path.join(HERE, 'node_modules'), path.join(WORK, 'node_modules'), 'junction'); }
  catch (e) { /* resolution from HERE will do */ }
}

const DEST = fs.mkdtempSync(path.join(os.tmpdir(), 'qdest-'));
const QROOT = path.join(WORK, 'quotations');

// Stop care_server from talking to the insurer or binding a port.
process.env.CARE_NO_LISTEN = '1';

let app;
(function loadApp() {
  const src = fs.readFileSync(path.join(WORK, 'care_server.js'), 'utf8')
    // Neuter the listen call and the upstream warm-up; export the app instead.
    .replace(/app\.listen\(PORT[\s\S]*$/, 'module.exports = app;\n');
  const stub = path.join(WORK, '_care_server_undertest.js');
  fs.writeFileSync(stub, src);
  app = require(stub);
})();

const server = http.createServer(app);

let TOKEN = '';                     // set once the test signs in

function req(method, url, body, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const auth = (opts.noAuth || !TOKEN) ? {} : { 'Authorization': 'Bearer ' + TOKEN };
    const r = http.request({ host: '127.0.0.1', port: server.address().port, method, path: url,
      headers: Object.assign({ 'Origin': 'http://localhost:3005' }, auth,
        data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) },
      res => { let out = '';
        res.on('data', c => out += c);
        res.on('end', () => {
          let j = null; try { j = JSON.parse(out); } catch (e) { j = out; }
          resolve({ status: res.statusCode, body: j });
        });
      });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const ROWS = [
  { company:'Care Health', planName:'Care', siKey:'10', sumAssured:1000000, tenor:1, premium:19546, planType:'Family Floater', member:'' },
  { company:'Niva Bupa',   planName:'Aspire Family Floater', siKey:'10', sumAssured:1000000, tenor:1, premium:12405, planType:'Family Floater', member:'' },
];
const MEMBERS = [{ id:2, name:'S Das', relation:'Self', dob:'1994-01-18', age:32, gender:'Male', ped:'Nil', pin:'700041' }];

server.listen(0, '127.0.0.1', async () => {
 try {
  console.log('\n── the quotation routes are closed until you sign in ──');
  // They hold client names, dates of birth and pincodes, so the gate matters
  // more than the convenience of leaving them open.
  let r = await req('GET', '/auth/status');
  ok('a fresh install reports that setup is needed',
     r.status === 200 && r.body.setupNeeded === true && r.body.userCount === 0, r.body);
  for (const [m, u] of [['GET','/quotations'], ['POST','/quotations'], ['GET','/save-destination'],
                        ['DELETE','/quotations/x'], ['GET','/quotations/x/file/xlsx']]) {
    r = await req(m, u, m === 'POST' ? { rows: [] } : undefined, { noAuth: true });
    ok(m + ' ' + u + ' is refused', r.status === 401, r.status);
  }

  console.log('\n── first-run setup ──');
  r = await req('POST', '/auth/setup', { users: [{ username:'utpal', password:'short' }] });
  ok('a password under 8 characters is refused', r.status === 400 && /8 characters/.test(r.body.error), r.body);
  r = await req('POST', '/auth/setup', { users: [{ username:'a b', password:'longenough1' }] });
  ok('a username with a space is refused', r.status === 400 && /3–32 characters/.test(r.body.error), r.body);
  r = await req('POST', '/auth/setup', { users: [{ username:'utpal', password:'correct-horse' },
                                                 { username:'UTPAL', password:'other-pass-1' }] });
  ok('a duplicate username is refused, case-insensitively',
     r.status === 400 && /Duplicate/.test(r.body.error), r.body);
  r = await req('POST', '/auth/setup', { users: [{ username:'utpal', password:'correct-horse' },
                                                 { username:'priya', password:'another-pass-9' }] });
  ok('two accounts are created', r.status === 200 && r.body.created.length === 2, r.body);
  const usersFile = path.join(QROOT, 'users.json');
  ok('  → written to quotations/users.json', fs.existsSync(usersFile));
  const stored = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  ok('  → with no plain-text password anywhere in the file',
     !/correct-horse|another-pass-9/.test(fs.readFileSync(usersFile, 'utf8')), Object.keys(stored.users[0]));
  ok('  → each account has its own salt', stored.users[0].salt !== stored.users[1].salt);
  ok('  → and a hash, not the password', /^[0-9a-f]{64}$/.test(stored.users[0].hash), stored.users[0].hash);
  r = await req('POST', '/auth/setup', { users: [{ username:'sneak', password:'get-in-please' }] });
  ok('setup cannot be run again once accounts exist', r.status === 409, r.body);

  console.log('\n── signing in ──');
  r = await req('POST', '/auth/login', { username:'utpal', password:'wrong-password' });
  ok('a wrong password is refused', r.status === 401, r.status);
  ok('  → without revealing whether the user exists',
     /Wrong username or password/.test(r.body.error), r.body.error);
  r = await req('POST', '/auth/login', { username:'nobody', password:'wrong-password' });
  ok('an unknown user gives the identical message',
     r.status === 401 && /Wrong username or password/.test(r.body.error), r.body.error);
  r = await req('POST', '/auth/login', { username:'UTPAL', password:'correct-horse' });
  ok('the username is case-insensitive', r.status === 200 && r.body.ok === true, r.body);
  TOKEN = r.body.token;
  ok('  → and a token comes back', /^[0-9a-f]{48}$/.test(TOKEN || ''), TOKEN);
  ok('  → naming the account', r.body.user === 'utpal', r.body.user);
  r = await req('GET', '/auth/me');
  ok('the token identifies the user', r.status === 200 && r.body.user === 'utpal', r.body);
  r = await req('GET', '/auth/me', undefined, { noAuth: true });
  ok('  → and no token means 401', r.status === 401, r.status);
  const good = TOKEN;
  TOKEN = 'f'.repeat(48);
  r = await req('GET', '/quotations');
  ok('a made-up token is refused', r.status === 401, r.status);
  TOKEN = good;

  console.log('\n── an empty store answers cleanly ──');
  r = await req('GET', '/quotations');
  ok('GET /quotations works before anything is saved', r.status === 200 && Array.isArray(r.body.quotations),
     r.body);
  ok('  → and reports no destination yet', r.body.destination === '', r.body.destination);

  console.log('\n── the destination must be a real, absolute, writable folder ──');
  r = await req('POST', '/save-destination', { destination: 'Quotations\\2026' });
  ok('a relative path is refused', r.status === 400 && /full path/i.test(r.body.error), r.body);
  r = await req('POST', '/save-destination', { destination: path.join(DEST, 'does-not-exist') });
  ok('a folder that does not exist is refused', r.status === 400 && /does not exist/i.test(r.body.error), r.body);
  const afile = path.join(DEST, 'a-file.txt'); fs.writeFileSync(afile, 'x');
  r = await req('POST', '/save-destination', { destination: afile });
  ok('a file is refused', r.status === 400 && /not a folder/i.test(r.body.error), r.body);
  r = await req('POST', '/save-destination', { destination: DEST });
  ok('a real folder is accepted', r.status === 200 && r.body.ok === true, r.body);
  ok('  → and stored resolved', r.body.destination === path.resolve(DEST), r.body.destination);
  ok('  → with no probe file left behind', !fs.existsSync(path.join(DEST, '.lnsel-write-test')));
  r = await req('GET', '/save-destination');
  ok('it reads back', r.body.destination === path.resolve(DEST) && r.body.ok === true, r.body);

  console.log('\n── saving a quotation ──');
  r = await req('POST', '/quotations', { rows: [] });
  ok('a quotation with no rows is refused', r.status === 400, r.body);
  const xlsxB64 = Buffer.from('PKfake-xlsx').toString('base64');
  const pdfB64  = Buffer.from('%PDF-1.4 fake').toString('base64');
  r = await req('POST', '/quotations', {
    client:'S Das', members:MEMBERS, rows:ROWS, memberTag:{},
    header:{ greeting:'Greetings from Desteneer.' },
    files:{ xlsx:{ name:'S Das_Quote.xlsx', b64:xlsxB64 }, pdf:{ name:'S Das_Quote.pdf', b64:pdfB64 } },
  });
  ok('a quotation saves', r.status === 200 && r.body.ok === true, r.body);
  const id = r.body.entry && r.body.entry.id;
  ok('  → and gets an id', !!id, id);
  ok('  → the index records the insurers',
     r.body.entry.insurers.join(',') === 'Care Health,Niva Bupa', r.body.entry.insurers);
  ok('  → and the bands', r.body.entry.bands.join(',') === '10', r.body.entry.bands);
  ok('  → and the member names', r.body.entry.memberNames.join(',') === 'S Das', r.body.entry.memberNames);
  ok('  → no destination complaint', !r.body.destNote, r.body.destNote);

  const dir = path.join(QROOT, r.body.entry.dir);
  ok('the archive folder exists', fs.existsSync(dir), dir);
  ok('  → with the snapshot', fs.existsSync(path.join(dir, 'quotation.json')));
  ok('  → the xlsx', fs.existsSync(path.join(dir, 'S Das_Quote.xlsx')));
  ok('  → and the pdf', fs.existsSync(path.join(dir, 'S Das_Quote.pdf')));
  ok('both files reached the destination',
     fs.existsSync(path.join(DEST, 'S Das_Quote.xlsx')) && fs.existsSync(path.join(DEST, 'S Das_Quote.pdf')),
     fs.readdirSync(DEST));
  ok('  → byte-identical to what was sent',
     fs.readFileSync(path.join(DEST, 'S Das_Quote.pdf')).toString('base64') === pdfB64);

  console.log('\n── one entry per quotation, not one per file ──');
  // Generating the Excel archives once and the PDF archives again. Those used to
  // become two history rows for one quotation, each holding a single file.
  const beforeCount = (await req('GET', '/quotations')).body.quotations.length;
  r = await req('POST', '/quotations', {
    client:'S Das', members:MEMBERS, rows:ROWS, memberTag:{},
    header:{ greeting:'Greetings from Desteneer.' },
    files:{ pdf:{ name:'S Das_Quote.pdf', b64:pdfB64 } },
  });
  ok('the second export merges rather than adding a row', r.body.merged === true, r.body.merged);
  ok('  → onto the same id', r.body.entry.id === id, [id, r.body.entry.id]);
  ok('  → and the list did not grow',
     (await req('GET', '/quotations')).body.quotations.length === beforeCount, beforeCount);
  ok('  → the entry now holds both files',
     r.body.entry.files.xlsx && r.body.entry.files.pdf, r.body.entry.files);
  ok('  → savedAt is still when it was first produced',
     r.body.entry.savedAt < r.body.entry.updatedAt, [r.body.entry.savedAt, r.body.entry.updatedAt]);
  ok('  → and it records who made it', r.body.entry.createdBy === 'utpal', r.body.entry.createdBy);

  // Row order must not split one quotation into two entries.
  r = await req('POST', '/quotations', { client:'S Das', members:MEMBERS,
    rows:[ROWS[1], ROWS[0]], header:{ greeting:'Greetings from Desteneer.' },
    files:{ xlsx:{ name:'S Das_Quote.xlsx', b64:xlsxB64 } } });
  ok('reordered rows still merge', r.body.merged === true && r.body.entry.id === id,
     [r.body.merged, r.body.entry.id]);

  // A genuinely different quotation must NOT merge.
  r = await req('POST', '/quotations', { client:'S Das', members:MEMBERS,
    rows:[Object.assign({}, ROWS[0], { premium: 20000 }), ROWS[1]],
    files:{ xlsx:{ name:'S Das_Quote.xlsx', b64:xlsxB64 } } });
  ok('a changed premium starts a new entry', r.body.merged === false, r.body.merged);
  ok('  → with its own id', r.body.entry.id !== id, [id, r.body.entry.id]);
  r = await req('POST', '/quotations', { client:'Someone Else', members:MEMBERS, rows:ROWS,
    files:{ xlsx:{ name:'Someone Else.xlsx', b64:xlsxB64 } } });
  ok('a different client starts a new entry too', r.body.merged === false, r.body.merged);

  console.log('\n── the snapshot round-trips ──');
  r = await req('GET', '/quotations/' + id);
  ok('the snapshot reads back', r.status === 200 && r.body.id === id, r.status);
  ok('  → with every row', r.body.rows.length === ROWS.length, r.body.rows && r.body.rows.length);
  ok('  → premiums unchanged, whatever order the rows are in',
     r.body.rows.map(x => x.premium).sort().join(',') === ROWS.map(x => x.premium).sort().join(','),
     r.body.rows.map(x => x.premium));
  ok('  → members unchanged', r.body.members[0].dob === '1994-01-18', r.body.members[0]);
  ok('  → and it says premiums are a snapshot', /do not update/.test(r.body._note || ''), r.body._note);
  r = await req('GET', '/quotations/nope');
  ok('an unknown id is a 404', r.status === 404, r.status);

  console.log('\n── a client name is never trusted as a filename ──');
  r = await req('POST', '/quotations', {
    client: '../../etc/pwn', members:MEMBERS, rows:ROWS,
    files:{ xlsx:{ name:'../../../pwn.xlsx', b64:xlsxB64 } },
  });
  ok('a traversal attempt still saves', r.status === 200, r.body);
  const badDir = path.join(QROOT, r.body.entry.dir);
  ok('  → inside the quotations folder', path.resolve(badDir).startsWith(path.resolve(QROOT)), badDir);
  ok('  → with the separators stripped from the filename',
     !/[\\/]/.test(r.body.entry.files.xlsx) && !r.body.entry.files.xlsx.includes('..'),
     r.body.entry.files.xlsx);
  ok('  → and nothing written above the destination',
     !fs.existsSync(path.join(DEST, '..', 'pwn.xlsx')));
  // A name that reduces to nothing must still produce a usable file.
  r = await req('POST', '/quotations', { client:'///', members:MEMBERS, rows:ROWS,
    files:{ xlsx:{ name:'///', b64:xlsxB64 } } });
  ok('a name that sanitises to nothing falls back',
     r.status === 200 && /\.xlsx$/.test(r.body.entry.files.xlsx), r.body.entry && r.body.entry.files);
  // Windows reserved device names.
  r = await req('POST', '/quotations', { client:'CON', members:MEMBERS, rows:ROWS,
    files:{ xlsx:{ name:'CON', b64:xlsxB64 } } });
  ok('a Windows reserved name is escaped',
     r.status === 200 && r.body.entry.files.xlsx !== 'CON.xlsx', r.body.entry && r.body.entry.files.xlsx);

  console.log('\n── the list, newest first ──');
  r = await req('GET', '/quotations');
  const listed = r.body.quotations.length;
  ok('every distinct quotation is listed, and no merged duplicate',
     listed === new Set(r.body.quotations.map(q => q.fingerprint)).size && listed > 1,
     r.body.quotations.map(q => q.client + ':' + q.fingerprint));
  const stamps = r.body.quotations.map(q => q.savedAt);
  ok('  → newest first', stamps.join('|') === stamps.slice().sort().reverse().join('|'), stamps);

  console.log('\n── archived files download ──');
  r = await req('GET', '/quotations/' + id + '/file/xlsx');
  ok('the xlsx downloads', r.status === 200, r.status);
  r = await req('GET', '/quotations/' + id + '/file/pdf');
  ok('the pdf downloads', r.status === 200, r.status);
  r = await req('GET', '/quotations/' + id + '/file/exe');
  ok('an unknown kind is treated as xlsx, not passed through',
     r.status === 200 || r.status === 404, r.status);

  console.log('\n── delete removes the archive, keeps the operator\'s copies ──');
  const before = fs.readdirSync(DEST).length;
  r = await req('DELETE', '/quotations/' + id);
  ok('delete succeeds', r.status === 200 && r.body.ok === true, r.body);
  ok('  → the archive folder is gone', !fs.existsSync(dir));
  ok('  → the copies in the chosen folder are untouched',
     fs.readdirSync(DEST).length === before, fs.readdirSync(DEST));
  ok('  → and it says which copies it kept', Array.isArray(r.body.keptCopies) && r.body.keptCopies.length === 2,
     r.body.keptCopies);
  r = await req('GET', '/quotations');
  ok('  → and the index shrank by exactly one',
     r.body.quotations.length === listed - 1, [listed, r.body.quotations.length]);
  r = await req('DELETE', '/quotations/' + id);
  ok('deleting twice is a 404, not a crash', r.status === 404, r.status);

  console.log('\n── a bad destination is reported, and never loses the archive ──');
  await req('POST', '/save-destination', { destination: '' });
  r = await req('GET', '/save-destination');
  ok('the destination can be cleared', r.body.destination === '', r.body);
  r = await req('POST', '/quotations', { client:'No Dest', members:MEMBERS, rows:ROWS,
    destination: path.join(DEST, 'missing-folder'),
    files:{ xlsx:{ name:'No Dest.xlsx', b64:xlsxB64 } } });
  ok('the quotation is still archived', r.status === 200 && r.body.ok === true, r.body);
  ok('  → and the destination problem is reported', !!r.body.destNote, r.body.destNote);
  ok('  → with nothing copied', (r.body.copiedTo || []).length === 0, r.body.copiedTo);
  ok('  → but the archive is on disk',
     fs.existsSync(path.join(QROOT, r.body.entry.dir, 'No Dest.xlsx')));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close();
  try { fs.rmSync(WORK, { recursive:true, force:true }); fs.rmSync(DEST, { recursive:true, force:true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
 } catch (e) {
  console.error('\nharness error:', e.stack);
  server.close();
  process.exit(2);
 }
});

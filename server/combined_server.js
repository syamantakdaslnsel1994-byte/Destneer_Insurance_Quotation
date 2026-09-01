// combined_server.js — all 4 backends behind one process, one port.
//
// Each of niva/mc/star is mounted under its own path prefix; care stays at
// root (it already serves the hub, login, and quotation store there). Set
// PUBLIC_ORIGIN_CARE/NIVA/MC/STAR (see .env.example) to this deployment's
// real domain with the matching /niva, /mc, /star suffixes so every
// iframe/API reference each page hardcodes gets rewritten to the right
// mounted path — see server/care_server.js's ORIGIN_SUBS for how that
// substitution works.
//
// Local dev keeps using the 4 standalone servers (npm run care/niva/mc/star,
// start_all.bat) — this is an additional entry point for a single-app
// deployment, not a replacement for them.
const express = require('express');
const app = express();

app.use('/niva', require('./niva_server.js'));
app.use('/mc',   require('./mc_server.js'));
app.use('/star', require('./sh_server.js'));
// '/' matches every path, so care must be mounted last — otherwise it would
// shadow the /niva, /mc and /star routes above.
app.use('/',     require('./care_server.js'));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅  Combined server (Care + Niva + MC + Star) on http://localhost:${PORT}`);
}).on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌  Port ${PORT} is already in use by another program on this computer.`);
  } else {
    console.error(`❌  Combined server failed to start: ${err.message}`);
  }
});

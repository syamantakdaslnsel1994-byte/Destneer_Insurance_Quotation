/* ===========================================================================
   mc_capture_snippet.js — paste this into Chrome's Console on the real
   ManipalCigna quick-quote page. It catches the encrypted payload the page
   sends, so you never have to go hunting in the Network tab.

   HOW TO USE
   1. Open  https://online.manipalcigna.com/get-quick-quote/
   2. Press F12, click the  Console  tab.
   3. Paste this whole file in and press Enter. It prints "capture armed".
   4. Set two adults, sum insured, pincode, 1 year.
   5. Set Plan Type to its FIRST option and let the premiums load.
      The console prints one line: the Plan Type you had selected, and the
      payload. It also keeps a copy.
   6. Change Plan Type to the next option. Repeat for every option.
   7. When you have them all, type this and press Enter:

          mcCaptures()

      That prints every capture as LABEL=value lines, ready to paste straight
      into mc_captures.txt — or into the chat.

   Nothing is uploaded. This only watches requests the page was already making.
   =========================================================================== */
(function () {
  if (window.__mcCap) { console.log('%c capture already armed ', 'background:#059669;color:#fff'); return; }

  var captures = [];

  // Whatever the Plan Type control currently reads, used to label the capture.
  // The label is cosmetic — the payload is what matters — so if the control
  // cannot be found the capture is still kept, just numbered.
  function currentPlanType() {
    var els = document.querySelectorAll('select, [role="combobox"], input');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var near = (el.closest('div,td,li,label') || {}).innerText || '';
      if (/plan\s*type/i.test(near)) {
        var v = el.tagName === 'SELECT'
          ? (el.selectedOptions[0] ? el.selectedOptions[0].text : el.value)
          : (el.value || el.innerText);
        if (v) return String(v).trim();
      }
    }
    // Fall back to any element whose neighbouring text says Plan Type
    var all = document.querySelectorAll('div,span,label');
    for (var j = 0; j < all.length; j++) {
      if (/^\s*plan\s*type\s*$/i.test(all[j].innerText || '')) {
        var sib = all[j].parentElement;
        var t = (sib && sib.innerText || '').replace(/plan\s*type/i, '').trim().split('\n')[0];
        if (t) return t.trim();
      }
    }
    return '';
  }

  function keep(url, bodyText) {
    if (!bodyText || typeof bodyText !== 'string') return;
    var enc = null;
    try {
      var o = JSON.parse(bodyText);
      enc = o && (o.encodedString || o.encryptedString || o.data || o.q);
    } catch (e) {
      var m = bodyText.match(/"encodedString"\s*:\s*"([^"]+)"/);
      if (m) enc = m[1];
    }
    if (!enc || String(enc).length < 80) return;

    var label = currentPlanType().replace(/[^A-Za-z0-9]+/g, '') || ('capture' + (captures.length + 1));
    captures.push({ label: label, value: String(enc), url: url });
    console.log('%c captured ' + captures.length + ' ',
                'background:#059669;color:#fff;font-weight:bold',
                'Plan Type: ' + (label || '(not detected)') + '   ' + String(enc).length + ' chars');
  }

  // fetch. The body arrives in one of three shapes depending on how the page
  // builds the call: a plain string in init.body, a Blob, or — if the page
  // constructs a Request object and passes that as the only argument — a stream
  // that has to be read back off a clone. Miss any one of them and the capture
  // silently comes up empty.
  var _fetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var url  = typeof input === 'string' ? input : (input && input.url) || '';
      var body = init && init.body;
      if (typeof body === 'string') {
        keep(url, body);
      } else if (body && typeof body.text === 'function') {
        body.text().then(function (t) { keep(url, t); }).catch(function () {});
      } else if (input && typeof input === 'object' && typeof input.clone === 'function') {
        try { input.clone().text().then(function (t) { keep(url, t); }).catch(function () {}); } catch (e) {}
      }
    } catch (e) {}
    return _fetch.apply(this, arguments);
  };

  // XMLHttpRequest
  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__mcUrl = u; return _open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    try { if (typeof body === 'string') keep(this.__mcUrl || '', body); } catch (e) {}
    return _send.apply(this, arguments);
  };

  window.mcCaptures = function () {
    if (!captures.length) { console.log('nothing captured yet — run a quote first'); return ''; }
    var seen = {}, out = [];
    captures.forEach(function (c) {
      var n = c.label, i = 2;
      while (seen[n]) { n = c.label + '_' + (i++); }
      seen[n] = 1;
      out.push(n + '=' + c.value);
    });
    var text = out.join('\n');
    console.log('%c ' + out.length + ' capture(s) — copy everything between the lines ',
                'background:#1d4ed8;color:#fff;font-weight:bold');
    console.log('------------------------------------------------------------');
    console.log(text);
    console.log('------------------------------------------------------------');
    try { copy(text); console.log('(also copied to your clipboard)'); } catch (e) {}
    return text;
  };
  window.mcReset = function () { captures = []; console.log('captures cleared'); };
  window.__mcCap = true;

  console.log('%c capture armed ', 'background:#059669;color:#fff;font-weight:bold',
              '— run a quote, change Plan Type, repeat. Then type  mcCaptures()');
})();

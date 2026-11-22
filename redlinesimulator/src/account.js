'use strict';
/* ============================================================
   ACCOUNT: log in before playing. Each player's save (garage and
   credits) lives on the game server and is uploaded a few seconds
   after every change. Logging out clears the local copy.
   Server address: MP_SERVER (built in), or the page's own server.
   ============================================================ */
const Account = {
  TOKEN_KEY: 'rg2_token', NAME_KEY: 'rg2_name',
  quiet: false, dirty: false, timer: null, done: null,

  token: function () { return store.get(this.TOKEN_KEY, '') || ''; },
  name: function () { return store.get(this.NAME_KEY, '') || ''; },
  base: function () {
    const m = window.MP_SERVER || '';
    if (m) return m.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/+$/, '');
    return ''; // the page is served by the game server itself
  },

  // One request to the server. Resolves with {status, body}; rejects if the server cannot be reached.
  api: function (method, p, body, keepalive) {
    const headers = { 'content-type': 'application/json' }, t = this.token();
    if (t) headers.authorization = 'Bearer ' + t;
    const opts = { method: method, headers: headers, keepalive: !!keepalive };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(this.base() + p, opts).then(function (r) {
      return r.text().then(function (txt) {
        let j = null; try { j = JSON.parse(txt); } catch (e) { /* not JSON: wrong address */ }
        if (j === null) throw new Error('not-game-server');
        return { status: r.status, body: j };
      });
    });
  },

  // Called once at start-up. Resolves when a logged-in player is ready to play.
  gate: function () {
    const self = this;
    this.bind();
    try { UI.loading(false); } catch (e) { /* UI not ready yet */ }
    return new Promise(function (resolve) {
      self.done = resolve;
      self.check();
    });
  },
  check: function () {
    const self = this;
    if (!this.token()) return this.show('');
    this.api('GET', '/api/me').then(function (r) {
      if (r.status === 401) { store.set(self.TOKEN_KEY, ''); return self.show('Log in to continue.'); }
      if (r.status !== 200) throw new Error('bad-status');
      return self.syncDown().then(function () { self.finish(r.body.name); });
    }).catch(function (e) { self.show(self.explain(e)); });
  },

  explain: function (e) {
    if (e && e.message === 'not-game-server') return 'The game server is not set up for this site yet.';
    return 'Cannot reach the game server. Check your connection and try again.';
  },

  // Downloads the server save into the game, or uploads the local save if the account has none yet.
  syncDown: function () {
    const self = this;
    return this.api('GET', '/api/save').then(function (r) {
      if (r.status !== 200) throw new Error('save-failed');
      if (r.body.save && typeof r.body.save === 'object') {
        self.quiet = true;
        try {
          Object.keys(SAVE).forEach(function (k) { delete SAVE[k]; });
          Object.assign(SAVE, r.body.save);
          sanitizeSave(); persist();
        } finally { self.quiet = false; }
        return null;
      }
      return self.upload();
    });
  },

  upload: function () {
    if (!this.token()) return Promise.resolve(false);
    const self = this;
    return this.api('PUT', '/api/save', SAVE).then(function (r) {
      self.dirty = r.status !== 200;
      return r.status === 200;
    }).catch(function () { self.dirty = true; return false; });
  },

  // Called by persist() on every local save. Uploads after a short pause, so a burst of changes sends once.
  scheduleUpload: function () {
    if (this.quiet || !this.token()) return;
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.upload(), 2500);
  },

  show: function (msg) {
    const m = document.getElementById('md-auth'); if (!m) return;
    m.hidden = false;
    this.msg(msg);
  },
  msg: function (text) { const el = document.getElementById('au-msg'); if (el) el.textContent = text || ''; },

  finish: function (name) {
    store.set(this.NAME_KEY, name);
    const m = document.getElementById('md-auth'); if (m) m.hidden = true;
    const bar = document.getElementById('acct-bar'), who = document.getElementById('acct-name');
    if (who) who.textContent = name;
    if (bar) bar.hidden = false;
    if (this.done) { const d = this.done; this.done = null; d(); }
  },

  submit: function (route) {
    const self = this;
    const name = (document.getElementById('au-name').value || '').trim();
    const pass = document.getElementById('au-pass').value || '';
    if (!name || !pass) { this.msg('Enter a name and a password.'); return; }
    this.msg('Please wait...');
    this.api('POST', '/api/' + route, { name: name, password: pass }).then(function (r) {
      if (r.status !== 200) { self.msg(r.body.error || 'Something went wrong.'); return; }
      store.set(self.TOKEN_KEY, r.body.token);
      document.getElementById('au-pass').value = '';
      return self.syncDown().then(function () { self.finish(r.body.name); });
    }).catch(function (e) { self.msg(self.explain(e)); });
  },

  logout: function () {
    const self = this;
    const finish = function () { store.set(self.TOKEN_KEY, ''); store.set(self.NAME_KEY, ''); try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } location.reload(); };
    this.api('POST', '/api/logout', {}).then(finish, finish);
  },

  bind: function () {
    if (this.bound) return; this.bound = true;
    const self = this;
    const on = function (id, fn) { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('au-login', function () { self.submit('login'); });
    on('au-reg', function () { self.submit('register'); });
    on('acct-out', function () { self.logout(); });
    const pass = document.getElementById('au-pass');
    if (pass) pass.addEventListener('keydown', function (e) { if (e.key === 'Enter') self.submit('login'); });
    // Save anything still waiting when the player leaves the page.
    window.addEventListener('pagehide', function () {
      if (!self.dirty || !self.token()) return;
      self.api('PUT', '/api/save', SAVE, true).catch(function () { /* nothing more to do */ });
    });
  }
};

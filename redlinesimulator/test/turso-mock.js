'use strict';
// Test stand-in for Turso's HTTP API (POST /v2/pipeline). Same request and response shape,
// stored in a local SQLite file. Used only by test/accounts-turso-test.js.
const http = require('http');
const { DatabaseSync } = require('node:sqlite');

function cell(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number') return { type: 'integer', value: String(v) };
  return { type: 'text', value: String(v) };
}

function start(port, file, token) {
  const db = new DatabaseSync(file);
  const server = http.createServer(function (req, res) {
    let raw = '';
    req.on('data', function (c) { raw += c; });
    req.on('end', function () {
      const reply = function (status, obj) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.method !== 'POST' || req.url !== '/v2/pipeline') return reply(404, { error: 'not found' });
      if (req.headers.authorization !== 'Bearer ' + token) return reply(401, { error: 'bad token' });
      const body = JSON.parse(raw);
      const results = body.requests.map(function (r) {
        if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
        try {
          const sql = r.stmt.sql;
          const args = (r.stmt.args || []).map(function (a) {
            if (a.type === 'null') return null;
            if (a.type === 'integer') return Number(a.value);
            return a.value;
          });
          const stmt = db.prepare(sql);
          if (/^\s*select/i.test(sql)) {
            const rows = stmt.all(...args);
            const cols = rows.length ? Object.keys(rows[0]).map(function (n) { return { name: n, decltype: null }; }) : [];
            const out = rows.map(function (row) { return Object.keys(row).map(function (k) { return cell(row[k]); }); });
            return { type: 'ok', response: { type: 'execute', result: { cols: cols, rows: out, affected_row_count: 0, last_insert_rowid: null } } };
          }
          stmt.run(...args);
          return { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: 0, last_insert_rowid: null } } };
        } catch (e) {
          return { type: 'error', error: { message: e.message, code: 'SQLITE_ERROR' } };
        }
      });
      reply(200, { baton: null, base_url: null, results: results });
    });
  });
  return new Promise(function (resolve) { server.listen(port, function () { resolve(server); }); });
}

module.exports = { start };

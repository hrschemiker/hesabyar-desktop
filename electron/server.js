'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const core = require('./core');
const rates = require('./rates');
const sync = require('./sync');
const U = require('./util');

const TOKEN = crypto.randomBytes(24).toString('hex');
let RENDERER_DIR = null;

const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };

function parseQuery(u) { const q = {}; for (const [k, v] of u.searchParams.entries()) q[k] = v; return q; }

let UNLOCKED = false;
function lockPage(msg) {
  return '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + U.esc_html(core.APP_NAME) + '</title><link rel="stylesheet" href="/assets/css/hpa.css"><link rel="stylesheet" href="/assets/css/app.css"></head><body><div class="hpa-app" dir="rtl"><div class="hpa-login-gate hpa-auth-gate"><form method="post" action="/unlock" class="hpa-login-box hpa-auth-card hpa-pin-card"><div class="hpa-auth-logo"><img src="/assets/img/logo.svg" width="72" alt=""></div><h2>' + U.esc_html(core.APP_NAME) + '</h2><p>قفل امنیتی — PIN را وارد کنید.</p>' + (msg ? '<p style="color:#dc2626">' + U.esc_html(msg) + '</p>' : '') + '<input type="password" name="pin" inputmode="numeric" autocomplete="off" autofocus placeholder="PIN"><input type="hidden" name="hpa_token" value="' + TOKEN + '"><button class="hpa-btn hpa-btn-primary" type="submit">ورود</button></form></div></div></body></html>';
}

function htmlDocument(query) {
  core.setContext(query, TOKEN);
  const tab = query.hpa_tab || 'dashboard';
  const bodyHtml = core.renderTab(tab);
  return '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + U.esc_html(core.APP_NAME) + ' — ' + U.esc_html(core.APP_SUBTITLE) + '</title>' +
    '<link rel="stylesheet" href="/assets/css/hpa.css">' +
    '<link rel="stylesheet" href="/assets/css/app.css">' +
    '<link rel="icon" href="/assets/img/logo.svg">' +
    '</head><body>' + bodyHtml + '<script src="/assets/js/hpa.js" defer></script></body></html>';
}

function serveStatic(req, res, pathname) {
  const rel = pathname.replace(/^\/assets\//, '').replace(/\.\.+/g, '');
  const file = path.join(RENDERER_DIR, 'assets', rel);
  if (!file.startsWith(path.join(RENDERER_DIR, 'assets'))) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function readBody(req, cb) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => cb(Buffer.concat(chunks)));
  req.on('error', () => cb(Buffer.alloc(0)));
}

// Minimal multipart/form-data parser
function parseMultipart(buffer, boundary) {
  const fields = {}, files = {};
  const bnd = Buffer.from('--' + boundary);
  let start = buffer.indexOf(bnd);
  if (start < 0) return { fields, files };
  start += bnd.length;
  while (true) {
    if (buffer.slice(start, start + 2).toString() === '--') break;
    // skip CRLF after boundary
    if (buffer.slice(start, start + 2).toString() === '\r\n') start += 2;
    const headerEnd = buffer.indexOf('\r\n\r\n', start);
    if (headerEnd < 0) break;
    const header = buffer.slice(start, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const next = buffer.indexOf(bnd, dataStart);
    if (next < 0) break;
    let data = buffer.slice(dataStart, next - 2); // strip trailing CRLF
    const nameM = header.match(/name="([^"]*)"/i);
    const fileM = header.match(/filename="([^"]*)"/i);
    const typeM = header.match(/Content-Type:\s*([^\r\n]+)/i);
    const name = nameM ? nameM[1] : '';
    if (fileM) {
      if (fileM[1]) { if (!files[name]) files[name] = []; files[name].push({ filename: fileM[1], mime: typeM ? typeM[1].trim() : '', data }); }
    } else {
      fields[name] = data.toString('utf8');
    }
    start = next + bnd.length;
  }
  return { fields, files };
}
function parseUrlEncoded(buffer) {
  const fields = {};
  const s = buffer.toString('utf8');
  for (const pair of s.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const k = decodeURIComponent((idx < 0 ? pair : pair.slice(0, idx)).replace(/\+/g, ' '));
    const v = idx < 0 ? '' : decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
    fields[k] = v;
  }
  return fields;
}

function redirect(res, tab, extraQuery) {
  let loc = '/?hpa_tab=' + encodeURIComponent(tab) + '&hpa_msg=saved';
  if (extraQuery) loc += '&' + extraQuery;
  res.writeHead(302, { Location: loc });
  res.end();
}

async function handleAction(req, res, u, method) {
  const query = parseQuery(u);
  let post = {}, files = {};
  if (method === 'POST') {
    await new Promise(resolve => readBody(req, (buf) => {
      const ct = String(req.headers['content-type'] || '');
      if (ct.indexOf('multipart/form-data') > -1) { const bm = ct.match(/boundary=(.+)$/); const parsed = parseMultipart(buf, bm ? bm[1].trim().replace(/^"|"$/g, '') : ''); post = parsed.fields; files = parsed.files; }
      else post = parseUrlEncoded(buf);
      resolve();
    }));
  } else { post = query; }
  const token = post.hpa_token || query.hpa_token;
  if (token !== TOKEN) { res.writeHead(403); return res.end('bad token'); }
  const action = post.action || query.action;

  try {
    if (action === 'hpa_export_backup') {
      const data = core.export_backup_json();
      const name = 'hesabyar-backup-' + U.today_gregorian().replace(/-/g, '') + '.json';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + name + '"' });
      return res.end(JSON.stringify(data, null, 2));
    }
    if (action === 'hpa_import_backup') {
      let parsed = null;
      const f = (files.hpa_backup && files.hpa_backup[0]) ? files.hpa_backup[0] : null;
      if (f) { try { parsed = JSON.parse(f.data.toString('utf8')); } catch (e) { } }
      if (parsed) core.import_backup(parsed);
      return redirect(res, 'reports');
    }
    if (action === 'hpa_fetch_rates') { await rates.fetchAndStore(); return redirect(res, 'rates'); }
    if (action === 'hpa_save_sync') { await sync.saveAndLogin(post); return redirect(res, 'settings'); }
    if (action === 'hpa_sync_test') { await sync.test(); return redirect(res, 'settings'); }
    if (action === 'hpa_sync_pull') { await sync.pull(); return redirect(res, 'settings'); }
    if (action === 'hpa_sync_push') { await sync.push(); return redirect(res, 'settings'); }
    if (action === 'hpa_sync_full') { await sync.full(); return redirect(res, 'settings'); }
    // default sync DB actions
    core.setContext(query, TOKEN);
    const tab = core.handleAction(action, post, files);
    return redirect(res, tab);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('خطا: ' + e.message + '\n' + e.stack);
  }
}

function createServer(rendererDir) {
  RENDERER_DIR = rendererDir;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const pathname = u.pathname;
    try {
      if (pathname.startsWith('/assets/')) return serveStatic(req, res, pathname);
      const pin = String((core.settings().security_pin) || '');
      if (pin && !UNLOCKED) {
        if (pathname === '/unlock' && req.method === 'POST') {
          return readBody(req, (buf) => {
            const f = parseUrlEncoded(buf);
            if (String(f.pin || '') === pin) { UNLOCKED = true; res.writeHead(302, { Location: '/' }); return res.end(); }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(lockPage('PIN اشتباه است.'));
          });
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(lockPage(''));
      }
      if (pathname === '/action') return handleAction(req, res, u, req.method);
      if (pathname === '/' || pathname === '/index.html') {
        const query = parseQuery(u);
        const html = htmlDocument(query);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(html);
      }
      res.writeHead(404); res.end('not found');
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('خطا: ' + e.message + '\n' + e.stack);
    }
  });
  return server;
}

module.exports = { createServer, TOKEN };

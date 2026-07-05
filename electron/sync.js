'use strict';
// Site connection client — talks to the WordPress plugin's REST API (hpa/v1).
const D = require('./db');
const U = require('./util');

const SYNC_TABLES = ['accounts', 'categories', 'transactions', 'transaction_items', 'transaction_splits', 'debts', 'receivables', 'assets', 'rates', 'loans', 'loan_installments', 'checks', 'recurring', 'attachments', 'goals', 'deleted_items'];

function getSync() { return D.getOption('site_sync', { site_url: '', username: '', token: '', enabled: 0, rest_style: '', last_result: '', last_sync: '' }); }
function setSync(s) { D.setOption('site_sync', s); }
function trimSite(url) { return String(url || '').trim().replace(/\/+$/, ''); }
function baseFor(site, style) { return style === 'plain' ? (trimSite(site) + '/?rest_route=/hpa/v1/') : (trimSite(site) + '/wp-json/hpa/v1/'); }
function base(sync) { return baseFor(sync.site_url, sync.rest_style || 'pretty'); }

async function req(url, opts, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs || 25000);
  try {
    const res = await fetch(url, Object.assign({ signal: controller.signal }, opts));
    const txt = await res.text();
    let json = null; try { json = JSON.parse(txt); } catch (e) { }
    return { ok: res.ok, status: res.status, json, text: txt };
  } finally { clearTimeout(t); }
}

// Detect which REST URL form the site serves (pretty permalinks vs plain).
async function detectStyle(site) {
  for (const style of ['pretty', 'plain']) {
    try {
      const r = await req(baseFor(site, style) + 'ping', {}, 12000);
      if (r.ok && r.json && r.json.ok) return style;
    } catch (e) { /* try next */ }
  }
  return '';
}

async function saveAndLogin(post) {
  const s = getSync();
  s.site_url = trimSite(post.site_url);
  s.username = String(post.username || '').trim();
  s.enabled = post.enabled ? 1 : 0;
  const password = String(post.password || '');
  if (!s.site_url) { s.last_result = 'آدرس سایت وارد نشده است.'; setSync(s); return; }
  // resolve the working API address first (fixes "API address not found")
  const style = await detectStyle(s.site_url);
  if (!style) { s.rest_style = ''; s.last_result = 'آدرس API این سایت پیدا نشد. مطمئن شو افزونهٔ حساب‌یار نسخهٔ ۳.۱۳.۰ نصب و فعال است و در تنظیمات افزونه، گزینهٔ «اتصال نرم‌افزار دسکتاپ» را تیک زده‌ای.'; setSync(s); return; }
  s.rest_style = style;
  if (s.username && password) {
    try {
      const r = await req(base(s) + 'login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: s.username, password }) });
      if (r.ok && r.json && r.json.token) { s.token = r.json.token; s.last_result = 'اتصال با موفقیت برقرار شد' + (r.json.user ? ' (' + r.json.user.display_name + ')' : '') + '. اکنون می‌توانی همگام‌سازی کنی.'; }
      else s.last_result = 'ورود ناموفق: ' + ((r.json && (r.json.message || r.json.code)) || ('کد ' + r.status)) + '.';
    } catch (e) { s.last_result = 'خطا در اتصال به سایت: ' + e.message; }
  } else {
    s.last_result = 'آدرس API پیدا شد. برای اتصال، نام کاربری و رمز عبور وردپرس را وارد کن.';
  }
  setSync(s);
}

async function test() {
  const s = getSync();
  if (!s.site_url) { s.last_result = 'آدرس سایت تنظیم نشده.'; setSync(s); return; }
  if (!s.rest_style) s.rest_style = await detectStyle(s.site_url);
  if (!s.rest_style) { s.last_result = 'آدرس API پیدا نشد. افزونه را به‌روزرسانی و «اتصال نرم‌افزار دسکتاپ» را فعال کن.'; setSync(s); return; }
  try {
    const r = await req(base(s) + 'ping', {});
    if (r.ok && r.json && r.json.ok) s.last_result = 'اتصال سالم است. نسخهٔ افزونه: ' + (r.json.version || '?') + '.';
    else s.last_result = 'پاسخ نامعتبر از سایت (کد ' + r.status + ').';
  } catch (e) { s.last_result = 'خطا: ' + e.message; }
  setSync(s);
}

function localTables() {
  const out = {};
  for (const key of SYNC_TABLES) { const table = D.TABLES[key]; if (!table) continue; out[key] = D.all('SELECT * FROM ' + table); }
  return out;
}
function mergeIncoming(tables) {
  if (!tables) return 0;
  let count = 0;
  for (const key of SYNC_TABLES) {
    const rows = tables[key]; const table = D.TABLES[key];
    if (!Array.isArray(rows) || !table) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const clean = {};
      for (const c in row) { const v = row[c]; clean[c] = (v && typeof v === 'object') ? JSON.stringify(v) : v; }
      if (clean.id) { const exists = Number(D.scalar('SELECT id FROM ' + table + ' WHERE id=?', [clean.id])) || 0; if (exists) D.update(table, clean, { id: clean.id }); else D.insert(table, clean); }
      else { delete clean.id; D.insert(table, clean); }
      count++;
    }
  }
  return count;
}

async function ensureReady(s) {
  if (!s.token) return 'ابتدا در تنظیمات وارد شو.';
  if (!s.rest_style) { s.rest_style = await detectStyle(s.site_url); if (!s.rest_style) return 'آدرس API پیدا نشد.'; }
  return null;
}
async function pull() {
  const s = getSync(); const err = await ensureReady(s); if (err) { s.last_result = err; setSync(s); return; }
  try {
    const r = await req(base(s) + 'pull', { headers: { 'Authorization': 'Bearer ' + s.token } });
    if (r.ok && r.json && r.json.tables) { const n = mergeIncoming(r.json.tables); s.last_result = 'دریافت از سایت انجام شد. ' + U.number_format_i18n(n) + ' ردیف ادغام شد.'; }
    else s.last_result = 'دریافت ناموفق: ' + ((r.json && r.json.message) || ('کد ' + r.status)) + '.';
  } catch (e) { s.last_result = 'خطا در دریافت: ' + e.message; }
  setSync(s);
}
async function push() {
  const s = getSync(); const err = await ensureReady(s); if (err) { s.last_result = err; setSync(s); return; }
  try {
    const r = await req(base(s) + 'push', { method: 'POST', headers: { 'Authorization': 'Bearer ' + s.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ tables: localTables() }) });
    if (r.ok && r.json && r.json.ok) { let total = 0; for (const k in (r.json.changed || {})) total += Number(r.json.changed[k]) || 0; s.last_result = 'ارسال به سایت انجام شد. ' + U.number_format_i18n(total) + ' ردیف روی سایت به‌روزرسانی شد.'; }
    else s.last_result = 'ارسال ناموفق: ' + ((r.json && r.json.message) || ('کد ' + r.status)) + '.';
  } catch (e) { s.last_result = 'خطا در ارسال: ' + e.message; }
  setSync(s);
}
async function full(silent) {
  const s = getSync(); const err = await ensureReady(s); if (err) { if (!silent) { s.last_result = err; setSync(s); } return { ok: false }; }
  try {
    const r = await req(base(s) + 'sync', { method: 'POST', headers: { 'Authorization': 'Bearer ' + s.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ tables: localTables() }) });
    if (r.ok && r.json && r.json.tables) {
      const n = mergeIncoming(r.json.tables);
      let pushed = 0; if (r.json.push_result && r.json.push_result.changed) for (const k in r.json.push_result.changed) pushed += Number(r.json.push_result.changed[k]) || 0;
      s.last_result = 'همگام‌سازی کامل انجام شد. ' + U.number_format_i18n(n) + ' ردیف از سایت دریافت و ' + U.number_format_i18n(pushed) + ' ردیف به سایت ارسال شد.';
      s.last_sync = U.now_mysql();
      setSync(s);
      return { ok: true };
    }
    if (!silent) { s.last_result = 'همگام‌سازی ناموفق: ' + ((r.json && r.json.message) || ('کد ' + r.status)) + '.'; setSync(s); }
    return { ok: false };
  } catch (e) { if (!silent) { s.last_result = 'خطا در همگام‌سازی: ' + e.message; setSync(s); } return { ok: false }; }
}

// Auto sync used on launch and when internet becomes available.
async function autoSync() {
  const s = getSync();
  if (!s.enabled || !s.token) return { ok: false, skipped: true };
  return full(true);
}

module.exports = { saveAndLogin, test, pull, push, full, autoSync, getSync };

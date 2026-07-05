'use strict';
// Online rate fetcher (TGJU) — ported normalization/validation from the plugin.
const D = require('./db');
const U = require('./util');
const core = require('./core');

function rate_items() { return core.rate_items(); }

function parse_market_number(value) {
  value = String(value === undefined || value === null ? '' : value);
  const fa = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹', '٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '٬', '،'];
  const en = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ',', ','];
  for (let i = 0; i < fa.length; i++) value = value.split(fa[i]).join(en[i]);
  value = value.replace(/[^0-9.,]/g, '');
  if (value === '') return 0;
  value = value.replace(/,/g, '');
  if ((value.match(/\./g) || []).length > 1) value = value.replace(/\./g, '');
  return parseFloat(value) || 0;
}
function normalize_tgju_price_to_toman(key, raw, allRaw) {
  raw = Number(raw) || 0; allRaw = allRaw || {};
  if (raw <= 0) return 0;
  if (['usd', 'eur', 'usdt'].indexOf(key) > -1) { if (raw >= 300000) raw = raw / 10; }
  else if (['gold18', 'gold24'].indexOf(key) > -1) { if (raw >= 20000000) raw = raw / 10; }
  else if (key === 'silver') { if (raw >= 500000) raw = raw / 10; }
  else if (['btc', 'eth', 'bnb', 'sol', 'xrp', 'doge'].indexOf(key) > -1) {
    let usdt = 0;
    if (allRaw.usdt && allRaw.usdt.price) usdt = normalize_tgju_price_to_toman('usdt', allRaw.usdt.price, {});
    else if (allRaw.usd && allRaw.usd.price) usdt = normalize_tgju_price_to_toman('usd', allRaw.usd.price, {});
    if (usdt > 0 && raw < 1000000) raw = raw * usdt;
    else if (raw >= 1000000000) raw = raw / 10;
  }
  return Math.round(raw * 100) / 100;
}
function price_is_valid_for_key(key, priceToman) {
  priceToman = Number(priceToman) || 0;
  const ranges = {
    usd: [10000, 3000000], eur: [10000, 4000000], usdt: [10000, 3000000],
    gold18: [100000, 200000000], gold24: [100000, 250000000], silver: [500, 50000000],
    btc: [10000000, 100000000000], eth: [1000000, 10000000000], bnb: [100000, 5000000000],
    sol: [10000, 2000000000], xrp: [100, 500000000], doge: [10, 100000000]
  };
  if (!ranges[key]) return priceToman > 0;
  return priceToman >= ranges[key][0] && priceToman <= ranges[key][1];
}

// TGJU ajax.json keys mapping
const TGJU_MAP = {
  usd: 'price_dollar_rl', eur: 'price_eur', gold18: 'geram18', gold24: 'geram24', silver: 'silver',
  btc: 'crypto-bitcoin', eth: 'crypto-ethereum', usdt: 'crypto-tether', bnb: 'crypto-binance-coin',
  sol: 'crypto-solana', xrp: 'crypto-ripple', doge: 'crypto-dogecoin'
};

async function httpJson(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 18000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 HesabYar/1.0', 'Accept': 'application/json,text/html;q=0.9,*/*' } });
    if (!res.ok) return null;
    const txt = await res.text();
    try { return JSON.parse(txt); } catch (e) { return null; }
  } catch (e) { return null; } finally { clearTimeout(t); }
}

async function fetchFromTgju() {
  const out = {};
  const sources = ['https://call1.tgju.org/ajax.json', 'https://call3.tgju.org/ajax.json'];
  for (const src of sources) {
    const json = await httpJson(src);
    if (!json || !json.current) continue;
    for (const key in TGJU_MAP) {
      if (out[key]) continue;
      const node = json.current[TGJU_MAP[key]];
      if (node && (node.p !== undefined)) { const price = parse_market_number(node.p); if (price > 0) out[key] = { price, source: 'TGJU' }; }
    }
    if (Object.keys(out).length >= Object.keys(TGJU_MAP).length) break;
  }
  return out;
}

async function fetchAndStore() {
  let fetched;
  try { fetched = await fetchFromTgju(); } catch (e) { fetched = {}; }
  if (!fetched || !Object.keys(fetched).length) return { ok: false, saved: 0 };
  // usdt fallback from usd
  if (!fetched.usdt && fetched.usd) fetched.usdt = { price: fetched.usd.price, source: fetched.usd.source + ' / USDT fallback' };
  const items = rate_items();
  const todayG = U.today_gregorian();
  const todayJ = U.gregorian_to_jalali_date(todayG);
  let saved = 0;
  for (const key in fetched) {
    if (!items[key]) continue;
    const price = normalize_tgju_price_to_toman(key, fetched[key].price, fetched);
    if (price <= 0 || !price_is_valid_for_key(key, price)) continue;
    const data = { rate_key: key, title: items[key][0], type: items[key][1], price, unit: 'toman', source: fetched[key].source || 'TGJU', jalali_date: todayJ, gregorian_date: todayG, note: 'به‌روزرسانی خودکار آنلاین', is_manual: 0, updated_at: U.now_mysql() };
    const exists = Number(D.scalar('SELECT id FROM hpa_rates WHERE rate_key=?', [key])) || 0;
    if (exists) D.update('hpa_rates', data, { id: exists }); else { data.created_at = U.now_mysql(); D.insert('hpa_rates', data); }
    saved++;
  }
  return { ok: saved > 0, saved };
}

module.exports = { fetchAndStore };

'use strict';
// HesabYar core — faithful JS port of the WordPress plugin's rendering + action logic.
const D = require('./db');
const U = require('./util');

const APP_NAME = 'حساب‌یار';
const APP_SUBTITLE = 'نرم‌افزار حسابداری شخصی';
const VERSION = '1.3.0';

// Per-request context (set by server before each render/action)
let CTX = { query: {}, token: '' };
function setContext(query, token) { CTX = { query: query || {}, token: token || '' }; }

// ---------- URL helpers (replace add_query_arg / remove_query_arg) ----------
function buildUrl(overrides, removeKeys) {
  const q = Object.assign({}, CTX.query);
  delete q.hpa_msg;
  if (removeKeys) for (const k of removeKeys) delete q[k];
  if (overrides) for (const k in overrides) { if (overrides[k] === null) delete q[k]; else q[k] = overrides[k]; }
  const parts = Object.keys(q).filter(k => q[k] !== undefined && q[k] !== '' && q[k] !== null)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(q[k]));
  return '/?' + parts.join('&');
}
function removeArgUrl(removeKeys) { return buildUrl({}, Array.isArray(removeKeys) ? removeKeys : [removeKeys]); }
function actionUrl(action, params) {
  let u = '/action?action=' + encodeURIComponent(action) + '&hpa_token=' + encodeURIComponent(CTX.token);
  if (params) for (const k in params) u += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  return u;
}

// ---------- Static data maps (mirror plugin) ----------
function currencies() { return { toman: 'تومان', rial: 'ریال', usd: 'دلار', eur: 'یورو', aed: 'درهم', try: 'لیر' }; }
function account_types() { return { cash: 'نقدی', bank: 'بانکی', credit: 'اعتباری' }; }
function transaction_types() {
  return {
    income: 'درآمد', expense: 'هزینه', loan_installment: 'پرداخت قسط', recurring_debt: 'بدهی تکرارشونده',
    transfer: 'انتقال بین حساب‌ها', person_transfer: 'انتقال بین اشخاص', debt_incur: 'دریافت قرض/وام', debt_settlement: 'تسویه بدهی',
    receivable_settlement: 'تسویه طلب', check_settlement: 'تسویه چک', asset_buy: 'خرید دارایی', asset_sell: 'فروش دارایی'
  };
}
// ---- Accounting classification ----
// True consumption expense (what actually reduces net worth). Everything else that
// moves money — borrowing/repaying principal, buying/selling assets, collecting a
// loan you gave — is "financing" and is NOT income or expense.
function expense_types() { return ['expense', 'recurring_debt']; }
function financing_out_types() { return ['loan_installment', 'debt_settlement', 'check_settlement', 'asset_buy']; }
function financing_in_types() { return ['debt_incur', 'asset_sell', 'receivable_settlement']; }
function cash_out_types() { return expense_types().concat(financing_out_types()); }
function cash_in_types() { return ['income'].concat(financing_in_types()); }
function asset_groups() { return { gold: 'طلا', silver: 'نقره', crypto: 'کریپتو', cash_currency: 'ارز نقدی', property: 'ملک', car: 'خودرو', valuable: 'کالای ارزشمند', other: 'سایر' }; }
function asset_group_icon(g) { const i = { gold: '🥇', silver: '🥈', crypto: '₿', cash_currency: '💵', property: '🏠', car: '🚗', valuable: '💍', other: '📦' }; return i[g] || '💼'; }
function status_labels() { return { open: 'باز', done: 'انجام‌شده', paid: 'تسویه‌شده', partial: 'بخشی تسویه‌شده', cancelled: 'لغوشده' }; }
function persons() {
  const labels = D.getOption('person_labels', { hamidreza: 'خودم', samira: 'همسر', joint: 'مشترک' });
  return { hamidreza: labels.hamidreza || 'خودم', samira: labels.samira || 'همسر', joint: labels.joint || 'مشترک' };
}
function person_label(key) { const p = persons(); return p[key] || p.hamidreza; }
function person_select(name, selected) {
  name = name || 'person_key'; selected = selected || 'hamidreza';
  let out = '<select name="' + U.esc_attr(name) + '">';
  const p = persons();
  for (const k in p) out += '<option value="' + U.esc_attr(k) + '"' + U.selected(selected, k) + '>' + U.esc_html(p[k]) + '</option>';
  return out + '</select>';
}
function settings() {
  return D.getOption('hpa_settings', {
    theme_mode: 'light', default_currency: 'toman', auto_rate_update: 1, security_pin: '', show_inactive_accounts: 0
  });
}
function today_jalali() { return U.today_jalali(); }

// ---------- money / currency ----------
function fmt_money(amount, currency) {
  currency = currency || 'toman';
  const curr = currencies();
  const precision = ['usd', 'eur', 'aed', 'try'].indexOf(currency) > -1 ? 2 : 0;
  return U.number_format_i18n(Number(amount) || 0, precision) + ' ' + (curr[currency] || U.esc_html(currency));
}
function latest_rate_price(rate_key) {
  rate_key = U.sanitize_key(String(rate_key || ''));
  if (rate_key === '') return 0;
  const v = D.scalar('SELECT price FROM hpa_rates WHERE rate_key=? LIMIT 1', [rate_key]);
  return Number(v) || 0;
}
function amount_to_toman(amount, currency) {
  amount = Number(amount) || 0;
  currency = U.sanitize_key(String(currency || ''));
  if (currency === 'rial') return amount / 10;
  if (currency === 'toman' || currency === '') return amount;
  const rate = latest_rate_price(currency);
  if (rate > 0) return amount * rate;
  return amount;
}
function toman_to_currency(amount_toman, currency) {
  amount_toman = Number(amount_toman) || 0;
  currency = U.sanitize_key(String(currency || ''));
  if (currency === 'rial') return amount_toman * 10;
  if (currency === 'toman' || currency === '') return amount_toman;
  const rate = latest_rate_price(currency);
  if (rate > 0) return amount_toman / rate;
  return amount_toman;
}
function convert_currency(amount, from, to) {
  from = U.sanitize_key(String(from || '')); to = U.sanitize_key(String(to || ''));
  if (from === to) return Number(amount) || 0;
  return toman_to_currency(amount_to_toman(amount, from), to);
}
function rows_sum_toman(rows, amountField, currField) {
  amountField = amountField || 'amount'; currField = currField || 'currency';
  let sum = 0;
  for (const r of (rows || [])) sum += amount_to_toman(r[amountField] || 0, r[currField] || 'toman');
  return sum;
}
function table_sum_toman(tableKey, amountField, where) {
  amountField = amountField || 'amount';
  if (['amount', 'purchase_price'].indexOf(amountField) < 0) amountField = 'amount';
  const table = D.TABLES[tableKey];
  const rows = D.all('SELECT `' + amountField + '` AS amount, currency FROM ' + table + ' WHERE ' + (where || '1=1'));
  return rows_sum_toman(rows);
}
function transaction_sum_toman(type, where) {
  where = where || '1=1';
  let rows;
  if (Array.isArray(type)) {
    const types = type.map(t => U.sanitize_key(t)).filter(Boolean);
    if (!types.length) return 0;
    const ph = types.map(() => '?').join(',');
    rows = D.all("SELECT amount, currency FROM hpa_transactions WHERE type IN (" + ph + ") AND status!='cancelled' AND " + where, types);
  } else {
    rows = D.all("SELECT amount, currency FROM hpa_transactions WHERE type=? AND status!='cancelled' AND " + where, [U.sanitize_key(type)]);
  }
  return rows_sum_toman(rows);
}
function total_balances_toman(balances) {
  let total = 0;
  for (const a of get_accounts()) total += amount_to_toman(balances[a.id] || 0, a.currency);
  return total;
}

// ---------- accounts / categories ----------
let _accountsCache = null;
function get_accounts() {
  if (_accountsCache !== null) return _accountsCache;
  _accountsCache = D.all('SELECT * FROM hpa_accounts WHERE is_active=1 ORDER BY id DESC');
  return _accountsCache;
}
function get_categories(type) {
  const where = type ? D.all('SELECT * FROM hpa_categories WHERE type=? ORDER BY is_default DESC, id DESC', [type]) : D.all('SELECT * FROM hpa_categories ORDER BY is_default DESC, id DESC');
  return where;
}
function account_select(name, selected) {
  name = name || 'account_id'; selected = Number(selected) || 0;
  let out = '<select name="' + U.esc_attr(name) + '"><option value="0">انتخاب حساب</option>';
  for (const a of get_accounts()) out += '<option value="' + U.esc_attr(a.id) + '"' + U.selected(selected, a.id) + '>' + U.esc_html((a.icon || '') + ' ' + a.name + ' — ' + person_label(a.person_key || 'hamidreza')) + '</option>';
  return out + '</select>';
}
function category_select(name, type, selected) {
  name = name || 'category_id'; type = U.sanitize_key(type || 'expense'); selected = Number(selected) || 0;
  let rows = D.all('SELECT * FROM hpa_categories WHERE type=? ORDER BY is_default DESC, name ASC', [type]);
  if (!rows.length) rows = D.all('SELECT * FROM hpa_categories ORDER BY is_default DESC, name ASC');
  let out = '<select name="' + U.esc_attr(name) + '"><option value="0">بدون دسته‌بندی</option>';
  for (const c of rows) out += '<option value="' + U.esc_attr(c.id) + '"' + U.selected(selected, c.id) + '>' + U.esc_html((c.icon || '🏷️') + ' ' + c.name) + '</option>';
  return out + '</select>';
}
function clickable_category(id, name, icon) {
  icon = icon || '🏷️';
  if (!id) return U.esc_html(name);
  return '<a class="hpa-tax-link" href="' + U.esc_url(buildUrl({ hpa_tab: 'transactions', hpa_category: id }, ['paged']) + '#hpa-transactions-list') + '">' + U.esc_html((icon + ' ' + name).trim()) + '</a>';
}
function clickable_tag(tag) {
  tag = String(tag || '').trim(); if (tag === '') return '';
  return '<a class="hpa-tag-link" href="' + U.esc_url(buildUrl({ hpa_tab: 'transactions', hpa_tag: tag }, ['paged']) + '#hpa-transactions-list') + '">#' + U.esc_html(tag) + '</a>';
}

// ---------- forms ----------
function form_open(action, multipart) {
  return '<form class="hpa-form" method="post" ' + (multipart ? 'enctype="multipart/form-data"' : '') + ' action="/action"><input type="hidden" name="action" value="' + U.esc_attr(action) + '"><input type="hidden" name="hpa_token" value="' + U.esc_attr(CTX.token) + '">';
}
function form_close(label) { return '<button class="hpa-btn hpa-btn-primary" type="submit">' + U.esc_html(label || 'ذخیره') + '</button></form>'; }
function delete_button(action, id, tab) {
  const url = actionUrl(action, { id: id, tab: tab });
  return '<a class="hpa-delete" onclick="return confirm(\'حذف شود؟\')" href="' + U.esc_url(url) + '">حذف</a>';
}

// ---------- balances ----------
let _balancesCache = null;
function calculate_balances() {
  if (_balancesCache !== null) return _balancesCache;
  const balances = {}, currenciesMap = {};
  for (const a of get_accounts()) { balances[a.id] = Number(a.opening_balance) || 0; currenciesMap[a.id] = a.currency; }
  const rows = D.all("SELECT account_id,to_account_id,type,amount,fee_amount,currency,person_key,from_person_key,to_person_key FROM hpa_transactions WHERE status!='cancelled'");
  for (const r of rows) {
    if (balances[r.account_id] === undefined) balances[r.account_id] = 0;
    const sourceCurrency = currenciesMap[r.account_id] || (r.currency || 'toman');
    const sourceAmount = convert_currency(r.amount, r.currency || sourceCurrency, sourceCurrency);
    const feeAmount = convert_currency(r.fee_amount || 0, r.currency || sourceCurrency, sourceCurrency);
    if (r.type === 'income' || r.type === 'asset_sell' || r.type === 'receivable_settlement' || r.type === 'debt_incur') {
      balances[r.account_id] += sourceAmount;
    } else if (r.type === 'transfer') {
      balances[r.account_id] -= (sourceAmount + feeAmount);
      if (r.to_account_id) {
        if (balances[r.to_account_id] === undefined) balances[r.to_account_id] = 0;
        const destCurrency = currenciesMap[r.to_account_id] || (r.currency || 'toman');
        balances[r.to_account_id] += convert_currency(r.amount, r.currency || sourceCurrency, destCurrency);
      }
    } else if (r.type === 'person_transfer') {
      const fromP = r.from_person_key || (r.person_key || 'hamidreza');
      const toP = r.to_person_key || 'samira';
      if (fromP === 'hamidreza' && toP !== 'hamidreza') balances[r.account_id] -= (sourceAmount + feeAmount);
      else if (toP === 'hamidreza' && fromP !== 'hamidreza') { balances[r.account_id] += sourceAmount; if (feeAmount > 0) balances[r.account_id] -= feeAmount; }
    } else {
      balances[r.account_id] -= sourceAmount;
    }
  }
  _balancesCache = balances;
  return balances;
}
function apply_transaction_to_balance(balance, currency, tx) {
  const sourceAmount = convert_currency(tx.amount || 0, tx.currency || currency, currency);
  const feeAmount = convert_currency(tx.fee_amount || 0, tx.currency || currency, currency);
  const type = tx.type || '';
  if (['income', 'asset_sell', 'receivable_settlement', 'debt_incur'].indexOf(type) > -1) return balance + sourceAmount;
  if (type === 'transfer') return balance - sourceAmount - feeAmount;
  if (type === 'person_transfer') {
    const from = tx.from_person_key || (tx.person_key || 'hamidreza');
    const to = tx.to_person_key || 'samira';
    if (from === 'hamidreza' && to !== 'hamidreza') return balance - sourceAmount - feeAmount;
    if (to === 'hamidreza' && from !== 'hamidreza') return balance + sourceAmount - feeAmount;
    return balance;
  }
  return balance - sourceAmount;
}
function account_balance_after_transaction(tx) {
  if (!tx.account_id) return null;
  const acc = D.get('SELECT * FROM hpa_accounts WHERE id=?', [tx.account_id]);
  if (!acc) return null;
  let balance = Number(acc.opening_balance) || 0;
  const rows = D.all("SELECT * FROM hpa_transactions WHERE status!='cancelled' AND account_id=? AND (gregorian_date < ? OR (gregorian_date=? AND id<=?)) ORDER BY gregorian_date ASC, id ASC", [tx.account_id, tx.gregorian_date, tx.gregorian_date, tx.id]);
  for (const r of rows) balance = apply_transaction_to_balance(balance, acc.currency, r);
  return { account: acc.name, balance: balance, currency: acc.currency };
}

// ---------- asset valuation ----------
function asset_base_amount(asset) {
  if (['gold', 'silver'].indexOf(asset.asset_group) > -1) return Math.max(0, Number(asset.weight) || 0);
  const quantity = Number(asset.quantity) || 0, weight = Number(asset.weight) || 0;
  if (quantity > 0) return quantity;
  if (weight > 0) return weight;
  return 1;
}
function asset_market_rate_key(asset) {
  const group = U.sanitize_key(String(asset.asset_group || ''));
  let text = String((asset.title || '') + ' ' + (asset.model || '') + ' ' + (asset.purity || '') + ' ' + (asset.unit || '') + ' ' + (asset.currency || '')).toLowerCase().trim();
  text = text.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  if (group === 'gold') return /24|۲۴|999|۹۹۹/.test(text) ? 'gold24' : 'gold18';
  if (group === 'silver') return 'silver';
  if (group === 'crypto') {
    const map = { btc: ['btc', 'bitcoin', 'بیت کوین', 'بیت‌کوین'], eth: ['eth', 'ethereum', 'اتریوم'], usdt: ['usdt', 'tether', 'تتر'], bnb: ['bnb', 'binance', 'بایننس'], sol: ['sol', 'solana', 'سولانا'], xrp: ['xrp', 'ripple', 'ریپل'], doge: ['doge', 'dogecoin', 'دوج'] };
    for (const key in map) for (const needle of map[key]) if (text.indexOf(needle.toLowerCase()) > -1) return key;
  }
  if (group === 'cash_currency') {
    if (/usd|dollar|دلار/.test(text)) return 'usd';
    if (/eur|euro|یورو/.test(text)) return 'eur';
    if (/usdt|تتر/.test(text)) return 'usdt';
  }
  return '';
}
function asset_valuation(asset) {
  const base = asset_base_amount(asset);
  const purchaseTotal = amount_to_toman(asset.purchase_price || 0, asset.currency || 'toman');
  const purchaseUnit = base > 0 ? purchaseTotal / base : 0;
  const rateKey = asset_market_rate_key(asset);
  const marketUnit = rateKey ? latest_rate_price(rateKey) : 0;
  const hasMarket = (rateKey !== '' && marketUnit > 0 && base > 0);
  const currentTotal = hasMarket ? base * marketUnit : purchaseTotal;
  const currentUnit = hasMarket ? marketUnit : purchaseUnit;
  const profit = currentTotal - purchaseTotal;
  const percent = purchaseTotal > 0 ? (profit / purchaseTotal) * 100 : 0;
  return { base, rate_key: rateKey, has_market: hasMarket, purchase_total: purchaseTotal, purchase_unit: purchaseUnit, current_unit: currentUnit, current_total: currentTotal, profit, percent };
}
function asset_summary_totals(where) {
  const rows = D.all('SELECT * FROM hpa_assets WHERE ' + (where || '1=1'));
  const out = { purchase: 0, current: 0, profit: 0 };
  for (const a of rows) { const v = asset_valuation(a); out.purchase += v.purchase_total; out.current += v.current_total; }
  out.profit = out.current - out.purchase;
  return out;
}
function asset_funding_label(asset) {
  const map = { personal: 'پول شخصی', loan: 'از محل وام', check: 'از محل چک', debt: 'از محل بدهی' };
  const src = asset.funding_source || 'personal';
  let label = map[src] || src;
  if (asset.source_loan_id) label += ' / وام مرتبط';
  if (asset.goal_id) { const goal = D.scalar('SELECT title FROM hpa_goals WHERE id=?', [asset.goal_id]); if (goal) label += ' / هدف: ' + goal; }
  return label;
}
function asset_status_html(v) {
  const profit = Number(v.profit) || 0, percent = Number(v.percent) || 0;
  const cls = profit >= 0 ? 'hpa-asset-gain' : 'hpa-asset-loss';
  const arrow = profit >= 0 ? '↗' : '↘';
  const label = profit >= 0 ? 'سود' : 'زیان';
  return '<span class="hpa-asset-status ' + cls + '"><b>' + arrow + '</b><span>' + label + ' ' + U.esc_html(fmt_money(Math.abs(profit), 'toman')) + '</span><small>' + U.esc_html(U.number_format_i18n(Math.abs(percent), 1)) + '%</small></span>';
}
function asset_amount_label(asset) {
  let unit = String(asset.unit || '').trim();
  if ((asset.asset_group || '') === 'crypto' && unit === '') unit = String(asset.model || 'واحد').toUpperCase();
  if (['gold', 'silver'].indexOf(asset.asset_group) > -1) { const u = unit || 'گرم'; return (U.number_format_i18n(Number(asset.weight) || 0, 4) + ' ' + u).trim(); }
  const base = (Number(asset.quantity) || 0) > 0 ? Number(asset.quantity) : Number(asset.weight) || 0;
  return (U.number_format_i18n(base, 8) + ' ' + unit).trim();
}
function asset_unit_price_label(asset) {
  let unit = String(asset.unit || '').trim();
  if ((asset.asset_group || '') === 'crypto' && unit === '') unit = String(asset.model || 'واحد').toUpperCase();
  if (['gold', 'silver'].indexOf(asset.asset_group) > -1) unit = unit || 'گرم';
  if (unit === '') unit = 'واحد';
  const base = ['gold', 'silver'].indexOf(asset.asset_group) > -1 ? Number(asset.weight) || 0 : ((Number(asset.quantity) || 0) > 0 ? Number(asset.quantity) : Number(asset.weight) || 0);
  const price = (Number(asset.unit_price) || 0) > 0 ? Number(asset.unit_price) : (base > 0 ? (Number(asset.purchase_price) || 0) / base : 0);
  if (price <= 0) return '—';
  return fmt_money(price, asset.currency) + ' / ' + unit;
}

// ---------- date ranges ----------
function current_jalali_month_gregorian_range() {
  const today = today_jalali();
  const parts = today.split('/');
  const jy = parseInt(parts[0], 10) || 1403, jm = parseInt(parts[1], 10) || 1;
  const last = jm <= 6 ? 31 : (jm <= 11 ? 30 : 29);
  const start = U.pad(jy, 4) + '/' + U.pad(jm, 2) + '/01';
  const end = U.pad(jy, 4) + '/' + U.pad(jm, 2) + '/' + U.pad(last, 2);
  return [U.jalali_to_gregorian_date(start), U.jalali_to_gregorian_date(end)];
}
function last_jalali_month_ranges(n) {
  n = n || 6;
  const ranges = [];
  const today = today_jalali();
  const [jy0, jm0] = today.split('/').map(x => parseInt(x, 10));
  for (let i = n - 1; i >= 0; i--) {
    let m = jm0 - i, y = jy0;
    while (m <= 0) { m += 12; y--; }
    const start = U.pad(y, 4) + '/' + U.pad(m, 2) + '/01';
    const last = m <= 6 ? 31 : (m <= 11 ? 30 : 29);
    const end = U.pad(y, 4) + '/' + U.pad(m, 2) + '/' + U.pad(last, 2);
    ranges.push({ label: jalali_month_name(m), start: U.jalali_to_gregorian_date(start), end: U.jalali_to_gregorian_date(end) });
  }
  return ranges;
}
function jalali_month_name(m) { const names = { 1: 'فروردین', 2: 'اردیبهشت', 3: 'خرداد', 4: 'تیر', 5: 'مرداد', 6: 'شهریور', 7: 'مهر', 8: 'آبان', 9: 'آذر', 10: 'دی', 11: 'بهمن', 12: 'اسفند' }; return names[m] || String(m); }

module.exports = {
  setContext, VERSION, APP_NAME, APP_SUBTITLE,
  // exposed for other modules / server
  currencies, account_types, transaction_types, asset_groups, status_labels, persons, person_label,
  settings, fmt_money, amount_to_toman, latest_rate_price, calculate_balances, get_accounts,
  buildUrl, actionUrl, D, U,
  // placeholders assigned below
};

// ---- rate items ----
function rate_items() {
  return {
    usd: ['دلار آمریکا', 'currency', '💵'], eur: ['یورو', 'currency', '💶'],
    gold18: ['طلای ۱۸ عیار', 'metal', '🥇'], gold24: ['طلای ۲۴ عیار', 'metal', '🟡'],
    silver: ['نقره', 'metal', '🥈'], btc: ['Bitcoin', 'crypto', '₿'],
    eth: ['Ethereum', 'crypto', '◆'], usdt: ['Tether', 'crypto', '₮'],
    bnb: ['BNB', 'crypto', '🟨'], sol: ['Solana', 'crypto', '◎'],
    xrp: ['XRP', 'crypto', '✕'], doge: ['Dogecoin', 'crypto', 'Ð']
  };
}
function crypto_rate_items() { const out = {}; const it = rate_items(); for (const k in it) if (it[k][1] === 'crypto') out[k] = it[k]; return out; }

Object.assign(module.exports, { rate_items, crypto_rate_items, asset_valuation, asset_summary_totals });

// ================= SELECT builders =================
function loan_select(name, selected) {
  name = name || 'source_loan_id'; selected = Number(selected) || 0;
  const rows = D.all("SELECT id,title,principal_amount,currency,status FROM hpa_loans WHERE status!='cancelled' ORDER BY id DESC");
  let out = '<select name="' + U.esc_attr(name) + '"><option value="0">ندارد</option>';
  for (const r of rows) { const label = r.title + ' — ' + fmt_money(r.principal_amount, r.currency); out += '<option value="' + U.esc_attr(r.id) + '"' + U.selected(selected, r.id) + '>' + U.esc_html(label) + '</option>'; }
  return out + '</select>';
}
function installment_select(name, loanId, selected) {
  name = name || 'loan_installment_id'; loanId = Number(loanId) || 0; selected = Number(selected) || 0;
  const where = loanId ? 'i.loan_id=' + loanId : '1=1';
  const rows = D.all("SELECT i.*, l.title AS loan_title FROM hpa_loan_installments i LEFT JOIN hpa_loans l ON l.id=i.loan_id WHERE " + where + " AND i.status!='paid' ORDER BY i.due_gregorian_date ASC, i.installment_no ASC LIMIT 100");
  let out = '<select name="' + U.esc_attr(name) + '"><option value="0">ندارد</option>';
  for (const r of rows) { const label = ((r.due_jalali_date || 'بدون تاریخ') + ' — ' + (r.loan_title || 'وام') + ' — ' + fmt_money(r.amount, r.currency)).trim(); out += '<option value="' + U.esc_attr(r.id) + '"' + U.selected(selected, r.id) + '>' + U.esc_html(label) + '</option>'; }
  return out + '</select>';
}
function debt_select(name, selected) {
  name = name || 'debt_id'; selected = Number(selected) || 0;
  const rows = D.all("SELECT id,person_name,amount,paid_amount,currency,due_jalali_date,status FROM hpa_debts WHERE status!='paid' ORDER BY COALESCE(due_gregorian_date, gregorian_date) ASC, id DESC LIMIT 150");
  let out = '<select name="' + U.esc_attr(name) + '"><option value="0">انتخاب بدهی</option>';
  for (const r of rows) { const remain = Math.max(0, (Number(r.amount) || 0) - (Number(r.paid_amount) || 0)); const label = ((r.due_jalali_date || 'بدون موعد') + ' — ' + (r.person_name || 'بدهی') + ' — مانده: ' + fmt_money(remain, r.currency)).trim(); out += '<option data-amount="' + U.esc_attr(remain) + '" data-currency="' + U.esc_attr(r.currency) + '" value="' + U.esc_attr(r.id) + '"' + U.selected(selected, r.id) + '>' + U.esc_html(label) + '</option>'; }
  return out + '</select>';
}
function receivable_select(name, selected) {
  name = name || 'receivable_id'; selected = Number(selected) || 0;
  const rows = D.all("SELECT id,person_name,amount,paid_amount,currency,due_jalali_date,status FROM hpa_receivables WHERE status!='paid' ORDER BY COALESCE(due_gregorian_date, gregorian_date) ASC, id DESC LIMIT 150");
  let out = '<select name="' + U.esc_attr(name) + '"><option value="0">انتخاب طلب</option>';
  for (const r of rows) { const remain = Math.max(0, (Number(r.amount) || 0) - (Number(r.paid_amount) || 0)); const label = ((r.due_jalali_date || 'بدون موعد') + ' — ' + (r.person_name || 'طلب') + ' — مانده: ' + fmt_money(remain, r.currency)).trim(); out += '<option data-amount="' + U.esc_attr(remain) + '" data-currency="' + U.esc_attr(r.currency) + '" value="' + U.esc_attr(r.id) + '"' + U.selected(selected, r.id) + '>' + U.esc_html(label) + '</option>'; }
  return out + '</select>';
}
function check_select(name, selected) {
  name = name || 'check_id'; selected = U.absint(selected);
  const where = selected ? "(status!='paid' OR id=" + selected + ")" : "status!='paid'";
  const rows = D.all("SELECT id,title,check_count,amount_each,currency,first_due_jalali_date,used_for,status FROM hpa_checks WHERE " + where + " ORDER BY COALESCE(first_due_gregorian_date, created_at) ASC, id DESC LIMIT 150");
  let out = '<select name="' + U.esc_attr(name) + '" class="hpa-check-select"><option value="0">انتخاب چک</option>';
  for (const r of rows) { const amount = (Number(r.amount_each) || 0) * Math.max(1, Number(r.check_count) || 0); let label = ((r.first_due_jalali_date || 'بدون موعد') + ' — ' + (r.title || 'چک') + ' — ' + fmt_money(amount, r.currency)).trim(); if ((Number(r.check_count) || 0) > 1) label += ' — تعداد: ' + (Number(r.check_count) || 0); out += '<option data-amount="' + U.esc_attr(amount) + '" data-currency="' + U.esc_attr(r.currency) + '" value="' + U.esc_attr(r.id) + '"' + U.selected(selected, r.id) + '>' + U.esc_html(label) + '</option>'; }
  return out + '</select>';
}
function asset_select(name, selected) {
  name = name || 'asset_id'; selected = Number(selected) || 0;
  const rows = D.all("SELECT id,title,asset_group,purchase_price,currency FROM hpa_assets ORDER BY gregorian_date DESC, id DESC LIMIT 150");
  const groups = asset_groups();
  let out = '<select name="' + U.esc_attr(name) + '"><option value="0">انتخاب دارایی</option>';
  for (const r of rows) { const label = ((r.title || 'دارایی') + ' — ' + (groups[r.asset_group] || r.asset_group) + ' — ' + fmt_money(r.purchase_price, r.currency)).trim(); out += '<option value="' + U.esc_attr(r.id) + '"' + U.selected(selected, r.id) + '>' + U.esc_html(label) + '</option>'; }
  return out + '</select>';
}
function recurring_select(name, selected) {
  name = name || 'recurring_id'; selected = Number(selected) || 0;
  const rows = D.all("SELECT id,title,amount,currency,next_jalali_date,interval_type,status FROM hpa_recurring WHERE status='active' ORDER BY COALESCE(next_gregorian_date, start_gregorian_date) ASC, id DESC LIMIT 150");
  let out = '<select name="' + U.esc_attr(name) + '" class="hpa-recurring-select"><option value="0">انتخاب بدهی تکرارشونده</option>';
  for (const r of rows) { const label = ((r.title || 'تکرارشونده') + ' — موعد: ' + (r.next_jalali_date || 'بدون تاریخ') + ' — ' + fmt_money(r.amount, r.currency)).trim(); out += '<option data-amount="' + U.esc_attr(r.amount) + '" data-currency="' + U.esc_attr(r.currency) + '" data-due="' + U.esc_attr(r.next_jalali_date) + '" value="' + U.esc_attr(r.id) + '"' + U.selected(selected, r.id) + '>' + U.esc_html(label) + '</option>'; }
  return out + '</select>';
}
function advance_recurring_gregorian_date(baseG, intervalType, steps) {
  baseG = String(baseG || ''); steps = Math.max(0, Number(steps) || 0);
  if (!baseG || steps === 0) return baseG;
  intervalType = U.sanitize_key(String(intervalType || ''));
  if (intervalType === 'daily') return U.date_add_days(baseG, steps);
  if (intervalType === 'weekly') return U.date_add_days(baseG, steps * 7);
  if (intervalType === 'yearly') return U.date_add_years(baseG, steps);
  return U.date_add_months(baseG, steps);
}
function recurring_due_select(name, selectedRecurring, selectedDate) {
  name = name || 'recurring_due_jalali_date'; selectedRecurring = Number(selectedRecurring) || 0; selectedDate = selectedDate || '';
  const rows = D.all("SELECT id,title,next_jalali_date,next_gregorian_date,start_jalali_date,start_gregorian_date,interval_type FROM hpa_recurring WHERE status='active' ORDER BY COALESCE(next_gregorian_date, start_gregorian_date) ASC, id DESC LIMIT 150");
  let out = '<select name="' + U.esc_attr(name) + '" class="hpa-recurring-due-select"><option value="">انتخاب تاریخ سررسید</option>';
  for (const r of rows) {
    let baseG = r.next_gregorian_date || (r.start_gregorian_date || ((r.next_jalali_date || r.start_jalali_date) ? U.jalali_to_gregorian_date(r.next_jalali_date || r.start_jalali_date) : ''));
    if (!baseG) continue;
    for (let i = 0; i < 12; i++) {
      const g = advance_recurring_gregorian_date(baseG, r.interval_type, i);
      const j = U.gregorian_to_jalali_date(g);
      const label = (r.title || 'تکرارشونده') + ' — ' + j;
      const isSel = (String(selectedDate) === String(j)) && (!selectedRecurring || selectedRecurring === r.id);
      out += '<option data-recurring="' + U.esc_attr(r.id) + '" data-gregorian="' + U.esc_attr(g) + '" value="' + U.esc_attr(j) + '"' + (isSel ? ' selected' : '') + '>' + U.esc_html(label) + '</option>';
    }
  }
  return out + '</select>';
}
function goal_select(name, selected) {
  name = name || 'goal_id'; selected = Number(selected) || 0;
  let out = '<select name="' + U.esc_attr(name) + '"><option value="0">بدون هدف مالی</option>';
  for (const g of get_goals(false)) out += '<option value="' + U.esc_attr(g.id) + '"' + U.selected(selected, g.id) + '>' + U.esc_html('🎯 ' + g.title) + '</option>';
  return out + '</select>';
}
function get_goals(activeOnly) {
  const where = activeOnly ? "WHERE status='active'" : 'WHERE 1=1';
  return D.all('SELECT * FROM hpa_goals ' + where + ' ORDER BY id DESC');
}

// ================= recurring / loan / settlement logic =================
function resolve_recurring_payment_selection(recurringId, dueJalali, dueRecurringId) {
  recurringId = U.absint(recurringId); dueRecurringId = U.absint(dueRecurringId);
  dueJalali = String(dueJalali || '').replace(/[۰-۹٠-٩]/g, d => String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(d) % 10)).replace(/[^0-9/\-]/g, '').replace(/-/g, '/');
  let rec = null;
  const cand = [...new Set([recurringId, dueRecurringId].filter(Boolean))];
  for (const id of cand) { rec = D.get('SELECT * FROM hpa_recurring WHERE id=? LIMIT 1', [id]); if (rec) break; }
  if (!rec && dueJalali) {
    const exact = D.get("SELECT * FROM hpa_recurring WHERE status='active' AND (next_jalali_date=? OR start_jalali_date=?) ORDER BY id DESC LIMIT 1", [dueJalali, dueJalali]);
    if (exact) rec = exact;
  }
  if (!rec && dueJalali) {
    const targetG = U.jalali_to_gregorian_date(dueJalali);
    const rows = D.all("SELECT * FROM hpa_recurring WHERE status='active' ORDER BY id DESC LIMIT 150");
    outer: for (const candidate of rows) {
      const baseG = candidate.next_gregorian_date || (candidate.start_gregorian_date || '');
      if (!baseG) continue;
      for (let i = 0; i < 24; i++) if (advance_recurring_gregorian_date(baseG, candidate.interval_type, i) === targetG) { rec = candidate; break outer; }
    }
  }
  if (!rec) return [0, dueJalali, dueJalali ? U.jalali_to_gregorian_date(dueJalali) : null];
  if (!dueJalali) dueJalali = rec.next_jalali_date || rec.start_jalali_date;
  const dueGregorian = dueJalali ? U.jalali_to_gregorian_date(dueJalali) : (rec.next_gregorian_date || rec.start_gregorian_date);
  return [rec.id, dueJalali, dueGregorian || null];
}
function sync_recurring_payment_status(recurringId) {
  recurringId = U.absint(recurringId); if (!recurringId) return;
  const rec = D.get('SELECT * FROM hpa_recurring WHERE id=?', [recurringId]); if (!rec) return;
  let baseG = rec.next_gregorian_date || ((rec.next_jalali_date || '') ? U.jalali_to_gregorian_date(rec.next_jalali_date) : '');
  if (!baseG) baseG = rec.start_gregorian_date || ((rec.start_jalali_date || '') ? U.jalali_to_gregorian_date(rec.start_jalali_date) : '');
  if (!baseG) return;
  const paidDates = D.all("SELECT DISTINCT recurring_due_gregorian_date AS d FROM hpa_transactions WHERE recurring_id=? AND type='recurring_debt' AND status='done' AND recurring_due_gregorian_date IS NOT NULL", [recurringId]).map(r => r.d);
  const paidMap = {}; for (const p of paidDates) if (p) paidMap[String(p)] = true;
  let nextG = baseG;
  for (let i = 0; i < 600; i++) { if (!paidMap[nextG]) break; nextG = advance_recurring_gregorian_date(nextG, rec.interval_type, 1); }
  const nextJ = U.gregorian_to_jalali_date(nextG);
  D.update('hpa_recurring', { next_jalali_date: nextJ, next_gregorian_date: nextG, updated_at: U.now_mysql() }, { id: recurringId });
}
function update_debt_like_payment(tableKey, id, amount, currency) {
  id = U.absint(id); if (!id) return;
  const table = D.TABLES[tableKey];
  const row = D.get('SELECT * FROM ' + table + ' WHERE id=?', [id]); if (!row) return;
  const paidExistingToman = amount_to_toman(Number(row.paid_amount) || 0, row.currency);
  const totalToman = amount_to_toman(Number(row.amount) || 0, row.currency);
  const newPaidToman = Math.max(0, paidExistingToman + amount_to_toman(amount, currency));
  const newPaidNative = toman_to_currency(Math.min(newPaidToman, totalToman), row.currency);
  const status = newPaidToman + 0.0001 >= totalToman ? 'paid' : (newPaidToman > 0 ? 'partial' : 'open');
  D.update(table, { paid_amount: newPaidNative, status: status, updated_at: U.now_mysql() }, { id: id });
}
function sync_check_settlement_status(checkId) {
  checkId = U.absint(checkId); if (!checkId) return;
  const tx = D.get("SELECT id,jalali_date,gregorian_date FROM hpa_transactions WHERE type='check_settlement' AND status!='cancelled' AND check_id=? ORDER BY gregorian_date DESC, id DESC LIMIT 1", [checkId]);
  if (tx) D.update('hpa_checks', { status: 'paid', paid_transaction_id: tx.id, paid_jalali_date: tx.jalali_date, paid_gregorian_date: tx.gregorian_date, updated_at: U.now_mysql() }, { id: checkId });
  else D.update('hpa_checks', { status: 'open', paid_transaction_id: 0, paid_jalali_date: null, paid_gregorian_date: null, updated_at: U.now_mysql() }, { id: checkId });
}
function get_installment(id) { return D.get('SELECT i.*, l.title AS loan_title FROM hpa_loan_installments i LEFT JOIN hpa_loans l ON l.id=i.loan_id WHERE i.id=?', [id]); }
function refresh_loan_paid_count(loanId) {
  const paid = Number(D.scalar("SELECT COUNT(*) AS c FROM hpa_loan_installments WHERE loan_id=? AND status='paid'", [loanId])) || 0;
  const total = Number(D.scalar('SELECT COUNT(*) AS c FROM hpa_loan_installments WHERE loan_id=?', [loanId])) || 0;
  const status = (total > 0 && paid >= total) ? 'paid' : 'open';
  D.update('hpa_loans', { paid_installments: paid, status: status, updated_at: U.now_mysql() }, { id: loanId });
}
function count_monthly_installments(first, last) {
  if (!first || !last) return 0;
  const a = new Date(first + 'T00:00:00'), b = new Date(last + 'T00:00:00');
  if (b < a) return 0;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
}
function parse_installment_overrides(text) {
  const out = {};
  const lines = String(text || '').split(/\r\n|\r|\n/);
  for (let line of lines) {
    line = line.trim(); if (line === '') continue;
    line = line.replace(/[=:،]/g, '|');
    const partsArr = line.split('|').map(s => s.trim()).filter(s => s.length);
    if (partsArr.length < 2) continue;
    const key = partsArr[0].replace(/[^0-9/\-]/g, '');
    const amount = U.money_val(partsArr[1]);
    if (key !== '' && amount > 0) out[key] = amount;
  }
  return out;
}
function installment_override_amount(overrides, no, jalaliDate, def) {
  const keys = [String(no), String(no).replace(/^0+/, ''), String(jalaliDate)];
  for (const k of keys) if (k !== '' && overrides[k] && Number(overrides[k]) > 0) return Number(overrides[k]);
  return Number(def);
}
function regenerate_loan_installments(loanId, loan) {
  D.del('hpa_loan_installments', { loan_id: loanId });
  const total = Math.max(0, Number(loan.total_installments) || 0);
  const paid = Math.max(0, Math.min(total, Number(loan.paid_installments) || 0));
  let amount = Number(loan.installment_amount) || 0;
  if (amount <= 0 && total > 0) amount = (Number(loan.principal_amount) || 0) / total;
  const overrides = loan.variable_installments ? parse_installment_overrides(loan.installment_overrides || '') : {};
  const first = loan.first_due_gregorian_date || U.today_gregorian();
  const now = U.now_mysql();
  for (let i = 1; i <= total; i++) {
    const g = U.date_add_months(first, i - 1);
    const j = U.gregorian_to_jalali_date(g);
    const rowAmount = installment_override_amount(overrides, i, j, amount);
    D.insert('hpa_loan_installments', { user_id: 0, loan_id: loanId, installment_no: i, amount: rowAmount, currency: loan.currency, due_jalali_date: j, due_gregorian_date: g, status: (i <= paid ? 'paid' : 'open'), created_at: now, updated_at: now });
  }
  refresh_loan_paid_count(loanId);
}
function get_or_create_reconciliation_category(type) {
  type = type === 'income' ? 'income' : 'expense';
  const name = 'متفرقه/تطابق';
  const id = Number(D.scalar('SELECT id FROM hpa_categories WHERE name=? AND type=? LIMIT 1', [name, type])) || 0;
  if (id) return id;
  const res = D.insert('hpa_categories', { user_id: 0, name: name, type: type, icon: '⚖️', color: '#E0F2FE', is_default: 0, is_essential: 1, created_at: U.now_mysql() });
  return res.lastInsertRowid;
}
function archive_item_before_delete(tableKey, id, titleField) {
  id = U.absint(id); if (!id) return;
  const table = D.TABLES[tableKey]; if (!table) return;
  const row = D.get('SELECT * FROM ' + table + ' WHERE id=?', [id]); if (!row) return;
  const title = row[titleField] !== undefined && row[titleField] !== null ? String(row[titleField]) : (tableKey + ' #' + id);
  D.insert('hpa_deleted_items', { table_key: tableKey, original_id: id, item_title: U.wp_strip_all_tags(title), item_data: JSON.stringify(row), deleted_by: 0, deleted_at: U.now_mysql() });
}

// ================= POST helpers =================
function P(post, key, def) { const v = post[key]; return (v === undefined || v === null) ? (def === undefined ? '' : def) : String(v).trim(); }
function PT(post, key) { const v = post[key]; return (v === undefined || v === null) ? '' : String(v); }
function PM(post, key) { return U.money_val(post[key]); }
function PI(post, key) { return U.absint(post[key]); }
function PB(post, key) { return post[key] !== undefined && post[key] !== '' && post[key] !== '0' && post[key] !== false; }

let DUP_WARNING = 0; // transient replacement for duplicate warning

// Auto "received loan/debt" transaction: increases the account balance but is NOT income.
function get_or_create_debt_category() {
  const name = 'قرض/وام دریافتی';
  let id = Number(D.scalar('SELECT id FROM hpa_categories WHERE name=? LIMIT 1', [name])) || 0;
  if (id) return id;
  const res = D.insert('hpa_categories', { user_id: 0, name: name, type: 'income', icon: '🤝', color: '#E0F2FE', is_default: 0, is_essential: 0, created_at: U.now_mysql() });
  return res.lastInsertRowid;
}
// Keep a single linked debt_incur transaction in sync for a debt/loan.
function sync_incur_transaction(linkField, linkId, opts) {
  const existing = D.get("SELECT * FROM hpa_transactions WHERE type='debt_incur' AND " + linkField + "=? ORDER BY id DESC LIMIT 1", [linkId]);
  const accountId = Number(opts.account_id) || 0;
  const amount = Number(opts.amount) || 0;
  if (!accountId || amount <= 0) { if (existing) D.del('hpa_transactions', { id: existing.id }); return; }
  const cat = get_or_create_debt_category();
  const jalali = opts.jalali_date || today_jalali();
  const data = {
    user_id: 0, person_key: opts.person_key || 'hamidreza', from_person_key: opts.person_key || 'hamidreza', to_person_key: opts.person_key || 'hamidreza',
    account_id: accountId, to_account_id: 0, category_id: cat, type: 'debt_incur', amount: amount, fee_amount: 0, currency: opts.currency || 'toman',
    jalali_date: jalali, gregorian_date: U.jalali_to_gregorian_date(jalali), description: opts.description || 'دریافت قرض/وام',
    transaction_place: '', tags: 'قرض', status: 'done', updated_at: U.now_mysql()
  };
  data[linkField] = linkId;
  if (existing) D.update('hpa_transactions', data, { id: existing.id });
  else { data.created_at = U.now_mysql(); D.insert('hpa_transactions', data); }
}
function delete_incur_transaction(linkField, linkId) {
  const rows = D.all("SELECT id FROM hpa_transactions WHERE type='debt_incur' AND " + linkField + "=?", [linkId]);
  for (const r of rows) D.del('hpa_transactions', { id: r.id });
}

// ================= ACTIONS =================
function save_account(post) {
  const id = PI(post, 'id');
  let type = P(post, 'type', 'cash');
  if (!account_types()[type]) type = 'cash';
  const data = {
    user_id: 0, person_key: P(post, 'person_key', 'hamidreza'), name: P(post, 'name'), type: type, currency: P(post, 'currency', 'toman'),
    opening_balance: PM(post, 'opening_balance'), bank_name: P(post, 'bank_name'), account_number: P(post, 'account_number'),
    card_number: P(post, 'card_number'), iban: P(post, 'iban'), icon: P(post, 'icon', '💳'), color: P(post, 'color', '#fde68a'),
    note: PT(post, 'note'), is_active: PB(post, 'is_active') ? 1 : 0, updated_at: U.now_mysql()
  };
  if (id) D.update('hpa_accounts', data, { id }); else { data.created_at = U.now_mysql(); D.insert('hpa_accounts', data); }
  return 'accounts';
}
function delete_account(post) { D.update('hpa_accounts', { is_active: 0 }, { id: PI(post, 'id') }); return 'accounts'; }
function reopen_account(post) { D.update('hpa_accounts', { is_active: 1, updated_at: U.now_mysql() }, { id: PI(post, 'id') }); return 'accounts'; }

function save_category(post) {
  const id = PI(post, 'id');
  const data = { user_id: 0, name: P(post, 'name'), type: P(post, 'type', 'expense'), icon: P(post, 'icon', '📌'), color: P(post, 'color', '#E0E7FF'), is_essential: PB(post, 'is_essential') ? 1 : 0 };
  if (id) D.update('hpa_categories', data, { id }); else { data.is_default = 0; data.created_at = U.now_mysql(); D.insert('hpa_categories', data); }
  return 'categories';
}
function delete_category(post) { const id = PI(post, 'id'); const row = D.get('SELECT * FROM hpa_categories WHERE id=? AND is_default=0', [id]); if (row) { archive_item_before_delete('categories', id, 'name'); D.run('DELETE FROM hpa_categories WHERE id=? AND is_default=0', [id]); } return 'categories'; }

function save_transaction(post, files) {
  const jalaliInit = P(post, 'jalali_date'); let jalali = jalaliInit; let greg = U.jalali_to_gregorian_date(jalali);
  const receipt = save_uploads(files, 'receipt', 'transaction', 0);
  const id = PI(post, 'id');
  const old = id ? D.get('SELECT * FROM hpa_transactions WHERE id=?', [id]) : null;
  const oldCheckId = old ? (Number(old.check_id) || 0) : 0;
  const oldRecurringId = old ? (Number(old.recurring_id) || 0) : 0;
  if (old) {
    if (Number(old.loan_installment_id) || 0) {
      const inst = get_installment(Number(old.loan_installment_id));
      D.update('hpa_loan_installments', { status: 'open', paid_transaction_id: 0, updated_at: U.now_mysql() }, { id: Number(old.loan_installment_id) });
      if (inst) refresh_loan_paid_count(Number(inst.loan_id));
    }
    if (old.type === 'debt_settlement' && (Number(old.debt_id) || 0)) update_debt_like_payment('debts', Number(old.debt_id), -1 * (Number(old.amount) || 0), old.currency);
    if (old.type === 'receivable_settlement' && (Number(old.receivable_id) || 0)) update_debt_like_payment('receivables', Number(old.receivable_id), -1 * (Number(old.amount) || 0), old.currency);
  }
  const type = P(post, 'type', 'expense');
  const fromPerson = P(post, 'from_person_key', P(post, 'person_key', 'hamidreza'));
  const toPerson = P(post, 'to_person_key', 'samira');
  const isLoanRelated = PB(post, 'hpa_is_loan_related') || type === 'loan_installment';
  let recurringId = 0, recurringDueJalali = '', recurringDueGregorian = null;
  if (type === 'recurring_debt') {
    [recurringId, recurringDueJalali, recurringDueGregorian] = resolve_recurring_payment_selection(PI(post, 'recurring_id'), P(post, 'recurring_due_jalali_date'), PI(post, 'recurring_due_recurring_id'));
    if (recurringDueJalali && !jalali) { jalali = recurringDueJalali; greg = recurringDueGregorian || U.jalali_to_gregorian_date(jalali); }
  }
  const data = {
    user_id: 0,
    person_key: (type === 'person_transfer' ? fromPerson : P(post, 'person_key', 'hamidreza')),
    from_person_key: fromPerson, to_person_key: toPerson,
    account_id: PI(post, 'account_id'), to_account_id: (type === 'person_transfer' ? 0 : PI(post, 'to_account_id')),
    category_id: (type === 'person_transfer' || type === 'transfer' ? 0 : PI(post, 'category_id')),
    type: type, amount: PM(post, 'amount'),
    fee_amount: ['transfer', 'person_transfer'].indexOf(type) > -1 ? PM(post, 'fee_amount') : 0,
    currency: P(post, 'currency', 'toman'), jalali_date: jalali, gregorian_date: greg,
    description: PT(post, 'description'), transaction_place: P(post, 'transaction_place'), tags: P(post, 'tags'),
    source_loan_id: isLoanRelated ? PI(post, 'source_loan_id') : 0,
    loan_installment_id: isLoanRelated ? PI(post, 'loan_installment_id') : 0,
    debt_id: (type === 'debt_settlement') ? PI(post, 'debt_id') : 0,
    receivable_id: (type === 'receivable_settlement') ? PI(post, 'receivable_id') : 0,
    check_id: (type === 'check_settlement') ? PI(post, 'check_id') : 0,
    asset_id: ['asset_buy', 'asset_sell'].indexOf(type) > -1 ? PI(post, 'asset_id') : 0,
    asset_quantity: (type === 'asset_sell') ? PM(post, 'asset_quantity') : 0,
    recurring_id: (type === 'recurring_debt') ? recurringId : 0,
    recurring_due_jalali_date: (type === 'recurring_debt') ? recurringDueJalali : null,
    recurring_due_gregorian_date: (type === 'recurring_debt') ? recurringDueGregorian : null,
    status: P(post, 'status', 'done'), hide_amount: PB(post, 'hide_amount') ? 1 : 0, updated_at: U.now_mysql()
  };
  if (receipt) data.receipt_id = receipt;
  if (!id) {
    const dup = Number(D.scalar("SELECT id FROM hpa_transactions WHERE status!='cancelled' AND account_id=? AND type=? AND amount=? AND currency=? AND jalali_date=? AND COALESCE(description,'')=? LIMIT 1",
      [data.account_id, data.type, data.amount, data.currency, data.jalali_date, data.description || ''])) || 0;
    if (dup && !PB(post, 'hpa_allow_duplicate')) { DUP_WARNING = dup; return 'transactions'; }
  }
  let transactionId;
  if (id) { D.update('hpa_transactions', data, { id }); transactionId = id; }
  else { data.created_at = U.now_mysql(); const r = D.insert('hpa_transactions', data); transactionId = r.lastInsertRowid; }
  // splits
  D.del('hpa_transaction_splits', { transaction_id: transactionId });
  if (['transfer', 'person_transfer'].indexOf(type) < 0 && PB(post, 'hpa_split_categories')) {
    const splitRows = [[data.category_id, data.amount], [PI(post, 'split_category_id_2'), PM(post, 'split_amount_2')], [PI(post, 'split_category_id_3'), PM(post, 'split_amount_3')]];
    for (const sr of splitRows) if (Number(sr[0]) > 0 && Number(sr[1]) > 0) D.insert('hpa_transaction_splits', { transaction_id: transactionId, category_id: Number(sr[0]), amount: Number(sr[1]), currency: data.currency, created_at: U.now_mysql() });
  }
  // Per-item line prices (independent of the total) — for item-level spending reports.
  D.del('hpa_transaction_items', { transaction_id: transactionId });
  let items = [];
  try { const raw = PT(post, 'hpa_items'); if (raw) items = JSON.parse(raw); } catch (e) { items = []; }
  if (Array.isArray(items)) {
    for (const it of items) {
      const name = String((it && it.name) || '').trim();
      const amt = U.money_val(it && it.amount);
      if (name && amt > 0) D.insert('hpa_transaction_items', { transaction_id: transactionId, name: name, amount: amt, currency: data.currency, jalali_date: data.jalali_date, gregorian_date: data.gregorian_date, created_at: U.now_mysql() });
    }
  }
  const installmentId = Number(data.loan_installment_id) || 0;
  if (transactionId && installmentId && data.status !== 'cancelled') {
    const inst = get_installment(installmentId);
    if (inst) { D.update('hpa_loan_installments', { status: 'paid', paid_transaction_id: transactionId, updated_at: U.now_mysql() }, { id: installmentId }); refresh_loan_paid_count(Number(inst.loan_id)); }
  }
  if (transactionId && data.status !== 'cancelled') {
    if (type === 'debt_settlement' && Number(data.debt_id)) update_debt_like_payment('debts', Number(data.debt_id), data.amount, data.currency);
    if (type === 'receivable_settlement' && Number(data.receivable_id)) update_debt_like_payment('receivables', Number(data.receivable_id), data.amount, data.currency);
  }
  const newCheckId = Number(data.check_id) || 0;
  if (oldCheckId && oldCheckId !== newCheckId) sync_check_settlement_status(oldCheckId);
  if (newCheckId) sync_check_settlement_status(newCheckId);
  const newRecurringId = Number(data.recurring_id) || 0;
  if (oldRecurringId && oldRecurringId !== newRecurringId) sync_recurring_payment_status(oldRecurringId);
  if (newRecurringId) sync_recurring_payment_status(newRecurringId);
  return 'transactions';
}
function delete_transaction(post) {
  const id = PI(post, 'id');
  const tr = D.get('SELECT * FROM hpa_transactions WHERE id=?', [id]);
  if (tr) {
    if (Number(tr.loan_installment_id)) {
      const inst = get_installment(Number(tr.loan_installment_id));
      D.update('hpa_loan_installments', { status: 'open', paid_transaction_id: 0, updated_at: U.now_mysql() }, { id: Number(tr.loan_installment_id) });
      if (inst) refresh_loan_paid_count(Number(inst.loan_id));
    }
    if (tr.type === 'debt_settlement' && (Number(tr.debt_id) || 0)) update_debt_like_payment('debts', Number(tr.debt_id), -1 * (Number(tr.amount) || 0), tr.currency);
    if (tr.type === 'receivable_settlement' && (Number(tr.receivable_id) || 0)) update_debt_like_payment('receivables', Number(tr.receivable_id), -1 * (Number(tr.amount) || 0), tr.currency);
  }
  const oldCheckId = tr ? (Number(tr.check_id) || 0) : 0;
  const oldRecurringId = tr ? (Number(tr.recurring_id) || 0) : 0;
  archive_item_before_delete('transactions', id, 'description');
  D.del('hpa_transaction_items', { transaction_id: id });
  D.del('hpa_transactions', { id });
  if (oldCheckId) sync_check_settlement_status(oldCheckId);
  if (oldRecurringId) sync_recurring_payment_status(oldRecurringId);
  return 'transactions';
}

function save_debt_like(post, files, tableKey, tab) {
  const jalali = P(post, 'jalali_date'); const due = P(post, 'due_jalali_date');
  const receipt = save_uploads(files, 'receipt', tableKey, 0);
  const isDebt = tableKey === 'debts';
  const data = {
    user_id: 0, person_name: P(post, 'person_name'), phone: P(post, 'phone'), amount: PM(post, 'amount'), paid_amount: PM(post, 'paid_amount'),
    currency: P(post, 'currency', 'toman'), jalali_date: jalali, gregorian_date: U.jalali_to_gregorian_date(jalali),
    due_jalali_date: due, due_gregorian_date: due ? U.jalali_to_gregorian_date(due) : null, status: P(post, 'status', 'open'),
    note: PT(post, 'note'), updated_at: U.now_mysql()
  };
  if (isDebt) data.account_id = PI(post, 'account_id');
  if (receipt) data.receipt_id = receipt;
  let objectId = PI(post, 'id');
  if (objectId) D.update(D.TABLES[tableKey], data, { id: objectId });
  else { data.created_at = U.now_mysql(); const r = D.insert(D.TABLES[tableKey], data); objectId = r.lastInsertRowid; }
  // Borrowing money credits an account but is NOT income.
  if (isDebt) sync_incur_transaction('debt_id', objectId, { account_id: data.account_id, amount: data.amount, currency: data.currency, jalali_date: jalali, description: 'دریافت قرض از ' + (data.person_name || '—') });
  return tab;
}
function delete_debt(post) { const id = PI(post, 'id'); archive_item_before_delete('debts', id, 'person_name'); delete_incur_transaction('debt_id', id); D.del('hpa_debts', { id }); return 'debt'; }
function delete_receivable(post) { const id = PI(post, 'id'); archive_item_before_delete('receivables', id, 'person_name'); D.del('hpa_receivables', { id }); return 'receivable'; }

function save_asset(post, files) {
  const jalali = P(post, 'jalali_date'); const receipt = save_uploads(files, 'receipt', 'asset', 0); const id = PI(post, 'id');
  const assetGroup = P(post, 'asset_group', 'gold');
  const cryptoItems = crypto_rate_items();
  const isCrypto = assetGroup === 'crypto';
  let model = isCrypto ? U.sanitize_key(P(post, 'model_crypto', '')) : P(post, 'model');
  if (isCrypto && !cryptoItems[model]) { const keys = Object.keys(cryptoItems); model = keys.length ? keys[0] : 'btc'; }
  const weight = isCrypto ? 0 : PM(post, 'weight');
  const quantity = (assetGroup === 'gold') ? 0 : PM(post, 'quantity');
  const purchasePrice = PM(post, 'purchase_price');
  const unitBase = ['gold', 'silver'].indexOf(assetGroup) > -1 ? weight : (quantity > 0 ? quantity : weight);
  const unitPrice = unitBase > 0 ? Math.round((purchasePrice / unitBase) * 1e8) / 1e8 : 0;
  const data = {
    user_id: 0, person_key: P(post, 'person_key', 'hamidreza'), title: P(post, 'title'), asset_group: assetGroup, model: model,
    purity: isCrypto ? '' : P(post, 'purity'), weight: weight, quantity: quantity, unit: isCrypto ? String(model).toUpperCase() : P(post, 'unit'),
    purchase_price: purchasePrice, unit_price: unitPrice, currency: P(post, 'currency', 'toman'), jalali_date: jalali, gregorian_date: U.jalali_to_gregorian_date(jalali),
    purchase_place: P(post, 'purchase_place'), source_loan_id: PI(post, 'source_loan_id'), goal_id: PI(post, 'goal_id'), funding_source: P(post, 'funding_source', 'personal'),
    note: PT(post, 'note'), is_active: PB(post, 'is_active') ? 1 : 0, updated_at: U.now_mysql()
  };
  if (receipt) data.receipt_id = receipt;
  if (id) D.update('hpa_assets', data, { id }); else { data.created_at = U.now_mysql(); D.insert('hpa_assets', data); }
  return 'assets';
}
function delete_asset(post) { const id = PI(post, 'id'); archive_item_before_delete('assets', id, 'title'); D.del('hpa_assets', { id }); return 'assets'; }

function save_loan(post) {
  const id = PI(post, 'id');
  const received = P(post, 'received_jalali_date') || today_jalali();
  const firstDue = P(post, 'first_due_jalali_date');
  const lastDue = P(post, 'last_due_jalali_date');
  const firstGreg = firstDue ? U.jalali_to_gregorian_date(firstDue) : null;
  const lastGreg = lastDue ? U.jalali_to_gregorian_date(lastDue) : null;
  const principal = PM(post, 'principal_amount');
  const total = count_monthly_installments(firstGreg, lastGreg);
  let installmentAmount = PM(post, 'installment_amount');
  if (installmentAmount <= 0 && total > 0) installmentAmount = Math.round((principal / total) * 100) / 100;
  const postedPaid = Math.max(0, U.absint(P(post, 'paid_installments', 0)));
  const paidExisting = total > 0 ? Math.min(total, postedPaid) : postedPaid;
  const accountId = PI(post, 'account_id');
  const data = {
    user_id: 0, person_key: P(post, 'person_key', 'hamidreza'), title: P(post, 'title'), lender: P(post, 'lender'),
    principal_amount: principal, currency: P(post, 'currency', 'toman'), account_id: accountId, received_jalali_date: received, received_gregorian_date: U.jalali_to_gregorian_date(received),
    used_for: PT(post, 'used_for'), total_installments: total, paid_installments: paidExisting, installment_amount: installmentAmount,
    variable_installments: PB(post, 'variable_installments') ? 1 : 0, installment_overrides: PT(post, 'installment_overrides'),
    first_due_jalali_date: firstDue, first_due_gregorian_date: firstGreg, last_due_jalali_date: lastDue, last_due_gregorian_date: lastGreg,
    status: P(post, 'status', 'open'), note: PT(post, 'note'), updated_at: U.now_mysql()
  };
  let lid = id;
  if (id) D.update('hpa_loans', data, { id }); else { data.created_at = U.now_mysql(); const r = D.insert('hpa_loans', data); lid = r.lastInsertRowid; }
  if (lid) regenerate_loan_installments(lid, data);
  // Receiving the loan principal credits an account but is NOT income.
  if (lid) sync_incur_transaction('source_loan_id', lid, { account_id: accountId, amount: principal, currency: data.currency, jalali_date: received, person_key: data.person_key, description: 'دریافت وام ' + (data.title || '') });
  return 'debt';
}
function delete_loan(post) {
  const id = PI(post, 'id'); archive_item_before_delete('loans', id, 'title');
  const inst = D.all('SELECT * FROM hpa_loan_installments WHERE loan_id=?', [id]);
  for (const i of inst) archive_item_before_delete('loan_installments', i.id, 'due_jalali_date');
  delete_incur_transaction('source_loan_id', id);
  D.del('hpa_loan_installments', { loan_id: id }); D.del('hpa_loans', { id }); return 'debt';
}
function save_check(post) {
  const due = P(post, 'first_due_jalali_date'); const id = PI(post, 'id');
  const data = {
    user_id: 0, person_key: P(post, 'person_key', 'hamidreza'), title: P(post, 'title'), check_count: Math.max(1, U.absint(P(post, 'check_count', 1))),
    amount_each: PM(post, 'amount_each'), currency: P(post, 'currency', 'toman'), first_due_jalali_date: due, first_due_gregorian_date: due ? U.jalali_to_gregorian_date(due) : null,
    used_for: PT(post, 'used_for'), include_in_assets: PB(post, 'include_in_assets') ? 1 : 0, status: P(post, 'status', 'open'), note: PT(post, 'note'), updated_at: U.now_mysql()
  };
  if (id) D.update('hpa_checks', data, { id }); else { data.created_at = U.now_mysql(); D.insert('hpa_checks', data); }
  return 'debt';
}
function delete_check(post) { const id = PI(post, 'id'); archive_item_before_delete('checks', id, 'title'); D.del('hpa_checks', { id }); return 'debt'; }
function save_recurring(post) {
  const id = PI(post, 'id');
  const start = P(post, 'start_jalali_date') || today_jalali();
  const next = P(post, 'next_jalali_date') || start;
  const data = {
    user_id: 0, person_key: P(post, 'person_key', 'hamidreza'), title: P(post, 'title'), category_id: PI(post, 'category_id'), account_id: PI(post, 'account_id'), type: P(post, 'type', 'expense'),
    amount: PM(post, 'amount'), currency: P(post, 'currency', 'toman'), interval_type: P(post, 'interval_type', 'monthly'),
    start_jalali_date: start, start_gregorian_date: U.jalali_to_gregorian_date(start), next_jalali_date: next, next_gregorian_date: U.jalali_to_gregorian_date(next),
    status: P(post, 'status', 'active'), note: PT(post, 'note'), updated_at: U.now_mysql()
  };
  if (id) D.update('hpa_recurring', data, { id }); else { data.created_at = U.now_mysql(); D.insert('hpa_recurring', data); }
  return 'debt';
}
function delete_recurring(post) { const id = PI(post, 'id'); archive_item_before_delete('recurring', id, 'title'); D.del('hpa_recurring', { id }); return 'debt'; }
function save_goal(post) {
  const id = PI(post, 'id'); const jalali = P(post, 'target_jalali_date');
  const data = { user_id: 0, title: P(post, 'title'), target_amount: PM(post, 'target_amount'), currency: P(post, 'currency', 'toman'), target_jalali_date: jalali, target_gregorian_date: jalali ? U.jalali_to_gregorian_date(jalali) : null, note: PT(post, 'note'), status: P(post, 'status', 'active'), updated_at: U.now_mysql() };
  if (id) D.update('hpa_goals', data, { id }); else { data.created_at = U.now_mysql(); D.insert('hpa_goals', data); }
  return 'assets';
}
function delete_goal(post) { const id = PI(post, 'id'); archive_item_before_delete('goals', id, 'title'); D.del('hpa_goals', { id }); return 'assets'; }
function save_rate(post) {
  const items = rate_items(); let key = U.sanitize_key(P(post, 'rate_key'));
  if (!items[key]) key = 'usd';
  const jalali = P(post, 'jalali_date');
  const data = { rate_key: key, title: items[key][0], type: items[key][1], price: PM(post, 'price'), unit: 'toman', source: P(post, 'source', 'دستی'), jalali_date: jalali, gregorian_date: U.jalali_to_gregorian_date(jalali), note: PT(post, 'note'), is_manual: 1, updated_at: U.now_mysql() };
  const exists = Number(D.scalar('SELECT id FROM hpa_rates WHERE rate_key=?', [key])) || 0;
  if (exists) D.update('hpa_rates', data, { id: exists }); else { data.created_at = U.now_mysql(); D.insert('hpa_rates', data); }
  return 'rates';
}
function delete_rate(post) { const id = PI(post, 'id'); archive_item_before_delete('rates', id, 'title'); D.del('hpa_rates', { id }); return 'rates'; }
function reconcile_account(post) {
  const accountId = PI(post, 'account_id'); const actual = PM(post, 'actual_balance');
  const account = D.get('SELECT * FROM hpa_accounts WHERE id=?', [accountId]); if (!account) return 'accounts';
  const balances = calculate_balances(); const calc = Number(balances[accountId]) || 0; const diff = actual - calc;
  if (Math.abs(diff) > 0.0001) {
    const type = diff >= 0 ? 'income' : 'expense';
    const cat = get_or_create_reconciliation_category(type);
    const jalali = today_jalali();
    D.insert('hpa_transactions', {
      user_id: 0, person_key: account.person_key || 'hamidreza', from_person_key: account.person_key || 'hamidreza', to_person_key: account.person_key || 'hamidreza',
      account_id: accountId, to_account_id: 0, category_id: cat, type: type, amount: Math.abs(diff), fee_amount: 0, currency: account.currency || 'toman',
      jalali_date: jalali, gregorian_date: U.jalali_to_gregorian_date(jalali), description: 'اصلاحیه خودکار تطبیق مانده حساب: ' + (diff >= 0 ? 'افزایش' : 'کاهش') + ' مانده',
      transaction_place: 'تطبیق مانده', tags: 'تطابق,اصلاحیه', status: 'done', created_at: U.now_mysql(), updated_at: U.now_mysql()
    });
  }
  return 'accounts';
}
function restore_deleted_item(post) {
  const id = PI(post, 'id');
  const item = D.get('SELECT * FROM hpa_deleted_items WHERE id=?', [id]);
  if (item && D.TABLES[item.table_key]) {
    let data; try { data = JSON.parse(item.item_data); } catch (e) { data = null; }
    if (data && typeof data === 'object') {
      const table = D.TABLES[item.table_key];
      if (data.id) { const exists = Number(D.scalar('SELECT id FROM ' + table + ' WHERE id=?', [data.id])) || 0; if (exists) delete data.id; }
      D.insert(table, data); D.del('hpa_deleted_items', { id });
    }
  }
  return 'rates';
}
function permanent_delete_item(post) { D.del('hpa_deleted_items', { id: PI(post, 'id') }); return 'rates'; }

// uploads: save files into userData/uploads, record attachment rows, return first attachment id
let UPLOAD_DIR = null;
function setUploadDir(d) { UPLOAD_DIR = d; }
function save_uploads(files, field, objectType, objectId) {
  if (!files) return 0;
  const list = files[field] || files[field + '[]'];
  if (!list) return 0;
  const fs = require('fs'), path = require('path');
  const arr = Array.isArray(list) ? list : [list];
  let firstId = 0;
  for (const f of arr) {
    if (!f || !f.filename || !f.data || !f.data.length) continue;
    try {
      if (UPLOAD_DIR && !fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const safe = Date.now() + '-' + Math.floor(Math.random() * 1e6) + '-' + f.filename.replace(/[^\w.\-]+/g, '_');
      const dest = path.join(UPLOAD_DIR, safe);
      fs.writeFileSync(dest, f.data);
      const r = D.insert('hpa_attachment_files', { filename: f.filename, stored_path: dest, mime: f.mime || '', created_at: U.now_mysql() });
      const attId = r.lastInsertRowid;
      D.insert('hpa_attachments', { user_id: 0, object_type: U.sanitize_key(objectType), object_id: objectId || 0, attachment_id: attId, created_at: U.now_mysql() });
      if (!firstId) firstId = attId;
    } catch (e) { /* ignore */ }
  }
  return firstId;
}

// ================= VIEW: chrome =================
function topbar(active) {
  const tabs = { dashboard: 'داشبورد', accounts: 'حساب‌ها', transactions: 'تراکنش‌ها', categories: 'موضوعات', debt: 'بدهی', receivable: 'طلب', assets: 'دارایی‌ها', reports: 'گزارش‌ها', rates: 'نرخ‌ها', settings: 'تنظیمات' };
  const icons = { dashboard: '🏠', accounts: '💳', transactions: '↔️', categories: '🏷️', debt: '📉', receivable: '📈', assets: '💰', reports: '📊', rates: '⚙️', settings: '🔧' };
  let out = '<header class="hpa-top"><div class="hpa-brand"><span class="hpa-brand-logo"><img src="/assets/img/logo.svg" alt="' + U.esc_attr(APP_NAME) + '"></span><div class="hpa-brand-text"><strong>' + U.esc_html(APP_NAME) + '</strong><span>' + U.esc_html(APP_SUBTITLE) + '</span></div></div><nav class="hpa-desktop-nav">';
  for (const k in tabs) out += '<a class="' + (active === k ? 'is-active' : '') + '" href="' + U.esc_url(buildUrl({ hpa_tab: k })) + '"><span class="hpa-nav-ico">' + U.esc_html(icons[k]) + '</span><span>' + U.esc_html(tabs[k]) + '</span></a>';
  out += '</nav></header><nav class="hpa-mobile-nav" aria-label="منوی حسابداری شخصی">';
  const mobileTabs = { dashboard: tabs.dashboard, transactions: tabs.transactions, assets: tabs.assets, reports: tabs.reports, settings: 'تنظیمات' };
  for (const k in mobileTabs) out += '<a class="' + (active === k ? 'is-active' : '') + '" href="' + U.esc_url(buildUrl({ hpa_tab: k })) + '"><span class="hpa-nav-ico">' + U.esc_html(icons[k]) + '</span><span>' + U.esc_html(mobileTabs[k]) + '</span></a>';
  out += '</nav>';
  if (CTX.query.hpa_msg) out += '<div class="hpa-toast">اطلاعات با موفقیت ذخیره شد.</div>';
  return out;
}
function tab_header(active) {
  const data = {
    accounts: ['حساب‌ها', 'دفترها، مانده‌ها، تطبیق حساب و صورت‌حساب‌ها', '💳'],
    transactions: ['تراکنش‌ها', 'ثبت، فیلتر، بررسی و مدیریت جریان پول', '↔️'],
    categories: ['موضوعات', 'دسته‌بندی درآمد و هزینه با رنگ و آیکن', '🏷️'],
    debt: ['بدهی و تعهدات', 'وام، اقساط، چک، بدهی‌های تکرارشونده و تعهدات آینده', '📉'],
    receivable: ['طلب‌ها', 'مدیریت طلب‌ها، وصول کامل و وصول جزئی', '📈'],
    assets: ['دارایی‌ها', 'دارایی، هدف مالی، ارزش فعلی و سود/زیان', '💰'],
    reports: ['گزارش‌ها', 'تحلیل مالی، نمودارها و گزارش‌های تصمیم‌ساز', '📊'],
    rates: ['نرخ‌ها', 'نرخ ارز، طلا و کریپتو با به‌روزرسانی خودکار', '⚙️'],
    settings: ['تنظیمات', 'ظاهر، اشخاص، امنیت و اتصال به سایت', '🔧']
  };
  if (active === 'dashboard' || !data[active]) return '';
  const d = data[active];
  return '<section class="hpa-tab-identity"><span>' + U.esc_html(d[2]) + '</span><div><h1>' + U.esc_html(d[0]) + '</h1><p>' + U.esc_html(d[1]) + '</p></div></section>';
}
function kpi(title, value, icon, extraClass) { return '<article class="hpa-kpi ' + U.esc_attr(extraClass || '') + '"><span>' + icon + '</span><small>' + U.esc_html(title) + '</small><strong>' + U.esc_html(value) + '</strong></article>'; }
function kpi_asset_current(value, profit, icon) {
  const cls = profit >= 0 ? 'hpa-profit-positive' : 'hpa-profit-negative';
  const label = (profit >= 0 ? 'سود: ' : 'زیان: ') + fmt_money(Math.abs(profit), 'toman');
  return '<article class="hpa-kpi hpa-kpi-asset-current"><span>' + icon + '</span><small>ارزش فعلی دارایی‌ها</small><strong>' + U.esc_html(value) + '</strong><em class="' + U.esc_attr(cls) + '">' + U.esc_html(label) + '</em></article>';
}
function transaction_flow_class(r) {
  const type = r.type || '';
  if (['income', 'asset_sell', 'receivable_settlement', 'debt_incur'].indexOf(type) > -1) return 'in';
  if (type === 'person_transfer') { const to = r.to_person_key || '', from = r.from_person_key || ''; if (to === 'hamidreza' || to === 'joint') return 'in'; if (from === 'hamidreza' || from === 'joint') return 'out'; return 'neutral'; }
  if (type === 'transfer') return 'neutral';
  return 'out';
}

// ================= VIEW: dashboard =================
function loan_remaining_total_toman() { return rows_sum_toman(D.all("SELECT amount,currency FROM hpa_loan_installments WHERE status!='paid'")); }
function check_open_total_toman() { return rows_sum_toman(D.all("SELECT (amount_each * check_count) AS amount, currency FROM hpa_checks WHERE status!='paid'")); }

function view_dashboard() {
  let accounts = get_accounts().slice();
  const balances = calculate_balances();
  accounts.sort((a, b) => { const at = amount_to_toman(balances[a.id] || 0, a.currency); const bt = amount_to_toman(balances[b.id] || 0, b.currency); if (at === bt) return b.id - a.id; return bt - at; });
  const dashboardAccounts = accounts.slice(0, 5);
  const assetSummary = asset_summary_totals();
  const assetsTotal = assetSummary.current;
  const assetProfit = assetSummary.profit;
  const assetIcon = assetProfit >= 0 ? '<span class="hpa-trend-icon hpa-trend-up">↗</span>' : '<span class="hpa-trend-icon hpa-trend-down">↘</span>';
  const debtsTotal = table_sum_toman('debts', 'amount', "status!='paid'") + loan_remaining_total_toman() + check_open_total_toman();
  const recvTotal = table_sum_toman('receivables', 'amount', "status!='paid'");
  const range = current_jalali_month_gregorian_range();
  const income = transaction_sum_toman('income', "gregorian_date BETWEEN '" + range[0] + "' AND '" + range[1] + "'");
  const expense = transaction_sum_toman(expense_types(), "gregorian_date BETWEEN '" + range[0] + "' AND '" + range[1] + "'");
  const monthlyNet = income - expense;
  const usdRate = latest_rate_price('usd');
  const gold18Rate = latest_rate_price('gold18');
  const heroClass = monthlyNet >= 0 ? 'hpa-hero-positive' : 'hpa-hero-negative';
  const heroLabel = monthlyNet >= 0 ? 'مازاد ماه جاری' : 'کسری ماه جاری';
  let out = '<section class="hpa-hero-finance hpa-hero-finance-fixed ' + U.esc_attr(heroClass) + '"><div class="hpa-hero-copy"><span class="hpa-eyebrow">خلاصه مالی ماه جاری</span><h1>' + U.esc_html(heroLabel) + ': ' + U.esc_html(fmt_money(Math.abs(monthlyNet), 'toman')) + '</h1></div><div class="hpa-hero-metrics hpa-hero-market-metrics"><div><small>دلار</small><b>' + U.esc_html(usdRate ? fmt_money(usdRate, 'toman') : 'ثبت نشده') + '</b></div><div><small>طلای ۱۸ عیار</small><b>' + U.esc_html(gold18Rate ? fmt_money(gold18Rate, 'toman') : 'ثبت نشده') + '</b></div></div></section>';
  out += '<section class="hpa-grid hpa-kpis">';
  out += kpi('موجودی حساب‌ها', fmt_money(total_balances_toman(balances), 'toman'), '💶');
  out += kpi_asset_current(fmt_money(assetsTotal, 'toman'), assetProfit, assetIcon);
  out += kpi('طلب‌های باز', fmt_money(recvTotal, 'toman'), '🤝', 'hpa-mobile-hide');
  out += kpi('بدهی‌های باز', fmt_money(debtsTotal, 'toman'), '⚠️', 'hpa-mobile-hide');
  out += kpi('درآمد ماه', fmt_money(income, 'toman'), '📈');
  out += kpi('هزینه ماه', fmt_money(expense, 'toman'), '📉');
  out += '</section>';
  out += loan_due_reminders();
  out += check_due_reminders();
  out += recurring_due_reminders();
  out += '<section class="hpa-three hpa-dashboard-middle"><div class="hpa-card hpa-dashboard-expenses"><h3>ترکیب هزینه‌ها</h3>' + expense_chart(false, true, true) + '</div><div class="hpa-card hpa-dashboard-accounts"><h3>حساب‌ها</h3>';
  if (!dashboardAccounts.length) out += '<p class="hpa-muted">هنوز حسابی ثبت نشده است.</p>';
  else for (const a of dashboardAccounts) { const c = a.color || '#eef2ff'; out += '<div class="hpa-list-row hpa-dashboard-account-row" style="background:' + U.esc_attr(c) + '"><span class="hpa-badge">' + U.esc_html(a.icon) + '</span><b>' + U.esc_html(a.name) + '</b><em>' + U.esc_html(fmt_money(balances[a.id] || 0, a.currency)) + '</em></div>'; }
  out += '</div>' + dashboard_future_obligations_preview() + '</section>';
  out += '<section class="hpa-card hpa-recent-card-section"><div class="hpa-section-head"><div><h3>آخرین تراکنش‌ها</h3><p class="hpa-muted">سه تراکنش آخر با جزئیات جمع‌شونده</p></div></div>' + recent_transaction_cards(3) + '<div class="hpa-more-under"><a class="hpa-btn hpa-btn-ghost hpa-more-btn" href="' + U.esc_url(buildUrl({ hpa_tab: 'transactions' })) + '">نمایش بیشتر</a></div></section>';
  return out;
}
function recent_transaction_cards(limit) {
  limit = limit || 3;
  const types = transaction_types();
  const rows = D.all("SELECT t.*, a.name account_name, c.id cat_id, c.name cat_name, c.icon cat_icon, c.color cat_color FROM hpa_transactions t LEFT JOIN hpa_accounts a ON a.id=t.account_id LEFT JOIN hpa_categories c ON c.id=t.category_id WHERE t.status!='cancelled' ORDER BY t.gregorian_date DESC, t.id DESC LIMIT ?", [limit]);
  let out = '<div class="hpa-recent-tx-cards">';
  if (!rows.length) out += '<p class="hpa-muted">هنوز تراکنشی ثبت نشده است.</p>';
  for (const r of rows) {
    const flow = transaction_flow_class(r);
    const moneyClass = flow === 'in' ? 'hpa-positive' : (flow === 'out' ? 'hpa-negative' : 'hpa-neutral');
    const flowIcon = flow === 'in' ? '↗' : (flow === 'out' ? '↘' : '↔');
    let tags = ''; for (const tag of String(r.tags || '').replace(/#/g, '').split(',').map(s => s.trim()).filter(Boolean)) tags += clickable_tag(tag) + ' ';
    const editUrl = buildUrl({ hpa_tab: 'transactions', hpa_edit_transaction: r.id });
    const balAfter = account_balance_after_transaction(r);
    const balanceLine = balAfter ? '<p><strong>مانده حساب بعد از تراکنش:</strong> ' + U.esc_html(fmt_money(balAfter.balance, balAfter.currency)) + '</p>' : '';
    const hide = !!r.hide_amount;
    const amtHtml = hide ? '<span class="hpa-amount-hidden" aria-hidden="true">***</span>' : '<b class="' + U.esc_attr(moneyClass) + '">' + U.esc_html(fmt_money(r.amount, r.currency)) + '</b>';
    out += '<details class="hpa-recent-tx-card hpa-flow-' + U.esc_attr(flow) + (hide ? ' hpa-tx-hidden' : '') + '"><summary><span class="hpa-flow-mark">' + U.esc_html(flowIcon) + '</span><span class="hpa-recent-main">' + amtHtml + '<small>' + U.esc_html(r.jalali_date) + ' · ' + U.esc_html(types[r.type] || r.type) + '</small></span><span class="hpa-recent-cat" style="background:' + U.esc_attr(r.cat_color || '#eef2ff') + '">' + clickable_category(Number(r.cat_id) || 0, r.cat_name || 'بدون موضوع', r.cat_icon || '📌') + '</span></summary><div class="hpa-recent-details"><p><strong>حساب:</strong> ' + U.esc_html(r.account_name || '—') + '</p>' + balanceLine + '<p><strong>محل تراکنش:</strong> ' + U.esc_html((r.transaction_place || '') || '—') + '</p><p><strong>توضیح:</strong> ' + U.esc_html(r.description || '—') + '</p><p><strong>برچسب‌ها:</strong> ' + (tags || '<span class="hpa-muted">ندارد</span>') + '</p><div class="hpa-row-actions"><a class="hpa-edit" href="' + U.esc_url(editUrl) + '">ویرایش</a>' + delete_button('hpa_delete_transaction', r.id, 'dashboard') + '</div></div></details>';
  }
  return out + '</div>';
}
function loan_due_reminders() {
  const today = U.today_gregorian(); const to = U.date_add_days(today, 5);
  const rows = D.all("SELECT i.*, l.title AS loan_title FROM hpa_loan_installments i LEFT JOIN hpa_loans l ON l.id=i.loan_id WHERE i.status!='paid' AND i.due_gregorian_date BETWEEN ? AND ? ORDER BY i.due_gregorian_date ASC LIMIT 5", [today, to]);
  if (!rows.length) return '';
  let out = '<section class="hpa-card hpa-loan-reminders"><h3>یادآور اقساط نزدیک</h3>';
  for (const r of rows) { const url = buildUrl({ hpa_tab: 'transactions', hpa_pay_loan: r.id }); out += '<div class="hpa-list-row hpa-warn-row"><span class="hpa-badge">🏦</span><b>' + U.esc_html(r.loan_title) + ' — قسط ' + (Number(r.installment_no) || 0) + '<small>موعد: ' + U.esc_html(r.due_jalali_date) + '</small></b><em>' + U.esc_html(fmt_money(r.amount, r.currency)) + '</em><a class="hpa-btn hpa-btn-small" href="' + U.esc_url(url) + '">پرداخت کردم</a></div>'; }
  return out + '</section>';
}
function check_due_reminders() {
  const today = U.today_gregorian(); const to = U.date_add_days(today, 30);
  const rows = D.all("SELECT * FROM hpa_checks WHERE status!='paid' AND first_due_gregorian_date BETWEEN ? AND ? ORDER BY first_due_gregorian_date ASC LIMIT 10", [today, to]);
  if (!rows.length) return '';
  let out = '<section class="hpa-card hpa-check-reminders"><h3>چک‌های آینده ۳۰ روزه</h3>';
  for (const r of rows) { const url = buildUrl({ hpa_tab: 'transactions', hpa_pay_check: r.id }); const total = (Number(r.amount_each) || 0) * Math.max(1, Number(r.check_count) || 0); out += '<div class="hpa-list-row hpa-warn-row"><span class="hpa-badge">🧾</span><b>' + U.esc_html(r.title) + '<small>موعد: ' + U.esc_html(r.first_due_jalali_date) + ' | ' + U.esc_html(r.used_for) + '</small></b><em>' + U.esc_html(fmt_money(total, r.currency)) + '</em><a class="hpa-btn hpa-btn-small" href="' + U.esc_url(url) + '">پرداخت کردم</a></div>'; }
  return out + '</section>';
}
function recurring_due_reminders() {
  const today = U.today_gregorian(); const to = U.date_add_days(today, 5);
  const rows = D.all("SELECT * FROM hpa_recurring WHERE status='active' AND next_gregorian_date BETWEEN ? AND ? ORDER BY next_gregorian_date ASC LIMIT 5", [today, to]);
  if (!rows.length) return '';
  let out = '<section class="hpa-card hpa-recurring-reminders"><h3>یادآور تراکنش‌های تکرارشونده</h3>';
  for (const r of rows) out += '<div class="hpa-list-row hpa-warn-row"><span class="hpa-badge">🔁</span><b>' + U.esc_html(r.title) + '<small>موعد بعدی: ' + U.esc_html(r.next_jalali_date) + '</small></b><em>' + U.esc_html(fmt_money(r.amount, r.currency)) + '</em><a class="hpa-btn hpa-btn-small" href="' + U.esc_url(buildUrl({ hpa_tab: 'transactions', hpa_q: r.title })) + '">ثبت پرداخت</a></div>';
  return out + '</section>';
}
function dashboard_future_obligations_preview() {
  const items = future_obligation_items(12).slice(0, 4);
  let out = '<div class="hpa-card hpa-dashboard-obligations"><div class="hpa-section-head"><div><h3>تعهدات آینده</h3><p class="hpa-muted">سه مورد نزدیک‌تر</p></div></div><div class="hpa-dashboard-obligation-list">';
  let count = 0;
  for (const it of items) { count++; if (count <= 3) out += obligation_card_html(it, 'hpa-dashboard-obligation-card'); }
  if (!items.length) out += '<p class="hpa-muted">تعهد آینده‌ای ثبت نشده است.</p>';
  out += '<a class="hpa-obligation-more-peek" href="' + U.esc_url(buildUrl({ hpa_tab: 'debt' }) + '#hpa-future-obligations') + '">مشاهده همه تعهدات آینده</a></div></div>';
  return out;
}

// ================= VIEW: accounts =================
function view_accounts() {
  const curr = currencies(); const types = account_types(); const balances = calculate_balances();
  const editId = U.absint(CTX.query.hpa_edit_account);
  const edit = editId ? D.get('SELECT * FROM hpa_accounts WHERE id=?', [editId]) : null;
  const isEdit = !!edit;
  let out = '<details class="hpa-card hpa-account-form-details' + (isEdit ? ' hpa-editing' : '') + '"' + (isEdit ? ' open' : '') + '><summary class="hpa-account-form-summary">' + (isEdit ? '✏️ ویرایش حساب' : '➕ ثبت حساب جدید') + '</summary>';
  out += form_open('hpa_save_account');
  if (isEdit) out += '<input type="hidden" name="id" value="' + U.esc_attr(edit.id) + '">';
  const name = isEdit ? edit.name : ''; const person = isEdit ? (edit.person_key || 'hamidreza') : 'hamidreza'; const type = isEdit ? edit.type : 'cash'; const currency = isEdit ? edit.currency : 'toman';
  out += '<div class="hpa-form-grid"><label>نام حساب<input name="name" required placeholder="مثلاً کارت ملت / کیف پول" value="' + U.esc_attr(name) + '"></label><label>شخص' + person_select('person_key', person) + '</label><label>نوع حساب<select name="type">';
  for (const k in types) out += '<option value="' + U.esc_attr(k) + '"' + U.selected(type, k) + '>' + U.esc_html(types[k]) + '</option>';
  out += '</select></label><label>واحد پول<select name="currency">';
  for (const k of ['toman', 'rial', 'usd', 'eur']) out += '<option value="' + U.esc_attr(k) + '"' + U.selected(currency, k) + '>' + U.esc_html(curr[k]) + '</option>';
  out += '</select></label><label>موجودی اولیه<input name="opening_balance" inputmode="decimal" value="' + U.esc_attr(isEdit ? edit.opening_balance : '') + '"></label><label>نام بانک<input name="bank_name" value="' + U.esc_attr(isEdit ? (edit.bank_name || '') : '') + '"></label><label>شماره حساب<input name="account_number" value="' + U.esc_attr(isEdit ? (edit.account_number || '') : '') + '"></label><label>شماره کارت<input name="card_number" value="' + U.esc_attr(isEdit ? (edit.card_number || '') : '') + '"></label><label>شبا<input name="iban" value="' + U.esc_attr(isEdit ? (edit.iban || '') : '') + '"></label><label>آیکن/اموجی<input name="icon" value="' + U.esc_attr(isEdit ? (edit.icon || '💳') : '💳') + '"></label><label>رنگ<input type="color" name="color" value="' + U.esc_attr(isEdit ? (edit.color || '#ede9fe') : '#ede9fe') + '"></label><label>فعال باشد؟ <span class="hpa-checkline"><input type="checkbox" name="is_active" value="1"' + U.checked(isEdit ? Number(edit.is_active) : 1, 1) + '> بله</span></label><label class="hpa-col-full">توضیح<textarea name="note">' + U.esc_textarea(isEdit ? (edit.note || '') : '') + '</textarea></label></div>';
  out += form_close(isEdit ? 'ذخیره تغییرات حساب' : 'ثبت حساب');
  if (isEdit) out += '<a class="hpa-btn hpa-btn-ghost hpa-cancel-edit" href="' + U.esc_url(removeArgUrl('hpa_edit_account')) + '">انصراف از ویرایش</a>';
  out += '</details>';
  out += '<section class="hpa-card"><div class="hpa-section-head"><div><h2>حساب‌های من</h2></div></div>';
  const rows = get_accounts();
  out += '<div class="hpa-account-card-grid">';
  if (!rows.length) out += '<p class="hpa-muted">هنوز حسابی ثبت نشده است.</p>';
  for (const r of rows) {
    const editUrl = buildUrl({ hpa_tab: 'accounts', hpa_edit_account: r.id });
    const bal = Number(balances[r.id] !== undefined ? balances[r.id] : r.opening_balance) || 0;
    const bg = r.color || '#ede9fe';
    out += '<details class="hpa-account-card"><summary style="background:' + U.esc_attr(bg) + '">';
    out += '<span class="hpa-account-card-icon">' + U.esc_html(r.icon || '💳') + '</span>';
    out += '<div class="hpa-account-card-info"><strong>' + U.esc_html(r.name) + '</strong><small>' + U.esc_html(person_label(r.person_key || 'hamidreza')) + ' · ' + U.esc_html(types[r.type] || r.type) + '</small></div>';
    out += '<span class="hpa-account-card-balance">' + U.esc_html(fmt_money(bal, r.currency)) + '</span></summary>';
    out += '<div class="hpa-account-card-body"><div class="hpa-account-card-details">';
    out += '<div><span>ارز</span><strong>' + U.esc_html(curr[r.currency] || r.currency) + '</strong></div>';
    out += '<div><span>موجودی اولیه</span><strong>' + U.esc_html(fmt_money(r.opening_balance, r.currency)) + '</strong></div>';
    if (r.bank_name) out += '<div><span>بانک</span><strong>' + U.esc_html(r.bank_name) + '</strong></div>';
    if (r.card_number) out += '<div><span>کارت</span><strong>' + U.esc_html(r.card_number) + '</strong></div>';
    if (r.iban) out += '<div><span>شبا</span><strong>' + U.esc_html(r.iban) + '</strong></div>';
    out += '</div>';
    out += '<div class="hpa-account-card-reconcile"><form class="hpa-inline-form" method="post" action="/action"><input type="hidden" name="action" value="hpa_reconcile_account"><input type="hidden" name="hpa_token" value="' + U.esc_attr(CTX.token) + '"><input type="hidden" name="account_id" value="' + U.esc_attr(r.id) + '"><input name="actual_balance" inputmode="decimal" placeholder="موجودی واقعی برای تطبیق"><button class="hpa-btn hpa-btn-small" type="submit">⚖️ تطبیق</button></form></div>';
    out += '<div class="hpa-row-actions"><a class="hpa-edit" href="' + U.esc_url(editUrl) + '">ویرایش</a>' + delete_button('hpa_delete_account', r.id, 'accounts') + '</div>';
    out += '</div></details>';
  }
  out += '</div></section>';
  out += accounts_accounting_reports();
  return out;
}
function accounts_accounting_reports() {
  const s = settings();
  const showInactive = !!s.show_inactive_accounts;
  const accounts = showInactive ? D.all('SELECT * FROM hpa_accounts ORDER BY is_active DESC, id DESC') : get_accounts();
  const range = current_jalali_month_gregorian_range();
  let out = '<section class="hpa-card hpa-accounting-books"><div class="hpa-section-head"><div><h2>دفترهای حسابداری شخصی</h2><p class="hpa-muted">دفتر روزنامه، دفتر کل و صورت‌حساب‌ها اینجا آمده‌اند تا داشبورد و تراکنش‌ها شلوغ نشوند.</p></div></div>';
  out += '<details class="hpa-book-block hpa-journal-collapsed" open><summary>دفتر روزنامه شخصی</summary>';
  out += '<div class="hpa-journal-desktop"><div class="hpa-table-wrap"><table class="hpa-table"><thead><tr><th>تاریخ</th><th>رویداد</th><th>حساب/شخص</th><th>مبلغ</th><th>توضیح</th></tr></thead><tbody>';
  let journal = [];
  const tx = D.all("SELECT t.*, a.name account_name FROM hpa_transactions t LEFT JOIN hpa_accounts a ON a.id=t.account_id WHERE t.status!='cancelled' ORDER BY t.gregorian_date DESC, t.id DESC LIMIT 80");
  for (const r of tx) journal.push({ g: r.gregorian_date, j: r.jalali_date, e: transaction_types()[r.type] || r.type, a: r.account_name || person_label(r.person_key), m: fmt_money(r.amount, r.currency), d: r.description || r.transaction_place });
  const as = D.all('SELECT * FROM hpa_assets ORDER BY gregorian_date DESC, id DESC LIMIT 30');
  for (const r of as) journal.push({ g: r.gregorian_date, j: r.jalali_date, e: 'ثبت دارایی', a: person_label(r.person_key), m: fmt_money(r.purchase_price, r.currency), d: r.title });
  const db2 = D.all('SELECT * FROM hpa_debts ORDER BY gregorian_date DESC, id DESC LIMIT 30');
  for (const r of db2) journal.push({ g: r.gregorian_date, j: r.jalali_date, e: 'ثبت بدهی', a: r.person_name, m: fmt_money(r.amount, r.currency), d: r.note });
  journal.sort((a, b) => String(b.g).localeCompare(String(a.g)));
  journal = journal.slice(0, 80);
  if (!journal.length) out += '<tr><td colspan="5" class="hpa-muted">رویدادی ثبت نشده است.</td></tr>';
  journal.forEach((r, i) => { out += '<tr' + (i >= 5 ? ' class="hpa-journal-extra"' : '') + '><td>' + U.esc_html(r.j) + '</td><td>' + U.esc_html(r.e) + '</td><td>' + U.esc_html(r.a) + '</td><td>' + U.esc_html(r.m) + '</td><td>' + U.esc_html(U.wp_trim_words(r.d, 10)) + '</td></tr>'; });
  out += '</tbody></table></div></div>';
  out += '<div class="hpa-journal-mobile">';
  if (!journal.length) out += '<p class="hpa-muted">رویدادی ثبت نشده است.</p>';
  journal.forEach((r, i) => { out += '<div class="hpa-journal-mobile-card' + (i >= 5 ? ' hpa-journal-extra' : '') + '"><div class="hpa-journal-mc-top"><span class="hpa-journal-mc-date">' + U.esc_html(r.j) + '</span><span class="hpa-journal-mc-type">' + U.esc_html(r.e) + '</span></div><div class="hpa-journal-mc-mid"><strong>' + U.esc_html(r.a) + '</strong><em>' + U.esc_html(r.m) + '</em></div>' + (r.d ? '<p class="hpa-journal-mc-desc">' + U.esc_html(U.wp_trim_words(r.d, 8)) + '</p>' : '') + '</div>'; });
  out += '</div>' + (journal.length > 5 ? '<button type="button" class="hpa-btn hpa-journal-more">نمایش همهٔ رویدادها (' + U.number_format_i18n(journal.length) + ')</button>' : '') + '</details>';
  out += '<div class="hpa-two hpa-account-reports-grid"><section class="hpa-card hpa-subcard"><h3>دفتر کل حساب‌ها</h3>';
  for (const a of accounts) {
    let bal = Number(a.opening_balance) || 0;
    out += '<details class="hpa-ledger-card"><summary><b>' + U.esc_html((a.icon || '💳') + ' ' + a.name) + '</b><small>' + U.esc_html(a.is_active ? 'فعال' : 'بسته‌شده') + '</small></summary><div class="hpa-ledger-lines">';
    const rows = D.all("SELECT * FROM hpa_transactions WHERE account_id=? AND status!='cancelled' ORDER BY gregorian_date ASC, id ASC LIMIT 120", [a.id]);
    if (!rows.length) out += '<p class="hpa-muted">گردشی ثبت نشده است.</p>';
    for (const r of rows) { bal = apply_transaction_to_balance(bal, a.currency, r); out += '<div class="hpa-list-row"><b>' + U.esc_html(r.jalali_date + ' · ' + (transaction_types()[r.type] || r.type)) + '</b><span>' + U.esc_html(fmt_money(r.amount, r.currency)) + '</span><em>مانده: ' + U.esc_html(fmt_money(bal, a.currency)) + '</em></div>'; }
    out += '</div></details>';
  }
  out += '</section><section class="hpa-card hpa-subcard"><h3>صورت‌حساب ماهانه هر حساب</h3>';
  for (const a of accounts) {
    let startBal = Number(a.opening_balance) || 0;
    const before = D.all("SELECT * FROM hpa_transactions WHERE account_id=? AND status!='cancelled' AND gregorian_date < ? ORDER BY gregorian_date ASC, id ASC", [a.id, range[0]]);
    for (const r of before) startBal = apply_transaction_to_balance(startBal, a.currency, r);
    const month = D.all("SELECT * FROM hpa_transactions WHERE account_id=? AND status!='cancelled' AND gregorian_date BETWEEN ? AND ? ORDER BY gregorian_date ASC,id ASC", [a.id, range[0], range[1]]);
    let inn = 0, outg = 0, end = startBal;
    for (const r of month) { const old = end; end = apply_transaction_to_balance(end, a.currency, r); const delta = end - old; if (delta >= 0) inn += delta; else outg += Math.abs(delta); }
    out += '<div class="hpa-list-row"><b>' + U.esc_html(a.name) + '<small>مانده اول/پایان ماه</small></b><span>' + U.esc_html(fmt_money(startBal, a.currency)) + ' → ' + U.esc_html(fmt_money(end, a.currency)) + '</span><em>ورودی: ' + U.esc_html(fmt_money(inn, a.currency)) + '<br>خروجی: ' + U.esc_html(fmt_money(outg, a.currency)) + '</em></div>';
  }
  if (showInactive) {
    out += '</section></div><section class="hpa-card hpa-subcard"><h3>حساب‌های بسته‌شده</h3>';
    const closed = accounts.filter(a => !Number(a.is_active));
    if (!closed.length) out += '<p class="hpa-muted">حساب بسته‌شده‌ای وجود ندارد.</p>';
    for (const a of closed) { const url = actionUrl('hpa_reopen_account', { id: a.id }); out += '<div class="hpa-list-row"><b>' + U.esc_html((a.icon || '💳') + ' ' + a.name) + '</b><span>' + U.esc_html(person_label(a.person_key)) + '</span><a class="hpa-btn hpa-btn-small hpa-btn-ghost" href="' + U.esc_url(url) + '">فعال‌سازی دوباره</a></div>'; }
    out += '</section></section>';
  } else out += '</section></div></section>';
  return out;
}

// ================= VIEW: categories =================
function view_categories() {
  const editId = U.absint(CTX.query.hpa_edit_category);
  const edit = editId ? D.get('SELECT * FROM hpa_categories WHERE id=?', [editId]) : null;
  const isEdit = !!edit;
  let out = '<section class="hpa-card ' + (isEdit ? 'hpa-editing' : '') + '"><h2>' + (isEdit ? 'ویرایش موضوع تراکنش' : 'افزودن موضوع تراکنش') + '</h2>' + form_open('hpa_save_category');
  if (isEdit) out += '<input type="hidden" name="id" value="' + U.esc_attr(edit.id) + '">';
  const name = isEdit ? edit.name : ''; const type = isEdit ? edit.type : 'expense'; const icon = isEdit ? (edit.icon || '📌') : '📌'; const color = isEdit ? (edit.color || '#e0e7ff') : '#e0e7ff'; const essential = isEdit ? Number(edit.is_essential !== undefined ? edit.is_essential : 1) : 1;
  out += '<div class="hpa-form-grid"><label>نام موضوع<input name="name" required placeholder="مثلاً خرید لوازم آموزشی" value="' + U.esc_attr(name) + '"></label><label>نوع<select name="type"><option value="expense"' + U.selected(type, 'expense') + '>هزینه</option><option value="income"' + U.selected(type, 'income') + '>درآمد</option></select></label><label>آیکن/اموجی<input name="icon" value="' + U.esc_attr(icon) + '"></label><label>رنگ فلت<input type="color" name="color" value="' + U.esc_attr(color) + '"></label><label class="hpa-col-full"><span class="hpa-checkline"><input type="checkbox" name="is_essential" value="1"' + U.checked(essential, 1) + '> هزینه ضروری محسوب شود</span><small class="hpa-help">برای گزارش هزینه‌های ضروری/غیرضروری استفاده می‌شود.</small></label></div>';
  out += form_close(isEdit ? 'ذخیره تغییرات موضوع' : 'ثبت موضوع');
  if (isEdit) out += '<a class="hpa-btn hpa-btn-ghost hpa-cancel-edit" href="' + U.esc_url(removeArgUrl('hpa_edit_category')) + '">انصراف از ویرایش</a>';
  out += '</section><section class="hpa-card"><h2>موضوعات</h2><div class="hpa-category-list">';
  const typeLabels = { expense: 'هزینه', income: 'درآمد' };
  for (const c of get_categories()) {
    const editUrl = buildUrl({ hpa_tab: 'categories', hpa_edit_category: c.id });
    out += '<article class="hpa-category-item"><span class="hpa-category-icon" style="background:' + U.esc_attr(c.color) + '">' + U.esc_html(c.icon || '📌') + '</span><div class="hpa-category-text"><strong>' + U.esc_html(c.name) + '</strong><small class="hpa-category-meta">' + U.esc_html(typeLabels[c.type] || c.type) + (c.is_default ? ' | پیش‌فرض' : '') + (Number(c.is_essential !== undefined ? c.is_essential : 1) ? ' | ضروری' : ' | غیرضروری') + '</small></div><div class="hpa-row-actions"><a class="hpa-edit" href="' + U.esc_url(editUrl) + '">ویرایش</a>' + (c.is_default ? '' : delete_button('hpa_delete_category', c.id, 'categories')) + '</div></article>';
  }
  out += '</div></section>';
  return out;
}

// ================= VIEW: transactions =================
function view_transactions() {
  const accounts = get_accounts(); const categories = get_categories(); const curr = currencies(); const types = transaction_types();
  const editId = U.absint(CTX.query.hpa_edit_transaction);
  const edit = editId ? D.get('SELECT * FROM hpa_transactions WHERE id=?', [editId]) : null;
  const isEdit = !!edit;
  let existingItems = [];
  if (isEdit) existingItems = D.all('SELECT name, amount FROM hpa_transaction_items WHERE transaction_id=? ORDER BY id', [edit.id]).map(r => ({ name: r.name, amount: r.amount }));
  let out = '';
  if (DUP_WARNING) { out += '<section class="hpa-card hpa-alert hpa-alert-warning"><strong>هشدار تراکنش تکراری</strong><p>تراکنشی با همین مبلغ، حساب، تاریخ، نوع و توضیح قبلاً ثبت شده است. برای جلوگیری از ثبت اشتباه، عملیات ذخیره انجام نشد.</p><small>شناسه تراکنش مشابه: ' + U.esc_html(DUP_WARNING) + '</small></section>'; DUP_WARNING = 0; }
  out += '<section class="hpa-card hpa-transaction-form-card ' + (isEdit ? 'hpa-editing' : 'hpa-creating') + '"><h2>' + (isEdit ? 'ویرایش تراکنش' : 'ثبت تراکنش') + '</h2>' + form_open('hpa_save_transaction', true);
  if (isEdit) out += '<input type="hidden" name="id" value="' + U.esc_attr(edit.id) + '">';
  const payInstId = U.absint(CTX.query.hpa_pay_loan);
  const payInst = payInstId ? get_installment(payInstId) : null;
  const payCheckId = U.absint(CTX.query.hpa_pay_check);
  const payCheck = payCheckId ? D.get('SELECT * FROM hpa_checks WHERE id=?', [payCheckId]) : null;
  const etype = isEdit ? edit.type : (payInst ? 'loan_installment' : (payCheck ? 'check_settlement' : 'expense'));
  const eacc = isEdit ? Number(edit.account_id) : 0; const eto = isEdit ? Number(edit.to_account_id) : 0; const ecat = isEdit ? Number(edit.category_id) : 0;
  const ecur = isEdit ? edit.currency : (payInst ? (payInst.currency || 'toman') : (payCheck ? (payCheck.currency || 'toman') : 'toman'));
  const estatus = isEdit ? edit.status : 'done'; const eperson = isEdit ? (edit.person_key || 'hamidreza') : 'hamidreza';
  const efrom = isEdit ? (edit.from_person_key || eperson) : 'hamidreza';
  const etoPerson = isEdit ? (edit.to_person_key || 'samira') : 'samira';
  const eloan = isEdit ? Number(edit.source_loan_id || 0) : (payInst ? Number(payInst.loan_id) : 0);
  const einstall = isEdit ? Number(edit.loan_installment_id || 0) : payInstId;
  const edebt = isEdit ? Number(edit.debt_id || 0) : 0;
  const erecv = isEdit ? Number(edit.receivable_id || 0) : 0;
  const echeck = isEdit ? Number(edit.check_id || 0) : (payCheck ? Number(payCheck.id) : 0);
  const easset = isEdit ? Number(edit.asset_id || 0) : 0;
  const erecurring = isEdit ? Number(edit.recurring_id || 0) : 0;
  const erecurringDue = isEdit ? (edit.recurring_due_jalali_date || '') : '';
  const loanChecked = (eloan || einstall || etype === 'loan_installment');
  const presetAmount = isEdit ? edit.amount : (payInst ? Number(payInst.amount) : (payCheck ? (Number(payCheck.amount_each) * Math.max(1, Number(payCheck.check_count))) : ''));
  const presetDesc = isEdit ? edit.description : (payInst ? 'پرداخت قسط وام ' + payInst.loan_title + ' در تاریخ ' + payInst.due_jalali_date : (payCheck ? 'تسویه چک ' + payCheck.title + ' در تاریخ ' + payCheck.first_due_jalali_date : ''));
  out += '<div class="hpa-form-grid">';
  out += '<label class="hpa-person-normal-field">شخص' + person_select('person_key', eperson) + '</label>';
  out += '<label>نوع تراکنش<select name="type">'; for (const k in types) out += '<option value="' + U.esc_attr(k) + '"' + U.selected(etype, k) + '>' + U.esc_html(types[k]) + '</option>'; out += '</select></label>';
  out += '<label>حساب مرتبط<select name="account_id">'; for (const a of accounts) out += '<option value="' + U.esc_attr(a.id) + '"' + U.selected(eacc, a.id) + '>' + U.esc_html(a.icon + ' ' + a.name) + '</option>'; out += '</select></label>';
  out += '<label class="hpa-transfer-account-field">حساب مقصد در انتقال<select name="to_account_id"><option value="0">ندارد</option>'; for (const a of accounts) out += '<option value="' + U.esc_attr(a.id) + '"' + U.selected(eto, a.id) + '>' + U.esc_html(a.icon + ' ' + a.name) + '</option>'; out += '</select></label>';
  out += '<label class="hpa-person-transfer-field">مبدأ پول' + person_select('from_person_key', efrom) + '</label>';
  out += '<label class="hpa-person-transfer-field">مقصد پول' + person_select('to_person_key', etoPerson) + '</label>';
  out += '<label class="hpa-category-field">موضوع<select name="category_id" class="hpa-category-by-type"><option value="0" data-cat-type="all">بدون موضوع</option>'; for (const c of categories) out += '<option data-cat-type="' + U.esc_attr(c.type) + '" value="' + U.esc_attr(c.id) + '"' + U.selected(ecat, c.id) + '>' + U.esc_html(c.icon + ' ' + c.name) + '</option>'; out += '</select></label>';
  out += '<label class="hpa-col-full hpa-split-toggle-field"><span class="hpa-checkline"><input type="checkbox" name="hpa_split_categories" value="1"> تقسیم مبلغ بین چند دسته‌بندی</span><small class="hpa-help">اگر فعال شود، مبلغ دسته‌های دوم و سوم هم باید وارد شوند؛ جمع آن‌ها باید با مبلغ کل تراکنش یکی باشد.</small></label>';
  out += '<label class="hpa-split-field">موضوع دوم<select name="split_category_id_2" class="hpa-category-by-type"><option value="0" data-cat-type="all">انتخاب موضوع دوم</option>'; for (const c of categories) out += '<option data-cat-type="' + U.esc_attr(c.type) + '" value="' + U.esc_attr(c.id) + '">' + U.esc_html(c.icon + ' ' + c.name) + '</option>'; out += '</select></label><label class="hpa-split-field">مبلغ موضوع دوم<input name="split_amount_2" inputmode="decimal"></label>';
  out += '<label class="hpa-split-field">موضوع سوم<select name="split_category_id_3" class="hpa-category-by-type"><option value="0" data-cat-type="all">انتخاب موضوع سوم</option>'; for (const c of categories) out += '<option data-cat-type="' + U.esc_attr(c.type) + '" value="' + U.esc_attr(c.id) + '">' + U.esc_html(c.icon + ' ' + c.name) + '</option>'; out += '</select></label><label class="hpa-split-field">مبلغ موضوع سوم<input name="split_amount_3" inputmode="decimal"></label>';
  out += '<label>مبلغ<input name="amount" required inputmode="decimal" value="' + U.esc_attr(presetAmount) + '"></label><label class="hpa-transfer-fee-field">کارمزد انتقال<input name="fee_amount" inputmode="decimal" placeholder="اختیاری" value="' + U.esc_attr(isEdit ? (edit.fee_amount || 0) : '') + '"><small class="hpa-help">در انتقال بین حساب‌ها یا اشخاص از حساب مبدأ کم می‌شود.</small></label>';
  out += '<label>واحد پول<select name="currency">'; for (const k in curr) out += '<option value="' + U.esc_attr(k) + '"' + U.selected(ecur, k) + '>' + U.esc_html(curr[k]) + '</option>'; out += '</select></label>';
  out += '<label>تاریخ شمسی<input name="jalali_date" class="hpa-jdate" required value="' + U.esc_attr(isEdit ? edit.jalali_date : today_jalali()) + '" placeholder="1403/01/15"></label>';
  out += '<label>محل تراکنش<input name="transaction_place" placeholder="مثلاً افق کوروش" value="' + U.esc_attr(isEdit ? (edit.transaction_place || '') : '') + '"></label>';
  out += '<label>وضعیت<select name="status"><option value="done"' + U.selected(estatus, 'done') + '>انجام‌شده</option><option value="open"' + U.selected(estatus, 'open') + '>باز</option><option value="cancelled"' + U.selected(estatus, 'cancelled') + '>لغوشده</option></select></label>';
  const ehide = isEdit ? Number(edit.hide_amount || 0) : 0;
  out += '<label class="hpa-col-full"><span class="hpa-checkline"><input type="checkbox" name="hide_amount" value="1"' + U.checked(ehide, 1) + '> <strong>🔒 پنهان‌کردن مبلغ</strong></span><small class="hpa-help">اگر فعال شود، مبلغ این تراکنش در داشبورد و لیست تراکنش‌ها پنهان می‌شود. مبلغ واقعی در دفتر حساب و تمام محاسبات دست‌نخورده باقی می‌ماند.</small></label>';
  out += '<label class="hpa-col-full hpa-loan-toggle-field"><span class="hpa-checkline"><input type="checkbox" name="hpa_is_loan_related" value="1"' + U.checked(loanChecked ? 1 : 0, 1) + '> تراکنش وام/قسط است یا از محل وام انجام شده؟</span></label>';
  out += '<label class="hpa-loan-related-field hpa-source-loan-field">وام مرتبط' + loan_select('source_loan_id', eloan) + '<small class="hpa-help">اگر تراکنش یا خرید از محل وام خاصی بوده، اینجا مشخص کن؛ اصل وام به‌عنوان درآمد/دارایی حساب نمی‌شود.</small></label>';
  out += '<label class="hpa-loan-related-field hpa-installment-field">قسط مرتبط' + installment_select('loan_installment_id', eloan, einstall) + '</label>';
  out += '<label class="hpa-debt-settlement-field">بدهی مرتبط' + debt_select('debt_id', edebt) + '<small class="hpa-help">با ثبت مبلغ تراکنش، بدهی کامل یا بخشی تسویه می‌شود.</small></label>';
  out += '<label class="hpa-receivable-settlement-field">طلب مرتبط' + receivable_select('receivable_id', erecv) + '<small class="hpa-help">با ثبت مبلغ تراکنش، طلب کامل یا بخشی وصول می‌شود.</small></label>';
  out += '<label class="hpa-check-settlement-field">چک مرتبط' + check_select('check_id', echeck) + '<small class="hpa-help">با ثبت تراکنش تسویه چک، وضعیت چک پرداخت‌شده می‌شود و دیگر در چک‌های آینده نمایش داده نمی‌شود.</small></label>';
  out += '<label class="hpa-asset-link-field">دارایی مرتبط' + asset_select('asset_id', easset) + '<small class="hpa-help">برای خرید/فروش دارایی، تراکنش را به دارایی ثبت‌شده وصل کن.</small></label><label class="hpa-asset-sell-field">مقدار فروخته‌شده<input name="asset_quantity" inputmode="decimal" value="' + U.esc_attr(isEdit ? (edit.asset_quantity || '') : '') + '"><small class="hpa-help">برای فروش جزئی دارایی و گزارش سود/زیان تحقق‌یافته.</small></label>';
  out += '<input type="hidden" name="recurring_due_recurring_id" value="' + U.esc_attr(erecurring) + '">';
  out += '<label class="hpa-recurring-debt-field">بدهی تکرارشونده' + recurring_select('recurring_id', erecurring) + '</label>';
  out += '<label class="hpa-recurring-debt-field">تاریخ سررسید بدهی تکرارشونده' + recurring_due_select('recurring_due_jalali_date', erecurring, erecurringDue) + '<small class="hpa-help">اگر زودتر پرداخت می‌کنی، باز هم تاریخ سررسید همان بدهی را انتخاب کن.</small></label>';
  out += '<label class="hpa-tags-field">برچسب‌ها<input class="hpa-tags-input" name="tags" placeholder="برچسب را بنویس و Enter بزن" value="' + U.esc_attr(isEdit ? edit.tags : '') + '"><small class="hpa-help">با هر Enter یک برچسب اضافه می‌شود؛ می‌توانی چند برچسب ثبت کنی.</small></label>';
  out += '<label class="hpa-col-full hpa-items-field">اقلام خرید (اختیاری)<div class="hpa-items-editor" data-items="' + U.esc_attr(JSON.stringify(existingItems)) + '"></div><input type="hidden" name="hpa_items" value="' + U.esc_attr(JSON.stringify(existingItems)) + '"><small class="hpa-help">نام هر قلم و قیمتش را وارد کن و Enter بزن. مستقل از مبلغ کل است و در گزارش «خرج به تفکیک قلم» جمع می‌شود.</small></label>';
  out += '<label>رسید خرید/پرداخت<input type="file" name="receipt[]" accept="image/*,application/pdf" multiple></label>';
  out += '<label class="hpa-col-full">توضیح<textarea name="description">' + U.esc_textarea(presetDesc || '') + ' </textarea></label></div>';
  out += form_close(isEdit ? 'ذخیره تغییرات تراکنش' : 'ثبت تراکنش');
  if (isEdit) out += '<a class="hpa-btn hpa-btn-ghost hpa-cancel-edit" href="' + U.esc_url(removeArgUrl('hpa_edit_transaction')) + '">انصراف از ویرایش</a>';
  out += '</section><section class="hpa-card"><h2>تراکنش‌ها</h2>' + transactions_filter_ui() + transactions_table(50) + '</section>';
  return out;
}
function transactions_filter_ui() {
  const q = CTX.query.hpa_q || ''; const tag = CTX.query.hpa_tag || ''; const cat = U.absint(CTX.query.hpa_category);
  let out = '<form class="hpa-filter-bar" method="get" action="/"><input type="hidden" name="hpa_tab" value="transactions">';
  out += '<input name="hpa_q" value="' + U.esc_attr(q) + '" placeholder="جستجوی توضیح، برچسب، مبلغ...">';
  out += '<select name="hpa_category"><option value="0">همه دسته‌ها</option>';
  for (const c of get_categories()) out += '<option value="' + U.esc_attr(c.id) + '"' + U.selected(cat, c.id) + '>' + U.esc_html((c.icon || '🏷️') + ' ' + c.name) + '</option>';
  out += '</select>';
  out += '<input name="hpa_tag" value="' + U.esc_attr(tag) + '" placeholder="برچسب">';
  out += '<input name="hpa_from" class="hpa-jdate" value="' + U.esc_attr(CTX.query.hpa_from || '') + '" placeholder="از تاریخ">';
  out += '<input name="hpa_to" class="hpa-jdate" value="' + U.esc_attr(CTX.query.hpa_to || '') + '" placeholder="تا تاریخ">';
  out += '<button class="hpa-btn hpa-btn-primary" type="submit">فیلتر</button><a class="hpa-btn hpa-btn-ghost" href="' + U.esc_url(buildUrl({ hpa_tab: 'transactions' }, ['hpa_q', 'hpa_tag', 'hpa_category', 'hpa_from', 'hpa_to'])) + '">پاک‌کردن</a></form>';
  return out;
}
function transactions_table(limit) {
  limit = U.absint(limit);
  const where = ['1=1']; const params = [];
  if (CTX.query.hpa_category) { where.push('t.category_id=?'); params.push(U.absint(CTX.query.hpa_category)); }
  if (CTX.query.hpa_tag) { where.push('t.tags LIKE ?'); params.push('%' + U.esc_like(String(CTX.query.hpa_tag)) + '%'); }
  if (CTX.query.hpa_q) { const q = '%' + U.esc_like(String(CTX.query.hpa_q)) + '%'; where.push('(t.description LIKE ? OR t.tags LIKE ? OR CAST(t.amount AS TEXT) LIKE ?)'); params.push(q, q, q); }
  if (CTX.query.hpa_from) { const g = U.jalali_to_gregorian_date(String(CTX.query.hpa_from)); if (g) { where.push('t.gregorian_date >= ?'); params.push(g); } }
  if (CTX.query.hpa_to) { const g = U.jalali_to_gregorian_date(String(CTX.query.hpa_to)); if (g) { where.push('t.gregorian_date <= ?'); params.push(g); } }
  const sql = "SELECT t.*, a.name account_name, c.id cat_id, c.name cat_name, c.icon cat_icon, c.color cat_color FROM hpa_transactions t LEFT JOIN hpa_accounts a ON a.id=t.account_id LEFT JOIN hpa_categories c ON c.id=t.category_id WHERE " + where.join(' AND ') + " ORDER BY t.gregorian_date DESC, t.id DESC LIMIT " + limit;
  const rows = D.all(sql, params);
  const types = transaction_types();
  let out = '<div id="hpa-transactions-list" class="hpa-transaction-card-list hpa-list-card-view">';
  if (!rows.length) out += '<p class="hpa-muted">هنوز تراکنشی ثبت نشده است.</p>';
  for (const r of rows) {
    const flow = transaction_flow_class(r);
    const moneyClass = flow === 'in' ? 'hpa-positive' : (flow === 'out' ? 'hpa-negative' : 'hpa-neutral');
    const flowIcon = flow === 'in' ? '↗' : (flow === 'out' ? '↘' : '↔');
    const editUrl = buildUrl({ hpa_tab: 'transactions', hpa_edit_transaction: r.id });
    let tagsHtml = ''; for (const tg of String(r.tags || '').replace(/#/g, '').split(',').map(s => s.trim()).filter(Boolean)) tagsHtml += clickable_tag(tg) + ' ';
    const balAfter = account_balance_after_transaction(r);
    const balanceLine = balAfter ? '<p><strong>مانده حساب بعد از تراکنش:</strong> ' + U.esc_html(fmt_money(balAfter.balance, balAfter.currency)) + '</p>' : '';
    const hide = !!r.hide_amount;
    const amtHtml = hide ? '<span class="hpa-amount-hidden" aria-hidden="true">***</span>' : '<b class="' + U.esc_attr(moneyClass) + '">' + U.esc_html(fmt_money(r.amount, r.currency)) + '</b>';
    out += '<details class="hpa-recent-tx-card hpa-tx-list-card hpa-flow-' + U.esc_attr(flow) + (hide ? ' hpa-tx-hidden' : '') + '"><summary><span class="hpa-flow-mark">' + U.esc_html(flowIcon) + '</span><span class="hpa-recent-main">' + amtHtml + '<small>' + U.esc_html(r.jalali_date) + ' · ' + U.esc_html(types[r.type] || r.type) + ' · ' + U.esc_html(person_label(r.person_key || 'hamidreza')) + '</small></span><span class="hpa-recent-cat" style="background:' + U.esc_attr(r.cat_color || '#eef2ff') + '">' + clickable_category(Number(r.cat_id) || 0, r.cat_name || 'بدون موضوع', r.cat_icon || '📌') + '</span></summary><div class="hpa-recent-details"><p><strong>حساب:</strong> ' + U.esc_html(r.account_name || '—') + '</p>' + balanceLine + '<p><strong>محل تراکنش:</strong> ' + U.esc_html((r.transaction_place || '') || '—') + '</p><p><strong>توضیح:</strong> ' + U.esc_html(r.description || '—') + '</p><p><strong>برچسب‌ها:</strong> ' + (tagsHtml || '<span class="hpa-muted">ندارد</span>') + '</p><div class="hpa-row-actions"><a class="hpa-edit" href="' + U.esc_url(editUrl) + '">ویرایش</a>' + delete_button('hpa_delete_transaction', r.id, 'transactions') + '</div></div></details>';
  }
  return out + '</div>';
}

// ================= VIEW: debt-like (debts / receivables) =================
function view_debt_like(tableKey, tab, title, action, personLabel) {
  const curr = currencies(); const statuses = status_labels();
  const editKey = tab === 'debt' ? 'hpa_edit_debt' : 'hpa_edit_receivable';
  const editId = U.absint(CTX.query[editKey]);
  const edit = editId ? D.get('SELECT * FROM ' + D.TABLES[tableKey] + ' WHERE id=?', [editId]) : null;
  const isEdit = !!edit;
  let out = '<section class="hpa-card ' + (isEdit ? 'hpa-editing' : '') + '"><h2>' + (isEdit ? 'ویرایش ' + title : 'ثبت ' + title) + '</h2>' + form_open(action, true);
  if (isEdit) out += '<input type="hidden" name="id" value="' + U.esc_attr(edit.id) + '">';
  const currency = isEdit ? (edit.currency || 'toman') : 'toman'; const status = isEdit ? (edit.status || 'open') : 'open';
  out += '<div class="hpa-form-grid">'
    + '<label>' + personLabel + '<input name="person_name" required value="' + U.esc_attr(isEdit ? edit.person_name : '') + '"></label>'
    + '<label>شماره تماس<input name="phone" value="' + U.esc_attr(isEdit ? (edit.phone || '') : '') + '"></label>'
    + '<label>مبلغ کل<input name="amount" required inputmode="decimal" value="' + U.esc_attr(isEdit ? edit.amount : '') + '"></label>'
    + '<label>مبلغ پرداخت‌شده<input name="paid_amount" inputmode="decimal" value="' + U.esc_attr(isEdit ? (edit.paid_amount || 0) : 0) + '"><small class="hpa-help">برای پرداخت جزئی بدهی/طلب استفاده می‌شود.</small></label>'
    + (tab === 'debt' ? '<label>واریز به حساب' + account_select('account_id', isEdit ? Number(edit.account_id || 0) : 0) + '<small class="hpa-help">اگر حساب انتخاب شود، یک تراکنش «قرض» به‌صورت خودکار ثبت و موجودی حساب زیاد می‌شود؛ اما این مبلغ جزو درآمد ماه حساب نمی‌شود.</small></label>' : '')
    + '<label>واحد پول<select name="currency">';
  for (const k in curr) out += '<option value="' + U.esc_attr(k) + '"' + U.selected(currency, k) + '>' + U.esc_html(curr[k]) + '</option>';
  out += '</select></label>'
    + '<label>تاریخ ثبت شمسی<input name="jalali_date" class="hpa-jdate" required value="' + U.esc_attr(isEdit ? (edit.jalali_date || today_jalali()) : today_jalali()) + '" placeholder="1403/01/15"></label>'
    + '<label>موعد پرداخت شمسی<input name="due_jalali_date" class="hpa-jdate" value="' + U.esc_attr(isEdit ? (edit.due_jalali_date || '') : '') + '" placeholder="1403/02/15"></label>'
    + '<label>وضعیت<select name="status">';
  for (const k in statuses) out += '<option value="' + U.esc_attr(k) + '"' + U.selected(status, k) + '>' + U.esc_html(statuses[k]) + '</option>';
  out += '</select></label><label>رسید/سند<input type="file" name="receipt[]" accept="image/*,application/pdf" multiple></label>'
    + '<label class="hpa-col-full">توضیح<textarea name="note">' + U.esc_textarea(isEdit ? (edit.note || '') : '') + '</textarea></label></div>';
  out += form_close(isEdit ? 'ذخیره تغییرات' : 'ثبت');
  if (isEdit) out += '<a class="hpa-btn hpa-btn-ghost hpa-cancel-edit" href="' + U.esc_url(removeArgUrl(editKey)) + '">انصراف از ویرایش</a>';
  out += '</section><section class="hpa-card"><h2>' + title + '</h2>';
  const rows = D.all('SELECT * FROM ' + D.TABLES[tableKey] + ' ORDER BY COALESCE(due_gregorian_date, gregorian_date) ASC, id DESC LIMIT 100');
  out += '<div class="hpa-table-wrap"><table class="hpa-table"><thead><tr><th>شخص</th><th>مبلغ کل</th><th>پرداخت‌شده</th><th>باقی‌مانده</th><th>تاریخ</th><th>موعد</th><th>وضعیت</th><th>توضیح</th><th>عملیات</th></tr></thead><tbody>';
  const soon = U.date_add_days(U.today_gregorian(), 7);
  for (const r of rows) {
    const remaining = Math.max(0, (Number(r.amount) || 0) - (Number(r.paid_amount) || 0));
    const isPaid = (r.status === 'paid' || remaining <= 0.0001);
    const warn = (r.due_gregorian_date && r.due_gregorian_date <= soon && !isPaid) ? ' hpa-warn-row' : '';
    const paidClass = isPaid ? ' hpa-debt-paid-row' : '';
    const editUrl = buildUrl({ hpa_tab: tab, [editKey]: r.id });
    out += '<tr class="' + U.esc_attr((warn + paidClass).trim()) + '"' + (isPaid ? ' data-paid="1"' : '') + '><td>' + U.esc_html(r.person_name) + '</td><td>' + U.esc_html(fmt_money(r.amount, r.currency)) + '</td><td>' + U.esc_html(fmt_money(r.paid_amount || 0, r.currency)) + '</td><td>' + U.esc_html(fmt_money(remaining, r.currency)) + '</td><td>' + U.esc_html(r.jalali_date) + '</td><td>' + U.esc_html(r.due_jalali_date) + '</td><td>' + U.esc_html(statuses[r.status] || r.status) + '</td><td>' + U.esc_html(U.wp_trim_words(r.note, 10)) + '</td><td><div class="hpa-row-actions"><a class="hpa-edit" href="' + U.esc_url(editUrl) + '">ویرایش</a>' + delete_button(tab === 'debt' ? 'hpa_delete_debt' : 'hpa_delete_receivable', r.id, tab) + '</div></td></tr>';
  }
  if (!rows.length) out += '<tr><td colspan="9" class="hpa-muted">موردی ثبت نشده است.</td></tr>';
  out += '</tbody></table></div></section>';
  return out;
}

// ================= VIEW: debts full (loans/checks/recurring) =================
function view_recurring() {
  const curr = currencies();
  const editId = U.absint(CTX.query.hpa_edit_recurring);
  const edit = editId ? D.get('SELECT * FROM hpa_recurring WHERE id=?', [editId]) : null;
  const isEdit = !!edit;
  let out = '<section class="hpa-card ' + (isEdit ? 'hpa-editing' : '') + '"><h2>' + (isEdit ? 'ویرایش تراکنش تکرارشونده' : 'اجاره، بیمه و تراکنش‌های تکرارشونده') + '</h2>' + form_open('hpa_save_recurring');
  if (isEdit) out += '<input type="hidden" name="id" value="' + U.esc_attr(edit.id) + '">';
  const person = isEdit ? (edit.person_key || 'hamidreza') : 'hamidreza'; const currency = isEdit ? (edit.currency || 'toman') : 'toman'; const type = isEdit ? (edit.type || 'expense') : 'expense'; const status = isEdit ? (edit.status || 'active') : 'active';
  out += '<div class="hpa-form-grid">'
    + '<label>عنوان<input name="title" required placeholder="مثلاً اجاره خانه / بیمه / اشتراک" value="' + U.esc_attr(isEdit ? edit.title : '') + '" /></label>'
    + '<label>شخص' + person_select('person_key', person) + '</label>'
    + '<label>نوع<select name="type"><option value="expense"' + U.selected(type, 'expense') + '>هزینه</option><option value="income"' + U.selected(type, 'income') + '>درآمد</option></select></label>'
    + '<label>حساب' + account_select('account_id', isEdit ? Number(edit.account_id) : 0) + '</label>'
    + '<label>دسته‌بندی' + category_select('category_id', type, isEdit ? Number(edit.category_id) : 0) + '</label>'
    + '<label>مبلغ<input name="amount" inputmode="decimal" required value="' + U.esc_attr(isEdit ? edit.amount : '') + '" /></label>'
    + '<label>واحد پول<select name="currency">';
  for (const k in curr) out += '<option value="' + U.esc_attr(k) + '"' + U.selected(currency, k) + '>' + U.esc_html(curr[k]) + '</option>';
  out += '</select></label><label>تکرار<select name="interval_type"><option value="monthly"' + U.selected(isEdit ? edit.interval_type : 'monthly', 'monthly') + '>ماهانه</option><option value="weekly"' + U.selected(isEdit ? edit.interval_type : 'monthly', 'weekly') + '>هفتگی</option><option value="yearly"' + U.selected(isEdit ? edit.interval_type : 'monthly', 'yearly') + '>سالانه</option></select></label>'
    + '<label>تاریخ شروع<input name="start_jalali_date" class="hpa-jdate" value="' + U.esc_attr(isEdit ? edit.start_jalali_date : today_jalali()) + '"></label>'
    + '<label>موعد بعدی<input name="next_jalali_date" class="hpa-jdate" value="' + U.esc_attr(isEdit ? edit.next_jalali_date : today_jalali()) + '"></label>'
    + '<label>وضعیت<select name="status"><option value="active"' + U.selected(status, 'active') + '>فعال</option><option value="paused"' + U.selected(status, 'paused') + '>متوقف</option></select></label>'
    + '<label class="hpa-col-full">یادداشت<textarea name="note">' + U.esc_textarea(isEdit ? (edit.note || '') : '') + '</textarea></label></div>';
  out += form_close(isEdit ? 'ذخیره تراکنش تکرارشونده' : 'ثبت تراکنش تکرارشونده');
  if (isEdit) out += '<a class="hpa-btn hpa-btn-ghost hpa-cancel-edit" href="' + U.esc_url(removeArgUrl('hpa_edit_recurring')) + '">انصراف از ویرایش</a>';
  const rows = D.all("SELECT r.*, c.name AS category_name, c.icon AS category_icon FROM hpa_recurring r LEFT JOIN hpa_categories c ON c.id=r.category_id ORDER BY COALESCE(r.next_gregorian_date, r.created_at) ASC LIMIT 50");
  out += '<div class="hpa-table-wrap"><table class="hpa-table hpa-table-pro"><thead><tr><th>عنوان</th><th>شخص</th><th>دسته</th><th>مبلغ</th><th>تکرار</th><th>موعد بعدی</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>';
  for (const r of rows) { const editUrl = buildUrl({ hpa_tab: 'debt', hpa_edit_recurring: r.id }); out += '<tr><td><strong>' + U.esc_html(r.title) + '</strong></td><td>' + U.esc_html(person_label(r.person_key)) + '</td><td>' + clickable_category(Number(r.category_id) || 0, r.category_name || '—', r.category_icon || '🏷️') + '</td><td>' + U.esc_html(fmt_money(r.amount, r.currency)) + '</td><td>' + U.esc_html(r.interval_type) + '</td><td>' + U.esc_html(r.next_jalali_date) + '</td><td>' + U.esc_html(r.status === 'active' ? 'فعال' : 'متوقف') + '</td><td><div class="hpa-row-actions"><a class="hpa-edit" href="' + U.esc_url(editUrl) + '">ویرایش</a>' + delete_button('hpa_delete_recurring', r.id, 'debt') + '</div></td></tr>'; }
  if (!rows.length) out += '<tr><td colspan="8" class="hpa-muted">تراکنش تکرارشونده‌ای ثبت نشده است.</td></tr>';
  out += '</tbody></table></div></section>';
  return out;
}
function view_loans() {
  const curr = currencies();
  const editId = U.absint(CTX.query.hpa_edit_loan);
  const edit = editId ? D.get('SELECT * FROM hpa_loans WHERE id=?', [editId]) : null;
  const isEdit = !!edit;
  let out = '<section class="hpa-card ' + (isEdit ? 'hpa-editing' : '') + '"><h2>' + (isEdit ? 'ویرایش وام / اقساط' : 'اقساط و وام‌ها') + '</h2>' + form_open('hpa_save_loan');
  if (isEdit) out += '<input type="hidden" name="id" value="' + U.esc_attr(edit.id) + '">';
  const person = isEdit ? (edit.person_key || 'hamidreza') : 'hamidreza'; const currency = isEdit ? (edit.currency || 'toman') : 'toman'; const status = isEdit ? (edit.status || 'open') : 'open';
  out += '<div class="hpa-form-grid">'
    + '<label>عنوان وام<input name="title" required placeholder="مثلاً وام خرید طلا / وام بانک ملت" value="' + U.esc_attr(isEdit ? edit.title : '') + '"></label>'
    + '<label>شخص' + person_select('person_key', person) + '</label>'
    + '<label>وام‌دهنده / بانک<input name="lender" value="' + U.esc_attr(isEdit ? (edit.lender || '') : '') + '"></label>'
    + '<label>مبلغ اصلی وام<input name="principal_amount" required inputmode="decimal" value="' + U.esc_attr(isEdit ? edit.principal_amount : '') + '"></label>'
    + '<label>واحد پول<select name="currency">';
  for (const k in curr) out += '<option value="' + U.esc_attr(k) + '"' + U.selected(currency, k) + '>' + U.esc_html(curr[k]) + '</option>';
  out += '</select></label>'
    + '<label>تاریخ دریافت وام<input name="received_jalali_date" class="hpa-jdate" required value="' + U.esc_attr(isEdit ? (edit.received_jalali_date || today_jalali()) : today_jalali()) + '"></label>'
    + '<label>واریز به حساب' + account_select('account_id', isEdit ? Number(edit.account_id || 0) : 0) + '<small class="hpa-help">اگر حساب انتخاب شود، اصل وام به‌صورت خودکار به‌عنوان تراکنش «قرض/وام» به آن حساب واریز می‌شود (جزو درآمد حساب نمی‌شود).</small></label>'
    + '<label>مبلغ هر قسط<input name="installment_amount" inputmode="decimal" placeholder="اگر خالی بماند خودکار محاسبه می‌شود" value="' + U.esc_attr(isEdit ? edit.installment_amount : '') + '"></label>'
    + '<label>تاریخ اولین قسط<input name="first_due_jalali_date" class="hpa-jdate" placeholder="1403/02/15" value="' + U.esc_attr(isEdit ? (edit.first_due_jalali_date || '') : '') + '"></label>'
    + '<label>تاریخ آخرین قسط<input name="last_due_jalali_date" class="hpa-jdate" placeholder="1405/02/15" value="' + U.esc_attr(isEdit ? (edit.last_due_jalali_date || '') : '') + '"><small class="hpa-help">تعداد کل اقساط خودکار از فاصله اولین تا آخرین قسط محاسبه می‌شود.</small></label>'
    + '<label>تعداد اقساط پرداخت‌شده<input name="paid_installments" inputmode="numeric" min="0" value="' + U.esc_attr(isEdit ? Number(edit.paid_installments) : 0) + '"><small class="hpa-help">برای وام‌های قبلی وارد کن تا مانده اقساط درست محاسبه شود.</small></label>'
    + '<label>وضعیت<select name="status"><option value="open"' + U.selected(status, 'open') + '>باز</option><option value="paid"' + U.selected(status, 'paid') + '>تسویه‌شده</option></select></label>'
    + '<label class="hpa-col-full hpa-variable-installment-toggle"><span class="hpa-checkline"><input type="checkbox" name="variable_installments" value="1"' + U.checked(isEdit ? Number(edit.variable_installments || 0) : 0, 1) + '> اقساط با مبلغ متفاوت؟</span><small class="hpa-help">اگر بعضی ماه‌ها مبلغ قسط فرق دارد، این گزینه را فعال کن.</small></label>'
    + '<label class="hpa-col-full hpa-variable-installment-box">مبالغ متفاوت اقساط<textarea name="installment_overrides" placeholder="هر خط یک قسط:&#10;3 = 25000000&#10;1403/07/15 = 25000000">' + U.esc_textarea(isEdit ? (edit.installment_overrides || '') : '') + '</textarea><small class="hpa-help">می‌توانی شماره قسط یا تاریخ شمسی قسط را بنویسی.</small></label>'
    + '<label class="hpa-col-full">کجا استفاده شده؟<textarea name="used_for" placeholder="مثلاً خرید سکه، تعمیر خانه، خرید ماشین...">' + U.esc_textarea(isEdit ? (edit.used_for || '') : '') + '</textarea></label>'
    + '<label class="hpa-col-full">یادداشت<textarea name="note">' + U.esc_textarea(isEdit ? (edit.note || '') : '') + '</textarea></label></div>';
  out += form_close(isEdit ? 'ذخیره تغییرات وام' : 'ثبت وام و ساخت برنامه اقساط');
  if (isEdit) out += '<a class="hpa-btn hpa-btn-ghost hpa-cancel-edit" href="' + U.esc_url(removeArgUrl('hpa_edit_loan')) + '">انصراف از ویرایش</a>';
  const rows = D.all('SELECT * FROM hpa_loans ORDER BY id DESC LIMIT 50');
  out += '<div class="hpa-table-wrap"><table class="hpa-table hpa-table-pro"><thead><tr><th>وام</th><th>شخص</th><th>اصل وام</th><th>اقساط پرداخت‌شده</th><th>باقی‌مانده</th><th>آخرین قسط</th><th>مصرف‌شده برای</th><th>عملیات</th></tr></thead><tbody>';
  for (const r of rows) { const rem = Math.max(0, (Number(r.total_installments) || 0) - (Number(r.paid_installments) || 0)); const editUrl = buildUrl({ hpa_tab: 'debt', hpa_edit_loan: r.id }); out += '<tr><td><div class="hpa-loan-title"><strong>' + U.esc_html(r.title) + '</strong><small class="hpa-loan-lender">وام‌دهنده: ' + U.esc_html(r.lender || '—') + '</small></div></td><td>' + U.esc_html(person_label(r.person_key)) + '</td><td>' + U.esc_html(fmt_money(r.principal_amount, r.currency)) + '</td><td>' + U.esc_html((Number(r.paid_installments) || 0) + ' / ' + (Number(r.total_installments) || 0)) + '</td><td>' + U.esc_html(rem + ' قسط') + '</td><td>' + U.esc_html(r.last_due_jalali_date || '—') + '</td><td>' + U.esc_html(U.wp_trim_words(r.used_for, 12)) + '</td><td><div class="hpa-row-actions"><a class="hpa-edit" href="' + U.esc_url(editUrl) + '">ویرایش</a>' + delete_button('hpa_delete_loan', r.id, 'debt') + '</div></td></tr>'; }
  if (!rows.length) out += '<tr><td colspan="8" class="hpa-muted">وامی ثبت نشده است.</td></tr>';
  out += '</tbody></table></div></section>';
  return out;
}
function view_checks() {
  const curr = currencies();
  const editId = U.absint(CTX.query.hpa_edit_check);
  const edit = editId ? D.get('SELECT * FROM hpa_checks WHERE id=?', [editId]) : null;
  const isEdit = !!edit;
  let out = '<section class="hpa-card ' + (isEdit ? 'hpa-editing' : '') + '"><h2>' + (isEdit ? 'ویرایش چک' : 'چک‌های باز') + '</h2>' + form_open('hpa_save_check');
  if (isEdit) out += '<input type="hidden" name="id" value="' + U.esc_attr(edit.id) + '">';
  const person = isEdit ? (edit.person_key || 'hamidreza') : 'hamidreza'; const currency = isEdit ? (edit.currency || 'toman') : 'toman'; const status = isEdit ? (edit.status || 'open') : 'open';
  out += '<div class="hpa-form-grid">'
    + '<label>عنوان چک‌ها<input name="title" required placeholder="مثلاً چک خرید خودرو / خرید طلا" value="' + U.esc_attr(isEdit ? edit.title : '') + '"></label>'
    + '<label>شخص' + person_select('person_key', person) + '</label>'
    + '<label>تعداد چک<input name="check_count" inputmode="numeric" value="' + U.esc_attr(isEdit ? Number(edit.check_count) : 1) + '"></label>'
    + '<label>مبلغ هر چک<input name="amount_each" inputmode="decimal" required value="' + U.esc_attr(isEdit ? edit.amount_each : '') + '"></label>'
    + '<label>واحد پول<select name="currency">';
  for (const k in curr) out += '<option value="' + U.esc_attr(k) + '"' + U.selected(currency, k) + '>' + U.esc_html(curr[k]) + '</option>';
  out += '</select></label>'
    + '<label>تاریخ اولین چک<input name="first_due_jalali_date" class="hpa-jdate" placeholder="1403/02/15" value="' + U.esc_attr(isEdit ? (edit.first_due_jalali_date || '') : '') + '"></label>'
    + '<label>وضعیت<select name="status"><option value="open"' + U.selected(status, 'open') + '>باز</option><option value="paid"' + U.selected(status, 'paid') + '>تسویه‌شده</option></select></label>'
    + '<label>در دارایی حساب شود؟ <span class="hpa-checkline"><input type="checkbox" name="include_in_assets" value="1"' + U.checked(isEdit ? Number(edit.include_in_assets) : 0, 1) + '> فقط وقتی خودم می‌خواهم</span></label>'
    + '<label class="hpa-col-full">در چه زمینه‌ای صرف شده؟<textarea name="used_for">' + U.esc_textarea(isEdit ? (edit.used_for || '') : '') + '</textarea></label>'
    + '<label class="hpa-col-full">یادداشت<textarea name="note">' + U.esc_textarea(isEdit ? (edit.note || '') : '') + '</textarea></label></div>';
  out += form_close(isEdit ? 'ذخیره تغییرات چک' : 'ثبت چک');
  if (isEdit) out += '<a class="hpa-btn hpa-btn-ghost hpa-cancel-edit" href="' + U.esc_url(removeArgUrl('hpa_edit_check')) + '">انصراف از ویرایش</a>';
  const rows = D.all('SELECT * FROM hpa_checks ORDER BY COALESCE(first_due_gregorian_date, created_at) ASC LIMIT 50');
  out += '<div class="hpa-table-wrap"><table class="hpa-table hpa-table-pro"><thead><tr><th>عنوان</th><th>شخص</th><th>تعداد</th><th>مبلغ هر چک</th><th>جمع</th><th>موعد اول</th><th>مصرف‌شده برای</th><th>دارایی؟</th><th>عملیات</th></tr></thead><tbody>';
  for (const r of rows) { const total = (Number(r.amount_each) || 0) * (Number(r.check_count) || 0); const editUrl = buildUrl({ hpa_tab: 'debt', hpa_edit_check: r.id }); out += '<tr><td><strong>' + U.esc_html(r.title) + '</strong></td><td>' + U.esc_html(person_label(r.person_key)) + '</td><td>' + (Number(r.check_count) || 0) + '</td><td>' + U.esc_html(fmt_money(r.amount_each, r.currency)) + '</td><td>' + U.esc_html(fmt_money(total, r.currency)) + '</td><td>' + U.esc_html(r.first_due_jalali_date) + '</td><td>' + U.esc_html(U.wp_trim_words(r.used_for, 10)) + '</td><td>' + (r.include_in_assets ? 'بله' : 'خیر') + '</td><td><div class="hpa-row-actions"><a class="hpa-edit" href="' + U.esc_url(editUrl) + '">ویرایش</a>' + delete_button('hpa_delete_check', r.id, 'debt') + '</div></td></tr>'; }
  if (!rows.length) out += '<tr><td colspan="9" class="hpa-muted">چکی ثبت نشده است.</td></tr>';
  out += '</tbody></table></div></section>';
  return out;
}
function view_debts_full() {
  let out = '<section class="hpa-debt-tabs"><div class="hpa-card"><h2>بدهی‌های ساده</h2></div></section>';
  out += view_debt_like('debts', 'debt', 'بدهی‌ها', 'hpa_save_debt', 'طلبکار');
  out += view_recurring();
  out += view_loans();
  out += view_checks();
  out += report_future_obligations();
  out += report_next_month_obligations();
  out += report_debt_backed_assets();
  return out;
}

// ================= VIEW: assets & goals =================
function view_assets() {
  const groups = asset_groups(); const curr = currencies();
  const editId = U.absint(CTX.query.hpa_edit_asset);
  const edit = editId ? D.get('SELECT * FROM hpa_assets WHERE id=?', [editId]) : null;
  const isEdit = !!edit;
  let out = '<section class="hpa-card hpa-assets-list-section"><h2>دارایی‌ها</h2>';
  const rows = D.all('SELECT * FROM hpa_assets ORDER BY gregorian_date DESC, id DESC LIMIT 100');
  out += '<div class="hpa-asset-card-list hpa-list-card-view">';
  if (!rows.length) out += '<p class="hpa-muted">دارایی ثبت نشده است.</p>';
  for (const r of rows) {
    const v = asset_valuation(r);
    const editUrl = buildUrl({ hpa_tab: 'assets', hpa_edit_asset: r.id });
    const groupLabel = groups[r.asset_group] || r.asset_group;
    out += '<details class="hpa-asset-card hpa-recent-tx-card"><summary><span class="hpa-asset-card-icon">' + U.esc_html(asset_group_icon(r.asset_group)) + '</span><span class="hpa-recent-main"><b>' + U.esc_html(r.title) + '</b><small>' + U.esc_html(groupLabel) + ' · ' + U.esc_html(asset_amount_label(r)) + '</small></span><strong class="hpa-asset-card-value">' + U.esc_html(fmt_money(v.current_total, 'toman')) + '</strong></summary><div class="hpa-recent-details"><p><strong>شخص:</strong> ' + U.esc_html(person_label(r.person_key || 'hamidreza')) + '</p><p><strong>مدل/عیار:</strong> ' + U.esc_html((r.model + ' ' + r.purity).trim() || '—') + '</p><p><strong>قیمت خرید کل:</strong> ' + U.esc_html(fmt_money(v.purchase_total, 'toman')) + '</p><p><strong>نرخ خرید واحد:</strong> ' + U.esc_html(asset_unit_price_label(r)) + '</p><p><strong>ارزش فعلی:</strong> ' + U.esc_html(fmt_money(v.current_total, 'toman')) + ' ' + (v.has_market ? '<small class="hpa-market-rate-note">نرخ بازار: ' + U.esc_html(fmt_money(v.current_unit, 'toman')) + '</small>' : '<small class="hpa-market-rate-note">بدون نرخ بازار؛ برابر خرید</small>') + '</p><p><strong>وضعیت:</strong> ' + asset_status_html(v) + '</p><p><strong>محل خرید:</strong> ' + U.esc_html(r.purchase_place || '—') + '</p><p><strong>تأمین مالی:</strong> ' + U.esc_html(asset_funding_label(r)) + '</p><div class="hpa-row-actions"><a class="hpa-edit" href="' + U.esc_url(editUrl) + '">ویرایش</a>' + delete_button('hpa_delete_asset', r.id, 'assets') + '</div></div></details>';
  }
  out += '</div></section>';
  out += view_goals();
  out += '<section class="hpa-card hpa-asset-form-card ' + (isEdit ? 'hpa-editing' : 'hpa-creating') + '"><h2>' + (isEdit ? 'ویرایش دارایی' : 'ثبت دارایی') + '</h2>' + form_open('hpa_save_asset', true);
  if (isEdit) out += '<input type="hidden" name="id" value="' + U.esc_attr(edit.id) + '">';
  const eg = isEdit ? edit.asset_group : 'gold'; const ecur = isEdit ? edit.currency : 'toman'; const eperson = isEdit ? (edit.person_key || 'hamidreza') : 'hamidreza'; const eloan = isEdit ? Number(edit.source_loan_id || 0) : 0; const egoal = isEdit ? Number(edit.goal_id || 0) : 0; const efunding = isEdit ? (edit.funding_source || 'personal') : 'personal'; const emodel = isEdit ? String(edit.model || '') : ''; const cryptoItems = crypto_rate_items();
  out += '<div class="hpa-form-grid"><label>عنوان دارایی<input name="title" required placeholder="مثلاً سکه / بیت‌کوین / انگشتر طلا" value="' + U.esc_attr(isEdit ? edit.title : '') + '"></label><label>شخص' + person_select('person_key', eperson) + '</label><label>گروه دارایی<select name="asset_group">';
  for (const k in groups) out += '<option value="' + U.esc_attr(k) + '"' + U.selected(eg, k) + '>' + U.esc_html(groups[k]) + '</option>';
  out += '</select></label><label class="hpa-asset-model-text">مدل/نوع<input name="model" placeholder="مثلاً زربد" value="' + U.esc_attr(emodel) + '"></label><label class="hpa-asset-model-crypto">نوع کریپتو<select name="model_crypto">';
  for (const ck in cryptoItems) { const ci = cryptoItems[ck]; const emodelL = emodel.toLowerCase(); const labelL = String(ci[0]).toLowerCase(); const isSel = (emodelL === ck.toLowerCase() || emodelL === labelL || emodelL.indexOf(ck.toLowerCase()) > -1 || (labelL !== '' && emodelL.indexOf(labelL) > -1)); out += '<option value="' + U.esc_attr(ck) + '"' + (isSel ? ' selected' : '') + '>' + U.esc_html(ci[2] + ' ' + ci[0]) + '</option>'; }
  out += '</select><small class="hpa-help">برای کریپتو، نوع دارایی از نرخ‌های ثبت‌شده انتخاب می‌شود.</small></label><label class="hpa-asset-purity-field">عیار/خلوص<input name="purity" placeholder="18 عیار / 24 عیار / 999" value="' + U.esc_attr(isEdit ? edit.purity : '') + '"></label><label class="hpa-asset-weight-field">وزن<input name="weight" inputmode="decimal" placeholder="گرم" value="' + U.esc_attr(isEdit ? edit.weight : '') + '"></label><label class="hpa-asset-quantity-field">تعداد/مقدار<input name="quantity" inputmode="decimal" value="' + U.esc_attr(isEdit ? edit.quantity : '') + '"></label><label class="hpa-asset-unit-field">واحد<input name="unit" placeholder="گرم، عدد، BTC" value="' + U.esc_attr(isEdit ? edit.unit : '') + '"></label><label>قیمت خرید کل<input name="purchase_price" inputmode="decimal" value="' + U.esc_attr(isEdit ? edit.purchase_price : '') + '"><small class="hpa-help hpa-unit-price-preview">قیمت واحد بعد از وارد کردن مقدار محاسبه می‌شود.</small></label><label>واحد پول<select name="currency">';
  for (const k in curr) out += '<option value="' + U.esc_attr(k) + '"' + U.selected(ecur, k) + '>' + U.esc_html(curr[k]) + '</option>';
  out += '</select></label><label>تاریخ خرید شمسی<input name="jalali_date" class="hpa-jdate" required value="' + U.esc_attr(isEdit ? edit.jalali_date : today_jalali()) + '" placeholder="1403/01/15"></label><label>محل خرید<input name="purchase_place" value="' + U.esc_attr(isEdit ? (edit.purchase_place || '') : '') + '"></label><label>وام تأمین‌کننده' + loan_select('source_loan_id', eloan) + '<small class="hpa-help">اگر دارایی با وام خریداری شده، وام را انتخاب کن.</small></label><label>هدف مالی' + goal_select('goal_id', egoal) + '</label><label>منبع تأمین<select name="funding_source"><option value="personal"' + U.selected(efunding, 'personal') + '>پول شخصی</option><option value="loan"' + U.selected(efunding, 'loan') + '>از محل وام</option><option value="check"' + U.selected(efunding, 'check') + '>از محل چک</option><option value="debt"' + U.selected(efunding, 'debt') + '>از محل بدهی</option></select></label><label>رسید خرید<input type="file" name="receipt[]" accept="image/*,application/pdf" multiple></label><label>فعال باشد؟ <span class="hpa-checkline"><input type="checkbox" name="is_active" value="1"' + U.checked(isEdit ? Number(edit.is_active) : 1, 1) + '> بله</span></label><label class="hpa-col-full">توضیح<textarea name="note">' + U.esc_textarea(isEdit ? (edit.note || '') : '') + '</textarea></label></div>';
  out += form_close(isEdit ? 'ذخیره تغییرات دارایی' : 'ثبت دارایی');
  if (isEdit) out += '<a class="hpa-btn hpa-btn-ghost hpa-cancel-edit" href="' + U.esc_url(removeArgUrl('hpa_edit_asset')) + '">انصراف از ویرایش</a>';
  out += '</section>';
  return out;
}
function view_goals() {
  const curr = currencies();
  let out = '<section class="hpa-card hpa-goals-section"><h2>هدف‌های مالی دارایی‌ها</h2><p class="hpa-muted">برای خرید، پس‌انداز یا نگهداری دارایی‌ها هدف تعریف کن و دارایی‌ها را به آن وصل کن.</p>' + form_open('hpa_save_goal');
  out += '<div class="hpa-form-grid"><label>عنوان هدف<input name="title" required placeholder="مثلاً پس‌انداز طلا / سفر / صندوق اضطراری"></label><label>مبلغ هدف<input name="target_amount" inputmode="decimal"></label><label>واحد پول<select name="currency">';
  for (const k in curr) out += '<option value="' + U.esc_attr(k) + '">' + U.esc_html(curr[k]) + '</option>';
  out += '</select></label><label>تاریخ هدف<input name="target_jalali_date" class="hpa-jdate" placeholder="1404/12/29"></label><label>وضعیت<select name="status"><option value="active">فعال</option><option value="done">تکمیل‌شده</option></select></label><label class="hpa-col-full">یادداشت<textarea name="note"></textarea></label></div>';
  out += form_close('ثبت هدف مالی');
  const goals = get_goals(false);
  out += '<div class="hpa-goal-grid">';
  for (const g of goals) {
    const assetSum = D.all('SELECT * FROM hpa_assets WHERE goal_id=?', [g.id]);
    let cur = 0; for (const a of assetSum) cur += asset_valuation(a).current_total;
    const target = amount_to_toman(g.target_amount, g.currency); const pct = target > 0 ? Math.min(100, Math.round(cur * 100 / target)) : 0;
    out += '<article class="hpa-goal-card"><strong>🎯 ' + U.esc_html(g.title) + '</strong><small>پیشرفت: ' + U.esc_html(pct) + '%</small><div class="hpa-progress"><span style="width:' + U.esc_attr(pct) + '%"></span></div><em>' + U.esc_html(fmt_money(cur, 'toman')) + ' از ' + U.esc_html(fmt_money(target, 'toman')) + '</em>' + delete_button('hpa_delete_goal', g.id, 'assets') + '</article>';
  }
  if (!goals.length) out += '<p class="hpa-muted">هنوز هدف مالی ثبت نشده است.</p>';
  out += '</div></section>';
  return out;
}

// ================= obligations =================
function future_obligation_items(limit) {
  limit = Math.max(1, U.absint(limit));
  let items = [];
  const loans = D.all("SELECT i.due_jalali_date d, i.due_gregorian_date gd, i.amount, i.currency, l.title, l.lender FROM hpa_loan_installments i LEFT JOIN hpa_loans l ON l.id=i.loan_id WHERE i.status!='paid' ORDER BY i.due_gregorian_date ASC LIMIT " + limit);
  for (const r of loans) items.push({ title: 'قسط: ' + (r.title || 'وام'), date: r.d, gdate: r.gd, amount: r.amount, currency: r.currency, icon: '🏦', detail: 'وام‌دهنده: ' + (r.lender || '—'), type: 'installment', is_paid: false });
  const today = U.today_gregorian(); const to = U.date_add_days(today, 30);
  const checks = D.all("SELECT first_due_jalali_date d, first_due_gregorian_date gd, (amount_each*check_count) amount, currency, title, used_for, check_count FROM hpa_checks WHERE status!='paid' AND first_due_gregorian_date BETWEEN ? AND ? ORDER BY first_due_gregorian_date ASC LIMIT " + limit, [today, to]);
  for (const r of checks) items.push({ title: 'چک: ' + (r.title || 'چک'), date: r.d, gdate: r.gd, amount: r.amount, currency: r.currency, icon: '🧾', detail: 'تعداد: ' + (Number(r.check_count) || 0) + ' · مصرف: ' + (r.used_for || '—'), type: 'check', is_paid: false });
  const recurringItems = {};
  const rec = D.all("SELECT r.id, COALESCE(r.next_jalali_date,r.start_jalali_date) d, COALESCE(r.next_gregorian_date,r.start_gregorian_date) gd, r.amount, r.currency, r.title, r.interval_type, c.name AS category_name FROM hpa_recurring r LEFT JOIN hpa_categories c ON c.id=r.category_id WHERE COALESCE(r.status,'active') NOT IN ('inactive','archived','paid','closed') AND r.amount>0 ORDER BY COALESCE(r.next_gregorian_date,r.start_gregorian_date,'9999-12-31') ASC, r.id DESC LIMIT " + limit);
  for (const r of rec) {
    const key = r.id + '|' + (r.gd || r.d);
    const isPaid = !!D.scalar("SELECT id FROM hpa_transactions WHERE recurring_id=? AND type='recurring_debt' AND status='done' AND recurring_due_gregorian_date=? LIMIT 1", [r.id, String(r.gd)]);
    recurringItems[key] = { title: 'تکرارشونده: ' + (r.title || 'پرداخت تکرارشونده'), date: r.d || 'بدون تاریخ', gdate: r.gd || '9999-12-31', amount: r.amount, currency: r.currency, icon: '🔁', detail: 'دسته: ' + (r.category_name || '—') + ' · دوره: ' + (r.interval_type || '—'), type: 'recurring', is_paid: isPaid, recurring_id: r.id };
  }
  const paidFrom = U.date_add_days(today, -31); const paidTo = U.date_add_days(today, 365);
  const paidRec = D.all("SELECT t.id transaction_id,t.recurring_id,t.recurring_due_jalali_date d,t.recurring_due_gregorian_date gd,t.amount,t.currency,r.title,r.interval_type,c.name category_name FROM hpa_transactions t INNER JOIN hpa_recurring r ON r.id=t.recurring_id LEFT JOIN hpa_categories c ON c.id=r.category_id WHERE t.type='recurring_debt' AND t.status='done' AND t.recurring_id>0 AND t.recurring_due_gregorian_date BETWEEN ? AND ? ORDER BY t.recurring_due_gregorian_date ASC,t.id DESC LIMIT " + limit, [paidFrom, paidTo]);
  for (const r of paidRec) { const key = r.recurring_id + '|' + (r.gd || r.d); recurringItems[key] = { title: 'تکرارشونده: ' + (r.title || 'پرداخت تکرارشونده'), date: r.d || 'بدون تاریخ', gdate: r.gd || '9999-12-31', amount: r.amount, currency: r.currency, icon: '🔁', detail: 'دسته: ' + (r.category_name || '—') + ' · دوره: ' + (r.interval_type || '—'), type: 'recurring', is_paid: true, recurring_id: r.recurring_id, transaction_id: r.transaction_id }; }
  for (const k in recurringItems) items.push(recurringItems[k]);
  items.sort((a, b) => { const cmp = String(a.gdate || '9999-99-99').localeCompare(String(b.gdate || '9999-99-99')); if (cmp !== 0) return cmp; return (a.is_paid ? 1 : 0) - (b.is_paid ? 1 : 0); });
  return items.slice(0, limit);
}
function obligation_card_html(it, extraClass) {
  const title = String(it.title || '').replace(/\s+/g, ' ').trim();
  const isPaid = !!it.is_paid;
  const classes = ('hpa-obligation-card ' + (extraClass || '') + (isPaid ? ' hpa-obligation-paid' : '')).trim();
  const paidLabel = isPaid ? '<small class="hpa-obligation-status">✓ پرداخت‌شده</small>' : '';
  return '<details class="' + U.esc_attr(classes) + '"' + (isPaid ? ' data-paid="1"' : '') + '><summary><span>' + U.esc_html(it.icon) + '</span><span class="hpa-obligation-title-wrap"><b>' + U.esc_html(title) + '</b><small>' + U.esc_html(it.date || 'بدون تاریخ') + '</small>' + paidLabel + '</span><strong>' + U.esc_html(fmt_money(it.amount, it.currency)) + '</strong></summary><div class="hpa-obligation-detail"><p>' + U.esc_html(it.detail) + '</p><p><strong>نوع تعهد:</strong> ' + U.esc_html(it.type) + '</p>' + (isPaid ? '<p class="hpa-obligation-paid-note"><strong>وضعیت:</strong> پرداخت‌شده</p>' : '') + '</div></details>';
}
function report_future_obligations() {
  const items = future_obligation_items(60);
  const visibleDefault = 6;
  let out = '<section id="hpa-future-obligations" class="hpa-card hpa-future-obligations"><div class="hpa-section-head"><div><h2>تعهدات آینده</h2><p class="hpa-muted">اقساط، چک‌ها، بدهی‌های باز و پرداخت‌های تکرارشونده آینده.</p></div></div><div class="hpa-obligation-cards">';
  let i = 0;
  for (const it of items) { i++; out += obligation_card_html(it, i > visibleDefault ? 'hpa-lazy-more-item' : ''); }
  if (!items.length) out += '<p class="hpa-muted">تعهد آینده‌ای ثبت نشده است.</p>';
  out += '</div>';
  if (items.length > visibleDefault) out += '<button type="button" class="hpa-btn hpa-btn-ghost hpa-show-more-cards">نمایش بیشتر</button>';
  out += '</section>';
  return out;
}
function report_next_month_obligations() {
  const ranges = last_jalali_month_ranges(2); const next = ranges[1]; if (!next) return '';
  const loan = rows_sum_toman(D.all("SELECT amount,currency FROM hpa_loan_installments WHERE status!='paid' AND due_gregorian_date BETWEEN ? AND ?", [next.start, next.end]));
  const check = rows_sum_toman(D.all("SELECT (amount_each*check_count) amount,currency FROM hpa_checks WHERE status!='paid' AND first_due_gregorian_date BETWEEN ? AND ?", [next.start, next.end]));
  const rec = rows_sum_toman(D.all("SELECT amount,currency FROM hpa_recurring WHERE status='active' AND next_gregorian_date BETWEEN ? AND ?", [next.start, next.end]));
  return '<section class="hpa-card"><h2>فشار تعهدات ماه آینده</h2><div class="hpa-metric-row"><span>قسط</span><strong>' + U.esc_html(fmt_money(loan, 'toman')) + '</strong><span>چک</span><strong>' + U.esc_html(fmt_money(check, 'toman')) + '</strong><span>تکرارشونده</span><strong>' + U.esc_html(fmt_money(rec, 'toman')) + '</strong><span>جمع</span><strong>' + U.esc_html(fmt_money(loan + check + rec, 'toman')) + '</strong></div></section>';
}
function report_debt_backed_assets() {
  const rows = D.all("SELECT * FROM hpa_assets WHERE COALESCE(funding_source,'personal')!='personal' OR source_loan_id>0 ORDER BY id DESC LIMIT 50");
  let out = '<section class="hpa-card"><h2>دارایی‌های بدهی‌دار</h2><div class="hpa-asset-card-list">';
  for (const r of rows) { const v = asset_valuation(r); out += '<article class="hpa-asset-card"><span class="hpa-asset-card-icon">' + U.esc_html(asset_group_icon(r.asset_group)) + '</span><b>' + U.esc_html(r.title) + '</b><small>' + U.esc_html(asset_funding_label(r)) + '</small><strong>' + U.esc_html(fmt_money(v.current_total, 'toman')) + '</strong></article>'; }
  if (!rows.length) out += '<p class="hpa-muted">دارایی بدهی‌دار ثبت نشده است.</p>';
  out += '</div></section>';
  return out;
}
function next_month_minimum_liquidity() {
  const today = today_jalali(); let [jy, jm] = today.split('/').map(x => parseInt(x, 10)); jm++; if (jm > 12) { jm = 1; jy++; }
  const last = jm <= 6 ? 31 : (jm <= 11 ? 30 : 29);
  const start = U.jalali_to_gregorian_date(U.pad(jy, 4) + '/' + U.pad(jm, 2) + '/01');
  const end = U.jalali_to_gregorian_date(U.pad(jy, 4) + '/' + U.pad(jm, 2) + '/' + U.pad(last, 2));
  let sum = 0;
  for (const r of D.all("SELECT amount,currency FROM hpa_loan_installments WHERE status!='paid' AND due_gregorian_date BETWEEN ? AND ?", [start, end])) sum += amount_to_toman(r.amount, r.currency);
  for (const r of D.all("SELECT (amount_each*check_count) amount,currency FROM hpa_checks WHERE status!='paid' AND first_due_gregorian_date BETWEEN ? AND ?", [start, end])) sum += amount_to_toman(r.amount, r.currency);
  for (const r of D.all("SELECT amount,currency FROM hpa_recurring WHERE COALESCE(status,'active') NOT IN ('inactive','archived','paid','closed')")) sum += amount_to_toman(r.amount, r.currency);
  return sum;
}

// ================= charts =================
function expense_chart(legend, currentMonthOnly, percentList) {
  let where = "t.type IN ('expense','recurring_debt') AND t.status!='cancelled'";
  if (currentMonthOnly) { const range = current_jalali_month_gregorian_range(); where += " AND t.gregorian_date BETWEEN '" + range[0] + "' AND '" + range[1] + "'"; }
  const rows = D.all("SELECT t.amount, t.currency, c.name, c.icon, c.color, t.category_id, t.hide_amount FROM hpa_transactions t LEFT JOIN hpa_categories c ON c.id=t.category_id WHERE " + where + " ORDER BY t.gregorian_date DESC LIMIT 500");
  if (!rows.length) return '<p class="hpa-muted">برای ساخت نمودار، چند هزینه ثبت کن.</p>';
  const groupsMap = {};
  for (const r of rows) {
    const key = String(r.category_id || '0');
    if (!groupsMap[key]) groupsMap[key] = { name: r.name || 'بدون موضوع', icon: r.icon || '📌', color: r.color || '#e0e7ff', total: 0, hidden_count: 0, visible_total: 0 };
    const toman = amount_to_toman(r.amount, r.currency);
    groupsMap[key].total += toman;
    if (r.hide_amount) groupsMap[key].hidden_count++; else groupsMap[key].visible_total += toman;
  }
  let groups = Object.values(groupsMap); groups.sort((a, b) => b.total - a.total);
  const allSum = groups.reduce((s, r) => s + r.total, 0);
  const chartGroups = groups.slice(0, 8);
  const listGroups = groups.slice(0, 5);
  const chartSum = chartGroups.reduce((s, r) => s + r.total, 0);
  let bars = '', leg = '', shares = '';
  for (const r of chartGroups) { const pct = chartSum ? (r.total / chartSum) * 100 : 0; const w = chartSum ? Math.max(4, Math.round(pct)) : 0; bars += '<div class="hpa-bar" style="width:' + w + '%;background:' + U.esc_attr(r.color) + '" title="' + U.esc_attr(r.name) + '"></div>'; leg += '<div class="hpa-list-row"><span class="hpa-badge" style="background:' + U.esc_attr(r.color) + '">' + U.esc_html(r.icon) + '</span><b>' + U.esc_html(r.name) + '</b><em>' + U.esc_html(fmt_money(r.total, 'toman')) + '</em></div>'; }
  for (const r of listGroups) {
    const pct = allSum ? (r.total / allSum) * 100 : 0;
    let totalStr;
    if (r.hidden_count > 0 && r.visible_total > 0) totalStr = U.esc_html(fmt_money(r.visible_total, 'toman')) + ' + <span class="hpa-cat-hidden-star">***</span>';
    else if (r.hidden_count > 0) totalStr = '<span class="hpa-cat-hidden-star">***</span>';
    else totalStr = U.esc_html(fmt_money(r.total, 'toman'));
    shares += '<details class="hpa-expense-share-row" style="background:' + U.esc_attr(r.color) + '"><summary><b><span>' + U.esc_html(r.icon) + '</span>' + U.esc_html(r.name) + '</b><em>' + U.esc_html(U.number_format_i18n(Math.round(pct * 10) / 10, 1)) + '%</em></summary><div class="hpa-expense-share-detail"><small>' + totalStr + '</small></div></details>';
  }
  return '<div class="hpa-chart-stack">' + bars + '</div>' + (percentList ? '<div class="hpa-expense-share-list">' + shares + '</div>' : '') + (legend ? leg : '');
}
function monthly_svg_chart() {
  const data = [];
  const months = { 1: 'فروردین', 2: 'اردیبهشت', 3: 'خرداد', 4: 'تیر', 5: 'مرداد', 6: 'شهریور', 7: 'مهر', 8: 'آبان', 9: 'آذر', 10: 'دی', 11: 'بهمن', 12: 'اسفند' };
  const tp = today_jalali().split('/'); const jy = parseInt(tp[0], 10) || 1403, jm0 = parseInt(tp[1], 10) || 1;
  for (let i = 5; i >= 0; i--) {
    let m = jm0 - i, y = jy; while (m <= 0) { m += 12; y--; }
    const last = m <= 6 ? 31 : (m <= 11 ? 30 : 29);
    const start = U.jalali_to_gregorian_date(U.pad(y, 4) + '/' + U.pad(m, 2) + '/01');
    const end = U.jalali_to_gregorian_date(U.pad(y, 4) + '/' + U.pad(m, 2) + '/' + U.pad(last, 2));
    const inc = rows_sum_toman(D.all("SELECT amount,currency FROM hpa_transactions WHERE type='income' AND status!='cancelled' AND gregorian_date BETWEEN ? AND ?", [start, end]));
    const exp = rows_sum_toman(D.all("SELECT amount,currency FROM hpa_transactions WHERE type IN ('expense','recurring_debt') AND status!='cancelled' AND gregorian_date BETWEEN ? AND ?", [start, end]));
    data.push([months[m] || String(m), inc, exp]);
  }
  const max = Math.max(1, ...data.map(d => Math.max(d[1], d[2])));
  let svg = '<svg class="hpa-svg" viewBox="0 0 720 330" role="img" aria-label="درآمد و هزینه شش ماه اخیر">';
  svg += '<line x1="76" y1="250" x2="690" y2="250" class="hpa-svg-axis"/><line x1="76" y1="42" x2="76" y2="250" class="hpa-svg-axis hpa-svg-axis-y"/>';
  for (let g = 0; g <= 4; g++) { const y = 250 - (g * 52); const val = Math.round((max / 4) * g); svg += '<line x1="76" y1="' + y + '" x2="690" y2="' + y + '" class="hpa-svg-grid"/><text x="12" y="' + (y + 5) + '" class="hpa-svg-label hpa-svg-y-label">' + U.esc_html(U.number_format_i18n(val / 1000000, 1)) + ' م</text>'; }
  let x = 104;
  for (const d of data) { const hi = Math.round((d[1] / max) * 190); const he = Math.round((d[2] / max) * 190); svg += '<rect x="' + x + '" y="' + (250 - hi) + '" width="24" height="' + hi + '" rx="6" class="hpa-svg-income"/>'; svg += '<rect x="' + (x + 32) + '" y="' + (250 - he) + '" width="24" height="' + he + '" rx="6" class="hpa-svg-expense"/>'; svg += '<text x="' + (x - 6) + '" y="287" class="hpa-svg-label hpa-svg-month">' + U.esc_html(d[0]) + '</text>'; x += 98; }
  return svg + '<text x="76" y="24" class="hpa-svg-label">سبز: درآمد | بنفش: هزینه — محور عمودی: میلیون تومان</text></svg>';
}
function account_balance_trend_svg() {
  const accounts = get_accounts(); if (!accounts.length) return '<p class="hpa-muted">حسابی ثبت نشده است.</p>';
  let out = '<div class="hpa-mini-trends">'; const monthsR = last_jalali_month_ranges(6);
  for (const a of accounts) {
    const vals = [];
    for (const m of monthsR) { const inn = transaction_sum_toman(cash_in_types(), "account_id=" + a.id + " AND gregorian_date<='" + m.end + "'"); const outg = transaction_sum_toman(cash_out_types(), "account_id=" + a.id + " AND gregorian_date<='" + m.end + "'"); vals.push(amount_to_toman(a.opening_balance, a.currency) + inn - outg); }
    const max = Math.max(...vals) || 1; let bars = ''; for (const v of vals) bars += '<span style="height:' + Math.max(6, Math.round(v * 80 / max)) + 'px"></span>';
    out += '<div class="hpa-trend-row"><b>' + U.esc_html(a.name) + '</b><div class="hpa-spark">' + bars + '</div></div>';
  }
  return out + '</div>';
}

// ================= reports =================
function report_financial_overview_text() {
  const range = current_jalali_month_gregorian_range();
  const income = transaction_sum_toman('income', "gregorian_date BETWEEN '" + range[0] + "' AND '" + range[1] + "'");
  const expense = transaction_sum_toman(expense_types(), "gregorian_date BETWEEN '" + range[0] + "' AND '" + range[1] + "'");
  const cashflow = income - expense; const assets = asset_summary_totals();
  const debts = table_sum_toman('debts', 'amount', "status!='paid'") + loan_remaining_total_toman() + check_open_total_toman();
  const ratio = income > 0 ? Math.round(expense * 100 / income) : 0;
  let out = '<section class="hpa-card hpa-analysis-card"><h2>خلاصه تحلیلی سلامت مالی</h2>';
  out += '<p>در ماه شمسی جاری، ورودی ثبت‌شده برابر <strong>' + U.esc_html(fmt_money(income, 'toman')) + '</strong> و خروجی ثبت‌شده برابر <strong>' + U.esc_html(fmt_money(expense, 'toman')) + '</strong> است. جریان نقدی ماه ' + (cashflow >= 0 ? 'مثبت' : 'منفی') + ' و معادل <strong class="' + (cashflow >= 0 ? 'hpa-positive' : 'hpa-negative') + '">' + U.esc_html((cashflow >= 0 ? '+' : '-') + fmt_money(Math.abs(cashflow), 'toman')) + '</strong> است.</p>';
  out += '<p>نسبت هزینه به درآمد ماه جاری حدود <strong>' + U.esc_html(ratio) + '%</strong> است. هرچه این نسبت پایین‌تر باشد توان پس‌انداز، سرمایه‌گذاری و پوشش تعهدات آینده بهتر است.</p>';
  out += '<p>ارزش فعلی دارایی‌های ثبت‌شده <strong>' + U.esc_html(fmt_money(assets.current, 'toman')) + '</strong> است و سود/زیان روی کاغذ آن <strong class="' + (assets.profit >= 0 ? 'hpa-positive' : 'hpa-negative') + '">' + U.esc_html((assets.profit >= 0 ? '+' : '-') + fmt_money(Math.abs(assets.profit), 'toman')) + '</strong> محاسبه شده. مجموع بدهی‌ها، اقساط مانده و چک‌های باز حدود <strong>' + U.esc_html(fmt_money(debts, 'toman')) + '</strong> است.</p>';
  return out + '</section>';
}
function report_accounting_health_ratios() {
  const range = current_jalali_month_gregorian_range();
  const income = transaction_sum_toman('income', "gregorian_date BETWEEN '" + range[0] + "' AND '" + range[1] + "'");
  const expense = transaction_sum_toman(expense_types(), "gregorian_date BETWEEN '" + range[0] + "' AND '" + range[1] + "'");
  const netSavings = income - expense;
  const assets = asset_summary_totals();
  const debtTotal = table_sum_toman('debts', 'amount', "status!='paid'") + loan_remaining_total_toman() + check_open_total_toman();
  const debtAssetRatio = assets.current > 0 ? Math.round(debtTotal * 100 / assets.current) : 0;
  const installments = transaction_sum_toman(['loan_installment', 'recurring_debt'], "gregorian_date BETWEEN '" + range[0] + "' AND '" + range[1] + "'");
  const installIncomeRatio = income > 0 ? Math.round(installments * 100 / income) : 0;
  const nextMin = next_month_minimum_liquidity();
  return '<section class="hpa-grid hpa-kpis hpa-accounting-ratios"><article class="hpa-kpi"><span>💾</span><small>خالص پس‌انداز ماه</small><strong class="' + (netSavings >= 0 ? 'hpa-positive' : 'hpa-negative') + '">' + U.esc_html((netSavings >= 0 ? '+' : '-') + fmt_money(Math.abs(netSavings), 'toman')) + '</strong></article><article class="hpa-kpi"><span>⚖️</span><small>نسبت بدهی به دارایی</small><strong>' + U.esc_html(debtAssetRatio) + '%</strong></article><article class="hpa-kpi"><span>🏦</span><small>نسبت اقساط به درآمد</small><strong>' + U.esc_html(installIncomeRatio) + '%</strong></article><article class="hpa-kpi"><span>🧭</span><small>حداقل نقدینگی ماه آینده</small><strong>' + U.esc_html(fmt_money(nextMin, 'toman')) + '</strong></article></section>';
}
function report_money_routes() {
  const range = current_jalali_month_gregorian_range();
  const outTypes = expense_types();
  const inTypes = ['income'];
  const outv = {}; for (const t of outTypes) outv[t] = transaction_sum_toman(t, "gregorian_date BETWEEN '" + range[0] + "' AND '" + range[1] + "'");
  const inv = {}; for (const t of inTypes) inv[t] = transaction_sum_toman(t, "gregorian_date BETWEEN '" + range[0] + "' AND '" + range[1] + "'");
  const labels = transaction_types();
  let out = '<section class="hpa-two"><div class="hpa-card"><h2>پول کجا رفت؟</h2>';
  for (const k in outv) if (outv[k] > 0) out += '<div class="hpa-list-row"><b>' + U.esc_html(labels[k] || k) + '</b><em class="hpa-negative">' + U.esc_html(fmt_money(outv[k], 'toman')) + '</em></div>';
  if (!Object.values(outv).some(v => v > 0)) out += '<p class="hpa-muted">خروجی قابل گزارشی در ماه جاری نیست.</p>';
  out += '</div><div class="hpa-card"><h2>پول از کجا آمد؟</h2>';
  for (const k in inv) if (inv[k] > 0) out += '<div class="hpa-list-row"><b>' + U.esc_html(labels[k] || k) + '</b><em class="hpa-positive">' + U.esc_html(fmt_money(inv[k], 'toman')) + '</em></div>';
  if (!Object.values(inv).some(v => v > 0)) out += '<p class="hpa-muted">ورودی قابل گزارشی در ماه جاری نیست.</p>';
  return out + '</div></section>';
}
function report_essential_expenses() {
  const range = current_jalali_month_gregorian_range();
  const rows = D.all("SELECT c.is_essential, t.amount, t.currency FROM hpa_transactions t LEFT JOIN hpa_categories c ON c.id=t.category_id WHERE t.status!='cancelled' AND t.type IN ('expense','recurring_debt') AND t.gregorian_date BETWEEN ? AND ?", [range[0], range[1]]);
  let ess = 0, non = 0; for (const r of rows) { if (Number(r.is_essential !== undefined && r.is_essential !== null ? r.is_essential : 1)) ess += amount_to_toman(r.amount, r.currency); else non += amount_to_toman(r.amount, r.currency); }
  return '<section class="hpa-card"><h2>هزینه‌های ضروری و غیرضروری ماه</h2><div class="hpa-metric-row"><span>ضروری</span><strong>' + U.esc_html(fmt_money(ess, 'toman')) + '</strong><span>غیرضروری</span><strong>' + U.esc_html(fmt_money(non, 'toman')) + '</strong></div><p class="hpa-muted">ضروری/غیرضروری بودن از تنظیمات موضوعات تراکنش خوانده می‌شود.</p></section>';
}
function report_person_transfers_shared() {
  const range = current_jalali_month_gregorian_range();
  const rows = D.all("SELECT from_person_key,to_person_key,amount,currency FROM hpa_transactions WHERE type='person_transfer' AND status!='cancelled' AND gregorian_date BETWEEN ? AND ?", [range[0], range[1]]);
  const net = { hamidreza_to_samira: 0, samira_to_hamidreza: 0 };
  for (const r of rows) { const v = amount_to_toman(r.amount, r.currency); if (r.from_person_key === 'hamidreza' && r.to_person_key === 'samira') net.hamidreza_to_samira += v; if (r.from_person_key === 'samira' && r.to_person_key === 'hamidreza') net.samira_to_hamidreza += v; }
  const shared = transaction_sum_toman(['expense', 'loan_installment', 'recurring_debt', 'check_settlement', 'asset_buy'], "person_key='joint' AND gregorian_date BETWEEN '" + range[0] + "' AND '" + range[1] + "'");
  const p = persons();
  return '<section class="hpa-two"><div class="hpa-card"><h2>گزارش انتقال بین اشخاص</h2><div class="hpa-list-row"><b>' + U.esc_html(p.hamidreza) + ' ← ' + U.esc_html(p.samira) + '</b><em>' + U.esc_html(fmt_money(net.hamidreza_to_samira, 'toman')) + '</em></div><div class="hpa-list-row"><b>' + U.esc_html(p.samira) + ' ← ' + U.esc_html(p.hamidreza) + '</b><em>' + U.esc_html(fmt_money(net.samira_to_hamidreza, 'toman')) + '</em></div></div><div class="hpa-card"><h2>خرج‌های مشترک ماه</h2><div class="hpa-list-row"><b>جمع هزینه‌های مشترک</b><em>' + U.esc_html(fmt_money(shared, 'toman')) + '</em></div></div></section>';
}
function report_places_largest_balance() {
  const range = current_jalali_month_gregorian_range();
  let out = '<section class="hpa-three"><div class="hpa-card"><h2>بیشترین محل‌های خرج</h2>';
  const places = D.all("SELECT transaction_place, SUM(amount) s, currency FROM hpa_transactions WHERE transaction_place<>'' AND type IN ('expense','asset_buy','loan_installment','recurring_debt','check_settlement') AND status!='cancelled' AND gregorian_date BETWEEN ? AND ? GROUP BY transaction_place ORDER BY s DESC LIMIT 8", [range[0], range[1]]);
  for (const r of places) out += '<div class="hpa-list-row"><b>' + U.esc_html(r.transaction_place) + '</b><em>' + U.esc_html(fmt_money(r.s, r.currency)) + '</em></div>';
  if (!places.length) out += '<p class="hpa-muted">محل خرج ثبت نشده است.</p>';
  out += '</div><div class="hpa-card"><h2>بزرگ‌ترین تراکنش‌های ماه</h2>';
  const big = D.all("SELECT * FROM hpa_transactions WHERE status!='cancelled' AND gregorian_date BETWEEN ? AND ? ORDER BY amount DESC LIMIT 10", [range[0], range[1]]);
  for (const r of big) out += '<div class="hpa-list-row"><b>' + U.esc_html(r.jalali_date + ' · ' + (transaction_types()[r.type] || r.type)) + '</b><em>' + U.esc_html(fmt_money(r.amount, r.currency)) + '</em></div>';
  if (!big.length) out += '<p class="hpa-muted">تراکنشی ثبت نشده است.</p>';
  out += '</div><div class="hpa-card"><h2>روند مانده حساب‌ها</h2>' + account_balance_trend_svg() + '</div></section>';
  return out;
}
function report_asset_profit_by_group() {
  const groups = asset_groups();
  const rows = D.all("SELECT * FROM hpa_assets WHERE COALESCE(is_active,1)=1 ORDER BY asset_group ASC");
  const data = {};
  for (const a of rows) { const v = asset_valuation(a); const g = a.asset_group; if (!data[g]) data[g] = { purchase: 0, current: 0 }; data[g].purchase += v.purchase_total; data[g].current += v.current_total; }
  let out = '<section class="hpa-card"><h2>سود و زیان دارایی‌ها به تفکیک نوع</h2><div class="hpa-table-wrap"><table class="hpa-table"><thead><tr><th>نوع دارایی</th><th>ارزش خرید</th><th>ارزش فعلی</th><th>سود/زیان</th></tr></thead><tbody>';
  if (!Object.keys(data).length) out += '<tr><td colspan="4" class="hpa-muted">دارایی فعالی ثبت نشده است.</td></tr>';
  for (const g in data) { const d = data[g]; const profit = d.current - d.purchase; const cls = profit >= 0 ? 'hpa-positive' : 'hpa-negative'; out += '<tr><td>' + U.esc_html(groups[g] || g) + '</td><td>' + U.esc_html(fmt_money(d.purchase, 'toman')) + '</td><td>' + U.esc_html(fmt_money(d.current, 'toman')) + '</td><td class="' + cls + '">' + U.esc_html((profit >= 0 ? '+' : '-') + fmt_money(Math.abs(profit), 'toman')) + '</td></tr>'; }
  return out + '</tbody></table></div></section>';
}
function report_asset_realized_unrealized() {
  const sells = D.all("SELECT t.*, a.unit_price, a.currency asset_currency, a.title FROM hpa_transactions t LEFT JOIN hpa_assets a ON a.id=t.asset_id WHERE t.type='asset_sell' AND t.status!='cancelled' AND t.asset_id>0");
  let real = 0; for (const r of sells) { const qty = Number(r.asset_quantity) || 0; const cost = qty > 0 ? (Number(r.unit_price) || 0) * qty : 0; real += amount_to_toman(r.amount, r.currency) - amount_to_toman(cost, r.asset_currency || r.currency); }
  const unreal = asset_summary_totals().profit;
  return '<section class="hpa-card"><h2>سود/زیان تحقق‌یافته و تحقق‌نیافته</h2><div class="hpa-metric-row"><span>تحقق‌یافته از فروش دارایی</span><strong class="' + (real >= 0 ? 'hpa-positive' : 'hpa-negative') + '">' + U.esc_html((real >= 0 ? '+' : '-') + fmt_money(Math.abs(real), 'toman')) + '</strong><span>تحقق‌نیافته روی دارایی‌های موجود</span><strong class="' + (unreal >= 0 ? 'hpa-positive' : 'hpa-negative') + '">' + U.esc_html((unreal >= 0 ? '+' : '-') + fmt_money(Math.abs(unreal), 'toman')) + '</strong></div></section>';
}
function report_networth_affecting() {
  const rows = D.all("SELECT * FROM hpa_transactions WHERE status!='cancelled' AND type NOT IN ('transfer','person_transfer') ORDER BY gregorian_date DESC,id DESC LIMIT 12");
  let out = '<section class="hpa-card"><h2>تراکنش‌های اثرگذار روی دارایی خالص</h2>';
  for (const r of rows) out += '<div class="hpa-list-row"><b>' + U.esc_html(r.jalali_date + ' · ' + (transaction_types()[r.type] || r.type)) + '</b><em>' + U.esc_html(fmt_money(r.amount, r.currency)) + '</em></div>';
  if (!rows.length) out += '<p class="hpa-muted">موردی وجود ندارد.</p>';
  return out + '</section>';
}
function report_month_comparison() {
  const ranges = last_jalali_month_ranges(2); if (ranges.length < 2) return ''; const cur = ranges[1], prev = ranges[0];
  const ci = transaction_sum_toman('income', "gregorian_date BETWEEN '" + cur.start + "' AND '" + cur.end + "'"); const pi = transaction_sum_toman('income', "gregorian_date BETWEEN '" + prev.start + "' AND '" + prev.end + "'");
  const exps = expense_types();
  const ce = transaction_sum_toman(exps, "gregorian_date BETWEEN '" + cur.start + "' AND '" + cur.end + "'"); const pe = transaction_sum_toman(exps, "gregorian_date BETWEEN '" + prev.start + "' AND '" + prev.end + "'");
  const pct = (a, b) => b > 0 ? Math.round((a - b) * 100 / b) : 0;
  return '<section class="hpa-card"><h2>مقایسه ماه جاری با ماه قبل</h2><div class="hpa-metric-row"><span>تغییر درآمد</span><strong class="' + (ci >= pi ? 'hpa-positive' : 'hpa-negative') + '">' + U.esc_html(pct(ci, pi)) + '%</strong><span>تغییر هزینه</span><strong class="' + (ce <= pe ? 'hpa-positive' : 'hpa-negative') + '">' + U.esc_html(pct(ce, pe)) + '%</strong><span>پس‌انداز خالص</span><strong>' + U.esc_html(fmt_money(ci - ce, 'toman')) + '</strong></div></section>';
}
function report_cashflow_and_calendar() {
  const range = current_jalali_month_gregorian_range();
  const income = transaction_sum_toman('income', "gregorian_date BETWEEN '" + range[0] + "' AND '" + range[1] + "'");
  const expense = transaction_sum_toman(expense_types(), "gregorian_date BETWEEN '" + range[0] + "' AND '" + range[1] + "'");
  const net = income - expense;
  let out = '<section class="hpa-two"><div class="hpa-card"><h2>گزارش جریان نقدی ماه شمسی</h2><div class="hpa-list-row"><b>ورودی ماه</b><em class="hpa-positive">' + U.esc_html(fmt_money(income, 'toman')) + '</em></div><div class="hpa-list-row"><b>خروجی ماه</b><em class="hpa-negative">' + U.esc_html(fmt_money(expense, 'toman')) + '</em></div><div class="hpa-list-row"><b>خالص جریان نقدی</b><em class="' + (net >= 0 ? 'hpa-positive' : 'hpa-negative') + '">' + U.esc_html((net >= 0 ? '+' : '-') + fmt_money(Math.abs(net), 'toman')) + '</em></div></div>';
  const events = [];
  const tx = D.all("SELECT jalali_date, COUNT(*) c, SUM(amount) s, currency FROM hpa_transactions WHERE gregorian_date BETWEEN ? AND ? GROUP BY jalali_date ORDER BY gregorian_date ASC LIMIT 45", [range[0], range[1]]);
  for (const r of tx) events.push('<span class="hpa-calendar-chip">' + U.esc_html(r.jalali_date) + ' — ' + (Number(r.c) || 0) + ' تراکنش</span>');
  const checks = D.all("SELECT first_due_jalali_date, title FROM hpa_checks WHERE status!='paid' AND first_due_gregorian_date BETWEEN ? AND ? ORDER BY first_due_gregorian_date ASC LIMIT 20", [range[0], range[1]]);
  for (const r of checks) events.push('<span class="hpa-calendar-chip hpa-calendar-warn">' + U.esc_html(r.first_due_jalali_date) + ' — چک: ' + U.esc_html(r.title) + '</span>');
  const loans = D.all("SELECT i.due_jalali_date, l.title FROM hpa_loan_installments i LEFT JOIN hpa_loans l ON l.id=i.loan_id WHERE i.status!='paid' AND i.due_gregorian_date BETWEEN ? AND ? ORDER BY i.due_gregorian_date ASC LIMIT 20", [range[0], range[1]]);
  for (const r of loans) events.push('<span class="hpa-calendar-chip hpa-calendar-warn">' + U.esc_html(r.due_jalali_date) + ' — قسط: ' + U.esc_html(r.title) + '</span>');
  out += '<div class="hpa-card"><h2>تقویم مالی ماه شمسی</h2><div class="hpa-calendar-list">' + (events.length ? events.join('') : '<p class="hpa-muted">رویدادی برای این ماه ثبت نشده است.</p>') + '</div></div></section>';
  return out;
}
function report_item_spending() {
  const range = current_jalali_month_gregorian_range();
  const rows = D.all("SELECT name, amount, currency FROM hpa_transaction_items WHERE gregorian_date BETWEEN ? AND ?", [range[0], range[1]]);
  const map = {};
  for (const r of rows) { const key = String(r.name).trim(); if (!key) continue; map[key] = (map[key] || 0) + amount_to_toman(r.amount, r.currency); }
  const list = Object.keys(map).map(k => [k, map[k]]).sort((a, b) => b[1] - a[1]);
  const total = list.reduce((s, x) => s + x[1], 0);
  let out = '<section class="hpa-card hpa-item-spending"><div class="hpa-section-head"><div><h2>خرج به تفکیک قلم (ماه جاری)</h2><p class="hpa-muted">جمع هزینهٔ هر قلمی که هنگام ثبت تراکنش با قیمت جدا وارد کرده‌ای — مستقل از مبلغ کل.</p></div></div>';
  if (!list.length) out += '<p class="hpa-muted">هنوز قلمی با قیمت ثبت نشده است. هنگام ثبت تراکنش، در بخش «اقلام خرید» نام و قیمت هر قلم را وارد کن.</p>';
  else {
    out += '<div class="hpa-table-wrap"><table class="hpa-table"><thead><tr><th>قلم</th><th>جمع در ماه</th><th>سهم</th></tr></thead><tbody>';
    for (const [name, t] of list) { const pct = total > 0 ? Math.round(t * 100 / total) : 0; out += '<tr><td>' + U.esc_html(name) + '</td><td>' + U.esc_html(fmt_money(t, 'toman')) + '</td><td>' + U.esc_html(U.number_format_i18n(pct, 0)) + '%</td></tr>'; }
    out += '<tr><td><strong>جمع کل اقلام</strong></td><td><strong>' + U.esc_html(fmt_money(total, 'toman')) + '</strong></td><td>—</td></tr>';
    out += '</tbody></table></div>';
  }
  return out + '</section>';
}
function report_financing_summary() {
  const range = current_jalali_month_gregorian_range();
  const labels = transaction_types();
  const w = "gregorian_date BETWEEN '" + range[0] + "' AND '" + range[1] + "'";
  const inRows = financing_in_types().map(t => [t, transaction_sum_toman(t, w)]);
  const outRows = financing_out_types().map(t => [t, transaction_sum_toman(t, w)]);
  const inTotal = inRows.reduce((s, x) => s + x[1], 0);
  const outTotal = outRows.reduce((s, x) => s + x[1], 0);
  let out = '<section class="hpa-card hpa-financing-card"><div class="hpa-section-head"><div><h2>جابه‌جایی پول و بازپرداخت‌ها (ماه جاری)</h2><p class="hpa-muted">اینها درآمد یا هزینه نیستند؛ فقط جابه‌جایی پول‌اند (گرفتن/پس‌دادن قرض و وام، خرید/فروش دارایی، وصول طلب) و در «درآمد/هزینهٔ ماه» شمرده نمی‌شوند. روی موجودی حساب اثر می‌گذارند ولی روی «ارزش خالص دارایی» نه.</p></div></div><div class="hpa-two">';
  out += '<div class="hpa-card hpa-subcard"><h3>ورودی پول (تأمین مالی)</h3>';
  let anyIn = false;
  for (const [t, v] of inRows) if (v > 0) { anyIn = true; out += '<div class="hpa-list-row"><b>' + U.esc_html(labels[t] || t) + '</b><em class="hpa-positive">' + U.esc_html(fmt_money(v, 'toman')) + '</em></div>'; }
  if (!anyIn) out += '<p class="hpa-muted">موردی در این ماه نیست.</p>';
  out += '<div class="hpa-list-row"><b>جمع ورودی</b><em>' + U.esc_html(fmt_money(inTotal, 'toman')) + '</em></div></div>';
  out += '<div class="hpa-card hpa-subcard"><h3>خروجی پول (بازپرداخت/خرید دارایی)</h3>';
  let anyOut = false;
  for (const [t, v] of outRows) if (v > 0) { anyOut = true; out += '<div class="hpa-list-row"><b>' + U.esc_html(labels[t] || t) + '</b><em class="hpa-negative">' + U.esc_html(fmt_money(v, 'toman')) + '</em></div>'; }
  if (!anyOut) out += '<p class="hpa-muted">موردی در این ماه نیست.</p>';
  out += '<div class="hpa-list-row"><b>جمع خروجی</b><em>' + U.esc_html(fmt_money(outTotal, 'toman')) + '</em></div></div></div></section>';
  return out;
}
function view_reports() {
  let out = report_financial_overview_text();
  const balances = calculate_balances();
  const income = transaction_sum_toman('income');
  const expense = transaction_sum_toman(expense_types());
  const assetSummary = asset_summary_totals();
  const debtsTotal = table_sum_toman('debts', 'amount', "status!='paid'") + loan_remaining_total_toman() + check_open_total_toman();
  const recvTotal = table_sum_toman('receivables', 'amount', "status!='paid'");
  out += '<section class="hpa-grid hpa-kpis hpa-report-kpis">';
  out += kpi('کل درآمد ثبت‌شده', fmt_money(income, 'toman'), '📈');
  out += kpi('کل هزینه ثبت‌شده', fmt_money(expense, 'toman'), '📉');
  out += kpi('ارزش فعلی دارایی‌ها', fmt_money(assetSummary.current, 'toman'), assetSummary.profit >= 0 ? '<span class="hpa-trend-icon hpa-trend-up">↗</span>' : '<span class="hpa-trend-icon hpa-trend-down">↘</span>');
  out += kpi('طلب باز', fmt_money(recvTotal, 'toman'), '🤝');
  out += kpi('بدهی باز', fmt_money(debtsTotal, 'toman'), '⚠️');
  out += kpi('مانده حساب‌ها', fmt_money(total_balances_toman(balances), 'toman'), '💳');
  out += '</section>';
  out += report_month_comparison();
  out += report_accounting_health_ratios();
  out += report_money_routes();
  out += report_essential_expenses();
  out += report_item_spending();
  out += report_financing_summary();
  out += report_person_transfers_shared();
  out += '<section class="hpa-two"><div class="hpa-card"><h2>نمودار هزینه‌ها بر اساس موضوع</h2>' + expense_chart(true) + '</div><div class="hpa-card"><h2>درآمد و هزینه ۶ ماه اخیر</h2>' + monthly_svg_chart() + '</div></section>';
  out += '<section class="hpa-two"><div class="hpa-card"><h2>گزارش حساب‌ها</h2>';
  const accounts = get_accounts();
  if (!accounts.length) out += '<p class="hpa-muted">حسابی ثبت نشده است.</p>';
  for (const a of accounts) out += '<div class="hpa-list-row"><span class="hpa-badge" style="background:' + U.esc_attr(a.color) + '">' + U.esc_html(a.icon) + '</span><b>' + U.esc_html(a.name) + '<small class="hpa-inline-person">' + U.esc_html(person_label(a.person_key || 'hamidreza')) + '</small></b><em>' + U.esc_html(fmt_money(balances[a.id] || 0, a.currency)) + '</em></div>';
  out += '</div><div class="hpa-card"><h2>گزارش بر اساس شخص</h2>';
  const p = persons();
  for (const key in p) {
    const pin = transaction_sum_toman('income', "person_key='" + key + "'");
    const pex = transaction_sum_toman(expense_types(), "person_key='" + key + "'");
    const pas = asset_summary_totals("person_key='" + key + "'").current;
    out += '<div class="hpa-list-row"><span class="hpa-person-pill">' + U.esc_html(p[key]) + '</span><b>درآمد: ' + U.esc_html(fmt_money(pin, 'toman')) + '<br>هزینه: ' + U.esc_html(fmt_money(pex, 'toman')) + '</b><em>دارایی فعلی: ' + U.esc_html(fmt_money(pas, 'toman')) + '</em></div>';
  }
  out += '</div></section>';
  out += report_asset_profit_by_group();
  out += report_asset_realized_unrealized();
  out += report_places_largest_balance();
  out += report_networth_affecting();
  out += report_cashflow_and_calendar();
  out += '<section class="hpa-card"><div class="hpa-section-head"><div><h2>خروجی PDF و بکاپ</h2><p class="hpa-muted">برای PDF از چاپ استفاده کن و مقصد را Save as PDF بگذار. بکاپ JSON شامل همه داده‌ها است.</p></div><button type="button" class="hpa-btn hpa-btn-primary" onclick="window.print()">خروجی PDF گزارش</button></div>';
  out += '<div class="hpa-row-actions hpa-backup-actions"><a class="hpa-btn hpa-btn-ghost" href="' + U.esc_url(actionUrl('hpa_export_backup')) + '">دانلود بکاپ کامل</a>';
  out += form_open('hpa_import_backup', true);
  out += '<input type="file" name="hpa_backup" accept="application/json" required><button class="hpa-btn hpa-btn-primary" type="submit">بازیابی بکاپ</button></form></div></section>';
  out += '<section class="hpa-card"><h2>آخرین تراکنش‌ها برای کنترل گزارش</h2>' + transactions_table(12) + '</section>';
  return out;
}

// ================= VIEW: rates =================
function view_rates() {
  const items = rate_items();
  let out = '<section class="hpa-card hpa-mobile-settings-hub"><h2>دسترسی سریع</h2><p class="hpa-muted">میان‌بر بخش‌هایی که در منوی موبایل مخفی شده‌اند.</p><div class="hpa-settings-grid"><a href="' + U.esc_url(buildUrl({ hpa_tab: 'accounts' })) + '">💳 حساب‌ها</a><a href="' + U.esc_url(buildUrl({ hpa_tab: 'categories' })) + '">🏷️ موضوعات</a><a href="' + U.esc_url(buildUrl({ hpa_tab: 'debt' })) + '">📉 بدهی/وام/چک</a><a href="' + U.esc_url(buildUrl({ hpa_tab: 'receivable' })) + '">📈 طلب‌ها</a></div></section>';
  out += '<section class="hpa-card"><div class="hpa-section-head"><div><h2>نرخ‌ها و تنظیمات مالی</h2><p class="hpa-muted">نرخ ارز، طلا و کریپتو. با دکمهٔ زیر از منبع آنلاین (TGJU) به‌روزرسانی می‌شوند و کش می‌گردند.</p></div>';
  out += '<a class="hpa-btn hpa-btn-ghost" href="' + U.esc_url(actionUrl('hpa_fetch_rates')) + '">آپدیت نرخ‌ها از آنلاین</a></div>';
  out += form_open('hpa_save_rate');
  out += '<div class="hpa-form-grid"><label>عنوان نرخ<select name="rate_key">';
  for (const k in items) out += '<option value="' + U.esc_attr(k) + '">' + U.esc_html(items[k][2] + ' ' + items[k][0]) + '</option>';
  out += '</select></label><label>قیمت به تومان<input name="price" required inputmode="decimal"></label><label>تاریخ شمسی<input name="jalali_date" class="hpa-jdate" required value="' + U.esc_attr(today_jalali()) + '" placeholder="1403/01/15"></label><label>منبع/توضیح کوتاه<input name="source" placeholder="دستی / بازار / صرافی"></label><label class="hpa-col-full">یادداشت<textarea name="note"></textarea></label></div>';
  out += form_close('ثبت نرخ دستی');
  out += '</section><section class="hpa-card"><h2>آخرین نرخ‌های ثبت‌شده</h2>';
  const rows = D.all("SELECT * FROM hpa_rates ORDER BY (CASE type WHEN 'currency' THEN 0 WHEN 'metal' THEN 1 WHEN 'crypto' THEN 2 ELSE 3 END), title ASC");
  out += '<div class="hpa-rate-grid">';
  for (const r of rows) { const icon = (items[r.rate_key] ? items[r.rate_key][2] : '💱'); out += '<article class="hpa-rate-card"><span>' + U.esc_html(icon) + '</span><small>' + U.esc_html(r.title) + '</small><strong>' + U.esc_html(fmt_money(r.price, 'toman')) + '</strong><em>' + U.esc_html((r.is_manual ? 'دستی' : 'آنلاین') + ' | ' + (r.jalali_date || '')) + '</em>' + delete_button('hpa_delete_rate', r.id, 'rates') + '</article>'; }
  if (!rows.length) out += '<p class="hpa-muted">هنوز نرخی ثبت نشده است.</p>';
  out += '</div></section>';
  return out;
}

// ================= VIEW: settings (app + site connection) =================
function view_settings() {
  const s = settings();
  const p = persons();
  const sync = D.getOption('site_sync', { site_url: '', username: '', token: '', enabled: 0, last_result: '' });
  let out = '<section class="hpa-card"><h2>ظاهر و پیش‌فرض‌ها</h2>' + form_open('hpa_save_settings');
  out += '<div class="hpa-form-grid"><label>حالت ظاهری<select name="theme_mode"><option value="light"' + U.selected(s.theme_mode || 'light', 'light') + '>روشن</option><option value="dark"' + U.selected(s.theme_mode || 'light', 'dark') + '>تیره</option></select></label>';
  out += '<label>واحد پول پیش‌فرض<select name="default_currency">';
  const curr = currencies(); for (const k in curr) out += '<option value="' + U.esc_attr(k) + '"' + U.selected(s.default_currency || 'toman', k) + '>' + U.esc_html(curr[k]) + '</option>';
  out += '</select></label>';
  out += '<label>نمایش حساب‌های بسته‌شده <span class="hpa-checkline"><input type="checkbox" name="show_inactive_accounts" value="1"' + U.checked(s.show_inactive_accounts ? 1 : 0, 1) + '> بله</span></label>';
  out += '<label>آپدیت خودکار نرخ‌ها هنگام باز شدن برنامه <span class="hpa-checkline"><input type="checkbox" name="auto_rate_update" value="1"' + U.checked(s.auto_rate_update ? 1 : 0, 1) + '> بله</span></label>';
  out += '<label>قفل PIN برنامه<input type="password" name="security_pin" autocomplete="new-password" placeholder="خالی = بدون قفل" value="' + U.esc_attr(s.security_pin || '') + '"><small class="hpa-help">اگر PIN تنظیم شود، هنگام باز شدن برنامه پرسیده می‌شود.</small></label>';
  out += '</div><h3 class="hpa-settings-subhead">نام اشخاص</h3><div class="hpa-form-grid">';
  out += '<label>شخص اول<input name="person_hamidreza" value="' + U.esc_attr(p.hamidreza) + '"></label>';
  out += '<label>شخص دوم<input name="person_samira" value="' + U.esc_attr(p.samira) + '"></label>';
  out += '<label>مشترک<input name="person_joint" value="' + U.esc_attr(p.joint) + '"></label>';
  out += '</div>' + form_close('ذخیره تنظیمات') + '</section>';

  // Site connection card
  out += '<section class="hpa-card hpa-sync-card"><div class="hpa-section-head"><div><h2>اتصال به سایت (افزونه وردپرس)</h2><p class="hpa-muted">این برنامه می‌تواند با افزونهٔ «حساب‌یار» روی سایت وردپرسی شما داده‌ها را دوطرفه همگام کند. کافی است در تنظیمات افزونه، «اتصال اپ» را فعال کنید و سپس اینجا وارد شوید.</p></div><span class="hpa-sync-status ' + (sync.token ? 'is-on' : 'is-off') + '">' + (sync.token ? '● متصل' : '○ متصل نیست') + '</span></div>';
  out += form_open('hpa_save_sync');
  out += '<div class="hpa-form-grid"><label>آدرس سایت<input name="site_url" placeholder="https://example.com" value="' + U.esc_attr(sync.site_url || '') + '"></label>';
  out += '<label>نام کاربری وردپرس<input name="username" value="' + U.esc_attr(sync.username || '') + '"></label>';
  out += '<label>رمز عبور وردپرس<input type="password" name="password" autocomplete="new-password" placeholder="' + (sync.token ? 'برای تغییر دوباره وارد کنید' : 'رمز ورود سایت') + '"></label>';
  out += '<label class="hpa-col-full"><span class="hpa-checkline"><input type="checkbox" name="enabled" value="1"' + U.checked(sync.enabled ? 1 : 0, 1) + '> اتصال فعال باشد</span></label></div>';
  out += form_close('ذخیره و اتصال');
  if (sync.token) {
    out += '<div class="hpa-row-actions hpa-sync-actions" style="margin-top:12px">'
      + '<a class="hpa-btn hpa-btn-ghost" href="' + U.esc_url(actionUrl('hpa_sync_test')) + '">تست اتصال</a>'
      + '<a class="hpa-btn hpa-btn-primary" onclick="return confirm(\'داده‌های سایت دریافت و در برنامه ادغام شود؟\')" href="' + U.esc_url(actionUrl('hpa_sync_pull')) + '">دریافت از سایت</a>'
      + '<a class="hpa-btn hpa-btn-primary" onclick="return confirm(\'داده‌های برنامه به سایت ارسال شود؟\')" href="' + U.esc_url(actionUrl('hpa_sync_push')) + '">ارسال به سایت</a>'
      + '<a class="hpa-btn hpa-btn-primary" onclick="return confirm(\'همگام‌سازی کامل دوطرفه انجام شود؟\')" href="' + U.esc_url(actionUrl('hpa_sync_full')) + '">همگام‌سازی کامل</a>'
      + '</div>';
  }
  if (sync.last_result) out += '<p class="hpa-muted hpa-sync-result">' + U.esc_html(sync.last_result) + '</p>';
  out += '</section>';

  // Deleted items (trash)
  out += '<section class="hpa-card"><h2>سطل بازیافت (حذف‌شده‌ها)</h2><p class="hpa-muted">حذف‌ها به‌صورت نرم نگهداری می‌شوند تا در صورت اشتباه بازیابی شوند.</p>';
  const del = D.all('SELECT * FROM hpa_deleted_items ORDER BY deleted_at DESC LIMIT 200');
  out += '<div class="hpa-table-wrap"><table class="hpa-table"><thead><tr><th>نوع</th><th>عنوان</th><th>زمان حذف</th><th>عملیات</th></tr></thead><tbody>';
  if (!del.length) out += '<tr><td colspan="4" class="hpa-muted">مورد حذف‌شده‌ای نیست.</td></tr>';
  for (const r of del) out += '<tr><td>' + U.esc_html(r.table_key) + '</td><td>' + U.esc_html(r.item_title || '—') + '</td><td>' + U.esc_html(r.deleted_at) + '</td><td><div class="hpa-row-actions"><a class="hpa-edit" href="' + U.esc_url(actionUrl('hpa_restore_deleted_item', { id: r.id })) + '">بازیابی</a><a class="hpa-delete" onclick="return confirm(\'حذف دائمی؟\')" href="' + U.esc_url(actionUrl('hpa_permanent_delete_item', { id: r.id })) + '">حذف دائمی</a></div></td></tr>';
  out += '</tbody></table></div></section>';

  // Archive (snapshot + reset to zero)
  const agroups = archive_groups();
  out += '<section class="hpa-card hpa-archive-card"><h2>بایگانی و شروع دورهٔ جدید</h2><p class="hpa-muted">بخش‌های انتخابی را بایگانی کن: یک نسخهٔ کامل ذخیره می‌شود و سپس آن داده‌ها و اعدادشان صفر می‌شوند تا از نو شروع کنی. تعهدات باز (بدهی/وام/چک پرداخت‌نشده و طلب وصول‌نشده) پاک نمی‌شوند. بعداً می‌توانی از هر بایگانی خروجی PDF بگیری.</p>';
  out += form_open('hpa_save_archive');
  out += '<label class="hpa-col-full">عنوان بایگانی<input name="archive_title" placeholder="مثلاً پایان سال ۱۴۰۴"></label>';
  out += '<div class="hpa-archive-groups"><label class="hpa-checkline hpa-archive-all"><input type="checkbox" name="group_all" value="1"> <strong>همه‌چیز</strong></label>';
  for (const k in agroups) out += '<label class="hpa-checkline"><input type="checkbox" name="group_' + k + '" value="1"> ' + U.esc_html(agroups[k]) + '</label>';
  out += '</div>';
  out += '<button class="hpa-btn hpa-btn-danger" type="submit" onclick="return confirm(\'مطمئنی؟ داده‌های انتخاب‌شده صفر و پاک می‌شوند. یک نسخهٔ بایگانی برای خروجی PDF ذخیره می‌ماند. این کار قابل بازگشت خودکار نیست.\')">بایگانی و صفر کردن</button></form>';
  const archs = D.all('SELECT * FROM hpa_archives ORDER BY id DESC LIMIT 100');
  out += '<h3 class="hpa-settings-subhead">بایگانی‌های ثبت‌شده</h3>';
  if (!archs.length) out += '<p class="hpa-muted">هنوز بایگانی‌ای ثبت نشده است.</p>';
  else {
    out += '<div class="hpa-table-wrap"><table class="hpa-table"><thead><tr><th>عنوان</th><th>تاریخ</th><th>بخش‌ها</th><th>عملیات</th></tr></thead><tbody>';
    for (const r of archs) { let scope = []; try { scope = JSON.parse(r.scope || '[]'); } catch (e) { } out += '<tr><td>' + U.esc_html(r.title) + '</td><td>' + U.esc_html(r.jalali_date) + '</td><td>' + U.esc_html(scope.join('، ')) + '</td><td><div class="hpa-row-actions"><a class="hpa-edit" href="/archive-report?id=' + U.esc_attr(r.id) + '&hpa_token=' + U.esc_attr(CTX.token) + '" target="_blank" rel="noopener">دانلود PDF</a>' + delete_button('hpa_delete_archive', r.id, 'settings') + '</div></td></tr>'; }
    out += '</tbody></table></div>';
  }
  out += '</section>';

  out += '<section class="hpa-card hpa-about-card"><h2>درباره ' + U.esc_html(APP_NAME) + '</h2><p class="hpa-muted">' + U.esc_html(APP_SUBTITLE) + ' — نسخهٔ ' + U.esc_html(VERSION) + '</p></section>';
  return out;
}
function save_settings(post) {
  const s = settings();
  s.theme_mode = U.sanitize_key(P(post, 'theme_mode', 'light'));
  s.default_currency = U.sanitize_key(P(post, 'default_currency', 'toman'));
  s.auto_rate_update = PB(post, 'auto_rate_update') ? 1 : 0;
  s.show_inactive_accounts = PB(post, 'show_inactive_accounts') ? 1 : 0;
  s.security_pin = P(post, 'security_pin', '');
  D.setOption('hpa_settings', s);
  D.setOption('person_labels', { hamidreza: P(post, 'person_hamidreza', 'خودم') || 'خودم', samira: P(post, 'person_samira', 'همسر') || 'همسر', joint: P(post, 'person_joint', 'مشترک') || 'مشترک' });
  return 'settings';
}

// ================= ARCHIVE (snapshot + reset to zero) =================
function archive_groups() {
  return {
    tx: 'تراکنش‌ها',
    accounts: 'حساب‌ها',
    assets: 'دارایی‌ها',
    qard: 'قرض‌ها (بدهی ساده)',
    liabilities: 'بدهی‌ها (وام، چک، تکرارشونده)',
    receivables: 'طلب‌ها'
  };
}
function save_archive(post) {
  _accountsCache = null; _balancesCache = null;
  const groups = archive_groups();
  let selected = [];
  if (PB(post, 'group_all')) selected = Object.keys(groups);
  else for (const k in groups) if (PB(post, 'group_' + k)) selected.push(k);
  if (!selected.length) return 'settings';
  const G = new Set(selected);
  const title = P(post, 'archive_title') || ('بایگانی ' + today_jalali());
  const snap = {}; const summary = {};
  const add = (table, rows) => { if (rows && rows.length) snap[table] = (snap[table] || []).concat(rows); };
  const inPlaceholders = (ids) => ids.map(() => '?').join(',');

  const wipeAllTx = G.has('tx') || G.has('accounts');
  if (wipeAllTx) {
    const txs = D.all('SELECT * FROM hpa_transactions');
    _balancesCache = null;
    const bal = calculate_balances();
    if (G.has('tx')) summary.tx = { label: groups.tx, count: txs.length, total: transaction_sum_toman('income') };
    if (G.has('accounts')) {
      const accts = D.all('SELECT * FROM hpa_accounts');
      let totalBal = 0; for (const a of accts) totalBal += amount_to_toman(bal[a.id] || 0, a.currency);
      summary.accounts = { label: groups.accounts, count: accts.length, total: totalBal };
      add('hpa_accounts', accts);
    }
    add('hpa_transactions', txs);
    add('hpa_transaction_items', D.all('SELECT * FROM hpa_transaction_items'));
    add('hpa_transaction_splits', D.all('SELECT * FROM hpa_transaction_splits'));
    D.run('DELETE FROM hpa_transactions'); D.run('DELETE FROM hpa_transaction_items'); D.run('DELETE FROM hpa_transaction_splits');
    if (G.has('accounts')) D.run('DELETE FROM hpa_accounts');
    else D.run('UPDATE hpa_accounts SET opening_balance=0, updated_at=?', [U.now_mysql()]); // absolute zero
  }
  if (G.has('assets')) {
    const assets = D.all('SELECT * FROM hpa_assets');
    let cur = 0; for (const a of assets) cur += asset_valuation(a).current_total;
    summary.assets = { label: groups.assets, count: assets.length, total: cur };
    add('hpa_assets', assets); add('hpa_asset_files', D.all('SELECT * FROM hpa_asset_files')); add('hpa_goals', D.all('SELECT * FROM hpa_goals'));
    add('hpa_transactions', D.all("SELECT * FROM hpa_transactions WHERE type IN ('asset_buy','asset_sell')"));
    D.run('DELETE FROM hpa_assets'); D.run('DELETE FROM hpa_asset_files'); D.run('DELETE FROM hpa_goals'); D.run("DELETE FROM hpa_transactions WHERE type IN ('asset_buy','asset_sell')");
  }
  if (G.has('qard')) {
    const paid = D.all("SELECT * FROM hpa_debts WHERE status='paid'");
    summary.qard = { label: groups.qard, count: paid.length, total: rows_sum_toman(paid) };
    add('hpa_debts', paid);
    const ids = paid.map(r => r.id);
    if (ids.length) { const ph = inPlaceholders(ids); add('hpa_transactions', D.all("SELECT * FROM hpa_transactions WHERE debt_id IN (" + ph + ") AND type IN ('debt_incur','debt_settlement')", ids)); D.run("DELETE FROM hpa_transactions WHERE debt_id IN (" + ph + ") AND type IN ('debt_incur','debt_settlement')", ids); D.run("DELETE FROM hpa_debts WHERE status='paid'"); }
  }
  if (G.has('liabilities')) {
    let liaCount = 0, liaTotal = 0;
    const loansPaid = D.all("SELECT * FROM hpa_loans WHERE status='paid'"); const loanIds = loansPaid.map(r => r.id);
    add('hpa_loans', loansPaid); liaCount += loansPaid.length; liaTotal += rows_sum_toman(loansPaid, 'principal_amount');
    if (loanIds.length) { const ph = inPlaceholders(loanIds); add('hpa_loan_installments', D.all("SELECT * FROM hpa_loan_installments WHERE loan_id IN (" + ph + ")", loanIds)); add('hpa_transactions', D.all("SELECT * FROM hpa_transactions WHERE source_loan_id IN (" + ph + ") AND type IN ('debt_incur','loan_installment')", loanIds)); D.run("DELETE FROM hpa_transactions WHERE source_loan_id IN (" + ph + ") AND type IN ('debt_incur','loan_installment')", loanIds); D.run("DELETE FROM hpa_loan_installments WHERE loan_id IN (" + ph + ")", loanIds); D.run("DELETE FROM hpa_loans WHERE status='paid'"); }
    const checksPaid = D.all("SELECT * FROM hpa_checks WHERE status='paid'"); const checkIds = checksPaid.map(r => r.id);
    add('hpa_checks', checksPaid); liaCount += checksPaid.length; for (const c of checksPaid) liaTotal += amount_to_toman((Number(c.amount_each) || 0) * Math.max(1, Number(c.check_count) || 0), c.currency);
    if (checkIds.length) { const ph = inPlaceholders(checkIds); add('hpa_transactions', D.all("SELECT * FROM hpa_transactions WHERE check_id IN (" + ph + ") AND type='check_settlement'", checkIds)); D.run("DELETE FROM hpa_transactions WHERE check_id IN (" + ph + ") AND type='check_settlement'", checkIds); D.run("DELETE FROM hpa_checks WHERE status='paid'"); }
    const recInactive = D.all("SELECT * FROM hpa_recurring WHERE status!='active'"); const recIds = recInactive.map(r => r.id);
    add('hpa_recurring', recInactive); liaCount += recInactive.length;
    if (recIds.length) { const ph = inPlaceholders(recIds); add('hpa_transactions', D.all("SELECT * FROM hpa_transactions WHERE recurring_id IN (" + ph + ") AND type='recurring_debt'", recIds)); D.run("DELETE FROM hpa_transactions WHERE recurring_id IN (" + ph + ") AND type='recurring_debt'", recIds); D.run("DELETE FROM hpa_recurring WHERE status!='active'"); }
    summary.liabilities = { label: groups.liabilities, count: liaCount, total: liaTotal };
  }
  if (G.has('receivables')) {
    const paid = D.all("SELECT * FROM hpa_receivables WHERE status='paid'");
    summary.receivables = { label: groups.receivables, count: paid.length, total: rows_sum_toman(paid) };
    add('hpa_receivables', paid);
    const ids = paid.map(r => r.id);
    if (ids.length) { const ph = inPlaceholders(ids); add('hpa_transactions', D.all("SELECT * FROM hpa_transactions WHERE receivable_id IN (" + ph + ") AND type='receivable_settlement'", ids)); D.run("DELETE FROM hpa_transactions WHERE receivable_id IN (" + ph + ") AND type='receivable_settlement'", ids); D.run("DELETE FROM hpa_receivables WHERE status='paid'"); }
  }
  D.insert('hpa_archives', {
    title: title, scope: JSON.stringify(selected.map(k => groups[k] || k)), summary: JSON.stringify(summary),
    data: JSON.stringify(snap), jalali_date: today_jalali(), gregorian_date: U.today_gregorian(), created_at: U.now_mysql()
  });
  _accountsCache = null; _balancesCache = null;
  return 'settings';
}
function delete_archive(post) { D.del('hpa_archives', { id: PI(post, 'id') }); return 'settings'; }

function render_archive_report(id) {
  const a = D.get('SELECT * FROM hpa_archives WHERE id=?', [U.absint(id)]);
  const styles = '<style>@page{size:A4;margin:14mm}html,body{margin:0}body{font-family:"IRANSansXFaNum",Tahoma,sans-serif!important;direction:rtl;color:#0f172a;padding:16px;background:#fff}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:5px}p{margin:4px 0;color:#334155}table.rep{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}table.rep th,table.rep td{border:1px solid #e2e8f0;padding:6px 8px;text-align:right}table.rep th{background:#f1f5f9}.noprint{margin:0 0 14px}.noprint button{padding:9px 16px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font-weight:700;cursor:pointer}@media print{.noprint{display:none!important}}</style>';
  const head = '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/css/app.css">' + styles + '<title>گزارش بایگانی</title></head><body>';
  const foot = '<script>window.addEventListener("load",function(){setTimeout(function(){try{window.print();}catch(e){}},450);});</script></body></html>';
  if (!a) return head + '<p>بایگانی یافت نشد.</p>' + foot;
  let summary = {}, data = {}, scope = [];
  try { summary = JSON.parse(a.summary || '{}'); } catch (e) { }
  try { data = JSON.parse(a.data || '{}'); } catch (e) { }
  try { scope = JSON.parse(a.scope || '[]'); } catch (e) { }
  const types = transaction_types();
  let body = '<div class="noprint"><button onclick="window.print()">چاپ / ذخیره PDF</button></div>';
  body += '<h1>گزارش بایگانی: ' + U.esc_html(a.title) + '</h1>';
  body += '<p>تاریخ بایگانی: ' + U.esc_html(a.jalali_date) + ' — ' + U.esc_html(APP_NAME) + '</p>';
  body += '<p>بخش‌های بایگانی‌شده: ' + U.esc_html(scope.join('، ')) + '</p>';
  body += '<h2>خلاصه</h2><table class="rep"><thead><tr><th>بخش</th><th>تعداد</th><th>جمع (تومان)</th></tr></thead><tbody>';
  for (const k in summary) { const s = summary[k]; body += '<tr><td>' + U.esc_html(s.label || k) + '</td><td>' + U.esc_html(U.number_format_i18n(s.count || 0)) + '</td><td>' + U.esc_html(fmt_money(s.total || 0, 'toman')) + '</td></tr>'; }
  body += '</tbody></table>';
  const tbl = (rows, heads, cells) => { let h = '<table class="rep"><thead><tr>'; for (const x of heads) h += '<th>' + U.esc_html(x) + '</th>'; h += '</tr></thead><tbody>'; for (const r of rows) { h += '<tr>'; for (const c of cells(r)) h += '<td>' + c + '</td>'; h += '</tr>'; } return h + '</tbody></table>'; };
  if (data.hpa_transactions && data.hpa_transactions.length) body += '<h2>تراکنش‌ها (' + U.number_format_i18n(data.hpa_transactions.length) + ')</h2>' + tbl(data.hpa_transactions, ['تاریخ', 'نوع', 'مبلغ', 'توضیح'], r => [U.esc_html(r.jalali_date), U.esc_html(types[r.type] || r.type), U.esc_html(fmt_money(r.amount, r.currency)), U.esc_html(U.wp_trim_words(r.description || '', 12))]);
  if (data.hpa_accounts && data.hpa_accounts.length) body += '<h2>حساب‌ها (' + U.number_format_i18n(data.hpa_accounts.length) + ')</h2>' + tbl(data.hpa_accounts, ['نام', 'نوع', 'ارز', 'موجودی اولیه'], r => [U.esc_html(r.name), U.esc_html((account_types()[r.type] || r.type)), U.esc_html(currencies()[r.currency] || r.currency), U.esc_html(fmt_money(r.opening_balance, r.currency))]);
  if (data.hpa_assets && data.hpa_assets.length) body += '<h2>دارایی‌ها (' + U.number_format_i18n(data.hpa_assets.length) + ')</h2>' + tbl(data.hpa_assets, ['عنوان', 'گروه', 'قیمت خرید'], r => [U.esc_html(r.title), U.esc_html(asset_groups()[r.asset_group] || r.asset_group), U.esc_html(fmt_money(r.purchase_price, r.currency))]);
  if (data.hpa_debts && data.hpa_debts.length) body += '<h2>قرض‌ها (' + U.number_format_i18n(data.hpa_debts.length) + ')</h2>' + tbl(data.hpa_debts, ['شخص', 'مبلغ', 'تاریخ', 'وضعیت'], r => [U.esc_html(r.person_name), U.esc_html(fmt_money(r.amount, r.currency)), U.esc_html(r.jalali_date), U.esc_html(status_labels()[r.status] || r.status)]);
  if (data.hpa_loans && data.hpa_loans.length) body += '<h2>وام‌ها (' + U.number_format_i18n(data.hpa_loans.length) + ')</h2>' + tbl(data.hpa_loans, ['عنوان', 'وام‌دهنده', 'اصل وام'], r => [U.esc_html(r.title), U.esc_html(r.lender || '—'), U.esc_html(fmt_money(r.principal_amount, r.currency))]);
  if (data.hpa_checks && data.hpa_checks.length) body += '<h2>چک‌ها (' + U.number_format_i18n(data.hpa_checks.length) + ')</h2>' + tbl(data.hpa_checks, ['عنوان', 'تعداد', 'مبلغ هر چک'], r => [U.esc_html(r.title), U.esc_html(U.number_format_i18n(r.check_count)), U.esc_html(fmt_money(r.amount_each, r.currency))]);
  if (data.hpa_recurring && data.hpa_recurring.length) body += '<h2>تکرارشونده‌ها (' + U.number_format_i18n(data.hpa_recurring.length) + ')</h2>' + tbl(data.hpa_recurring, ['عنوان', 'مبلغ', 'دوره'], r => [U.esc_html(r.title), U.esc_html(fmt_money(r.amount, r.currency)), U.esc_html(r.interval_type)]);
  if (data.hpa_receivables && data.hpa_receivables.length) body += '<h2>طلب‌ها (' + U.number_format_i18n(data.hpa_receivables.length) + ')</h2>' + tbl(data.hpa_receivables, ['شخص', 'مبلغ', 'تاریخ', 'وضعیت'], r => [U.esc_html(r.person_name), U.esc_html(fmt_money(r.amount, r.currency)), U.esc_html(r.jalali_date), U.esc_html(status_labels()[r.status] || r.status)]);
  return head + body + foot;
}

// ================= dispatchers =================
function renderTab(tab) {
  _accountsCache = null; _balancesCache = null;
  let body;
  if (tab === 'accounts') body = view_accounts();
  else if (tab === 'categories') body = view_categories();
  else if (tab === 'transactions') body = view_transactions();
  else if (tab === 'debt') body = view_debts_full();
  else if (tab === 'receivable') body = view_debt_like('receivables', 'receivable', 'طلب‌ها', 'hpa_save_receivable', 'بدهکار');
  else if (tab === 'assets') body = view_assets();
  else if (tab === 'reports') body = view_reports();
  else if (tab === 'rates') body = view_rates();
  else if (tab === 'settings') body = view_settings();
  else { tab = 'dashboard'; body = view_dashboard(); }
  const s = settings();
  const mode = s.theme_mode || 'light';
  return '<div class="hpa-app hpa-mode-' + U.esc_attr(mode) + '" dir="rtl">' + topbar(tab) + '<main class="hpa-main">' + tab_header(tab) + body + '</main></div>';
}

const ACTIONS = {
  hpa_save_account: (p, f) => save_account(p), hpa_delete_account: (p) => delete_account(p), hpa_reopen_account: (p) => reopen_account(p),
  hpa_save_category: (p) => save_category(p), hpa_delete_category: (p) => delete_category(p),
  hpa_save_transaction: (p, f) => save_transaction(p, f), hpa_delete_transaction: (p) => delete_transaction(p),
  hpa_save_debt: (p, f) => save_debt_like(p, f, 'debts', 'debt'), hpa_save_receivable: (p, f) => save_debt_like(p, f, 'receivables', 'receivable'),
  hpa_delete_debt: (p) => delete_debt(p), hpa_delete_receivable: (p) => delete_receivable(p),
  hpa_save_asset: (p, f) => save_asset(p, f), hpa_delete_asset: (p) => delete_asset(p),
  hpa_save_loan: (p) => save_loan(p), hpa_delete_loan: (p) => delete_loan(p),
  hpa_save_check: (p) => save_check(p), hpa_delete_check: (p) => delete_check(p),
  hpa_save_recurring: (p) => save_recurring(p), hpa_delete_recurring: (p) => delete_recurring(p),
  hpa_save_goal: (p) => save_goal(p), hpa_delete_goal: (p) => delete_goal(p),
  hpa_save_rate: (p) => save_rate(p), hpa_delete_rate: (p) => delete_rate(p),
  hpa_reconcile_account: (p) => reconcile_account(p),
  hpa_restore_deleted_item: (p) => restore_deleted_item(p), hpa_permanent_delete_item: (p) => permanent_delete_item(p),
  hpa_save_settings: (p) => save_settings(p),
  hpa_save_archive: (p) => save_archive(p), hpa_delete_archive: (p) => delete_archive(p)
};

// async-capable actions (rates fetch, sync) handled separately in server
function handleAction(action, post, files) {
  const fn = ACTIONS[action];
  if (!fn) return 'dashboard';
  return fn(post, files) || 'dashboard';
}

function export_backup_json() {
  const out = { version: VERSION, created_at: U.now_mysql(), tables: {} };
  for (const key in D.TABLES) { if (key === 'settings') continue; out.tables[key] = D.all('SELECT * FROM ' + D.TABLES[key]); }
  return out;
}
function import_backup(data) {
  if (!data || typeof data !== 'object' || !data.tables) return 'reports';
  for (const key in data.tables) {
    if (!D.TABLES[key] || !Array.isArray(data.tables[key])) continue;
    const table = D.TABLES[key];
    for (const row of data.tables[key]) {
      if (!row || typeof row !== 'object') continue;
      if (row.id) { const exists = Number(D.scalar('SELECT id FROM ' + table + ' WHERE id=?', [row.id])) || 0; if (exists) D.update(table, row, { id: row.id }); else D.insert(table, row); }
      else D.insert(table, row);
    }
  }
  return 'reports';
}

Object.assign(module.exports, {
  renderTab, handleAction, setUploadDir, export_backup_json, import_backup,
  future_obligation_items, resolve_recurring_payment_selection, get_goals,
  render_archive_report
});



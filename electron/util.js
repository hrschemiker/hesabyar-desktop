'use strict';
// Faithful port of the plugin's helper/format/Jalali functions to Node.

function intdiv(a, b) { return Math.trunc(a / b); }

// ---- Jalali <-> Gregorian (exact algorithm from the plugin) ----
function gregorian_to_jalali(gy, gm, gd) {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = 355666 + (365 * gy) + intdiv(gy2 + 3, 4) - intdiv(gy2 + 99, 100) + intdiv(gy2 + 399, 400) + gd + g_d_m[gm - 1];
  let jy = -1595 + (33 * intdiv(days, 12053)); days %= 12053;
  jy += 4 * intdiv(days, 1461); days %= 1461;
  let jm, jd;
  if (days > 365) { jy += intdiv(days - 1, 365); days = (days - 1) % 365; }
  if (days < 186) { jm = 1 + intdiv(days, 31); jd = 1 + (days % 31); }
  else { jm = 7 + intdiv(days - 186, 30); jd = 1 + ((days - 186) % 30); }
  return [jy, jm, jd];
}

function jalali_to_gregorian(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + (365 * jy) + intdiv(jy, 33) * 8 + intdiv((jy % 33 + 3), 4) + jd + ((jm < 7) ? ((jm - 1) * 31) : (((jm - 7) * 30) + 186));
  let gy = 400 * intdiv(days, 146097); days %= 146097;
  if (days > 36524) { days--; gy += 100 * intdiv(days, 36524); days %= 36524; if (days >= 365) days++; }
  gy += 4 * intdiv(days, 1461); days %= 1461;
  if (days > 365) { gy += intdiv(days - 1, 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const sal_a = [0, 31, (((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm;
  for (gm = 1; gm <= 12 && gd > sal_a[gm]; gm++) gd -= sal_a[gm];
  return [gy, gm, gd];
}

function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

function gregorian_to_jalali_date(gdate) {
  const d = gdate ? new Date(gdate + (gdate.length <= 10 ? 'T00:00:00' : '')) : new Date();
  const dd = isNaN(d.getTime()) ? new Date() : d;
  const [jy, jm, jd] = gregorian_to_jalali(dd.getFullYear(), dd.getMonth() + 1, dd.getDate());
  return pad(jy, 4) + '/' + pad(jm, 2) + '/' + pad(jd, 2);
}

function jalali_to_gregorian_date(jalali) {
  jalali = String(jalali || '').replace(/[۰-۹٠-٩]/g, faDigitToEn).replace(/[^0-9/\-]/g, '');
  const parts = jalali.split(/[/\-]/);
  if (parts.length < 3) return today_gregorian();
  const jy = parseInt(parts[0], 10) || 0, jm = parseInt(parts[1], 10) || 0, jd = parseInt(parts[2], 10) || 0;
  const [gy, gm, gd] = jalali_to_gregorian(jy, jm, jd);
  return pad(gy, 4) + '-' + pad(gm, 2) + '-' + pad(gd, 2);
}

function faDigitToEn(d) { return String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(d) % 10); }

function today_gregorian() {
  const d = new Date();
  return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
}

function today_jalali() { return gregorian_to_jalali_date(today_gregorian()); }

function now_mysql() {
  const d = new Date();
  return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2) + ' ' +
    pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
}

// date('Y-m-d', strtotime(modifier, base)) helpers
function date_add_days(base, days) {
  const d = new Date((base || today_gregorian()) + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
}
function date_add_months(base, months) {
  const d = new Date((base || today_gregorian()) + 'T00:00:00');
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // guard month overflow like PHP strtotime does not, but plugin uses first-of-month so fine
  if (d.getDate() < day) d.setDate(0);
  return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
}
function date_add_years(base, years) {
  const d = new Date((base || today_gregorian()) + 'T00:00:00');
  d.setFullYear(d.getFullYear() + years);
  return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
}

// ---- Number formatting (mimics number_format_i18n for fa_IR) ----
const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
function toPersianDigits(s) { return String(s).replace(/[0-9]/g, d => FA[+d]); }
function number_format_i18n(num, decimals) {
  decimals = decimals || 0;
  num = Number(num) || 0;
  const neg = num < 0; num = Math.abs(num);
  let s = num.toFixed(decimals);
  let [intp, dec] = s.split('.');
  intp = intp.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  let out = intp + (dec ? '٫' + dec : '');
  out = toPersianDigits(out);
  return (neg ? '‎-' : '') + out;
}

// ---- HTML escaping ----
function esc_html(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function esc_attr(s) { return esc_html(s); }
function esc_textarea(s) { return esc_html(s); }
function esc_url(s) { return esc_html(String(s === null || s === undefined ? '' : s)); }

// selected()/checked() helpers
function selected(a, b) { return String(a) === String(b) ? ' selected' : ''; }
function checked(a, b) { return String(a) === String(b) ? ' checked' : ''; }

// wp_trim_words
function wp_trim_words(text, num) {
  text = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const words = text.split(' ');
  if (words.length <= num) return text;
  return words.slice(0, num).join(' ') + ' …';
}
function wp_strip_all_tags(s) { return String(s || '').replace(/<[^>]*>/g, ''); }

function esc_like(s) { return String(s || '').replace(/[%_\\]/g, '\\$&'); }

// sanitize helpers
function sanitize_key(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9_\-]/g, ''); }
function absint(s) { const n = parseInt(String(s).replace(/[۰-۹٠-٩]/g, faDigitToEn), 10); return isNaN(n) || n < 0 ? 0 : n; }
function money_val(s) {
  if (s === undefined || s === null) return 0;
  const n = parseFloat(String(s).replace(/[۰-۹٠-٩]/g, faDigitToEn).replace(/[,٬\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

module.exports = {
  intdiv, gregorian_to_jalali, jalali_to_gregorian, gregorian_to_jalali_date, jalali_to_gregorian_date,
  today_gregorian, today_jalali, now_mysql, date_add_days, date_add_months, date_add_years,
  toPersianDigits, number_format_i18n, esc_html, esc_attr, esc_textarea, esc_url, selected, checked,
  wp_trim_words, wp_strip_all_tags, esc_like, sanitize_key, absint, money_val, pad
};

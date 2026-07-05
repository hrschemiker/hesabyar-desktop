'use strict';
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const U = require('./util');

let SQL = null;
let db = null;
let dbPath = null;
let saveTimer = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hpa_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  person_key TEXT NOT NULL DEFAULT 'hamidreza',
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'cash',
  currency TEXT NOT NULL DEFAULT 'toman',
  opening_balance REAL NOT NULL DEFAULT 0,
  bank_name TEXT, account_number TEXT, card_number TEXT, iban TEXT,
  icon TEXT, color TEXT, note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS hpa_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'expense',
  icon TEXT, color TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_essential INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hpa_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  person_key TEXT NOT NULL DEFAULT 'hamidreza',
  from_person_key TEXT NOT NULL DEFAULT 'hamidreza',
  to_person_key TEXT NOT NULL DEFAULT 'samira',
  account_id INTEGER NOT NULL DEFAULT 0,
  to_account_id INTEGER NOT NULL DEFAULT 0,
  category_id INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'expense',
  amount REAL NOT NULL DEFAULT 0,
  fee_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'toman',
  jalali_date TEXT NOT NULL,
  gregorian_date TEXT NOT NULL,
  description TEXT,
  transaction_place TEXT,
  receipt_id INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  source_loan_id INTEGER NOT NULL DEFAULT 0,
  loan_installment_id INTEGER NOT NULL DEFAULT 0,
  debt_id INTEGER NOT NULL DEFAULT 0,
  receivable_id INTEGER NOT NULL DEFAULT 0,
  check_id INTEGER NOT NULL DEFAULT 0,
  asset_id INTEGER NOT NULL DEFAULT 0,
  asset_quantity REAL NOT NULL DEFAULT 0,
  recurring_id INTEGER NOT NULL DEFAULT 0,
  recurring_due_jalali_date TEXT,
  recurring_due_gregorian_date TEXT,
  status TEXT NOT NULL DEFAULT 'done',
  hide_amount INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS hpa_debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  person_name TEXT NOT NULL, phone TEXT,
  amount REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  fee_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'toman',
  account_id INTEGER NOT NULL DEFAULT 0,
  jalali_date TEXT NOT NULL, gregorian_date TEXT NOT NULL,
  due_jalali_date TEXT, due_gregorian_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT, receipt_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS hpa_receivables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  person_name TEXT NOT NULL, phone TEXT,
  amount REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  fee_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'toman',
  jalali_date TEXT NOT NULL, gregorian_date TEXT NOT NULL,
  due_jalali_date TEXT, due_gregorian_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT, receipt_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS hpa_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  person_key TEXT NOT NULL DEFAULT 'hamidreza',
  title TEXT NOT NULL,
  asset_group TEXT NOT NULL DEFAULT 'gold',
  model TEXT, purity TEXT, weight REAL, quantity REAL, unit TEXT,
  purchase_price REAL NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'toman',
  jalali_date TEXT NOT NULL, gregorian_date TEXT NOT NULL,
  purchase_place TEXT,
  source_loan_id INTEGER NOT NULL DEFAULT 0,
  goal_id INTEGER NOT NULL DEFAULT 0,
  funding_source TEXT NOT NULL DEFAULT 'personal',
  receipt_id INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS hpa_asset_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  asset_id INTEGER NOT NULL DEFAULT 0,
  attachment_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hpa_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rate_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'currency',
  price REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'toman',
  source TEXT, jalali_date TEXT, gregorian_date TEXT, note TEXT,
  is_manual INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS hpa_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  person_key TEXT NOT NULL DEFAULT 'hamidreza',
  title TEXT NOT NULL, lender TEXT,
  principal_amount REAL NOT NULL DEFAULT 0,
  fee_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'toman',
  account_id INTEGER NOT NULL DEFAULT 0,
  received_jalali_date TEXT, received_gregorian_date TEXT,
  used_for TEXT,
  total_installments INTEGER NOT NULL DEFAULT 0,
  paid_installments INTEGER NOT NULL DEFAULT 0,
  installment_amount REAL NOT NULL DEFAULT 0,
  variable_installments INTEGER NOT NULL DEFAULT 0,
  installment_overrides TEXT,
  first_due_jalali_date TEXT, first_due_gregorian_date TEXT,
  last_due_jalali_date TEXT, last_due_gregorian_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT, created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS hpa_loan_installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  loan_id INTEGER NOT NULL DEFAULT 0,
  installment_no INTEGER NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  fee_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'toman',
  due_jalali_date TEXT, due_gregorian_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  paid_transaction_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS hpa_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  person_key TEXT NOT NULL DEFAULT 'hamidreza',
  title TEXT NOT NULL,
  check_count INTEGER NOT NULL DEFAULT 1,
  amount_each REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'toman',
  first_due_jalali_date TEXT, first_due_gregorian_date TEXT,
  used_for TEXT,
  include_in_assets INTEGER NOT NULL DEFAULT 0,
  paid_transaction_id INTEGER NOT NULL DEFAULT 0,
  paid_jalali_date TEXT, paid_gregorian_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT, created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS hpa_recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  person_key TEXT NOT NULL DEFAULT 'hamidreza',
  title TEXT NOT NULL,
  category_id INTEGER NOT NULL DEFAULT 0,
  account_id INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'expense',
  amount REAL NOT NULL DEFAULT 0,
  fee_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'toman',
  interval_type TEXT NOT NULL DEFAULT 'monthly',
  start_jalali_date TEXT, start_gregorian_date TEXT,
  next_jalali_date TEXT, next_gregorian_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT, created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS hpa_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  object_type TEXT NOT NULL,
  object_id INTEGER NOT NULL DEFAULT 0,
  attachment_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hpa_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  target_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'toman',
  target_jalali_date TEXT, target_gregorian_date TEXT,
  note TEXT, status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS hpa_transaction_splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL DEFAULT 0,
  category_id INTEGER NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'toman',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hpa_transaction_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'toman',
  jalali_date TEXT,
  gregorian_date TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hpa_deleted_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_key TEXT NOT NULL,
  original_id INTEGER NOT NULL DEFAULT 0,
  item_title TEXT,
  item_data TEXT NOT NULL,
  deleted_by INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hpa_archives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  scope TEXT,
  summary TEXT,
  data TEXT,
  jalali_date TEXT,
  gregorian_date TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hpa_options (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT
);
CREATE TABLE IF NOT EXISTS hpa_attachment_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT, stored_path TEXT, mime TEXT, created_at TEXT
);
`;

// Table key -> real table name (mirrors plugin $this->tables)
const TABLES = {
  accounts: 'hpa_accounts', categories: 'hpa_categories', transactions: 'hpa_transactions',
  debts: 'hpa_debts', receivables: 'hpa_receivables', assets: 'hpa_assets', asset_files: 'hpa_asset_files',
  rates: 'hpa_rates', loans: 'hpa_loans', loan_installments: 'hpa_loan_installments', checks: 'hpa_checks',
  recurring: 'hpa_recurring', attachments: 'hpa_attachments', goals: 'hpa_goals',
  transaction_splits: 'hpa_transaction_splits', transaction_items: 'hpa_transaction_items', deleted_items: 'hpa_deleted_items',
  archives: 'hpa_archives'
};

async function init(userDataDir, wasmBinaryPath) {
  SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmBinaryPath) });
  dbPath = path.join(userDataDir, 'hesabyar.sqlite');
  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = OFF;');
  db.exec(SCHEMA);
  migrate();
  seedDefaults();
  save();
}

// Add columns/tables that may be missing on databases created by older versions.
function ensureColumn(table, col, ddl) {
  const cols = all('PRAGMA table_info(' + table + ')');
  if (!cols.some(c => c.name === col)) db.run('ALTER TABLE ' + table + ' ADD COLUMN ' + ddl);
}
function migrate() {
  try {
    ensureColumn('hpa_debts', 'account_id', 'account_id INTEGER NOT NULL DEFAULT 0');
    ensureColumn('hpa_loans', 'account_id', 'account_id INTEGER NOT NULL DEFAULT 0');
  } catch (e) { /* best-effort */ }
}

function all(sql, params) {
  const stmt = db.prepare(sql);
  if (params && params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function get(sql, params) { const r = all(sql, params); return r.length ? r[0] : null; }
function scalar(sql, params) { const r = get(sql, params); if (!r) return null; const k = Object.keys(r)[0]; return r[k]; }
function run(sql, params) {
  const stmt = db.prepare(sql);
  if (params && params.length) stmt.bind(params);
  stmt.step();
  stmt.free();
  const changes = db.getRowsModified();
  const lid = scalar('SELECT last_insert_rowid() AS id');
  scheduleSave();
  return { changes, lastInsertRowid: Number(lid) || 0 };
}

// Insert helper: data is {col: val}
function insert(table, data) {
  const cols = Object.keys(data);
  const ph = cols.map(() => '?').join(',');
  const vals = cols.map(c => normVal(data[c]));
  return run(`INSERT INTO ${table} (${cols.map(c => '`' + c + '`').join(',')}) VALUES (${ph})`, vals);
}
function update(table, data, where) {
  const cols = Object.keys(data);
  const set = cols.map(c => '`' + c + '`=?').join(',');
  const wcols = Object.keys(where);
  const wsql = wcols.map(c => '`' + c + '`=?').join(' AND ');
  const vals = cols.map(c => normVal(data[c])).concat(wcols.map(c => normVal(where[c])));
  return run(`UPDATE ${table} SET ${set} WHERE ${wsql}`, vals);
}
function del(table, where) {
  const wcols = Object.keys(where);
  const wsql = wcols.map(c => '`' + c + '`=?').join(' AND ');
  const vals = wcols.map(c => normVal(where[c]));
  return run(`DELETE FROM ${table} WHERE ${wsql}`, vals);
}
function normVal(v) {
  if (v === undefined) return null;
  if (v === true) return 1;
  if (v === false) return 0;
  return v;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
}
function save() {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (e) { /* ignore */ }
}

// ---- Options (mirrors get_option / update_option) ----
function getOption(key, def) {
  const r = get('SELECT setting_value FROM hpa_options WHERE setting_key=?', [key]);
  if (!r || r.setting_value == null) return def;
  try { return JSON.parse(r.setting_value); } catch (e) { return def; }
}
function setOption(key, val) {
  const s = JSON.stringify(val);
  const exists = get('SELECT setting_key FROM hpa_options WHERE setting_key=?', [key]);
  if (exists) run('UPDATE hpa_options SET setting_value=? WHERE setting_key=?', [s, key]);
  else run('INSERT INTO hpa_options (setting_key, setting_value) VALUES (?,?)', [key, s]);
}

function seedDefaults() {
  const count = scalar('SELECT COUNT(*) AS c FROM hpa_categories WHERE is_default=1');
  if (Number(count) > 0) return;
  const defaults = [
    ['خوراک و سوپرمارکت', 'expense', '🛒', '#FDE68A'], ['رستوران و کافه', 'expense', '🍽️', '#FECACA'], ['اجاره خانه', 'expense', '🏠', '#DDD6FE'],
    ['قبوض و شارژ', 'expense', '💡', '#BAE6FD'], ['اینترنت و موبایل', 'expense', '📱', '#BFDBFE'], ['حمل‌ونقل عمومی', 'expense', '🚇', '#BBF7D0'],
    ['تاکسی و بنزین', 'expense', '🚕', '#FED7AA'], ['درمان و دارو', 'expense', '💊', '#FBCFE8'], ['بیمه', 'expense', '🛡️', '#C7D2FE'],
    ['آموزش و کتاب', 'expense', '📚', '#A7F3D0'], ['پوشاک', 'expense', '👕', '#E9D5FF'], ['تفریح و سفر', 'expense', '✈️', '#FEF3C7'],
    ['هدیه و مهمانی', 'expense', '🎁', '#FCE7F3'], ['تعمیرات و وسایل خانه', 'expense', '🛠️', '#D1FAE5'], ['مالیات و عوارض', 'expense', '🧾', '#E5E7EB'],
    ['قسط و وام', 'expense', '🏦', '#FEE2E2'], ['سرمایه‌گذاری', 'expense', '📈', '#DCFCE7'], ['سایر هزینه‌ها', 'expense', '📌', '#E0E7FF'],
    ['حقوق و دستمزد', 'income', '💼', '#BBF7D0'], ['درآمد آزاد', 'income', '🧑‍💻', '#BAE6FD'], ['فروش دارایی', 'income', '💰', '#FEF08A'],
    ['هدیه دریافتی', 'income', '🎉', '#FBCFE8'], ['سود سرمایه‌گذاری', 'income', '📊', '#A7F3D0'], ['سایر درآمدها', 'income', '✨', '#DDD6FE'],
  ];
  const now = U.now_mysql();
  for (const d of defaults) {
    insert('hpa_categories', { user_id: 0, name: d[0], type: d[1], icon: d[2], color: d[3], is_default: 1, is_essential: 1, created_at: now });
  }
}

module.exports = {
  init, all, get, scalar, run, insert, update, del, save, getOption, setOption, TABLES,
  get raw() { return db; }
};

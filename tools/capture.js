'use strict';
// Runs the real app, seeds demo data, and captures PNG screenshots for the repo.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const D = require('../electron/db');
const core = require('../electron/core');
const { createServer, TOKEN } = require('../electron/server');

const OUT = path.join(__dirname, '..', 'docs');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

function act(action, post) { core.setContext({}, TOKEN); return core.handleAction(action, post || {}, {}); }

function seed() {
  // rates first so asset valuations show market values
  act('hpa_save_rate', { rate_key: 'usd', price: '58200', jalali_date: '1403/04/15' });
  act('hpa_save_rate', { rate_key: 'eur', price: '63500', jalali_date: '1403/04/15' });
  act('hpa_save_rate', { rate_key: 'gold18', price: '3620000', jalali_date: '1403/04/15' });
  act('hpa_save_rate', { rate_key: 'gold24', price: '4820000', jalali_date: '1403/04/15' });
  act('hpa_save_rate', { rate_key: 'btc', price: '3850000000', jalali_date: '1403/04/15' });
  // accounts
  act('hpa_save_account', { name: 'کارت بانک ملت', person_key: 'hamidreza', type: 'bank', currency: 'toman', opening_balance: '48,500,000', bank_name: 'ملت', card_number: '6104-3378-****-1122', icon: '💳', color: '#dbeafe', is_active: '1' });
  act('hpa_save_account', { name: 'کیف پول نقدی', person_key: 'joint', type: 'cash', currency: 'toman', opening_balance: '3,200,000', icon: '👛', color: '#fef9c3', is_active: '1' });
  act('hpa_save_account', { name: 'حساب دلاری', person_key: 'samira', type: 'bank', currency: 'usd', opening_balance: '1,250', icon: '💵', color: '#dcfce7', is_active: '1' });
  // income + expenses (current jalali month spread)
  const tj = core.U.today_jalali(); const ym = tj.slice(0, 8);
  act('hpa_save_transaction', { person_key: 'hamidreza', type: 'income', account_id: '1', category_id: '19', amount: '92,000,000', currency: 'toman', jalali_date: ym + '03', description: 'حقوق تیر ماه', status: 'done' });
  act('hpa_save_transaction', { person_key: 'joint', type: 'expense', account_id: '1', category_id: '1', amount: '4,350,000', currency: 'toman', jalali_date: ym + '05', transaction_place: 'هایپرمی', tags: 'ضروری,خانه', status: 'done', hpa_items: '[{"name":"شیر","amount":450000},{"name":"برنج","amount":1200000},{"name":"میوه","amount":900000}]' });
  act('hpa_save_transaction', { person_key: 'joint', type: 'expense', account_id: '2', category_id: '2', amount: '1,180,000', currency: 'toman', jalali_date: ym + '07', transaction_place: 'کافه لمیز', tags: 'تفریح', status: 'done', hpa_items: '[{"name":"قهوه","amount":680000},{"name":"کیک","amount":500000}]' });
  act('hpa_save_transaction', { person_key: 'joint', type: 'expense', account_id: '1', category_id: '4', amount: '2,650,000', currency: 'toman', jalali_date: ym + '09', transaction_place: 'قبض برق و گاز', status: 'done' });
  act('hpa_save_transaction', { person_key: 'hamidreza', type: 'expense', account_id: '1', category_id: '7', amount: '900,000', currency: 'toman', jalali_date: ym + '11', transaction_place: 'پمپ بنزین', status: 'done' });
  act('hpa_save_transaction', { person_key: 'samira', type: 'expense', account_id: '1', category_id: '11', amount: '3,900,000', currency: 'toman', jalali_date: ym + '12', transaction_place: 'مانتو', tags: 'پوشاک', status: 'done' });
  act('hpa_save_transaction', { type: 'transfer', account_id: '1', to_account_id: '2', amount: '5,000,000', fee_amount: '0', currency: 'toman', jalali_date: ym + '13', description: 'برداشت نقدی', status: 'done' });
  act('hpa_save_transaction', { person_key: 'hamidreza', type: 'income', account_id: '1', category_id: '20', amount: '15,500,000', currency: 'toman', jalali_date: ym + '14', description: 'پروژه فریلنس', status: 'done' });
  // debt / receivable
  act('hpa_save_debt', { person_name: 'آقای رضایی', amount: '12,000,000', paid_amount: '4,000,000', currency: 'toman', account_id: '1', jalali_date: ym + '02', due_jalali_date: ym + '25', status: 'partial' });
  act('hpa_save_receivable', { person_name: 'شرکت آریا', amount: '20,000,000', paid_amount: '0', currency: 'toman', jalali_date: ym + '01', due_jalali_date: ym + '28', status: 'open' });
  // loan + installments
  act('hpa_save_loan', { title: 'وام خرید خودرو', person_key: 'hamidreza', lender: 'بانک صادرات', principal_amount: '300,000,000', currency: 'toman', received_jalali_date: '1403/01/10', first_due_jalali_date: '1403/02/10', last_due_jalali_date: '1405/01/10', paid_installments: '4', status: 'open', used_for: 'خرید خودرو پژو ۲۰۷' });
  // check
  act('hpa_save_check', { title: 'چک‌های اقساط طلا', person_key: 'joint', check_count: '4', amount_each: '25,000,000', currency: 'toman', first_due_jalali_date: ym + '20', used_for: 'خرید طلا', status: 'open' });
  // recurring
  act('hpa_save_recurring', { title: 'اجاره خانه', person_key: 'joint', type: 'expense', account_id: '1', category_id: '3', amount: '18,000,000', currency: 'toman', interval_type: 'monthly', start_jalali_date: '1403/01/01', next_jalali_date: ym + '01', status: 'active' });
  act('hpa_save_recurring', { title: 'بیمه تکمیلی', person_key: 'hamidreza', type: 'expense', account_id: '1', category_id: '9', amount: '2,200,000', currency: 'toman', interval_type: 'monthly', start_jalali_date: '1403/01/05', next_jalali_date: ym + '05', status: 'active' });
  // goal + assets
  act('hpa_save_goal', { title: 'پس‌انداز طلا برای جهیزیه', target_amount: '500,000,000', currency: 'toman', target_jalali_date: '1405/06/31', status: 'active' });
  act('hpa_save_asset', { title: 'سکه تمام بهار', person_key: 'hamidreza', asset_group: 'gold', purity: '18 عیار', weight: '65', unit: 'گرم', purchase_price: '210,000,000', currency: 'toman', jalali_date: '1403/02/15', purchase_place: 'بازار طلا', funding_source: 'personal', goal_id: '1', is_active: '1' });
  act('hpa_save_asset', { title: 'بیت‌کوین', person_key: 'samira', asset_group: 'crypto', model_crypto: 'btc', quantity: '0.12', unit: 'BTC', purchase_price: '380,000,000', currency: 'toman', jalali_date: '1403/03/01', funding_source: 'personal', is_active: '1' });
  act('hpa_save_asset', { title: 'گوشی و لپ‌تاپ', person_key: 'joint', asset_group: 'valuable', quantity: '2', unit: 'عدد', purchase_price: '120,000,000', currency: 'toman', jalali_date: '1403/01/20', funding_source: 'personal', is_active: '1' });
  // financing movements — shown in the new "money movements" report, NOT counted as expense
  act('hpa_save_transaction', { person_key: 'hamidreza', type: 'debt_settlement', account_id: '1', debt_id: '1', amount: '4,000,000', currency: 'toman', jalali_date: ym + '18', description: 'بازپرداخت بخشی از قرض آقای رضایی', status: 'done', hpa_items: '[]' });
  act('hpa_save_transaction', { person_key: 'hamidreza', type: 'asset_buy', account_id: '1', asset_id: '1', amount: '30,000,000', currency: 'toman', jalali_date: ym + '16', description: 'خرید سکه', status: 'done', hpa_items: '[]' });
}

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hesabyar-shot-'));
  await D.init(dir, require.resolve('sql.js/dist/sql-wasm.wasm'));
  core.setUploadDir(path.join(dir, 'uploads'));
  seed();
  const server = createServer(path.join(__dirname, '..', 'renderer'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const win = new BrowserWindow({ width: 1440, height: 950, show: false, webPreferences: { contextIsolation: true } });
  const shots = [
    ['dashboard', 'screenshot-dashboard'],
    ['reports', 'screenshot-reports'],
    ['assets', 'screenshot-assets'],
    ['debt', 'screenshot-debt'],
    ['transactions', 'screenshot-transactions']
  ];
  for (const [tab, name] of shots) {
    await win.loadURL('http://127.0.0.1:' + port + '/?hpa_tab=' + tab);
    await new Promise(r => setTimeout(r, 1400));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
    console.log('captured', name);
  }
  // settings/archive: seed a sample archive record, then scroll to the archive card
  act('hpa_save_archive', { group_receivables: '1', archive_title: 'بایگانی نمونه — پایان دوره' });
  await win.loadURL('http://127.0.0.1:' + port + '/?hpa_tab=settings');
  await new Promise(r => setTimeout(r, 1800));
  await win.webContents.executeJavaScript("(function(){var c=document.querySelector('.hpa-archive-card'); if(c){var y=c.getBoundingClientRect().top+window.pageYOffset-24; window.scrollTo(0,Math.max(0,y));}})();");
  await new Promise(r => setTimeout(r, 900));
  const simg = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, 'screenshot-archive.png'), simg.toPNG());
  console.log('captured screenshot-archive');
  server.close();
  app.quit();
}
app.disableHardwareAcceleration();
app.whenReady().then(() => run().catch(e => { console.error('CAPTURE FAIL', e && e.stack ? e.stack : e); app.exit(1); }));

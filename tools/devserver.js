'use strict';
// Standalone dev server (no Electron) for live preview / UI verification.
const path = require('path');
const os = require('os');
const fs = require('fs');
const D = require('../electron/db');
const core = require('../electron/core');
const { createServer, TOKEN } = require('../electron/server');

const PORT = 4599;
function act(a, p) { core.setContext({}, TOKEN); return core.handleAction(a, p || {}, {}); }

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hesabyar-dev-'));
  await D.init(dir, require.resolve('sql.js/dist/sql-wasm.wasm'));
  core.setUploadDir(path.join(dir, 'uploads'));
  const tj = core.U.today_jalali(); const ym = tj.slice(0, 8);
  act('hpa_save_rate', { rate_key: 'usd', price: '58200', jalali_date: tj });
  act('hpa_save_rate', { rate_key: 'gold18', price: '3620000', jalali_date: tj });
  act('hpa_save_account', { name: 'کارت بانک ملت', person_key: 'hamidreza', type: 'bank', currency: 'toman', opening_balance: '48,500,000', icon: '💳', color: '#dbeafe', is_active: '1' });
  act('hpa_save_account', { name: 'کیف پول', person_key: 'joint', type: 'cash', currency: 'toman', opening_balance: '3,200,000', icon: '👛', color: '#fef9c3', is_active: '1' });
  act('hpa_save_account', { name: 'بلو', person_key: 'samira', type: 'bank', currency: 'toman', opening_balance: '493,808', icon: '💳', color: '#e0f2fe', is_active: '1' });
  act('hpa_save_transaction', { person_key: 'hamidreza', type: 'income', account_id: '1', category_id: '19', amount: '92,000,000', currency: 'toman', jalali_date: ym + '03', description: 'حقوق', status: 'done', hpa_items: '[]' });
  for (let i = 0; i < 9; i++) act('hpa_save_transaction', { person_key: 'joint', type: 'expense', account_id: '1', category_id: String(1 + (i % 6)), amount: String(500000 + i * 130000), currency: 'toman', jalali_date: ym + (i < 9 ? '0' + (i + 1) : '10'), transaction_place: 'فروشگاه ' + (i + 1), tags: 'ضروری,خانه', status: 'done', hpa_items: JSON.stringify([{ name: 'شیر', amount: 45000 }, { name: 'نان', amount: 20000 }]) });
  act('hpa_save_debt', { person_name: 'حسن', amount: '20,000,000', paid_amount: '0', currency: 'toman', account_id: '1', jalali_date: ym + '02', due_jalali_date: ym + '25', status: 'open' });
  act('hpa_save_loan', { title: 'وام خودرو', person_key: 'hamidreza', lender: 'صادرات', principal_amount: '300,000,000', currency: 'toman', account_id: '1', received_jalali_date: '1403/01/10', first_due_jalali_date: '1403/02/10', last_due_jalali_date: '1404/01/10', paid_installments: '3', status: 'open' });
  act('hpa_save_asset', { title: 'سکه', person_key: 'hamidreza', asset_group: 'gold', purity: '18', weight: '30', unit: 'گرم', purchase_price: '100,000,000', currency: 'toman', jalali_date: '1403/02/15', funding_source: 'personal', is_active: '1' });

  const server = createServer(path.join(__dirname, '..', 'renderer'));
  server.listen(PORT, '127.0.0.1', () => console.log('HesabYar dev server on http://127.0.0.1:' + PORT + '/?hpa_tab=dashboard'));
})().catch(e => { console.error('DEV FAIL', e && e.stack ? e.stack : e); process.exit(1); });

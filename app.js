const apiBase = '';
const LS = 'acc_'; // prefix for localStorage keys

// ===== גיבוי ללא שרת – שמירה בדפדפן (localStorage) =====
const DEFAULT_ACCOUNTS = [
  { id: 1, name: 'Cash', type: 'asset', code: '1000' },
  { id: 2, name: 'Bank', type: 'asset', code: '1010' },
  { id: 3, name: 'Accounts Receivable', type: 'asset', code: '1100' },
  { id: 4, name: 'Accounts Payable', type: 'liability', code: '2000' },
  { id: 5, name: 'Output VAT', type: 'liability', code: '2110' },
  { id: 6, name: 'Input VAT', type: 'asset', code: '1120' },
  { id: 7, name: 'Owner Equity', type: 'equity', code: '3000' },
  { id: 8, name: 'Sales Income', type: 'income', code: '4000' },
  { id: 9, name: 'Cost of Goods Sold', type: 'expense', code: '5000' },
  { id: 10, name: 'General Expenses', type: 'expense', code: '5100' },
  { id: 11, name: 'Depreciation Expense', type: 'expense', code: '5200' },
  { id: 12, name: 'Fixed Assets', type: 'asset', code: '1200' },
  { id: 13, name: 'Accumulated Depreciation', type: 'asset', code: '1210' }
];

function localGet(key) {
  try {
    const s = localStorage.getItem(LS + key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
function localSet(key, val) {
  try {
    localStorage.setItem(LS + key, JSON.stringify(val));
  } catch (e) {}
}

function getAccounts() {
  let a = localGet('accounts');
  if (!a || !a.length) {
    a = DEFAULT_ACCOUNTS.slice();
    localSet('accounts', a);
  }
  return a;
}

function localGetApi(path) {
  const accounts = getAccounts();
  const contacts = localGet('contacts') || [];
  const transactions = localGet('transactions') || [];
  const invoices = localGet('invoices') || [];
  const items = localGet('invoice_items') || [];
  const byId = (arr, id) => arr.find(x => x.id === id) || {};
  if (path === '/api/accounts') return accounts;
  if (path === '/api/contacts') return contacts;
  if (path === '/api/transactions') {
    return transactions.map(t => ({
      ...t,
      debit_account_name: (byId(accounts, t.debit_account_id)).name || '',
      credit_account_name: (byId(accounts, t.credit_account_id)).name || '',
      contact_name: (byId(contacts, t.contact_id)).name || ''
    }));
  }
  if (path === '/api/invoices') {
    return invoices.map(inv => ({
      ...inv,
      contact_name: (byId(contacts, inv.contact_id)).name || ''
    }));
  }
  if (path === '/api/summary') {
    let income = 0, expenses = 0, ar = 0, ap = 0;
    transactions.forEach(t => {
      const da = byId(accounts, t.debit_account_id);
      const ca = byId(accounts, t.credit_account_id);
      if (da.type === 'income') income -= t.amount; else if (ca.type === 'income') income += t.amount;
      if (da.type === 'expense') expenses += t.amount; else if (ca.type === 'expense') expenses -= t.amount;
      if (da.name === 'Accounts Receivable') ar += t.amount; else if (ca.name === 'Accounts Receivable') ar -= t.amount;
      if (da.name === 'Accounts Payable') ap += t.amount; else if (ca.name === 'Accounts Payable') ap -= t.amount;
    });
    return { income, expenses, profit: income - expenses, accounts_receivable: ar, accounts_payable: ap };
  }
  if (path === '/api/settings') {
    return { vat_rate: localGet('vat_rate') || '17' };
  }
  if (path === '/api/fixed-assets') return localGet('fixed_assets') || [];
  if (path.startsWith('/api/depreciation/schedule')) {
    const fas = localGet('fixed_assets') || [];
    const runs = localGet('depreciation_run') || [];
    const byAsset = {};
    runs.forEach(r => { byAsset[r.fixed_asset_id] = (byAsset[r.fixed_asset_id] || 0) + r.amount; });
    const schedule = fas.map(a => {
      const cost = a.cost;
      const residual = a.residual_value || 0;
      const years = a.useful_life_years || 1;
      const annual = (cost - residual) / years;
      const accumulated = byAsset[a.id] || 0;
      return { id: a.id, name: a.name, purchase_date: a.purchase_date, cost, residual_value: residual, useful_life_years: years, annual_depreciation: annual, accumulated, net_book_value: cost - accumulated, remaining_useful_value: cost - residual - accumulated };
    });
    return { schedule, as_of: new Date().toISOString().slice(0, 10) };
  }
  if (path.startsWith('/api/reports/')) return localGetApiReport(path, accounts, contacts, transactions, invoices);
  return null;
}

function localGetApiReport(path, accounts, contacts, transactions, invoices) {
  const byId = (arr, id) => arr.find(x => x.id === id) || {};
  if (path.includes('vat')) {
    let out = 0, inp = 0;
    transactions.forEach(t => {
      const da = byId(accounts, t.debit_account_id);
      const ca = byId(accounts, t.credit_account_id);
      if (da.name === 'Output VAT') out += t.amount; if (ca.name === 'Output VAT') out -= t.amount;
      if (da.name === 'Input VAT') inp -= t.amount; if (ca.name === 'Input VAT') inp += t.amount;
    });
    return { output_total: out, input_total: inp, balance: out - inp, rows: [] };
  }
  if (path.includes('balance-sheet')) {
    const balance = {};
    accounts.forEach(a => { balance[a.id] = 0; });
    transactions.forEach(t => {
      balance[t.debit_account_id] = (balance[t.debit_account_id] || 0) + t.amount;
      balance[t.credit_account_id] = (balance[t.credit_account_id] || 0) - t.amount;
    });
    const assets = accounts.filter(a => a.type === 'asset').map(a => ({ name: a.name, code: a.code, balance: balance[a.id] || 0 })).filter(x => x.balance);
    const liabilities = accounts.filter(a => a.type === 'liability').map(a => ({ name: a.name, code: a.code, balance: balance[a.id] || 0 })).filter(x => x.balance);
    const equity = accounts.filter(a => a.type === 'equity').map(a => ({ name: a.name, code: a.code, balance: balance[a.id] || 0 })).filter(x => x.balance);
    let profit = 0;
    accounts.filter(a => a.type === 'income' || a.type === 'expense').forEach(a => {
      const b = balance[a.id] || 0;
      if (a.type === 'income') profit += b; else profit -= b;
    });
    equity.push({ name: 'רווח/הפסד מצטבר', code: '', balance: profit });
    return { as_of: new Date().toISOString().slice(0, 10), assets, liabilities, equity, total_assets: assets.reduce((s, x) => s + x.balance, 0), total_liabilities_equity: liabilities.reduce((s, x) => s + x.balance, 0) + equity.reduce((s, x) => s + x.balance, 0) };
  }
  if (path.includes('pl')) {
    const balance = {};
    accounts.forEach(a => { balance[a.id] = 0; });
    transactions.forEach(t => {
      balance[t.debit_account_id] = (balance[t.debit_account_id] || 0) + t.amount;
      balance[t.credit_account_id] = (balance[t.credit_account_id] || 0) - t.amount;
    });
    const income = accounts.filter(a => a.type === 'income').map(a => ({ name: a.name, code: a.code, balance: -(balance[a.id] || 0) })).filter(x => x.balance);
    const expenses = accounts.filter(a => a.type === 'expense').map(a => ({ name: a.name, code: a.code, balance: (balance[a.id] || 0) })).filter(x => x.balance);
    const incomeTotal = income.reduce((s, x) => s + x.balance, 0);
    const expenseTotal = expenses.reduce((s, x) => s + x.balance, 0);
    return { from: '', to: '', income, expenses, income_total: incomeTotal, expense_total: expenseTotal, profit: incomeTotal - expenseTotal };
  }
  if (path.includes('depreciation')) return { schedule: [], as_of: new Date().toISOString().slice(0, 10) };
  return null;
}

function nextId(arr) {
  return (arr.length ? Math.max(...arr.map(x => x.id)) : 0) + 1;
}

function localPostApi(path, body) {
  const accounts = getAccounts();
  let contacts = localGet('contacts') || [];
  let transactions = localGet('transactions') || [];
  let invoices = localGet('invoices') || [];
  let items = localGet('invoice_items') || [];
  if (path === '/api/contacts') {
    const c = { id: nextId(contacts), name: body.name, type: body.type || 'customer', email: body.email || null, phone: body.phone || null, tax_id: body.tax_id || null };
    contacts = [...contacts, c];
    localSet('contacts', contacts);
    return c;
  }
  if (path === '/api/transactions') {
    const t = { id: nextId(transactions), date: body.date, description: body.description || null, debit_account_id: body.debit_account_id, credit_account_id: body.credit_account_id, amount: body.amount, contact_id: body.contact_id || null };
    transactions = [...transactions, t];
    localSet('transactions', transactions);
    return t;
  }
  if (path === '/api/invoices') {
    const vatPct = parseFloat(body.vat_rate) || 0;
    const subtotal = (body.items || []).reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0), 0);
    const vatAmount = Math.round((subtotal * vatPct / 100) * 100) / 100;
    const total = subtotal + vatAmount;
    const invId = nextId(invoices);
    const inv = { id: invId, date: body.date, contact_id: body.contact_id, number: body.number, subtotal, vat_amount: vatAmount, total, status: body.status || 'draft', posted_at: null };
    invoices = [...invoices, inv];
    const newItems = (body.items || []).map((it, i) => ({ id: nextId(items) + i, invoice_id: invId, description: it.description, qty: it.qty, unit_price: it.unit_price }));
    items = [...items, ...newItems];
    localSet('invoices', invoices);
    localSet('invoice_items', items);
    return { invoice: inv, items: newItems };
  }
  const postInvMatch = path.match(/^\/api\/invoices\/(\d+)\/post$/);
  if (postInvMatch) {
    const invId = parseInt(postInvMatch[1], 10);
    const inv = invoices.find(i => i.id === invId);
    if (!inv || inv.posted_at) throw new Error('חשבונית כבר רושמה או לא נמצאה');
    const ar = accounts.find(a => a.name === 'Accounts Receivable');
    const sales = accounts.find(a => a.name === 'Sales Income');
    const outputVat = accounts.find(a => a.name === 'Output VAT');
    const subtotal = inv.subtotal != null ? inv.subtotal : inv.total;
    const vatAmount = inv.vat_amount != null ? inv.vat_amount : 0;
    if (vatAmount > 0 && outputVat) {
      const t1 = { id: nextId(transactions), date: inv.date, description: `חשבונית ${inv.number} מע"מ`, debit_account_id: ar.id, credit_account_id: outputVat.id, amount: vatAmount, contact_id: inv.contact_id };
      transactions = [...transactions, t1];
    }
    const t2 = { id: nextId(transactions), date: inv.date, description: `חשבונית ${inv.number}`, debit_account_id: ar.id, credit_account_id: sales.id, amount: subtotal, contact_id: inv.contact_id };
    transactions = [...transactions, t2];
    inv.posted_at = new Date().toISOString();
    invoices = invoices.map(i => i.id === invId ? { ...i, posted_at: inv.posted_at } : i);
    localSet('transactions', transactions);
    localSet('invoices', invoices);
    return { ok: true, invoice: invoices.find(i => i.id === invId) };
  }
  if (path === '/api/fixed-assets') {
    const fa = { id: nextId(localGet('fixed_assets') || []), name: body.name, purchase_date: body.purchase_date, cost: parseFloat(body.cost), useful_life_years: parseFloat(body.useful_life_years), residual_value: parseFloat(body.residual_value) || 0 };
    let fas = localGet('fixed_assets') || [];
    fas = [...fas, fa];
    localSet('fixed_assets', fas);
    return fa;
  }
  if (path === '/api/depreciation/run') {
    const periodEnd = body.period_end || new Date().toISOString().slice(0, 10);
    const fas = localGet('fixed_assets') || [];
    const depRuns = localGet('depreciation_run') || [];
    const byAsset = {};
    depRuns.forEach(r => { byAsset[r.fixed_asset_id] = (byAsset[r.fixed_asset_id] || 0) + r.amount; });
    const depExp = accounts.find(a => a.name === 'Depreciation Expense');
    const accDep = accounts.find(a => a.name === 'Accumulated Depreciation');
    if (!depExp || !accDep) throw new Error('חסרים חשבונות פחת');
    const created = [];
    fas.forEach(a => {
      const annual = (a.cost - (a.residual_value || 0)) / (a.useful_life_years || 1);
      const amount = Math.round((annual / 12) * 100) / 100;
      const already = byAsset[a.id] || 0;
      if (already >= a.cost - (a.residual_value || 0) || amount <= 0) return;
      const tx = { id: nextId(transactions), date: periodEnd, description: `פחת ${a.name}`, debit_account_id: depExp.id, credit_account_id: accDep.id, amount, contact_id: null };
      transactions = [...transactions, tx];
      const run = { id: nextId(depRuns), fixed_asset_id: a.id, period_end: periodEnd, amount, transaction_id: tx.id };
      depRuns.push(run);
      byAsset[a.id] = (byAsset[a.id] || 0) + amount;
      created.push({ fixed_asset_id: a.id, amount, transaction_id: tx.id });
    });
    localSet('transactions', transactions);
    localSet('depreciation_run', depRuns);
    return { ok: true, created };
  }
  throw new Error('לא נתמך במצב שמירה מקומית');
}

// ===== Utilities =====
async function getErrorMessage(res, fallback) {
  try {
    const data = await res.json();
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

async function apiGet(path) {
  try {
    const res = await fetch(apiBase + path);
    if (!res.ok) throw new Error(await getErrorMessage(res, 'שגיאת שרת'));
    return res.json();
  } catch (e) {
    const data = localGetApi(path);
    if (data !== null) {
      window.usingLocalStorage = true;
      return data;
    }
    throw new Error('לא ניתן להתחבר לשרת. הנתונים נשמרים רק במחשב זה (מצב מקומי).');
  }
}

async function apiPost(path, body) {
  try {
    const res = await fetch(apiBase + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'שגיאת שרת'));
    return res.json();
  } catch (e) {
    window.usingLocalStorage = true;
    return localPostApi(path, body);
  }
}

async function apiPut(path, body) {
  try {
    const res = await fetch(apiBase + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await getErrorMessage(res, 'שגיאת שרת'));
    return res.json();
  } catch (e) {
    if (path === '/api/settings' && body.vat_rate != null) {
      localSet('vat_rate', String(body.vat_rate));
      return { vat_rate: String(body.vat_rate) };
    }
    throw new Error('לא נתמך');
  }
}

function formatCurrency(num) {
  const n = Number(num || 0);
  return n.toLocaleString('he-IL', { style: 'currency', currency: 'ILS' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('he-IL');
}

// ===== Tabs =====
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    tabs.forEach(t => t.classList.toggle('active', t === tab));
    panels.forEach(p =>
      p.classList.toggle('active', p.id === `tab-${target}`)
    );
  });
});

// ===== Dialog handling =====
const dialogBackdrop = document.getElementById('dialogBackdrop');
const dialogTitle = document.getElementById('dialogTitle');
const dialogBody = document.getElementById('dialogBody');
const dialogFooter = document.getElementById('dialogFooter');
const dialogClose = document.getElementById('dialogClose');

function openDialog(title, bodyNode, footerButtons = [], wide) {
  dialogTitle.textContent = title;
  dialogBody.innerHTML = '';
  dialogBody.appendChild(bodyNode);
  dialogFooter.innerHTML = '';
  const d = document.getElementById('dialog');
  if (wide) d.classList.add('wide'); else d.classList.remove('wide');

  footerButtons.forEach(btn => dialogFooter.appendChild(btn));

  dialogBackdrop.classList.remove('hidden');
}

function closeDialog() {
  dialogBackdrop.classList.add('hidden');
  document.getElementById('dialog').classList.remove('wide');
}

dialogClose.addEventListener('click', closeDialog);
dialogBackdrop.addEventListener('click', e => {
  if (e.target === dialogBackdrop) closeDialog();
});

// ===== Summary / Dashboard =====
const summaryCardsEl = document.getElementById('summaryCards');
const dashboardContentEl = document.getElementById('dashboardContent');

async function loadSummary() {
  try {
    const summary = await apiGet('/api/summary');
    summaryCardsEl.innerHTML = '';

    const cards = [
      {
        title: 'הכנסות',
        value: formatCurrency(summary.income),
        sub: 'סה״כ הכנסות לתקופה'
      },
      {
        title: 'הוצאות',
        value: formatCurrency(summary.expenses),
        sub: 'סה״כ הוצאות לתקופה'
      },
      {
        title: 'רווח משוער',
        value: formatCurrency(summary.profit),
        sub: 'הכנסות פחות הוצאות'
      },
      {
        title: 'יתרת לקוחות',
        value: formatCurrency(summary.accounts_receivable),
        sub: 'לקוחות חייבים'
      },
      {
        title: 'יתרת ספקים',
        value: formatCurrency(summary.accounts_payable),
        sub: 'ספקים שחייבים להם'
      }
    ];

    cards.forEach(c => {
      const div = document.createElement('div');
      div.className = 'summary-card';
      div.innerHTML = `
        <h3>${c.title}</h3>
        <div class="value">${c.value}</div>
        <div class="sub">${c.sub}</div>
      `;
      summaryCardsEl.appendChild(div);
    });

    dashboardContentEl.innerHTML = `
      <p>כאן תוכל לראות את תמונת המצב העסקית שלך: הכנסות, הוצאות, לקוחות וספקים.</p>
      <p class="muted">טיפ: התחל ביצירת לקוחות / ספקים, לאחר מכן הפק חשבוניות ורשום תנועות יומן עבור הוצאות והכנסות שאינן חשבוניות.</p>
      ${window.usingLocalStorage ? '<p class="muted" style="margin-top:0.5rem;color:#94a3b8;">הנתונים נשמרים במחשב זה (מצב מקומי – ללא שרת).</p>' : ''}
    `;
  } catch (e) {
    dashboardContentEl.textContent = 'שגיאה בטעינת הנתונים';
  }
}

// ===== Contacts =====
const contactsTableBody = document.querySelector('#contactsTable tbody');
const btnNewContact = document.getElementById('btnNewContact');

async function loadContacts() {
  const contacts = await apiGet('/api/contacts');
  contactsTableBody.innerHTML = '';
  if (!contacts.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="5" class="text-center muted">אין עדיין אנשי קשר. לחץ על "יצירת איש קשר".</td>`;
    contactsTableBody.appendChild(tr);
    return;
  }
  contacts.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.name}</td>
      <td>${c.type === 'customer' ? 'לקוח' : 'ספק'}</td>
      <td>${c.email || ''}</td>
      <td>${c.phone || ''}</td>
      <td>${c.tax_id || ''}</td>
    `;
    contactsTableBody.appendChild(tr);
  });
}

function openNewContactDialog() {
  const form = document.createElement('form');
  form.id = 'dialogFormContact';
  form.innerHTML = `
    <div id="formError" class="error" style="display:none"></div>
    <div class="field">
      <label>שם *</label>
      <input name="name" required />
    </div>
    <div class="field">
      <label>סוג *</label>
      <select name="type" required>
        <option value="customer">לקוח</option>
        <option value="supplier">ספק</option>
      </select>
    </div>
    <div class="field">
      <label>מייל</label>
      <input name="email" type="email" />
    </div>
    <div class="field">
      <label>טלפון</label>
      <input name="phone" />
    </div>
    <div class="field">
      <label>ת.ז / ח.פ</label>
      <input name="tax_id" />
    </div>
  `;

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'ביטול';
  cancelBtn.onclick = closeDialog;

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'primary';
  saveBtn.textContent = 'שמירה';
  saveBtn.setAttribute('form', 'dialogFormContact');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    data.type = data.type || 'customer';
    const errEl = form.querySelector('#formError');
    errEl.style.display = 'none';
    try {
      await apiPost('/api/contacts', data);
      closeDialog();
      await loadContacts();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });

  openDialog('יצירת איש קשר', form, [saveBtn, cancelBtn]);
}

btnNewContact.addEventListener('click', openNewContactDialog);

// ===== Invoices =====
const invoicesTableBody = document.querySelector('#invoicesTable tbody');
const btnNewInvoice = document.getElementById('btnNewInvoice');

async function loadInvoices() {
  const invoices = await apiGet('/api/invoices');
  invoicesTableBody.innerHTML = '';
  if (!invoices.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="8" class="text-center muted">אין עדיין חשבוניות.</td>`;
    invoicesTableBody.appendChild(tr);
    return;
  }

  invoices.forEach(inv => {
    const tr = document.createElement('tr');
    const postBtn = inv.posted_at ? '<span class="chip status-paid">רושם</span>' : `<button type="button" class="btn-small primary btn-post-inv" data-id="${inv.id}">רישום ליומן</button>`;
    tr.innerHTML = `
      <td>${inv.number}</td>
      <td>${formatDate(inv.date)}</td>
      <td>${inv.contact_name}</td>
      <td>${formatCurrency(inv.subtotal != null ? inv.subtotal : inv.total)}</td>
      <td>${formatCurrency(inv.vat_amount != null ? inv.vat_amount : 0)}</td>
      <td>${formatCurrency(inv.total)}</td>
      <td><span class="chip status-${inv.status}">${statusLabel(inv.status)}</span></td>
      <td>${postBtn}</td>
    `;
    invoicesTableBody.appendChild(tr);
  });
  invoicesTableBody.querySelectorAll('.btn-post-inv').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      try {
        await apiPost(`/api/invoices/${id}/post`, {});
        await loadInvoices();
        await loadTransactions();
        await loadSummary();
      } catch (e) {
        alert(e.message || 'שגיאה ברישום ליומן');
      }
    });
  });
}

function statusLabel(status) {
  switch (status) {
    case 'draft':
      return 'טיוטה';
    case 'sent':
      return 'נשלחה';
    case 'paid':
      return 'שולמה';
    case 'cancelled':
      return 'בוטלה';
    default:
      return status;
  }
}

async function openNewInvoiceDialog() {
  const [contacts, accounts] = await Promise.all([
    apiGet('/api/contacts'),
    apiGet('/api/accounts')
  ]);

  if (!contacts.length) {
    alert('יש ליצור לפחות לקוח אחד לפני הפקת חשבונית.');
    return;
  }

  let vatRate = 17;
  try { const s = await apiGet('/api/settings'); vatRate = parseFloat(s.vat_rate) || 17; } catch (_) {}
  const form = document.createElement('form');
  form.id = 'dialogFormInvoice';
  const today = new Date().toISOString().slice(0, 10);

  form.innerHTML = `
    <div id="formError" class="error" style="display:none"></div>
    <div class="field">
      <label>לקוח *</label>
      <select name="contact_id" required>
        ${contacts
          .filter(c => c.type === 'customer')
          .map(c => `<option value="${c.id}">${c.name}</option>`)
          .join('')}
      </select>
    </div>
    <div class="field">
      <label>תאריך *</label>
      <input type="date" name="date" value="${today}" required />
    </div>
    <div class="field">
      <label>מספר חשבונית *</label>
      <input name="number" placeholder="2026-001" required />
    </div>
    <div class="field">
      <label>שיעור מע"מ (%)</label>
      <input type="number" name="vat_rate" step="0.01" min="0" value="${vatRate}" />
    </div>
    <div class="field">
      <label>שורות חשבונית *</label>
      <table class="items-table" id="itemsTable">
        <thead>
          <tr>
            <th>תיאור</th>
            <th>כמות</th>
            <th>מחיר יחידה</th>
            <th>סה״כ</th>
            <th></th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
      <button type="button" class="btn-secondary" id="btnAddItem">הוספת שורה</button>
      <div class="field" style="text-align:left;margin-top:0.5rem" id="invoiceTotalWrap">
        <span id="invoiceTotal">סה"כ: 0 ₪</span>
      </div>
    </div>
    <div class="field">
      <label>סטטוס</label>
      <select name="status">
        <option value="draft">טיוטה</option>
        <option value="sent">נשלחה</option>
        <option value="paid">שולמה</option>
      </select>
    </div>
  `;

  const itemsTbody = form.querySelector('#itemsTable tbody');
  const btnAddItem = form.querySelector('#btnAddItem');
  const totalEl = form.querySelector('#invoiceTotal');

  function recalcTotal() {
    let subtotal = 0;
    const vatRate = parseFloat(form.querySelector('input[name="vat_rate"]').value || '0');
    itemsTbody.querySelectorAll('tr').forEach(tr => {
      const qty = parseFloat(tr.querySelector('input[name="qty"]').value || '0');
      const price = parseFloat(tr.querySelector('input[name="unit_price"]').value || '0');
      const lineTotal = qty * price;
      tr.querySelector('.line-total').textContent = formatCurrency(lineTotal);
      subtotal += lineTotal;
    });
    const vatAmount = Math.round((subtotal * vatRate / 100) * 100) / 100;
    const total = subtotal + vatAmount;
    totalEl.innerHTML = `סה"כ לפני מע"מ: <strong>${formatCurrency(subtotal)}</strong> | מע"מ: <strong>${formatCurrency(vatAmount)}</strong> | סה"כ: <strong id="invoiceTotalSum">${formatCurrency(total)}</strong>`;
  }

  function addItemRow() {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input name="description" placeholder="פריט / שירות" required /></td>
      <td><input name="qty" type="number" step="0.01" value="1" required /></td>
      <td><input name="unit_price" type="number" step="0.01" value="0" required /></td>
      <td class="line-total text-right">${formatCurrency(0)}</td>
      <td class="text-center"><button type="button" class="icon-btn btnRemoveItem">✕</button></td>
    `;
    itemsTbody.appendChild(tr);

    tr.querySelectorAll('input[name="qty"], input[name="unit_price"]').forEach(input => {
      input.addEventListener('input', recalcTotal);
    });
    tr.querySelector('.btnRemoveItem').addEventListener('click', () => {
      tr.remove();
      recalcTotal();
    });
  }

  btnAddItem.addEventListener('click', () => {
    addItemRow();
    recalcTotal();
  });

  // Start with one row
  addItemRow();
  const vatInput = form.querySelector('input[name="vat_rate"]');
  if (vatInput) vatInput.addEventListener('input', recalcTotal);
  recalcTotal();

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'ביטול';
  cancelBtn.onclick = closeDialog;

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'primary';
  saveBtn.textContent = 'שמירה';
  saveBtn.setAttribute('form', 'dialogFormInvoice');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = form.querySelector('#formError');
    errEl.style.display = 'none';

    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    data.contact_id = Number(data.contact_id);
    data.status = data.status || 'draft';
    data.vat_rate = parseFloat(data.vat_rate) || 0;

    const items = [];
    itemsTbody.querySelectorAll('tr').forEach(tr => {
      const description = tr.querySelector('input[name="description"]').value;
      const qty = parseFloat(tr.querySelector('input[name="qty"]').value || '0');
      const unit_price = parseFloat(tr.querySelector('input[name="unit_price"]').value || '0');
      if (description && qty > 0 && unit_price >= 0) {
        items.push({ description, qty, unit_price });
      }
    });

    if (!items.length) {
      errEl.textContent = 'יש להוסיף לפחות שורת פריט אחת.';
      errEl.style.display = 'block';
      return;
    }

    try {
      await apiPost('/api/invoices', { ...data, items });
      closeDialog();
      await loadInvoices();
      await loadSummary();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });

  openDialog('הפקת חשבונית', form, [saveBtn, cancelBtn]);
}

btnNewInvoice.addEventListener('click', openNewInvoiceDialog);

// ===== Transactions =====
const transactionsTableBody = document.querySelector('#transactionsTable tbody');
const btnNewTransaction = document.getElementById('btnNewTransaction');

async function loadTransactions() {
  const txs = await apiGet('/api/transactions');
  transactionsTableBody.innerHTML = '';
  if (!txs.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="6" class="text-center muted">אין עדיין תנועות יומן.</td>`;
    transactionsTableBody.appendChild(tr);
    return;
  }

  txs.forEach(tx => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(tx.date)}</td>
      <td>${tx.description || ''}</td>
      <td>${tx.debit_account_name}</td>
      <td>${tx.credit_account_name}</td>
      <td>${formatCurrency(tx.amount)}</td>
      <td>${tx.contact_name || ''}</td>
    `;
    transactionsTableBody.appendChild(tr);
  });
}

async function openNewTransactionDialog() {
  const [accounts, contacts] = await Promise.all([
    apiGet('/api/accounts'),
    apiGet('/api/contacts')
  ]);

  const form = document.createElement('form');
  form.id = 'dialogFormTransaction';
  const today = new Date().toISOString().slice(0, 10);

  const accountOptions = accounts
    .map(a => `<option value="${a.id}">${a.code || ''} ${a.name}</option>`)
    .join('');

  const contactOptions =
    '<option value="">ללא</option>' +
    contacts.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  form.innerHTML = `
    <div id="formError" class="error" style="display:none"></div>
    <div class="field">
      <label>תאריך *</label>
      <input type="date" name="date" value="${today}" required />
    </div>
    <div class="field">
      <label>תיאור</label>
      <input name="description" />
    </div>
    <div class="field">
      <label>חשבון חובה *</label>
      <select name="debit_account_id" required>
        ${accountOptions}
      </select>
    </div>
    <div class="field">
      <label>חשבון זכות *</label>
      <select name="credit_account_id" required>
        ${accountOptions}
      </select>
    </div>
    <div class="field">
      <label>סכום *</label>
      <input name="amount" type="number" step="0.01" required />
    </div>
    <div class="field">
      <label>איש קשר</label>
      <select name="contact_id">
        ${contactOptions}
      </select>
    </div>
  `;

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'ביטול';
  cancelBtn.onclick = closeDialog;

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'primary';
  saveBtn.textContent = 'שמירה';
  saveBtn.setAttribute('form', 'dialogFormTransaction');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = form.querySelector('#formError');
    errEl.style.display = 'none';

    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    data.debit_account_id = Number(data.debit_account_id);
    data.credit_account_id = Number(data.credit_account_id);
    data.amount = parseFloat(data.amount || '0');
    if (data.contact_id) data.contact_id = Number(data.contact_id);
    else delete data.contact_id;

    if (!data.amount || data.amount <= 0) {
      errEl.textContent = 'הזן סכום גדול מאפס.';
      errEl.style.display = 'block';
      return;
    }

    try {
      await apiPost('/api/transactions', data);
      closeDialog();
      await loadTransactions();
      await loadSummary();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });

  openDialog('רישום תנועת יומן', form, [saveBtn, cancelBtn]);
}

btnNewTransaction.addEventListener('click', openNewTransactionDialog);

// ===== Fixed Assets =====
const fixedAssetsTableBody = document.querySelector('#fixedAssetsTable tbody');
const btnNewFixedAsset = document.getElementById('btnNewFixedAsset');
const depreciationScheduleEl = document.getElementById('depreciationSchedule');
const btnRunDepreciation = document.getElementById('btnRunDepreciation');

async function loadFixedAssets() {
  const list = await apiGet('/api/fixed-assets');
  fixedAssetsTableBody.innerHTML = '';
  if (!list.length) {
    fixedAssetsTableBody.innerHTML = '<tr><td colspan="6" class="text-center muted">אין נכסים. הוסף נכס להמשך חישוב פחת.</td></tr>';
    return;
  }
  list.forEach(a => {
    const annual = (a.cost - (a.residual_value || 0)) / (a.useful_life_years || 1);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${a.name}</td>
      <td>${formatDate(a.purchase_date)}</td>
      <td>${formatCurrency(a.cost)}</td>
      <td>${a.useful_life_years}</td>
      <td>${formatCurrency(a.residual_value || 0)}</td>
      <td>${formatCurrency(annual)}</td>
    `;
    fixedAssetsTableBody.appendChild(tr);
  });
}

async function loadDepreciationSchedule() {
  const asOf = document.getElementById('reportDateDep') ? document.getElementById('reportDateDep').value : new Date().toISOString().slice(0, 10);
  try {
    const data = await apiGet('/api/depreciation/schedule?as_of=' + encodeURIComponent(asOf));
    if (!data.schedule || !data.schedule.length) {
      depreciationScheduleEl.innerHTML = '<p class="muted">אין נכסים או טרם חושב פחת.</p>';
      return;
    }
    let html = '<table class="report-table"><thead><tr><th>נכס</th><th>תאריך רכישה</th><th>עלות</th><th>פחת צבור</th><th>ערך בספרים</th></tr></thead><tbody>';
    data.schedule.forEach(s => {
      html += `<tr><td>${s.name}</td><td>${formatDate(s.purchase_date)}</td><td>${formatCurrency(s.cost)}</td><td>${formatCurrency(s.accumulated)}</td><td>${formatCurrency(s.net_book_value)}</td></tr>`;
    });
    html += '</tbody></table>';
    depreciationScheduleEl.innerHTML = html;
  } catch (e) {
    depreciationScheduleEl.innerHTML = '<p class="muted">לא ניתן לטעון לוח פחת.</p>';
  }
}

async function openNewFixedAssetDialog() {
  const form = document.createElement('form');
  form.id = 'dialogFormFixedAsset';
  const today = new Date().toISOString().slice(0, 10);
  form.innerHTML = `
    <div id="formError" class="error" style="display:none"></div>
    <div class="field">
      <label>שם הנכס *</label>
      <input name="name" required placeholder="מחשב, רכב, ציוד" />
    </div>
    <div class="field">
      <label>תאריך רכישה *</label>
      <input type="date" name="purchase_date" value="${today}" required />
    </div>
    <div class="field">
      <label>עלות רכישה (₪) *</label>
      <input type="number" name="cost" step="0.01" required />
    </div>
    <div class="field">
      <label>תקופה שימוש (שנים) *</label>
      <input type="number" name="useful_life_years" step="0.1" min="0.1" value="5" required />
    </div>
    <div class="field">
      <label>ערך שייר (₪)</label>
      <input type="number" name="residual_value" step="0.01" value="0" />
    </div>
  `;
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'ביטול';
  cancelBtn.onclick = closeDialog;
  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'primary';
  saveBtn.textContent = 'שמירה';
  saveBtn.setAttribute('form', 'dialogFormFixedAsset');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = form.querySelector('#formError');
    errEl.style.display = 'none';
    const data = Object.fromEntries(new FormData(form).entries());
    data.cost = parseFloat(data.cost);
    data.useful_life_years = parseFloat(data.useful_life_years);
    data.residual_value = parseFloat(data.residual_value) || 0;
    try {
      await apiPost('/api/fixed-assets', data);
      closeDialog();
      await loadFixedAssets();
      await loadDepreciationSchedule();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });
  openDialog('הוספת נכס קבוע', form, [saveBtn, cancelBtn], true);
}

btnNewFixedAsset.addEventListener('click', openNewFixedAssetDialog);
if (btnRunDepreciation) {
  btnRunDepreciation.addEventListener('click', async () => {
    const periodEnd = prompt('תאריך סוף תקופה (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
    if (!periodEnd) return;
    try {
      await apiPost('/api/depreciation/run', { period_end: periodEnd });
      await loadDepreciationSchedule();
      await loadTransactions();
      await loadSummary();
      alert('פחת בוצע בהצלחה.');
    } catch (e) {
      alert(e.message || 'שגיאה בביצוע פחת');
    }
  });
}

// ===== Reports =====
const reportTabs = document.querySelectorAll('.report-tab');
const reportFiltersEl = document.getElementById('reportFilters');
const reportContentEl = document.getElementById('reportContent');
let currentReport = 'vat';

function reportFiltersHTML() {
  const from = new Date();
  from.setMonth(from.getMonth() - 1);
  const defaultFrom = from.toISOString().slice(0, 10);
  const defaultTo = new Date().toISOString().slice(0, 10);
  if (currentReport === 'balance' || currentReport === 'depreciation') {
    return `
      <label>תאריך:</label>
      <input type="date" id="reportDate" value="${defaultTo}" />
      <button type="button" class="primary" id="btnLoadReport">הצג דוח</button>
    `;
  }
  return `
    <label>מתאריך:</label>
    <input type="date" id="reportFrom" value="${defaultFrom}" />
    <label>עד תאריך:</label>
    <input type="date" id="reportTo" value="${defaultTo}" />
    <button type="button" class="primary" id="btnLoadReport">הצג דוח</button>
  `;
}

async function loadReport() {
  if (!reportContentEl) return;
  const from = document.getElementById('reportFrom') ? document.getElementById('reportFrom').value : '';
  const to = document.getElementById('reportTo') ? document.getElementById('reportTo').value : '';
  const date = document.getElementById('reportDate') ? document.getElementById('reportDate').value : new Date().toISOString().slice(0, 10);
  try {
    if (currentReport === 'vat') {
      const data = await apiGet('/api/reports/vat?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));
      reportContentEl.innerHTML = `
        <h3>דוח מע"מ (מעמ)</h3>
        <p>תקופה: ${data.from || '-'} עד ${data.to || '-'}</p>
        <table class="report-table">
          <tr><th>מע"מ תשומה (חייב)</th><td>${formatCurrency(data.output_total)}</td></tr>
          <tr><th>מע"מ עוגן (זכות)</th><td>${formatCurrency(data.input_total)}</td></tr>
          <tr><th>יתרה לתשלום/החזר</th><td><strong>${formatCurrency(data.balance)}</strong></td></tr>
        </table>
      `;
    } else if (currentReport === 'balance') {
      const data = await apiGet('/api/reports/balance-sheet?date=' + encodeURIComponent(date));
      let html = '<h3>מאזן ליום ' + formatDate(data.as_of) + '</h3><table class="report-table"><thead><tr><th>נכסים</th><th>יתרה</th></tr></thead><tbody>';
      (data.assets || []).forEach(r => { html += '<tr><td>' + r.name + '</td><td>' + formatCurrency(r.balance) + '</td></tr>'; });
      html += '<tr><td><strong>סה"כ נכסים</strong></td><td><strong>' + formatCurrency(data.total_assets) + '</strong></td></tr></tbody></table>';
      html += '<table class="report-table" style="margin-top:1rem"><thead><tr><th>התחייבויות והון</th><th>יתרה</th></tr></thead><tbody>';
      (data.liabilities || []).forEach(r => { html += '<tr><td>' + r.name + '</td><td>' + formatCurrency(r.balance) + '</td></tr>'; });
      (data.equity || []).forEach(r => { html += '<tr><td>' + r.name + '</td><td>' + formatCurrency(r.balance) + '</td></tr>'; });
      html += '<tr><td><strong>סה"כ</strong></td><td><strong>' + formatCurrency(data.total_liabilities_equity) + '</strong></td></tr></tbody></table>';
      reportContentEl.innerHTML = html;
    } else if (currentReport === 'pl') {
      const data = await apiGet('/api/reports/pl?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));
      let html = '<h3>דוח רווח והפסד</h3><p>תקופה: ' + (data.from || '-') + ' עד ' + (data.to || '-') + '</p>';
      html += '<table class="report-table"><thead><tr><th>הכנסות</th><th>יתרה</th></tr></thead><tbody>';
      (data.income || []).forEach(r => { html += '<tr><td>' + r.name + '</td><td>' + formatCurrency(r.balance) + '</td></tr>'; });
      html += '<tr><td><strong>סה"כ הכנסות</strong></td><td><strong>' + formatCurrency(data.income_total) + '</strong></td></tr></tbody></table>';
      html += '<table class="report-table" style="margin-top:1rem"><thead><tr><th>הוצאות</th><th>יתרה</th></tr></thead><tbody>';
      (data.expenses || []).forEach(r => { html += '<tr><td>' + r.name + '</td><td>' + formatCurrency(r.balance) + '</td></tr>'; });
      html += '<tr><td><strong>סה"כ הוצאות</strong></td><td><strong>' + formatCurrency(data.expense_total) + '</strong></td></tr></tbody></table>';
      html += '<p class="report-summary">רווח: ' + formatCurrency(data.profit) + '</p>';
      reportContentEl.innerHTML = html;
    } else if (currentReport === 'depreciation') {
      const data = await apiGet('/api/depreciation/schedule?as_of=' + encodeURIComponent(date));
      if (!data.schedule || !data.schedule.length) {
        reportContentEl.innerHTML = '<p class="muted">אין נכסים או לוח פחת.</p>';
        return;
      }
      let html = '<h3>לוח פחת</h3><table class="report-table"><thead><tr><th>נכס</th><th>עלות</th><th>פחת שנתי</th><th>פחת צבור</th><th>ערך בספרים</th></tr></thead><tbody>';
      data.schedule.forEach(s => {
        html += '<tr><td>' + s.name + '</td><td>' + formatCurrency(s.cost) + '</td><td>' + formatCurrency(s.annual_depreciation) + '</td><td>' + formatCurrency(s.accumulated) + '</td><td>' + formatCurrency(s.net_book_value) + '</td></tr>';
      });
      html += '</tbody></table>';
      reportContentEl.innerHTML = html;
    }
  } catch (e) {
    reportContentEl.innerHTML = '<p class="error">שגיאה בטעינת הדוח: ' + (e.message || '') + '</p>';
  }
}

if (reportTabs.length) {
  reportTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      reportTabs.forEach(t => t.classList.toggle('active', t === tab));
      currentReport = tab.dataset.report;
      reportFiltersEl.innerHTML = reportFiltersHTML();
      reportFiltersEl.querySelector('#btnLoadReport').addEventListener('click', loadReport);
      if (currentReport === 'depreciation') {
        const dateInput = document.getElementById('reportDate');
        if (dateInput) dateInput.id = 'reportDateDep';
      }
      loadReport();
    });
  });
  reportFiltersEl.innerHTML = reportFiltersHTML();
  reportFiltersEl.querySelector('#btnLoadReport').addEventListener('click', loadReport);
  loadReport();
}

// ===== Settings =====
const settingsForm = document.getElementById('settingsForm');
if (settingsForm) {
  (async () => {
    try {
      const s = await apiGet('/api/settings');
      const vatInput = settingsForm.querySelector('input[name="vat_rate"]');
      if (vatInput) vatInput.value = s.vat_rate || 17;
    } catch (_) {}
  })();
  settingsForm.addEventListener('submit', async e => {
    e.preventDefault();
    const vat = settingsForm.querySelector('input[name="vat_rate"]').value;
    try {
      await apiPut('/api/settings', { vat_rate: parseFloat(vat) || 17 });
      alert('הגדרות נשמרו.');
    } catch (err) {
      alert(err.message || 'שגיאה בשמירה');
    }
  });
}

// ===== Init =====
(async function init() {
  await loadSummary();
  await loadContacts();
  await loadInvoices();
  await loadTransactions();
  if (document.querySelector('#fixedAssetsTable')) await loadFixedAssets();
  const depDateEl = document.getElementById('reportDateDep');
if (depDateEl) depDateEl.value = new Date().toISOString().slice(0, 10);
const btnRefreshDep = document.getElementById('btnRefreshDepSchedule');
if (btnRefreshDep) btnRefreshDep.addEventListener('click', loadDepreciationSchedule);
if (document.getElementById('depreciationSchedule')) await loadDepreciationSchedule();
})();


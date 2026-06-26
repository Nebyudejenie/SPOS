import { useEffect, useState } from 'react';

const EMPTY = {
  merchant_code: '',
  merchant_name: '',
  business_type: '',
  owner_name: '',
  phone_number: '',
  address: '',
  region: '',
  sales_officer: '',
  activation_officer: '',
  account_manager: '',
  assigned_pos: '',
  bank: '',
  settlement_account: '',
  qr_status: 'inactive',
  pos_status: 'inactive',
  activation_date: '',
  last_transaction_date: '',
  monthly_volume: '',
  support_history: '',
  current_status: 'active',
  notes: '',
};

const FIELDS = [
  ['merchant_code', 'Merchant ID *', 'text'],
  ['merchant_name', 'Merchant Name *', 'text'],
  ['business_type', 'Business Type', 'text'],
  ['owner_name', 'Owner Name', 'text'],
  ['phone_number', 'Phone Number', 'text'],
  ['region', 'Region', 'text'],
  ['bank', 'Bank', 'text'],
  ['settlement_account', 'Settlement Account', 'text'],
  ['assigned_pos', 'Assigned POS', 'text'],
  ['sales_officer', 'Sales Officer', 'text'],
  ['activation_officer', 'Activation Officer', 'text'],
  ['account_manager', 'Account Manager', 'text'],
  ['activation_date', 'Activation Date', 'date'],
  ['last_transaction_date', 'Last Transaction Date', 'date'],
  ['monthly_volume', 'Monthly Volume', 'number'],
];

// Normalize a record from the API into form-friendly strings.
function toFormState(record) {
  if (!record) return { ...EMPTY };
  const next = { ...EMPTY };
  for (const key of Object.keys(EMPTY)) {
    const val = record[key];
    if (val === null || val === undefined) continue;
    if (key.endsWith('_date') && typeof val === 'string') next[key] = val.slice(0, 10);
    else next[key] = String(val);
  }
  return next;
}

export default function MerchantForm({ editing, onSubmit, onCancel, busy }) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    setForm(toFormState(editing));
  }, [editing]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    // Strip empty strings so the API treats them as "unset".
    const payload = {};
    for (const [k, v] of Object.entries(form)) {
      if (v !== '') payload[k] = k === 'monthly_volume' ? Number(v) : v;
    }
    onSubmit(payload);
  };

  return (
    <form className="form" onSubmit={handleSubmit}>
      <h2>{editing ? 'Edit Merchant' : 'New Merchant'}</h2>
      <div className="form__grid">
        {FIELDS.map(([key, label, type]) => (
          <label key={key} className="field">
            <span>{label}</span>
            <input type={type} value={form[key]} onChange={set(key)}
              step={type === 'number' ? '0.01' : undefined} />
          </label>
        ))}

        <label className="field">
          <span>QR Status</span>
          <select value={form.qr_status} onChange={set('qr_status')}>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </label>
        <label className="field">
          <span>POS Status</span>
          <select value={form.pos_status} onChange={set('pos_status')}>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </label>
        <label className="field">
          <span>Current Status</span>
          <select value={form.current_status} onChange={set('current_status')}>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
            <option value="suspended">suspended</option>
          </select>
        </label>

        <label className="field field--wide">
          <span>Address</span>
          <input type="text" value={form.address} onChange={set('address')} />
        </label>
        <label className="field field--wide">
          <span>Support History</span>
          <textarea rows={2} value={form.support_history} onChange={set('support_history')} />
        </label>
        <label className="field field--wide">
          <span>Notes</span>
          <textarea rows={2} value={form.notes} onChange={set('notes')} />
        </label>
      </div>

      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {editing ? 'Save Changes' : 'Create Merchant'}
        </button>
        {editing && (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

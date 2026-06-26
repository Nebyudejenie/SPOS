import { useEffect, useState } from 'react';

const EMPTY = {
  terminal_id: '',
  serial_number: '',
  model: '',
  merchant_id: '',
  merchant_name: '',
  bank: '',
  sim_number: '',
  activation_date: '',
  last_communication: '',
  status: 'inactive',
  transaction_volume: '',
  error_history: '',
  replacement_history: '',
  current_owner: '',
};

const FIELDS = [
  ['terminal_id', 'Terminal ID *', 'text'],
  ['serial_number', 'Serial Number', 'text'],
  ['model', 'Model', 'text'],
  ['bank', 'Bank', 'text'],
  ['sim_number', 'SIM Number', 'text'],
  ['current_owner', 'Current Owner', 'text'],
  ['activation_date', 'Activation Date', 'date'],
  ['transaction_volume', 'Transaction Volume', 'number'],
];

function toFormState(record) {
  if (!record) return { ...EMPTY };
  const next = { ...EMPTY };
  for (const key of Object.keys(EMPTY)) {
    const val = record[key];
    if (val === null || val === undefined) continue;
    if (key === 'activation_date' && typeof val === 'string') next[key] = val.slice(0, 10);
    else if (key === 'last_communication' && typeof val === 'string') next[key] = val.slice(0, 16);
    else next[key] = String(val);
  }
  return next;
}

export default function PosForm({ editing, merchants, onSubmit, onCancel, busy }) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    setForm(toFormState(editing));
  }, [editing]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Selecting a merchant also snapshots its name onto the device.
  const onMerchantChange = (e) => {
    const id = e.target.value;
    const match = merchants.find((m) => m.id === id);
    setForm((f) => ({ ...f, merchant_id: id, merchant_name: match ? match.merchant_name : f.merchant_name }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {};
    for (const [k, v] of Object.entries(form)) {
      if (v !== '') payload[k] = k === 'transaction_volume' ? Number(v) : v;
    }
    onSubmit(payload);
  };

  return (
    <form className="form" onSubmit={handleSubmit}>
      <h2>{editing ? 'Edit POS Device' : 'New POS Device'}</h2>
      <div className="form__grid">
        {FIELDS.map(([key, label, type]) => (
          <label key={key} className="field">
            <span>{label}</span>
            <input type={type} value={form[key]} onChange={set(key)}
              step={type === 'number' ? '0.01' : undefined} />
          </label>
        ))}

        <label className="field">
          <span>Status</span>
          <select value={form.status} onChange={set('status')}>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
            <option value="faulty">faulty</option>
          </select>
        </label>

        <label className="field">
          <span>Merchant</span>
          <select value={form.merchant_id} onChange={onMerchantChange}>
            <option value="">— Unassigned —</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>{m.merchant_code} — {m.merchant_name}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Last Communication</span>
          <input type="datetime-local" value={form.last_communication} onChange={set('last_communication')} />
        </label>

        <label className="field field--wide">
          <span>Error History</span>
          <textarea rows={2} value={form.error_history} onChange={set('error_history')} />
        </label>
        <label className="field field--wide">
          <span>Replacement History</span>
          <textarea rows={2} value={form.replacement_history} onChange={set('replacement_history')} />
        </label>
      </div>

      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {editing ? 'Save Changes' : 'Create Device'}
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

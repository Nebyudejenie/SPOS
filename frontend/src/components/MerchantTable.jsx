function statusBadge(status) {
  const cls =
    status === 'active' ? 'badge badge--green'
    : status === 'suspended' ? 'badge badge--red'
    : 'badge badge--gray';
  return <span className={cls}>{status}</span>;
}

export default function MerchantTable({ rows, loading, onEdit, onDelete }) {
  if (loading) return <p className="muted">Loading merchants…</p>;
  if (!rows.length) return <p className="muted">No merchants yet. Create one above.</p>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Merchant ID</th>
            <th>Name</th>
            <th>Type</th>
            <th>Region</th>
            <th>Bank</th>
            <th>Assigned POS</th>
            <th>Status</th>
            <th className="table__actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td className="mono">{m.merchant_code}</td>
              <td>{m.merchant_name}</td>
              <td>{m.business_type || '—'}</td>
              <td>{m.region || '—'}</td>
              <td>{m.bank || '—'}</td>
              <td className="mono">{m.assigned_pos || '—'}</td>
              <td>{statusBadge(m.current_status)}</td>
              <td className="table__actions">
                <button className="btn btn--sm" onClick={() => onEdit(m)}>Edit</button>
                <button className="btn btn--sm btn--danger" onClick={() => onDelete(m)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

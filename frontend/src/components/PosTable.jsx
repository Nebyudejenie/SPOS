function statusBadge(status) {
  const cls =
    status === 'active' ? 'badge badge--green'
    : status === 'faulty' ? 'badge badge--red'
    : 'badge badge--gray';
  return <span className={cls}>{status}</span>;
}

function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export default function PosTable({ rows, loading, onEdit, onDelete }) {
  if (loading) return <p className="muted">Loading POS devices…</p>;
  if (!rows.length) return <p className="muted">No POS devices yet. Create one above.</p>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Terminal ID</th>
            <th>Model</th>
            <th>Merchant</th>
            <th>Bank</th>
            <th>Last Comm.</th>
            <th>Status</th>
            <th className="table__actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td className="mono">{d.terminal_id}</td>
              <td>{d.model || '—'}</td>
              <td>{d.merchant_name || '—'}</td>
              <td>{d.bank || '—'}</td>
              <td>{fmt(d.last_communication)}</td>
              <td>{statusBadge(d.status)}</td>
              <td className="table__actions">
                <button className="btn btn--sm" onClick={() => onEdit(d)}>Edit</button>
                <button className="btn btn--sm btn--danger" onClick={() => onDelete(d)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

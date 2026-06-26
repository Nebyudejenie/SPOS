import { useCallback, useEffect, useState } from 'react';
import { whApi } from '../api/client.js';

const PAGE = 25;
const HEALTH = ['', 'Green', 'Yellow', 'Warning', 'Red', 'Critical'];

function badge(b) {
  const cls = b === 'Green' ? 'green'
    : b === 'Red' || b === 'Critical' ? 'red'
    : b ? 'gray' : 'gray';
  return <span className={`badge badge--${cls}`}>{b || '—'}</span>;
}

export default function DevicesExplorer({ onOpenDevice, notify }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [health, setHealth] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (q, h, off) => {
    setLoading(true);
    try {
      const res = await whApi.devices({
        search: q || undefined, health: h || undefined, limit: PAGE, offset: off });
      setRows(res.data); setTotal(res.total);
    } catch (e) { notify('error', e.message); } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => {
    const t = setTimeout(() => { setOffset(0); load(search, health, 0); }, 300);
    return () => clearTimeout(t);
  }, [search, health, load]);

  const go = (off) => { setOffset(off); load(search, health, off); };
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE, total);

  return (
    <section className="panel">
      <div className="panel__bar">
        <h2>POS Devices <span className="muted">({total.toLocaleString()})</span></h2>
        <div className="filters">
          <select className="search" value={health} onChange={(e) => setHealth(e.target.value)}>
            {HEALTH.map((h) => <option key={h} value={h}>{h || 'All health'}</option>)}
          </select>
          <input className="search" placeholder="Search serial, terminal, merchant, model…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? <p className="muted">Loading…</p> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Serial</th><th>Terminal</th><th>Model</th><th>Merchant</th>
                    <th>Status</th><th>Health</th><th>Last Seen</th></tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="clickable" onClick={() => onOpenDevice(d.id)}>
                    <td className="mono">{d.serial_number || '—'}</td>
                    <td className="mono">{d.terminal_id || '—'}</td>
                    <td>{d.model || '—'}</td>
                    <td>{d.merchant_name || '—'}</td>
                    <td>{d.current_status || '—'}</td>
                    <td>{badge(d.health_bucket)}</td>
                    <td>{d.last_seen_at ? new Date(d.last_seen_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button className="btn btn--sm" disabled={offset === 0}
              onClick={() => go(Math.max(0, offset - PAGE))}>← Prev</button>
            <span className="muted">{from}–{to} of {total.toLocaleString()}</span>
            <button className="btn btn--sm" disabled={to >= total}
              onClick={() => go(offset + PAGE)}>Next →</button>
          </div>
        </>
      )}
    </section>
  );
}

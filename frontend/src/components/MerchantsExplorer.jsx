import { useCallback, useEffect, useState } from 'react';
import { whApi } from '../api/client.js';

const PAGE = 25;

export default function MerchantsExplorer({ onOpenMerchant, notify }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (q, off) => {
    setLoading(true);
    try {
      const res = await whApi.merchants({ search: q || undefined, limit: PAGE, offset: off });
      setRows(res.data); setTotal(res.total);
    } catch (e) { notify('error', e.message); } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => {
    const t = setTimeout(() => { setOffset(0); load(search, 0); }, 300);
    return () => clearTimeout(t);
  }, [search, load]);

  const go = (off) => { setOffset(off); load(search, off); };

  return (
    <section className="panel">
      <div className="panel__bar">
        <h2>Merchants <span className="muted">({total.toLocaleString()})</span></h2>
        <input className="search" placeholder="Search name, code, QR, phone…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? <p className="muted">Loading…</p> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Code</th><th>Name</th><th>Bank</th><th>Region</th>
                    <th>Status</th><th className="num">Devices</th><th className="num">Txn Amount</th></tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="clickable" onClick={() => onOpenMerchant(m.id)}>
                    <td className="mono">{m.merchant_code || '—'}</td>
                    <td>{m.trading_name || '—'}</td>
                    <td>{m.bank_name || '—'}</td>
                    <td>{m.region || '—'}</td>
                    <td>{m.current_status || '—'}</td>
                    <td className="num">{m.device_count}</td>
                    <td className="num">{Number(m.total_txn_amount || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager total={total} offset={offset} onGo={go} />
        </>
      )}
    </section>
  );
}

function Pager({ total, offset, onGo }) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE, total);
  return (
    <div className="pager">
      <button className="btn btn--sm" disabled={offset === 0} onClick={() => onGo(Math.max(0, offset - PAGE))}>← Prev</button>
      <span className="muted">{from}–{to} of {total.toLocaleString()}</span>
      <button className="btn btn--sm" disabled={to >= total} onClick={() => onGo(offset + PAGE)}>Next →</button>
    </div>
  );
}

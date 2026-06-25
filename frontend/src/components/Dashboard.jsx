import { useEffect, useState } from 'react';
import { whApi } from '../api/client.js';

const HEALTH_COLORS = {
  Green: '#16a34a', Yellow: '#d97706', Warning: '#d97706',
  Red: '#dc2626', Critical: '#b91c1c',
};

function fmtNum(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

function Bars({ rows, color }) {
  const max = Math.max(...rows.map((r) => Number(r.value) || 0), 1);
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.label} className="bars__row">
          <span className="bars__label" title={r.label}>{r.label}</span>
          <span className="bars__track">
            <span className="bars__fill"
              style={{ width: `${(Number(r.value) / max) * 100}%`,
                       background: color || (HEALTH_COLORS[r.label] || '#2563eb') }} />
          </span>
          <span className="bars__value">{fmtNum(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({ onOpenMerchant, notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    whApi.summary()
      .then(setData)
      .catch((e) => notify('error', e.message))
      .finally(() => setLoading(false));
  }, [notify]);

  if (loading) return <p className="muted">Loading dashboard…</p>;
  if (!data) return <p className="muted">No data.</p>;

  const c = data.counts;
  const kpis = [
    ['Merchants', c.merchants], ['POS Devices', c.devices],
    ['Transactions', c.transactions], ['Txn Summaries', c.txn_summaries],
    ['SIM Cards', c.sims], ['Banks', c.banks],
    ['Total Txn (Birr)', fmtNum(c.total_txn_amount)],
  ];

  return (
    <div className="dash">
      <div className="kpis">
        {kpis.map(([label, value]) => (
          <div className="kpi" key={label}>
            <div className="kpi__value">{typeof value === 'string' ? value : fmtNum(value)}</div>
            <div className="kpi__label">{label}</div>
          </div>
        ))}
      </div>

      <div className="dash__grid">
        <section className="panel">
          <h2>POS Health</h2>
          <Bars rows={data.health} />
        </section>
        <section className="panel">
          <h2>Merchants by Bank</h2>
          <Bars rows={data.banks} color="#2563eb" />
        </section>
        <section className="panel">
          <h2>Merchants by Region</h2>
          <Bars rows={data.regions} color="#7c3aed" />
        </section>
        <section className="panel">
          <h2>Transaction Volume by Bank</h2>
          <Bars rows={data.txnByBank} color="#0891b2" />
        </section>
      </div>

      <section className="panel">
        <h2>Top Merchants by Transaction Volume</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Merchant</th><th>Devices</th><th className="num">Txn Amount (Birr)</th></tr>
            </thead>
            <tbody>
              {data.topMerchants.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => onOpenMerchant(m.id)}>
                  <td>{m.name}</td>
                  <td>{m.device_count}</td>
                  <td className="num">{Number(m.txn_amount).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

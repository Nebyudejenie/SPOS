import { useEffect, useState } from 'react';
import { whApi } from '../api/client.js';

function Row({ k, v }) {
  if (v === null || v === undefined || v === '') return null;
  return <div className="kv"><span>{k}</span><b>{String(v)}</b></div>;
}

export default function MerchantDetail({ id, onClose, onOpenDevice, notify }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    whApi.merchant(id)
      .then(setD)
      .catch((e) => notify('error', e.message))
      .finally(() => setLoading(false));
  }, [id, notify]);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal__close" onClick={onClose} aria-label="Close">×</button>
        {loading && <p className="muted">Loading…</p>}
        {d && (
          <>
            <h2>
              {d.merchant.trading_name || d.merchant.merchant_code || '(unnamed merchant)'}
              {d.merchant.health_bucket && (
                <span className={`badge badge--${d.merchant.health_bucket === 'Green' ? 'green'
                  : d.merchant.health_bucket === 'Red' ? 'red' : 'gray'}`}
                  style={{ marginLeft: '.6rem', fontSize: '.7rem', verticalAlign: 'middle' }}>
                  Health {d.merchant.health_score} · {d.merchant.health_bucket}
                </span>
              )}
            </h2>
            <div className="kvs">
              <Row k="Merchant Code" v={d.merchant.merchant_code} />
              <Row k="QR Merchant ID" v={d.merchant.qr_merchant_id} />
              <Row k="Business Type" v={d.merchant.business_type} />
              <Row k="Phone" v={d.merchant.phone} />
              <Row k="Bank" v={d.merchant.bank_name} />
              <Row k="Region" v={d.merchant.region} />
              <Row k="City" v={d.merchant.city} />
              <Row k="Status" v={d.merchant.current_status} />
              <Row k="Settlement Acct" v={d.merchant.settlement_account} />
              <Row k="Devices" v={d.merchant.device_count} />
              <Row k="Total Txn (Birr)" v={Number(d.merchant.total_txn_amount || 0).toLocaleString()} />
            </div>

            <h3>Devices ({d.devices.length})</h3>
            {d.devices.length === 0 ? <p className="muted">None.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Serial</th><th>Terminal</th><th>Status</th><th>Health</th><th>Last Seen</th></tr></thead>
                  <tbody>
                    {d.devices.map((x) => (
                      <tr key={x.id} className="clickable" onClick={() => onOpenDevice(x.id)}>
                        <td className="mono">{x.serial_number || '—'}</td>
                        <td className="mono">{x.terminal_id || '—'}</td>
                        <td>{x.current_status || '—'}</td>
                        <td>{x.health_bucket || '—'}</td>
                        <td>{x.last_seen_at ? new Date(x.last_seen_at).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {d.deployments?.length > 0 && (
              <>
                <h3>Device Lifecycle ({d.deployments.length})</h3>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Event</th><th>Date</th><th>Received By</th><th>Condition / Remark</th></tr></thead>
                    <tbody>
                      {d.deployments.map((x, i) => (
                        <tr key={i}>
                          <td>{x.event_type}</td>
                          <td>{x.event_date ? new Date(x.event_date).toLocaleDateString() : '—'}</td>
                          <td>{x.received_by || '—'}</td>
                          <td>{x.condition || x.remark || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {d.followups?.length > 0 && (
              <>
                <h3>Support / Call Follow-ups ({d.followups.length})</h3>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Agent</th><th>Contacted</th><th>Round</th><th>Comment</th></tr></thead>
                    <tbody>
                      {d.followups.map((x, i) => (
                        <tr key={i}>
                          <td>{x.agent_name || '—'}</td>
                          <td>{x.contacted_person || x.contact_phone || '—'}</td>
                          <td>{x.follow_up_round || '—'}</td>
                          <td>{x.comment || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <h3>Transaction Summaries ({d.summaries.length})</h3>
            {d.summaries.length === 0 ? <p className="muted">None.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Terminal</th><th className="num">Txn Count</th><th className="num">Txn Amount</th><th className="num">Commission</th></tr></thead>
                  <tbody>
                    {d.summaries.slice(0, 20).map((x, i) => (
                      <tr key={i}>
                        <td className="mono">{x.terminal_id || '—'}</td>
                        <td className="num">{x.total_transaction_count ?? '—'}</td>
                        <td className="num">{Number(x.total_transaction_amount || 0).toLocaleString()}</td>
                        <td className="num">{Number(x.santimpay_commission || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

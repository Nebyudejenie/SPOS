import { useEffect, useState } from 'react';
import { whApi } from '../api/client.js';

function Row({ k, v }) {
  if (v === null || v === undefined || v === '') return null;
  return <div className="kv"><span>{k}</span><b>{String(v)}</b></div>;
}

export default function DeviceDetail({ id, onClose, notify }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    whApi.device(id)
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
            <h2>{d.device.serial_number || d.device.terminal_id || '(device)'}</h2>
            <div className="kvs">
              <Row k="Serial" v={d.device.serial_number} />
              <Row k="Terminal ID" v={d.device.terminal_id} />
              <Row k="PSN" v={d.device.psn} />
              <Row k="Model" v={d.device.model} />
              <Row k="Device Type" v={d.device.device_type} />
              <Row k="Merchant" v={d.device.merchant_name} />
              <Row k="Status" v={d.device.current_status} />
              <Row k="Health" v={d.device.health_bucket} />
              <Row k="Last Battery" v={d.device.last_battery_level} />
              <Row k="Last Connectivity" v={d.device.last_connectivity} />
              <Row k="Last Seen" v={d.device.last_seen_at ? new Date(d.device.last_seen_at).toLocaleString() : null} />
            </div>

            <h3>Telemetry history ({d.telemetry.length})</h3>
            {d.telemetry.length === 0 ? <p className="muted">No telemetry.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>When</th><th>Status</th><th>Battery</th><th>Connectivity</th><th>Signal</th></tr></thead>
                  <tbody>
                    {d.telemetry.map((t, i) => (
                      <tr key={i}>
                        <td>{t.snapshot_at ? new Date(t.snapshot_at).toLocaleString() : '—'}</td>
                        <td>{t.device_status || '—'}</td>
                        <td>{t.battery_level ?? '—'}</td>
                        <td>{t.connectivity || '—'}</td>
                        <td>{t.signal_strength || '—'}</td>
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

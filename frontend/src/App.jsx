import { useCallback, useEffect, useState } from 'react';
import { merchantsApi, posDevicesApi } from './api/client.js';
import Toast from './components/Toast.jsx';
import MerchantForm from './components/MerchantForm.jsx';
import MerchantTable from './components/MerchantTable.jsx';
import PosForm from './components/PosForm.jsx';
import PosTable from './components/PosTable.jsx';

export default function App() {
  const [tab, setTab] = useState('merchants');
  const [toast, setToast] = useState(null);

  const [merchants, setMerchants] = useState([]);
  const [posDevices, setPosDevices] = useState([]);
  const [loadingM, setLoadingM] = useState(true);
  const [loadingP, setLoadingP] = useState(true);
  const [busy, setBusy] = useState(false);

  const [editM, setEditM] = useState(null);
  const [editP, setEditP] = useState(null);
  const [search, setSearch] = useState('');

  const notify = useCallback((type, message) => setToast({ type, message }), []);

  const loadMerchants = useCallback(async (q) => {
    setLoadingM(true);
    try {
      const res = await merchantsApi.list(q ? { search: q } : undefined);
      setMerchants(res.data);
    } catch (err) {
      notify('error', err.message);
    } finally {
      setLoadingM(false);
    }
  }, [notify]);

  const loadPos = useCallback(async (q) => {
    setLoadingP(true);
    try {
      const res = await posDevicesApi.list(q ? { search: q } : undefined);
      setPosDevices(res.data);
    } catch (err) {
      notify('error', err.message);
    } finally {
      setLoadingP(false);
    }
  }, [notify]);

  useEffect(() => {
    loadMerchants();
    loadPos();
  }, [loadMerchants, loadPos]);

  // Re-query the active tab when the search box changes (debounced).
  useEffect(() => {
    const t = setTimeout(() => {
      if (tab === 'merchants') loadMerchants(search);
      else loadPos(search);
    }, 300);
    return () => clearTimeout(t);
  }, [search, tab, loadMerchants, loadPos]);

  // ---- Merchant handlers ----
  const submitMerchant = async (payload) => {
    setBusy(true);
    try {
      if (editM) {
        await merchantsApi.update(editM.id, payload);
        notify('success', 'Merchant updated');
      } else {
        await merchantsApi.create(payload);
        notify('success', 'Merchant created');
      }
      setEditM(null);
      await loadMerchants(search);
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteMerchant = async (m) => {
    if (!window.confirm(`Delete merchant ${m.merchant_code}?`)) return;
    try {
      await merchantsApi.remove(m.id);
      notify('success', 'Merchant deleted');
      if (editM?.id === m.id) setEditM(null);
      await loadMerchants(search);
    } catch (err) {
      notify('error', err.message);
    }
  };

  // ---- POS handlers ----
  const submitPos = async (payload) => {
    setBusy(true);
    try {
      if (editP) {
        await posDevicesApi.update(editP.id, payload);
        notify('success', 'POS device updated');
      } else {
        await posDevicesApi.create(payload);
        notify('success', 'POS device created');
      }
      setEditP(null);
      await loadPos(search);
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const deletePos = async (d) => {
    if (!window.confirm(`Delete POS device ${d.terminal_id}?`)) return;
    try {
      await posDevicesApi.remove(d.id);
      notify('success', 'POS device deleted');
      if (editP?.id === d.id) setEditP(null);
      await loadPos(search);
    } catch (err) {
      notify('error', err.message);
    }
  };

  const switchTab = (next) => {
    setTab(next);
    setSearch('');
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1>SPOS <span className="muted">· Merchant &amp; POS Management</span></h1>
        <nav className="tabs">
          <button className={`tab ${tab === 'merchants' ? 'tab--active' : ''}`} onClick={() => switchTab('merchants')}>
            Merchants <span className="pill">{merchants.length}</span>
          </button>
          <button className={`tab ${tab === 'pos' ? 'tab--active' : ''}`} onClick={() => switchTab('pos')}>
            POS Devices <span className="pill">{posDevices.length}</span>
          </button>
        </nav>
      </header>

      <Toast toast={toast} onClose={() => setToast(null)} />

      <main className="app__main">
        {tab === 'merchants' ? (
          <>
            <MerchantForm
              editing={editM}
              busy={busy}
              onSubmit={submitMerchant}
              onCancel={() => setEditM(null)}
            />
            <section className="panel">
              <div className="panel__bar">
                <h2>Merchants</h2>
                <input
                  className="search"
                  placeholder="Search name or ID…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <MerchantTable
                rows={merchants}
                loading={loadingM}
                onEdit={(m) => { setEditM(m); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                onDelete={deleteMerchant}
              />
            </section>
          </>
        ) : (
          <>
            <PosForm
              editing={editP}
              merchants={merchants}
              busy={busy}
              onSubmit={submitPos}
              onCancel={() => setEditP(null)}
            />
            <section className="panel">
              <div className="panel__bar">
                <h2>POS Devices</h2>
                <input
                  className="search"
                  placeholder="Search terminal, serial, model…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <PosTable
                rows={posDevices}
                loading={loadingP}
                onEdit={(d) => { setEditP(d); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                onDelete={deletePos}
              />
            </section>
          </>
        )}
      </main>

      <footer className="app__footer muted">SPOS · React + Express + PostgreSQL</footer>
    </div>
  );
}

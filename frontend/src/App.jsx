import { useCallback, useState } from 'react';
import Toast from './components/Toast.jsx';
import Dashboard from './components/Dashboard.jsx';
import MerchantsExplorer from './components/MerchantsExplorer.jsx';
import DevicesExplorer from './components/DevicesExplorer.jsx';
import MerchantDetail from './components/MerchantDetail.jsx';
import DeviceDetail from './components/DeviceDetail.jsx';
import HermesChat from './components/HermesChat.jsx';

const TABS = [
  ['dashboard', 'Dashboard'],
  ['merchants', 'Merchants'],
  ['devices', 'POS Devices'],
  ['hermes', 'Ask Hermes'],
];

export default function App() {
  const [tab, setTab] = useState('dashboard');
  const [toast, setToast] = useState(null);
  const [openMerchant, setOpenMerchant] = useState(null);
  const [openDevice, setOpenDevice] = useState(null);

  const notify = useCallback((type, message) => setToast({ type, message }), []);

  return (
    <div className="app">
      <header className="app__header">
        <h1>SPOS <span className="muted">· Merchant &amp; POS Intelligence</span></h1>
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={`tab ${tab === id ? 'tab--active' : ''}`}
              onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
      </header>

      <Toast toast={toast} onClose={() => setToast(null)} />

      <main className="app__main">
        {tab === 'dashboard' && (
          <Dashboard notify={notify} onOpenMerchant={setOpenMerchant} />
        )}
        {tab === 'merchants' && (
          <MerchantsExplorer notify={notify} onOpenMerchant={setOpenMerchant} />
        )}
        {tab === 'devices' && (
          <DevicesExplorer notify={notify} onOpenDevice={setOpenDevice} />
        )}
        {tab === 'hermes' && <HermesChat notify={notify} />}
      </main>

      {openMerchant && (
        <MerchantDetail id={openMerchant} notify={notify}
          onClose={() => setOpenMerchant(null)}
          onOpenDevice={(id) => { setOpenMerchant(null); setOpenDevice(id); }} />
      )}
      {openDevice && (
        <DeviceDetail id={openDevice} notify={notify} onClose={() => setOpenDevice(null)} />
      )}

      <footer className="app__footer muted">
        SPOS · React + Express + PostgreSQL · warehouse (spos.*) over {`${''}`}372 source files
      </footer>
    </div>
  );
}

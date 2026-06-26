import { useState } from 'react';
import { hermesApi } from '../api/client.js';

const SAMPLES = [
  'How many merchants are in each health bucket?',
  'Top 5 banks by number of merchants',
  'Which regions have the most merchants?',
  'How many POS devices are Red or Critical?',
  'Total transaction volume across all merchants',
];

export default function HermesChat({ notify }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const ask = async (q) => {
    const query = (q ?? question).trim();
    if (!query) return;
    setQuestion(query);
    setLoading(true);
    setResult(null);
    try {
      const res = await hermesApi.ask(query);
      setResult(res);
    } catch (e) {
      notify('error', e.message);
      setResult({ answer: null, error: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <h2>Ask Hermes <span className="muted">· AI analyst over the warehouse</span></h2>

      <div className="hermes__ask">
        <textarea
          className="hermes__input"
          rows={2}
          placeholder="Ask a question about merchants, devices, transactions, health…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); }}
        />
        <button className="btn btn--primary" onClick={() => ask()} disabled={loading}>
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      <div className="hermes__samples">
        {SAMPLES.map((s) => (
          <button key={s} className="hermes__chip" onClick={() => ask(s)} disabled={loading}>{s}</button>
        ))}
      </div>

      {loading && <p className="muted">Hermes is querying the warehouse…</p>}

      {result?.answer && (
        <div className="hermes__answer">
          {result.answer.split('\n').map((line, i) => <p key={i}>{line}</p>)}
        </div>
      )}
      {result?.error && <p className="muted">{result.error}</p>}

      {result?.sql?.length > 0 && (
        <details className="hermes__sql">
          <summary>SQL Hermes ran ({result.sql.length})</summary>
          {result.sql.map((s, i) => (
            <pre key={i} className="hermes__pre">
              {s.query}{'\n'}— {s.error ? `error: ${s.error}` : `${s.rowCount} rows`}
            </pre>
          ))}
        </details>
      )}
    </section>
  );
}

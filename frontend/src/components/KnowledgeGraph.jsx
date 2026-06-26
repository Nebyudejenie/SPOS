import { useEffect, useState } from 'react';
import { whApi } from '../api/client.js';

const COLORS = {
  merchant: '#2563eb', bank: '#0891b2', officer: '#7c3aed',
  device: '#16a34a', ticket: '#dc2626', transactions: '#d97706',
};
const W = 760, H = 460, CX = W / 2, CY = H / 2;

// Radial layout: merchant in the center, all neighbours on a ring around it.
function layout(nodes) {
  const center = nodes.find((n) => n.type === 'merchant') || nodes[0];
  const others = nodes.filter((n) => n !== center);
  const pos = { [center.id]: { x: CX, y: CY } };
  const R = Math.min(CX, CY) - 60;
  others.forEach((n, i) => {
    const a = (i / Math.max(others.length, 1)) * 2 * Math.PI - Math.PI / 2;
    pos[n.id] = { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };
  });
  return pos;
}

export default function KnowledgeGraph({ merchantId, notify }) {
  const [g, setG] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    whApi.graph(merchantId)
      .then(setG)
      .catch((e) => notify?.('error', e.message))
      .finally(() => setLoading(false));
  }, [merchantId, notify]);

  if (loading) return <p className="muted">Building graph…</p>;
  if (!g || g.nodes.length <= 1) return <p className="muted">No connections to graph.</p>;

  const pos = layout(g.nodes);
  const radius = (t) => (t === 'merchant' ? 30 : 18);

  return (
    <div className="graph-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="graph" role="img" aria-label="Knowledge graph">
        {g.edges.map((e, i) => {
          const a = pos[e.source], b = pos[e.target];
          if (!a || !b) return null;
          return (
            <g key={i}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#cbd5e1" strokeWidth="1.5" />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 3} className="graph__rel">{e.rel}</text>
            </g>
          );
        })}
        {g.nodes.map((n) => {
          const p = pos[n.id]; if (!p) return null;
          const r = radius(n.type);
          const fill = n.type === 'device' && n.health === 'Red' ? '#dc2626'
            : n.type === 'device' && n.health === 'Green' ? '#16a34a'
            : COLORS[n.type] || '#64748b';
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r={r} fill={fill} opacity="0.92" />
              <text x={p.x} y={p.y + r + 12} className="graph__label">
                {n.label?.length > 22 ? `${n.label.slice(0, 22)}…` : n.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="graph__legend">
        {Object.entries(COLORS).map(([t, c]) => (
          <span key={t} className="graph__chip">
            <i style={{ background: c }} />{t}
          </span>
        ))}
      </div>
    </div>
  );
}

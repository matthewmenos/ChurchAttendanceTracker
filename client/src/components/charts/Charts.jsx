const BLUE = '#2563eb';

/** Lightweight SVG line/area chart for attendance trends. */
export function TrendChart({ points, height = 220 }) {
  if (!points || points.length === 0) {
    return <p className="muted">No trend data yet.</p>;
  }
  const W = 640;
  const H = height;
  const P = 30;
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const stepX = points.length > 1 ? (W - 2 * P) / (points.length - 1) : 0;
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const x = (i) => P + i * stepX;
  const coords = points.map((p, i) => `${x(i)},${y(p.value)}`);
  const last = points.length - 1;
  const mid = Math.floor(last / 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend-chart" role="img" aria-label="Attendance trend chart">
      {[0, max / 2, max].map((v, i) => (
        <g key={i}>
          <line x1={P} y1={y(v)} x2={W - P} y2={y(v)} stroke="#e2e8f0" strokeDasharray="3 4" />
          <text x={4} y={y(v) + 4} fontSize="11" fill="#94a3b8">{Math.round(v)}</text>
        </g>
      ))}
      {points.length > 1 && (
        <polygon points={`${x(0)},${H - P} ${coords.join(' ')} ${x(last)},${H - P}`} fill="rgba(37,99,235,0.12)" />
      )}
      {points.length > 1 && <polyline points={coords.join(' ')} fill="none" stroke={BLUE} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
      {points.map((p, i) => (
        <g key={p.label + i}>
          <circle cx={x(i)} cy={y(p.value)} r={points.length > 20 ? 3 : 4.5} fill="#fff" stroke={BLUE} strokeWidth="2.5">
            <title>{`${p.label}: ${p.value}`}</title>
          </circle>
        </g>
      ))}
      {[0, mid, last].map((i) => (
        <text key={i} x={x(i)} y={H - 8} fontSize="11" fill="#64748b" textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}>
          {points[i].label}
        </text>
      ))}
    </svg>
  );
}

/** Horizontal bars, e.g. attendance by group or service. */
export function BarList({ items, emptyLabel = 'No data.' }) {
  if (!items || items.length === 0) return <p className="muted">{emptyLabel}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="bar-list">
      {items.map((item) => (
        <li key={item.label}>
          <span className="bar-label" title={item.label}>{item.label}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%`, background: item.color || BLUE }}
            />
          </span>
          <span className="bar-value">{item.extra || item.value}</span>
        </li>
      ))}
    </ul>
  );
}
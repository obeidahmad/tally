import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, useLoad, type Section } from '../api';
import { currentMonth, monthName, monthTitle, shiftMonth } from '../dates';
import { formatMinor } from '../money';
import { Load, Topbar, subLabel } from '../ui';

type Reports = {
  currency: string;
  months: string[];
  spending: { month: string; bySection: { sectionId: number; minor: number }[]; totalMinor: number }[];
  cashflow: { month: string; incomeMinor: number; spendingMinor: number }[];
  networth: { month: string; minor: number }[];
  payees: { payee: string; minor: number; count: number }[];
  missingRates?: string[];
};

const CHOICES = [3, 6, 12, 24];
const H = 240;
const M = { left: 44, top: 20, bottom: 36 };
const slotColour = (slot: number) => (slot >= 1 && slot <= 8 ? `var(--sec-${slot})` : 'var(--ink)');
const dot = (slot: number) => (slot >= 1 && slot <= 8 ? `ty-dot ty-dot--${slot}` : 'ty-dot');
const MINUS = '−';

/** 123456 -> "1.2K", 250000000 -> "2.5M"; chart labels only, the tables carry the exact figures. */
function compact(minor: number): string {
  const v = minor / 100, a = Math.abs(v);
  const n = a >= 1e6 ? `${+(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${+(a / 1e3).toFixed(1)}K` : `${Math.round(a)}`;
  return `${v < 0 && n !== '0' ? MINUS : ''}${n}`;
}

/** Round axis bounds and ticks around [min, max], about `n` steps. */
function scale(min: number, max: number, n = 4) {
  const span = max - min || Math.abs(max) || 100;
  const raw = Math.max(span / n, 1), mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const lo = Math.floor(min / step) * step, hi = Math.max(Math.ceil(max / step) * step, lo + step);
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(t);
  return { lo, hi, ticks };
}

/** A bar with the 4px rounded end at the top and a square foot on the baseline. */
function topRound(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
}

type Tip = { x: number; title: string; rows: { label: string; value: string; colour?: string }[]; foot?: { label: string; value: string } };
type Mark = (t: Tip, label: string) => object;

/** Measures its width, draws the svg and the one tooltip. Every mark spreads `mark(tip, label)` for hover, focus and tap. */
function Plot({ children }: { children: (w: number, mark: Mark) => ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [tip, setTip] = useState<Tip>();
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(Math.max(el.clientWidth, 240)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const hide = () => setTip(undefined);
  const mark: Mark = (t, label) => ({
    tabIndex: 0, role: 'img', 'aria-label': label,
    onPointerEnter: () => setTip(t), onFocus: () => setTip(t), onClick: () => setTip(t), onBlur: hide,
    onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') hide(); }, // a tap keeps its tooltip until the next tap
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Escape') hide(); },
  });
  const left = tip ? tip.x > w / 2 : false;
  return (
    <div className="rp-plot" ref={box}>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} onPointerDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
        {children(w, mark)}
      </svg>
      {tip && (
        <div className="rp-tip" role="tooltip" style={{ left: tip.x, transform: `translateX(${left ? 'calc(-100% - 0.75rem)' : '0.75rem'})` }}>
          <div className="rp-tip__title">{tip.title}</div>
          {tip.rows.map((r) => (
            <div key={r.label} className="rp-tip__row">
              <span className="rp-tip__key" style={{ background: r.colour }} />
              <span className="rp-tip__val">{r.value}</span>
              <span className="ty-cap">{r.label}</span>
            </div>
          ))}
          {tip.foot && <div className="rp-tip__row rp-tip__foot"><span className="rp-tip__val">{tip.foot.value}</span><span className="ty-cap">{tip.foot.label}</span></div>}
        </div>
      )}
    </div>
  );
}

/** Gridlines with tick labels, and the month labels along the baseline. */
function Axes({ w, months, ticks, y, band }: { w: number; months: string[]; ticks: number[]; y: (v: number) => number; band: number }) {
  const every = Math.ceil(34 / band);
  return (
    <g className="rp-axis">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={w} y1={y(t)} y2={y(t)} className="rp-grid" />
          <text x={M.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">{compact(t)}</text>
        </g>
      ))}
      {months.map((m, i) => (months.length - 1 - i) % every === 0 && (
        <text key={m} x={M.left + band * (i + 0.5)} y={H - M.bottom + 16} textAnchor="middle">
          {monthName(m).slice(0, 3)}
          {(i === 0 || m.endsWith('-01')) && <tspan x={M.left + band * (i + 0.5)} dy="13">{m.slice(0, 4)}</tspan>}
        </text>
      ))}
    </g>
  );
}

function Card({ title, head, empty, legend, chart, table, note }: {
  title: string; head?: ReactNode; empty: boolean; legend?: ReactNode; chart: ReactNode; table: ReactNode; note?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="ty-card ty-stack" aria-label={title}>
      {head ?? <h2 className="text-heading" style={{ margin: 0 }}>{title}</h2>}
      {empty ? <div className="ty-cap">Nothing to show yet.</div> : (
        <>
          {!asTable && legend}
          {asTable ? <div className="rp-table">{table}</div> : chart}
          {note}
        </>
      )}
      <div><button type="button" className="ty-btn ty-btn--quiet" onClick={() => setAsTable(!asTable)}>{asTable ? 'Show as chart' : 'Show as table'}</button></div>
    </section>
  );
}

function SpendingCard({ r, sections }: { r: Reports; sections: Section[] }) {
  const info = (id: number) => {
    const s = sections.find((x) => x.id === id);
    return { name: s?.name ?? `Section ${id}`, slot: s?.colorSlot ?? 0, colour: slotColour(s?.colorSlot ?? 0) };
  };
  const ids = r.spending[0]?.bySection.map((s) => s.sectionId) ?? [];
  const months = r.spending.map((s) => s.month);
  const empty = r.spending.every((s) => s.totalMinor === 0);
  const { hi, ticks } = scale(0, Math.max(...r.spending.map((s) => s.totalMinor), 0));
  return (
    <Card
      title="Spending by section" empty={empty}
      legend={<ul className="rp-legend">{ids.map((id) => <li key={id} className="ty-cap"><span className={dot(info(id).slot)} />{info(id).name}</li>)}</ul>}
      chart={
        <Plot>{(w, mark) => {
          const band = (w - M.left) / months.length, bw = Math.min(24, band * 0.6);
          const plotH = H - M.top - M.bottom, y = (v: number) => M.top + plotH * (1 - v / hi);
          return (
            <>
              <Axes w={w} months={months} ticks={ticks} y={y} band={band} />
              {r.spending.map((s, i) => {
                const x = M.left + band * (i + 0.5) - bw / 2;
                let acc = 0;
                const shown = s.bySection.filter((b) => b.minor > 0);
                const tip: Tip = {
                  x: x + bw / 2, title: monthTitle(s.month),
                  rows: s.bySection.map((b) => ({ label: info(b.sectionId).name, value: formatMinor(b.minor), colour: info(b.sectionId).colour })),
                  foot: { label: 'Total', value: formatMinor(s.totalMinor) },
                };
                return (
                  <g key={s.month} className="rp-col">
                    {shown.map((b, k) => {
                      const y1 = y(acc + b.minor), y0 = y(acc);
                      acc += b.minor;
                      const h = Math.max(y0 - y1 - (k === 0 ? 0 : 2), 1); // a 2px surface gap under every segment above the first
                      return k === shown.length - 1
                        ? <path key={b.sectionId} className="rp-seg" d={topRound(x, y1, bw, h)} fill={info(b.sectionId).colour} />
                        : <rect key={b.sectionId} className="rp-seg" x={x} y={y1} width={bw} height={h} fill={info(b.sectionId).colour} />;
                    })}
                    {band >= 36 && s.totalMinor > 0 && <text className="rp-total" x={x + bw / 2} y={y(s.totalMinor) - 6} textAnchor="middle">{compact(s.totalMinor)}</text>}
                    <rect className="rp-hit" x={M.left + band * i} y={M.top} width={band} height={H - M.top - M.bottom} fill="transparent"
                      {...mark(tip, `${tip.title}: ${tip.rows.map((t) => `${t.label} ${t.value}`).join(', ')}, total ${tip.foot!.value}`)} />
                  </g>
                );
              })}
            </>
          );
        }}</Plot>
      }
      table={
        <table className="ty-table">
          <thead><tr><th>Month</th>{ids.map((id) => <th key={id}>{info(id).name}</th>)}<th>Total</th></tr></thead>
          <tbody>{r.spending.map((s) => (
            <tr key={s.month}><td>{monthTitle(s.month)}</td>{s.bySection.map((b) => <td key={b.sectionId}>{formatMinor(b.minor)}</td>)}<td>{formatMinor(s.totalMinor)}</td></tr>
          ))}</tbody>
        </table>
      }
    />
  );
}

function CashflowCard({ r }: { r: Reports }) {
  const months = r.cashflow.map((c) => c.month);
  const income = r.cashflow.reduce((a, c) => a + c.incomeMinor, 0), spending = r.cashflow.reduce((a, c) => a + c.spendingMinor, 0);
  const { hi, ticks } = scale(0, Math.max(...r.cashflow.flatMap((c) => [c.incomeMinor, c.spendingMinor]), 0));
  const series = [['Income', 'incomeMinor', 'var(--positive)'], ['Spending', 'spendingMinor', 'var(--ink)']] as const;
  return (
    <Card
      title="Cash flow" empty={income === 0 && spending === 0}
      legend={<ul className="rp-legend">{series.map(([name, , colour]) => <li key={name} className="ty-cap"><span className="ty-dot" style={{ background: colour }} />{name}</li>)}</ul>}
      chart={
        <Plot>{(w, mark) => {
          const band = (w - M.left) / months.length, bw = Math.min(24, band * 0.3);
          const plotH = H - M.top - M.bottom, y = (v: number) => M.top + plotH * (1 - v / hi);
          return (
            <>
              <Axes w={w} months={months} ticks={ticks} y={y} band={band} />
              {r.cashflow.map((c, i) => (
                <g key={c.month}>
                  {series.map(([name, key, colour], k) => {
                    const v = c[key], x = M.left + band * (i + 0.5) + (k === 0 ? -bw - 1 : 1), h = y(0) - y(v);
                    const tip: Tip = { x: x + bw / 2, title: monthTitle(c.month), rows: [{ label: name, value: formatMinor(v), colour }] };
                    return (
                      <g key={name} className="rp-col">
                        {v > 0 && <path className="rp-seg" d={topRound(x, y(v), bw, h)} fill={colour} />}
                        <rect className="rp-hit" x={x - 1} y={M.top} width={bw + 2} height={H - M.top - M.bottom} fill="transparent" {...mark(tip, `${tip.title}, ${name} ${tip.rows[0].value}`)} />
                      </g>
                    );
                  })}
                </g>
              ))}
            </>
          );
        }}</Plot>
      }
      note={<div className="ty-cap">Over these months: income {formatMinor(income)}, spending {formatMinor(spending)}, {income >= spending ? 'saved' : 'overspent'} {formatMinor(Math.abs(income - spending))}.</div>}
      table={
        <table className="ty-table">
          <thead><tr><th>Month</th><th>Income</th><th>Spending</th></tr></thead>
          <tbody>{r.cashflow.map((c) => <tr key={c.month}><td>{monthTitle(c.month)}</td><td>{formatMinor(c.incomeMinor)}</td><td>{formatMinor(c.spendingMinor)}</td></tr>)}</tbody>
        </table>
      }
    />
  );
}

function NetWorthCard({ r }: { r: Reports }) {
  const months = r.networth.map((n) => n.month);
  const vals = r.networth.map((n) => n.minor);
  const { lo, hi, ticks } = scale(Math.min(...vals), Math.max(...vals));
  const missing = r.missingRates?.length ? r.missingRates.join(', ') : '';
  return (
    <Card
      title="Net worth" empty={vals.every((v) => v === 0)}
      chart={
        <Plot>{(w, mark) => {
          const inner = w - 88; // room at the right for the last value
          const band = (inner - M.left) / months.length;
          const plotH = H - M.top - M.bottom, y = (v: number) => M.top + plotH * (1 - (v - lo) / (hi - lo));
          const px = (i: number) => M.left + band * (i + 0.5);
          const last = r.networth.length - 1;
          return (
            <>
              <Axes w={inner} months={months} ticks={ticks} y={y} band={band} />
              <polyline className="rp-line" points={r.networth.map((n, i) => `${px(i)},${y(n.minor)}`).join(' ')} fill="none" />
              {r.networth.map((n, i) => {
                const tip: Tip = { x: px(i), title: monthTitle(n.month), rows: [{ label: 'Net worth', value: formatMinor(n.minor), colour: 'var(--ink)' }] };
                return (
                  <g key={n.month} className="rp-col">
                    <circle className="rp-dot" cx={px(i)} cy={y(n.minor)} r={4} />
                    <rect className="rp-hit" x={px(i) - Math.max(band, 24) / 2} y={M.top} width={Math.max(band, 24)} height={H - M.top - M.bottom} fill="transparent" {...mark(tip, `${tip.title}: ${tip.rows[0].value}`)} />
                  </g>
                );
              })}
              <text className="rp-total" x={px(last) + 10} y={y(vals[last])} dominantBaseline="middle">{formatMinor(vals[last])}</text>
            </>
          );
        }}</Plot>
      }
      note={missing && <div className="ty-cap">No exchange rate for {missing} for some months; those months leave it out.</div>}
      table={
        <table className="ty-table">
          <thead><tr><th>Month</th><th>Net worth</th></tr></thead>
          <tbody>{r.networth.map((n) => <tr key={n.month}><td>{monthTitle(n.month)}</td><td>{formatMinor(n.minor)}</td></tr>)}</tbody>
        </table>
      }
    />
  );
}

type Flow = { nodes: { id: string; label: string; kind: 'source' | 'section' | 'subsection' | 'other' }[]; links: { from: string; to: string; minor: number }[] };

const NODE_W = 12, GAP = 10, MIN_H = 14, TOP = 8, LABEL_W = 190;

/** Sankey layout: three columns (sources, sections, subsections), node height by value, links stacked at each end by the other end's position. */
function layoutFlow(flow: Flow, plotW: number) {
  const colOf = (n: Flow['nodes'][number]) => (n.kind === 'source' || n.id === 'carried' ? 0 : n.kind === 'section' || n.id === 'left-over' ? 1 : 2);
  const nodes = flow.nodes.map((n) => {
    const into = flow.links.filter((l) => l.to === n.id).reduce((a, l) => a + l.minor, 0);
    const out = flow.links.filter((l) => l.from === n.id).reduce((a, l) => a + l.minor, 0);
    return { ...n, col: colOf(n), value: Math.max(into, out), x: 0, y: 0, h: 0 };
  });
  const cols = [0, 1, 2].map((c) => nodes.filter((n) => n.col === c));
  const biggest = Math.max(...cols.map((c) => c.length), 1);
  const plotH = Math.max(280, biggest * (MIN_H + GAP));
  const k = Math.min(...cols.filter((c) => c.length).map((c) => (plotH - (c.length - 1) * GAP) / c.reduce((a, n) => a + n.value, 0)));
  let height = 0;
  cols.forEach((c, i) => {
    let y = TOP;
    c.forEach((n) => { n.h = Math.max(n.value * k, MIN_H); n.x = i * ((plotW - NODE_W) / 2); n.y = y; y += n.h + GAP; });
    height = Math.max(height, y);
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const thick = (n: { h: number; value: number }, minor: number) => (minor / n.value) * n.h;
  const links = flow.links.map((l) => ({ ...l, a: byId.get(l.from)!, b: byId.get(l.to)!, y0: 0, y1: 0 }));
  const stack = (end: 'a' | 'b', other: 'a' | 'b', key: 'y0' | 'y1') => {
    for (const n of nodes) {
      let off = 0;
      for (const l of links.filter((x) => x[end] === n).sort((p, q) => p[other].y - q[other].y)) { l[key] = n.y + off; off += thick(n, l.minor); }
    }
  };
  stack('a', 'b', 'y0');
  stack('b', 'a', 'y1');
  return { nodes, links, height, thick };
}

function FlowCard({ sections }: { sections: Section[] }) {
  const now = currentMonth();
  const [month, setMonth] = useState(now);
  const state = useLoad(() => api<Flow>('GET', `/reports/flow?month=${month}`), [month]);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [tip, setTip] = useState<{ x: number; y: number; text: string }>();
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(Math.max(el.clientWidth, 640)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [state.data]);
  const secById = new Map(sections.map((s) => [s.id, s]));
  const subById = new Map(sections.flatMap((s) => s.subsections.map((x) => [x.id, x] as const)));
  const sectionColour = (id: string) => slotColour(secById.get(Number(id.slice(8)))?.colorSlot ?? 0);
  const head = (
    <div className="ty-month__top">
      <h2 className="text-heading rp-flowtitle" style={{ margin: 0 }}>Where {monthName(month)}'s money went</h2>
      <span className="ty-grow" />
      <button className="ty-btn ty-btn--icon" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
      <span className="text-body" style={{ fontWeight: 600 }}>{monthTitle(month)}</span>
      <button className="ty-btn ty-btn--icon" aria-label="Next month" disabled={month >= now} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
    </div>
  );
  if (!state.data) return <Card title="Where the money went" head={head} empty={false} chart={<Load state={state}>{() => null}</Load>} table={null} />;
  const flow = state.data;
  const label = (id: string) => {
    const n = flow.nodes.find((x) => x.id === id);
    return n?.kind === 'subsection' ? subLabel({ name: n.label, emoji: subById.get(Number(id.slice(11)))?.emoji }) : n?.label ?? id;
  };
  const g = layoutFlow(flow, width - LABEL_W - 8);
  const nodeColour = (n: (typeof g.nodes)[number]) => {
    if (n.kind === 'section') return sectionColour(n.id);
    if (n.kind === 'subsection') { const parent = g.links.find((l) => l.to === n.id); return parent ? sectionColour(parent.from) : 'var(--ink)'; }
    return 'var(--ink)';
  };
  const linkColour = (l: (typeof g.links)[number]) => (l.a.kind === 'section' ? sectionColour(l.a.id) : l.b.kind === 'section' ? sectionColour(l.b.id) : 'var(--ink)');
  return (
    <Card
      title="Where the money went" head={head} empty={flow.links.length === 0}
      chart={
        <div className="rp-flowbox">
          <div className="rp-plot" ref={box} style={{ minWidth: 640 }}>
            <svg width={width} height={g.height} viewBox={`0 0 ${width} ${g.height}`} onPointerDown={(e) => { if (e.target === e.currentTarget) setTip(undefined); }}>
              <g transform="translate(4,0)">
                {g.links.map((l) => {
                  const x0 = l.a.x + NODE_W, x1 = l.b.x, xm = (x0 + x1) / 2;
                  const t0 = g.thick(l.a, l.minor), t1 = g.thick(l.b, l.minor);
                  const d = `M${x0},${l.y0}C${xm},${l.y0} ${xm},${l.y1} ${x1},${l.y1}L${x1},${l.y1 + t1}C${xm},${l.y1 + t1} ${xm},${l.y0 + t0} ${x0},${l.y0 + t0}Z`;
                  const text = `${label(l.from)} → ${label(l.to)}: ${formatMinor(l.minor)}`;
                  const at = { x: xm + 4, y: (l.y0 + l.y1 + (t0 + t1) / 2) / 2, text };
                  return (
                    <path key={`${l.from}>${l.to}`} className="rp-flow rp-hit" d={d} fill={linkColour(l)} tabIndex={0} role="img" aria-label={text}
                      onPointerEnter={() => setTip(at)} onFocus={() => setTip(at)} onClick={() => setTip(at)} onBlur={() => setTip(undefined)}
                      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setTip(undefined); }}
                      onKeyDown={(e) => { if (e.key === 'Escape') setTip(undefined); }} />
                  );
                })}
                {g.nodes.map((n) => {
                  const emoji = n.kind === 'subsection' ? subById.get(Number(n.id.slice(11)))?.emoji : null;
                  return (
                    <g key={n.id}>
                      <rect x={n.x} y={n.y} width={NODE_W} height={n.h} fill={nodeColour(n)} rx={2} />
                      {n.col < 2 && <rect className="rp-labelbg" x={n.x + NODE_W + 3} y={n.y + n.h / 2 - 9} width={(n.label.length + formatMinor(n.value).length + 1) * 6.4 + 10} height={18} rx={4} />}
                      <text className="rp-nodelabel" x={n.x + NODE_W + 6} y={n.y + n.h / 2} dominantBaseline="middle">
                        {emoji && <tspan className="ty-emoji">{emoji} </tspan>}{n.label}<tspan className="rp-nodeamt" dx={6}>{formatMinor(n.value)}</tspan>
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
            {tip && (
              <div className="rp-tip" role="tooltip" style={{ left: tip.x, top: tip.y, transform: `translate(${tip.x > width / 2 ? 'calc(-100% - 0.75rem)' : '0.75rem'}, -50%)` }}>
                <div className="rp-tip__val">{tip.text}</div>
              </div>
            )}
          </div>
        </div>
      }
      table={
        <table className="ty-table">
          <thead><tr><th>From</th><th>To</th><th>Amount</th></tr></thead>
          <tbody>{flow.links.map((l) => <tr key={`${l.from}>${l.to}`}><td>{label(l.from)}</td><td>{label(l.to)}</td><td>{formatMinor(l.minor)}</td></tr>)}</tbody>
        </table>
      }
    />
  );
}

function PayeesCard({ r }: { r: Reports }) {
  return (
    <section className="ty-card ty-stack" aria-label="Top payees">
      <h2 className="text-heading" style={{ margin: 0 }}>Top payees</h2>
      {r.payees.length === 0 ? <div className="ty-cap">Nothing to show yet.</div> : (
        <div className="rp-table">
          <table className="ty-table">
            <thead><tr><th>Payee</th><th>Payments</th><th>Amount</th></tr></thead>
            <tbody>{r.payees.map((p) => <tr key={p.payee}><td>{p.payee}</td><td>{p.count}</td><td>{formatMinor(p.minor)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function ReportsPage() {
  const [months, setMonths] = useState(12);
  const state = useLoad(() => Promise.all([api<Reports>('GET', `/reports?months=${months}`), api<{ sections: Section[] }>('GET', '/sections')]), [months]);
  return (
    <>
      <Topbar title="Reports" />
      <header className="ty-month__top ty-wide">
        <h1 className="text-display" style={{ margin: 0 }} tabIndex={-1}>Reports</h1>
      </header>
      <fieldset className="ty-fieldset">
        <legend className="app-sr-only">Period</legend>
        <div className="ty-segmented">
          {CHOICES.map((n) => <label key={n}><input type="radio" name="months" checked={months === n} onChange={() => setMonths(n)} />{n} months</label>)}
        </div>
      </fieldset>
      <Load state={state}>{([r, { sections }]) => (
        <div className="ty-stack">
          <FlowCard sections={sections} />
          <SpendingCard r={r} sections={sections} />
          <CashflowCard r={r} />
          <NetWorthCard r={r} />
          <PayeesCard r={r} />
        </div>
      )}</Load>
    </>
  );
}

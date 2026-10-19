import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { api, useLoad, type Section } from '../api';
import { monthName, monthTitle, shiftMonth, currentMonth } from '../dates';
import { formatMinor } from '../money';
import { TabPanel, Tabs, useTab } from '../tabs';
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

const TABS = [{ value: 'cash-flow', label: 'Cash flow' }, { value: 'spending', label: 'Spending' }, { value: 'net-worth', label: 'Net worth' }] as const;
const CHOICES = [3, 6, 12, 24];
const H = 240;
const M = { left: 44, top: 20, bottom: 36 };
const inSlots = (slot: number) => slot >= 1 && slot <= 8;
const slotColour = (slot: number) => (inSlots(slot) ? `var(--sec-${slot})` : 'var(--ink-muted)');
const dot = (slot: number) => (inSlots(slot) ? `ty-dot ty-dot--${slot}` : 'ty-dot');
const MINUS = '−';
const pct = (part: number, whole: number) => `${((part * 100) / whole).toFixed(1)}%`;

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

/** The element's width in real pixels, following resizes; never below `min`. */
function useWidth(min: number): [(el: HTMLDivElement | null) => void, number] {
  const [el, ref] = useState<HTMLDivElement | null>(null); // state, so the observer starts when the element appears
  const [w, setW] = useState(Math.max(min, 640));
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(Math.max(el.clientWidth, min)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min]);
  return [ref, w];
}

type Tip = { x: number; title: string; rows: { label: string; value: string; colour?: string }[]; foot?: { label: string; value: string } };
type Mark = (t: Tip, label: string) => object;

function TipBox({ tip, w, style }: { tip: Tip; w: number; style?: React.CSSProperties }) {
  const left = tip.x > w / 2;
  return (
    <div className="ty-chart-tip" role="tooltip" style={{ left: tip.x, transform: `translateX(${left ? 'calc(-100% - 0.75rem)' : '0.75rem'})`, ...style }}>
      <div className="ty-chart-tip__title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.label} className="ty-chart-tip__row">
          <span className="ty-chart-tip__key" style={{ background: r.colour }} />
          <span className="ty-chart-tip__val">{r.value}</span>
          <span className="ty-cap">{r.label}</span>
        </div>
      ))}
      {tip.foot && <div className="ty-chart-tip__row ty-chart-tip__foot"><span className="ty-chart-tip__val">{tip.foot.value}</span><span className="ty-cap">{tip.foot.label}</span></div>}
    </div>
  );
}

/** Measures its width, draws the svg and the one tooltip. Every mark spreads `mark(tip, label)` for hover, focus and tap. */
function Plot({ children }: { children: (w: number, mark: Mark) => ReactNode }) {
  const [box, w] = useWidth(240);
  const [tip, setTip] = useState<Tip>();
  const hide = () => setTip(undefined);
  const mark: Mark = (t, label) => ({
    tabIndex: 0, role: 'img', 'aria-label': label,
    onPointerEnter: () => setTip(t), onFocus: () => setTip(t), onClick: () => setTip(t), onBlur: hide,
    onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') hide(); }, // a tap keeps its tooltip until the next tap
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Escape') hide(); },
  });
  return (
    <div className="ty-chart-plot" ref={box}>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} onPointerDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
        {children(w, mark)}
      </svg>
      {tip && <TipBox tip={tip} w={w} />}
    </div>
  );
}

/** Gridlines with tick labels, and the month labels along the baseline. */
function Axes({ w, months, ticks, y, band }: { w: number; months: string[]; ticks: number[]; y: (v: number) => number; band: number }) {
  const every = Math.ceil(34 / band);
  return (
    <g className="ty-chart-axis">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={w} y1={y(t)} y2={y(t)} className="ty-chart-grid" />
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

/** The 3, 6, 12, 24 months choice (Segmented). */
function Range({ value, onChange, name }: { value: number; onChange: (n: number) => void; name: string }) {
  return (
    <fieldset className="ty-fieldset">
      <legend className="app-sr-only">Months</legend>
      <div className="ty-segmented">
        {CHOICES.map((n) => <label key={n}><input type="radio" name={name} checked={value === n} onChange={() => onChange(n)} />{n}<span className="app-sr-only"> months</span></label>)}
      </div>
    </fieldset>
  );
}

function Card({ title, head, control, empty, legend, chart, table, note }: {
  title: string; head?: ReactNode; control?: ReactNode; empty: boolean; legend?: ReactNode; chart: ReactNode; table: ReactNode; note?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="ty-card ty-stack" style={{ gap: 'var(--space-4)' }} aria-label={title}>
      {head ?? <div className="ty-card__head"><h2 className="text-title">{title}</h2><span className="ty-grow" />{control}</div>}
      {empty ? <div className="ty-cap">Nothing to show yet.</div> : (
        <>
          {asTable ? <div className="ty-chart-table">{table}</div> : chart}
          {!asTable && legend}
          {note}
        </>
      )}
      {!empty && <div><button type="button" className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => setAsTable(!asTable)}>{asTable ? 'Show as chart' : 'Show as table'}</button></div>}
    </section>
  );
}

function SpendingOverTime({ sections }: { sections: Section[] }) {
  const [n, setN] = useState(12);
  const state = useLoad(() => api<Reports>('GET', `/reports?months=${n}`), [n]);
  return (
    <Load state={state}>{(r) => (
      <>
        <SpendingBars r={r} sections={sections} control={<Range value={n} onChange={setN} name="spending-months" />} />
        <PayeesCard r={r} />
      </>
    )}</Load>
  );
}

function SpendingBars({ r, sections, control }: { r: Reports; sections: Section[]; control: ReactNode }) {
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
      title="Spending by section over time" control={control} empty={empty}
      legend={<ul className="ty-chart-legend">{ids.map((id) => <li key={id} className="ty-cap"><span className={dot(info(id).slot)} />{info(id).name}</li>)}</ul>}
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
                  <g key={s.month} className="ty-chart-col">
                    {shown.map((b, k) => {
                      const y1 = y(acc + b.minor), y0 = y(acc);
                      acc += b.minor;
                      const h = Math.max(y0 - y1 - (k === 0 ? 0 : 2), 1); // a 2px surface gap under every segment above the first
                      return k === shown.length - 1
                        ? <path key={b.sectionId} className="ty-chart-seg" d={topRound(x, y1, bw, h)} fill={info(b.sectionId).colour} />
                        : <rect key={b.sectionId} className="ty-chart-seg" x={x} y={y1} width={bw} height={h} fill={info(b.sectionId).colour} />;
                    })}
                    {band >= 36 && s.totalMinor > 0 && <text className="ty-chart-total" x={x + bw / 2} y={y(s.totalMinor) - 6} textAnchor="middle">{compact(s.totalMinor)}</text>}
                    <rect className="ty-chart-hit" x={M.left + band * i} y={M.top} width={band} height={H - M.top - M.bottom} fill="transparent"
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
  const [n, setN] = useState(12);
  const cash = r.cashflow.slice(-n);
  const months = cash.map((c) => c.month);
  const income = cash.reduce((a, c) => a + c.incomeMinor, 0), spending = cash.reduce((a, c) => a + c.spendingMinor, 0);
  const { hi, ticks } = scale(0, Math.max(...cash.flatMap((c) => [c.incomeMinor, c.spendingMinor]), 0));
  const series = [['Income', 'incomeMinor', 5], ['Spending', 'spendingMinor', 6]] as const;
  return (
    <Card
      title="Cash flow" control={<Range value={n} onChange={setN} name="cash-months" />} empty={income === 0 && spending === 0}
      legend={<ul className="ty-chart-legend">{series.map(([name, , slot]) => <li key={name} className="ty-cap"><span className={dot(slot)} />{name}</li>)}</ul>}
      chart={
        <Plot>{(w, mark) => {
          const band = (w - M.left) / months.length, bw = Math.min(24, band * 0.3);
          const plotH = H - M.top - M.bottom, y = (v: number) => M.top + plotH * (1 - v / hi);
          return (
            <>
              <Axes w={w} months={months} ticks={ticks} y={y} band={band} />
              {cash.map((c, i) => (
                <g key={c.month}>
                  {series.map(([name, key, slot], k) => {
                    const v = c[key], x = M.left + band * (i + 0.5) + (k === 0 ? -bw - 1 : 1), h = y(0) - y(v);
                    const tip: Tip = { x: x + bw / 2, title: monthTitle(c.month), rows: [{ label: name, value: formatMinor(v), colour: slotColour(slot) }] };
                    return (
                      <g key={name} className="ty-chart-col">
                        {v > 0 && <path className="ty-chart-seg" d={topRound(x, y(v), bw, h)} fill={slotColour(slot)} />}
                        <rect className="ty-chart-hit" x={x - 1} y={M.top} width={bw + 2} height={H - M.top - M.bottom} fill="transparent" {...mark(tip, `${tip.title}, ${name} ${tip.rows[0].value}`)} />
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
          <tbody>{cash.map((c) => <tr key={c.month}><td>{monthTitle(c.month)}</td><td>{formatMinor(c.incomeMinor)}</td><td>{formatMinor(c.spendingMinor)}</td></tr>)}</tbody>
        </table>
      }
    />
  );
}

const AH = 260, AM = { left: 48, right: 20, top: 8, bottom: 28 };

/** The net worth card: figure, change since the first month, the area chart and its table. `control` sits at the right of the header. */
export function NetWorthArea({ points, currency, control, missing, name = 'Net worth' }: {
  points: { month: string; minor: number }[]; currency: string; control?: ReactNode; missing?: string[]; name?: string;
}) {
  const id = useId().replace(/\W/g, '');
  const [box, w] = useWidth(240);
  const [asTable, setAsTable] = useState(false);
  const [at, setAt] = useState<number>();
  const vals = points.map((p) => p.minor);
  const first = points[0], last = points[points.length - 1];
  const { lo, hi, ticks } = scale(Math.min(...vals), Math.max(...vals));
  const inner = w - AM.left - AM.right, n = points.length;
  const px = (i: number) => AM.left + (n === 1 ? inner / 2 : (inner * i) / (n - 1));
  const y = (v: number) => AM.top + (AH - AM.top - AM.bottom) * (1 - (v - lo) / (hi - lo));
  const base = AH - AM.bottom;
  const every = Math.max(1, Math.ceil(70 / (n === 1 ? inner : inner / (n - 1))));
  const change = last.minor - first.minor;
  const empty = vals.every((v) => v === 0);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${px(i)},${y(p.minor)}`).join('');
  const day = (m: string) => `${monthName(m).slice(0, 3)} ${m.slice(2, 4)}`;
  const tipAt = at === undefined ? undefined : { x: px(at), title: monthTitle(points[at].month), rows: [{ label: 'Net worth', value: formatMinor(points[at].minor), colour: 'var(--sec-7)' }] };
  return (
    <section className="ty-card ty-stack" style={{ gap: 'var(--space-4)' }} aria-label={name}>
      <div className="ty-card__head">
        <div className="ty-areahead">
          <h2 className="ty-label">Net worth</h2>
          <span className="num-hero">{formatMinor(last.minor)}<span className="ty-cur">{currency}</span></span>
          {!empty && n > 1 && (
            <span className={change < 0 ? 'ty-delta ty-delta--neg' : 'ty-delta'}>
              {change < 0 ? '↓' : '↑'} {formatMinor(Math.abs(change))}{first.minor !== 0 && ` (${pct(Math.abs(change), Math.abs(first.minor))})`} <span>since {monthName(first.month)}</span>
            </span>
          )}
        </div>
        <span className="ty-grow" />
        {control}
      </div>
      {empty ? <div className="ty-cap">Nothing to show yet.</div> : asTable ? (
        <div className="ty-chart-table">
          <table className="ty-table">
            <thead><tr><th>Month</th><th>Net worth</th></tr></thead>
            <tbody>{points.map((p) => <tr key={p.month}><td>{monthTitle(p.month)}</td><td>{formatMinor(p.minor)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="ty-chart-plot" ref={box}>
          <svg width={w} height={AH} viewBox={`0 0 ${w} ${AH}`} onPointerDown={(e) => { if (e.target === e.currentTarget) setAt(undefined); }}>
            <defs>
              <linearGradient id={`nw${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" className="ty-area-stop" stopOpacity="0.25" /><stop offset="1" className="ty-area-stop" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g className="ty-chart-axis">
              {ticks.map((t) => (
                <g key={t}>
                  <line className="ty-chart-grid" x1={AM.left} x2={w - AM.right} y1={y(t)} y2={y(t)} />
                  <text x={AM.left - 8} y={y(t) + 4} textAnchor="end">{compact(t)}</text>
                </g>
              ))}
              {points.map((p, i) => (n - 1 - i) % every === 0 && <text key={p.month} x={px(i)} y={AH - 6} textAnchor="middle">{day(p.month)}</text>)}
            </g>
            <path d={`${line}L${px(n - 1)},${base}L${px(0)},${base}Z`} fill={`url(#nw${id})`} />
            <path className="ty-area-line" d={line} />
            {at !== undefined && <><line className="ty-area-cross" x1={px(at)} x2={px(at)} y1={AM.top} y2={base} /><circle className="ty-area-dot" cx={px(at)} cy={y(points[at].minor)} r={5} /></>}
            {points.map((p, i) => {
              const bw = n === 1 ? inner : inner / (n - 1);
              return (
                <rect key={p.month} className="ty-chart-hit" x={px(i) - bw / 2} y={AM.top} width={bw} height={base - AM.top} fill="transparent" tabIndex={0} role="img"
                  aria-label={`${monthTitle(p.month)}: ${formatMinor(p.minor)}`}
                  onPointerEnter={() => setAt(i)} onFocus={() => setAt(i)} onClick={() => setAt(i)} onBlur={() => setAt(undefined)}
                  onPointerLeave={(e) => { if (e.pointerType === 'mouse') setAt(undefined); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') setAt(undefined); }} />
              );
            })}
          </svg>
          {tipAt && <TipBox tip={tipAt} w={w} />}
        </div>
      )}
      {missing && missing.length > 0 && <div className="ty-cap">No exchange rate for {missing.join(', ')} for some months; those months leave it out.</div>}
      {!empty && <div><button type="button" className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => setAsTable(!asTable)}>{asTable ? 'Show as chart' : 'Show as table'}</button></div>}
    </section>
  );
}

function NetWorthTab({ r }: { r: Reports }) {
  const [n, setN] = useState(12);
  return <NetWorthArea points={r.networth.slice(-n)} currency={r.currency} missing={r.missingRates} control={<Range value={n} onChange={setN} name="networth-months" />} />;
}

/** The ring of a month's spending by section, with its legend. A section outside the eight colours folds into Other. */
function DonutCard({ r, sections, month }: { r: Reports; sections: Section[]; month: string }) {
  const [asTable, setAsTable] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number; name: string; text: string }>();
  const row = r.spending.find((s) => s.month === month);
  const items: { name: string; slot: number; minor: number }[] = [];
  let other = 0;
  for (const b of [...(row?.bySection ?? [])].filter((x) => x.minor > 0).sort((a, c) => c.minor - a.minor)) {
    const s = sections.find((x) => x.id === b.sectionId);
    if (s && inSlots(s.colorSlot)) items.push({ name: s.name, slot: s.colorSlot, minor: b.minor }); else other += b.minor;
  }
  if (other > 0) items.push({ name: 'Other', slot: 0, minor: other });
  const total = items.reduce((a, i) => a + i.minor, 0);
  const R = 96, C = 2 * Math.PI * R;
  let acc = 0;
  const show = (e: React.PointerEvent | React.FocusEvent, name: string, text: string) => {
    const box = e.currentTarget.closest('.ty-donut')!.getBoundingClientRect();
    setTip('clientX' in e ? { x: e.clientX - box.left, y: e.clientY - box.top, name, text } : { x: box.width / 2, y: box.height / 2, name, text });
  };
  return (
    <section className="ty-card ty-stack" style={{ gap: 'var(--space-4)' }} aria-label="Spending by section">
      <div className="ty-card__head"><h2 className="text-title">Spending by section</h2></div>
      {total === 0 ? <div className="ty-cap">Nothing to show yet.</div> : asTable ? (
        <div className="ty-chart-table">
          <table className="ty-table">
            <thead><tr><th>Section</th><th>Amount</th><th>Share</th></tr></thead>
            <tbody>{items.map((i) => <tr key={i.name}><td>{i.name}</td><td>{formatMinor(i.minor)}</td><td>{pct(i.minor, total)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="ty-donutbox">
          <div className="ty-donut">
            <svg viewBox="0 0 220 220" role="group" aria-label={`Spending by section, total ${formatMinor(total)}`}>
              {items.map((i) => {
                const len = (i.minor / total) * C, off = acc;
                acc += len;
                const text = `${formatMinor(i.minor)} (${pct(i.minor, total)})`;
                const a = ((off + len / 2) / C) * 2 * Math.PI; // the arc's middle, for the focus marker
                return (
                  <g key={i.name}>
                    <circle className="ty-donut__seg" style={{ stroke: slotColour(i.slot) }} cx={110} cy={110} r={R}
                      strokeDasharray={`${Math.max(len - 2, 0.5)} ${C}`} strokeDashoffset={-off}
                      onPointerMove={(e) => show(e, i.name, text)} onPointerLeave={() => setTip(undefined)} />
                    <circle className="ty-chart-hit" cx={110 + R * Math.cos(a)} cy={110 + R * Math.sin(a)} r={10} fill="transparent" style={{ pointerEvents: 'all' }} tabIndex={0} role="img" aria-label={`${i.name} ${text}`}
                      onPointerMove={(e) => show(e, i.name, text)} onPointerLeave={() => setTip(undefined)} onFocus={(e) => show(e, i.name, text)} onBlur={() => setTip(undefined)} />
                  </g>
                );
              })}
            </svg>
            <div className="ty-donut__mid"><span className="ty-donut__total">{formatMinor(total)}</span><span className="ty-cap">Total</span></div>
            {tip && <div className="ty-chart-tip" role="tooltip" style={{ left: tip.x, top: tip.y, transform: 'translate(0.75rem, -50%)' }}><div className="ty-chart-tip__title">{tip.name}</div><div className="ty-chart-tip__val">{tip.text}</div></div>}
          </div>
          <ul className="ty-dlegend">
            {items.map((i) => <li key={i.name}><span className={dot(i.slot)} /><span>{i.name}</span><span>{formatMinor(i.minor)} ({pct(i.minor, total)})</span></li>)}
          </ul>
        </div>
      )}
      {total > 0 && <div><button type="button" className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => setAsTable(!asTable)}>{asTable ? 'Show as chart' : 'Show as table'}</button></div>}
    </section>
  );
}

type Flow = { nodes: { id: string; label: string; kind: 'source' | 'section' | 'subsection' | 'other' }[]; links: { from: string; to: string; minor: number }[] };
type FNode = { id: string; label: string; col: number; value: number; x: number; y: number; h: number; emoji?: string | null; cls: string; colour: string };

const NODE_W = 10, GAP = 8, TOP = 4, PAD = 2, MIN_FLOW = 720, SHORT = 30;

/** Sankey layout in real pixels: sources -> Income -> "Not spent" and sections (sized by what they spent) -> subsections, one scale for every node. Sorted so no band crosses. */
function layoutFlow(flow: Flow, w: number, slotOf: (id: string) => number, emojiOf: (id: string) => string | null | undefined) {
  const isSrc = (n: Flow['nodes'][number]) => n.kind === 'source' || n.id === 'carried';
  const srcs = flow.nodes.filter(isSrc);
  const srcIds = new Set(srcs.map((n) => n.id));
  const sumFrom = (id: string) => flow.links.filter((l) => l.from === id).reduce((a, l) => a + l.minor, 0);
  const income = flow.links.filter((l) => srcIds.has(l.from)).reduce((a, l) => a + l.minor, 0);
  const secs = flow.nodes.filter((n) => n.kind === 'section').map((n) => ({ n, spent: flow.links.filter((l) => l.from === n.id && l.to.startsWith('subsection-')).reduce((a, l) => a + l.minor, 0) }))
    .filter((s) => s.spent > 0).sort((a, b) => b.spent - a.spent);
  const spent = secs.reduce((a, s) => a + s.spent, 0);
  const earlier = Math.max(spent - income, 0), notSpent = Math.max(income - spent, 0);
  const total = income + earlier;
  if (total <= 0) return null;
  const sec = (id: string) => (inSlots(slotOf(id)) ? slotOf(id) : 0);
  const secCls = (slot: number) => (slot ? `ty-snode--${slot}` : '');
  const mk = (id: string, label: string, col: number, value: number, cls: string, colour: string): FNode => ({ id, label, col, value, x: 0, y: 0, h: 0, emoji: emojiOf(id), cls, colour });
  const nodes: FNode[] = [
    ...srcs.map((n) => mk(n.id, n.label, 0, sumFrom(n.id), 'ty-snode--src', 'var(--sec-7)')),
    ...(earlier > 0 ? [mk('earlier', 'Earlier money', 0, earlier, 'ty-snode--src', 'var(--sec-7)')] : []),
    mk('income', 'Income', 1, total, 'ty-snode--income', 'var(--positive)'),
    ...(notSpent > 0 ? [mk('not-spent', 'Not spent', 2, notSpent, 'ty-snode--rest', 'var(--ink-muted)')] : []),
    ...secs.map(({ n, spent: v }) => mk(n.id, n.label, 2, v, secCls(sec(n.id)), slotColour(sec(n.id)))),
  ];
  const links: { from: string; to: string; minor: number }[] = [
    ...srcs.map((n) => ({ from: n.id, to: 'income', minor: sumFrom(n.id) })),
    ...(earlier > 0 ? [{ from: 'earlier', to: 'income', minor: earlier }] : []),
    ...(notSpent > 0 ? [{ from: 'income', to: 'not-spent', minor: notSpent }] : []),
    ...secs.map(({ n, spent: v }) => ({ from: 'income', to: n.id, minor: v })),
  ];
  for (const { n } of secs) {
    for (const l of flow.links.filter((x) => x.from === n.id && x.to.startsWith('subsection-')).sort((a, b) => b.minor - a.minor)) {
      const sn = flow.nodes.find((x) => x.id === l.to)!;
      nodes.push(mk(sn.id, sn.label, 3, l.minor, secCls(sec(n.id)), slotColour(sec(n.id))));
      links.push(l);
    }
  }
  const cols = [0, 1, 2, 3].map((c) => nodes.filter((n) => n.col === c));
  let height = Math.max(480, 34 * Math.max(...cols.map((c) => c.length)));
  const k = Math.min(...cols.filter((c) => c.length).map((c) => (height - 2 * TOP - (c.length - 1) * GAP) / c.reduce((a, n) => a + n.value, 0)));
  cols.forEach((c, i) => {
    let y = TOP;
    c.forEach((n) => { n.h = Math.max(n.value * k, 3); n.x = PAD + (i * (w - 2 * PAD - NODE_W)) / 3; n.y = y; y += n.h + GAP; });
  });
  // each section's subsections sit as a block level with their section, so bands run nearly level; the chart grows if the column needs it
  const top = new Map(cols[2].map((n) => [n.id, n.y]));
  const parent = new Map(links.filter((l) => top.has(l.from) && l.from !== 'income').map((l) => [l.to, l.from]));
  let end = TOP;
  let block = '';
  for (const n of cols[3]) {
    const p = parent.get(n.id) ?? '';
    n.y = p !== block ? Math.max(top.get(p) ?? TOP, end + 2 * GAP) : end + GAP;
    if (end === TOP) n.y = Math.max(top.get(p) ?? TOP, TOP);
    block = p;
    end = n.y + n.h;
  }
  height = Math.max(height, end + TOP, ...cols.slice(0, 3).map((c) => (c.length ? c[c.length - 1].y + c[c.length - 1].h + TOP : 0)));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placed = links.map((l) => ({ ...l, a: byId.get(l.from)!, b: byId.get(l.to)!, y0: 0, y1: 0 }));
  const thick = (n: FNode, minor: number) => (minor / n.value) * n.h;
  const stack = (end: 'a' | 'b', other: 'a' | 'b', key: 'y0' | 'y1') => {
    for (const n of nodes) {
      let off = 0;
      for (const l of placed.filter((x) => x[end] === n).sort((p, q) => p[other].y - q[other].y)) { l[key] = n.y + off; off += thick(n, l.minor); }
    }
  };
  stack('a', 'b', 'y0');
  stack('b', 'a', 'y1');
  return { nodes, links: placed, height, total, thick };
}

const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right + 3 && b.left < a.right + 3 && a.top < b.bottom + 2 && b.top < a.bottom + 2;

function FlowCard({ sections, month }: { sections: Section[]; month: string }) {
  const state = useLoad(() => api<Flow>('GET', `/reports/flow?month=${month}`), [month]);
  const [box, width] = useWidth(MIN_FLOW);
  const svg = useRef<SVGSVGElement>(null);
  const labels = useRef(new Map<string, SVGGElement>());
  const [crowded, setCrowded] = useState({ key: '', ids: '' });
  const [tip, setTip] = useState<{ x: number; y: number; text: string }>();
  const [asTable, setAsTable] = useState(false);
  const uid = useId().replace(/\W/g, '');
  const secById = new Map(sections.map((s) => [s.id, s]));
  const subById = new Map(sections.flatMap((s) => s.subsections.map((x) => [x.id, x] as const)));
  const g = state.data && layoutFlow(
    state.data, width,
    (id) => secById.get(Number(id.slice(8)))?.colorSlot ?? 0,
    (id) => (id.startsWith('subsection-') ? subById.get(Number(id.slice(11)))?.emoji : null),
  );
  // A label that would overlap a bigger node's label, or leave the card, shows on hover or focus instead.
  const key = g ? `${width}|${g.nodes.map((n) => `${n.id}:${Math.round(n.y)}:${Math.round(n.h)}`).join()}` : '';
  useLayoutEffect(() => {
    if (!g || !svg.current) return;
    const fit = () => {
      const card = svg.current!.getBoundingClientRect();
      const kept: DOMRect[] = [];
      const out: string[] = [];
      for (const n of [...g.nodes].sort((p, q) => q.h - p.h)) {
        const el = labels.current.get(n.id);
        if (n.h < SHORT) continue;
        if (!el) { out.push(n.id); continue; } // already dropped by an earlier pass (fit also runs when the font loads)
        const r = el.getBoundingClientRect();
        if (r.left < card.left || r.right > card.right || kept.some((o) => overlap(o, r))) out.push(n.id); else kept.push(r);
      }
      setCrowded({ key, ids: out.sort().join() });
    };
    fit();
    void document.fonts?.ready.then(fit);
  }, [key]);
  const label = (n: FNode) => (n.emoji ? subLabel({ name: n.label, emoji: n.emoji }) : n.label);
  const head = <div className="ty-card__head"><h2 className="text-title ty-flowtitle">Where {monthName(month)}'s money went</h2></div>;
  if (!state.data) return <section className="ty-card ty-stack" aria-label="Where the money went">{head}<Load state={state}>{() => null}</Load></section>;
  if (!g) return <section className="ty-card ty-stack" aria-label="Where the money went">{head}<div className="ty-cap">Nothing to show yet.</div></section>;
  const hide = new Set(crowded.key === key ? crowded.ids.split(',').filter(Boolean) : []); // a new layout starts with every label, then drops the crowded ones before paint
  const named = new Map(g.nodes.map((n) => [n.id, label(n)]));
  return (
    <section className="ty-card ty-stack" style={{ gap: 'var(--space-4)' }} aria-label="Where the money went">
      {head}
      {asTable ? (
        <div className="ty-chart-table">
          <table className="ty-table">
            <thead><tr><th>From</th><th>To</th><th>Amount</th></tr></thead>
            <tbody>{g.links.map((l) => <tr key={`${l.from}>${l.to}`}><td>{named.get(l.from)}</td><td>{named.get(l.to)}</td><td>{formatMinor(l.minor)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="ty-flowbox" ref={box}>
          <div className="ty-chart-plot" style={{ width }}>
            <svg ref={svg} width={width} height={g.height} viewBox={`0 0 ${width} ${g.height}`} role="group" aria-label={`Where ${monthName(month)}'s money went`}
              onPointerDown={(e) => { if (e.target === e.currentTarget) setTip(undefined); }}>
              {g.links.map((l, i) => {
                const x0 = l.a.x + NODE_W, x1 = l.b.x, xm = (x0 + x1) / 2;
                const t0 = g.thick(l.a, l.minor), t1 = g.thick(l.b, l.minor);
                const d = `M${x0},${l.y0}C${xm},${l.y0} ${xm},${l.y1} ${x1},${l.y1}L${x1},${l.y1 + t1}C${xm},${l.y1 + t1} ${xm},${l.y0 + t0} ${x0},${l.y0 + t0}Z`;
                const text = `${named.get(l.from)} → ${named.get(l.to)}: ${formatMinor(l.minor)}`;
                const at = { x: xm, y: Math.max((l.y0 + l.y1 + (t0 + t1) / 2) / 2, 24), text };
                return (
                  <g key={`${l.from}>${l.to}`}>
                    <linearGradient id={`${uid}${i}`} x1="0" x2="1"><stop offset="0" style={{ stopColor: l.a.colour }} /><stop offset="1" style={{ stopColor: l.b.colour }} /></linearGradient>
                    <path className="ty-band ty-chart-hit" fill={`url(#${uid}${i})`} d={d} tabIndex={0} role="img" aria-label={text}
                      onPointerEnter={() => setTip(at)} onFocus={() => setTip(at)} onClick={() => setTip(at)} onBlur={() => setTip(undefined)}
                      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setTip(undefined); }} onKeyDown={(e) => { if (e.key === 'Escape') setTip(undefined); }} />
                  </g>
                );
              })}
              {g.nodes.map((n) => {
                const end = n.col >= 2, lx = end ? n.x - 8 : n.x + NODE_W + 8;
                // Income's label sits inside its largest outgoing band, so it does not cross a band edge
                const big = n.col === 1 ? g.links.filter((l) => l.a === n).sort((p, q) => q.minor - p.minor)[0] : undefined;
                const cy = big && g.thick(n, big.minor) >= 40 ? big.y0 + g.thick(n, big.minor) / 2 : n.y + n.h / 2;
                const amt = `${formatMinor(n.value)} (${pct(n.value, g.total)})`;
                // A short or crowded node has no label: hovering or focusing it shows the same text as a tooltip.
                const shown = n.h >= SHORT && !hide.has(n.id);
                const text = `${label(n)} ${amt}`;
                const at = { x: end ? n.x - 6 : n.x + NODE_W + 6, y: Math.max(cy, 24), text };
                return (
                  <g key={n.id} className="ty-sgroup" tabIndex={0} role="img" aria-label={text}
                    onPointerEnter={() => setTip(at)} onFocus={() => setTip(at)} onBlur={() => setTip(undefined)} onPointerLeave={() => setTip(undefined)} onKeyDown={(e) => { if (e.key === 'Escape') setTip(undefined); }}>
                    <rect className={`ty-snode ${n.cls}`} x={n.x} y={n.y} width={NODE_W} height={n.h} />
                    {shown && (
                      <g ref={(el) => { if (el) labels.current.set(n.id, el); else labels.current.delete(n.id); }}>
                        <text className={`ty-slabel__name${end ? ' ty-slabel--end' : ''}`} x={lx} y={cy - 5}>{n.emoji && <tspan className="ty-emoji">{n.emoji}</tspan>}<tspan dx={n.emoji ? 4 : 0}>{n.label}</tspan></text>
                        <text className={`ty-slabel__amt${end ? ' ty-slabel--end' : ''}`} x={lx} y={cy + 14}>{amt}</text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
            {tip && (
              <div className="ty-chart-tip" role="tooltip" style={{ left: tip.x, top: tip.y, transform: `translate(${tip.x > width / 2 ? 'calc(-100% - 0.75rem)' : '0.75rem'}, -50%)` }}>
                <div className="ty-chart-tip__val">{tip.text}</div>
              </div>
            )}
          </div>
        </div>
      )}
      <div><button type="button" className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => setAsTable(!asTable)}>{asTable ? 'Show as chart' : 'Show as table'}</button></div>
    </section>
  );
}

function PayeesCard({ r }: { r: Reports }) {
  return (
    <section className="ty-card ty-stack" style={{ gap: 'var(--space-4)' }} aria-label="Top payees">
      <div className="ty-card__head"><h2 className="text-title">Top payees</h2></div>
      {r.payees.length === 0 ? <div className="ty-cap">Nothing to show yet.</div> : (
        <div className="ty-chart-table">
          <table className="ty-table">
            <thead><tr><th>Payee</th><th>Payments</th><th>Amount</th></tr></thead>
            <tbody>{r.payees.map((p) => <tr key={p.payee}><td>{p.payee}</td><td>{p.count}</td><td>{formatMinor(p.minor)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatCards({ r, month }: { r: Reports; month: string }) {
  const c = r.cashflow.find((x) => x.month === month);
  const income = c?.incomeMinor ?? 0, spending = c?.spendingMinor ?? 0, net = income - spending;
  const cards: [string, string, string][] = [
    ['Total income', formatMinor(income), ' ty-statcard__num--pos'],
    ['Total spending', formatMinor(spending), ' ty-statcard__num--neg'],
    ['Net', formatMinor(net), ''],
    ['Savings rate', income > 0 ? pct(net, income) : '—', ''],
  ];
  return (
    <div className="ty-statcards">
      {cards.map(([name, figure, cls]) => <div key={name} className="ty-statcard"><span className={`ty-statcard__num${cls}`}>{figure}</span><span className="ty-label">{name}</span></div>)}
    </div>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useTab(TABS.map((t) => t.value));
  const now = currentMonth();
  const [month, setMonth] = useState(now);
  const state = useLoad(() => Promise.all([api<Reports>('GET', '/reports?months=24'), api<{ sections: Section[] }>('GET', '/sections')]), []);
  return (
    <>
      <Topbar
        title="Reports"
        tabs={<Tabs label="Reports" tabs={TABS} value={tab} onChange={setTab} />}
        month={tab === 'net-worth' ? undefined : { label: monthTitle(month), onPrev: () => setMonth(shiftMonth(month, -1)), onNext: () => setMonth(shiftMonth(month, 1)), nextDisabled: month >= now }}
      />
      <TabPanel tab={tab}><Load state={state}>{([r, { sections }]) => tab === 'cash-flow' ? (
        <>
          <StatCards r={r} month={month} />
          <FlowCard sections={sections} month={month} />
          <CashflowCard r={r} />
        </>
      ) : tab === 'spending' ? (
        <>
          <DonutCard r={r} sections={sections} month={month} />
          <SpendingOverTime sections={sections} />
        </>
      ) : <NetWorthTab r={r} />}</Load></TabPanel>
    </>
  );
}

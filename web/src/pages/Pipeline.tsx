import { useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useLoad, type Pipeline, type PipelineBox, type Section } from '../api';
import { baseCurrency, useAuth } from '../auth';
import { currentMonth, isMonth, monthName, monthTitle, shiftMonth } from '../dates';
import { RestDialog, SectionDialog, SourceDialog, StepDialog } from '../dialogs';
import { formatMinor, percentText } from '../money';
import { pick } from '../pick';
import { EmptyCard, Load, StatePill, Topbar } from '../ui';

const dot = (slot: number) => (slot >= 1 && slot <= 8 ? `ty-dot ty-dot--${slot}` : 'ty-dot');
const colour = (base: string, slot: number) => (slot >= 1 && slot <= 8 ? `${base} ${base}--${slot}` : base);

type Dialog =
  | { t: 'source'; source?: { id: number; name: string; boxId: number; isLeftovers: boolean } }
  | { t: 'rest'; id: number }
  | { t: 'step'; box: PipelineBox; step?: PipelineBox['steps'][number] }
  | { t: 'section'; id?: number };

type Wire = { key: string; slot: number; next: boolean; x1: number; y1: number; x2: number; y2: number };

/** Measures the rendered rows (`data-from`) and section heads (`data-to`) and returns one wire per row. */
function useWires(deps: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [wires, setWires] = useState<{ w: Wire[] }>({ w: [] });
  useLayoutEffect(() => {
    const pipe = ref.current;
    if (!pipe) return;
    const measure = () => {
      const o = pipe.getBoundingClientRect();
      const heads = new Map<string, DOMRect>();
      pipe.querySelectorAll<HTMLElement>('[data-to]').forEach((el) => heads.set(el.dataset.to!, el.getBoundingClientRect()));
      const w: Wire[] = [];
      pipe.querySelectorAll<HTMLElement>('[data-from]').forEach((el, i) => {
        const to = heads.get(el.dataset.from!);
        if (!to) return;
        const r = el.getBoundingClientRect();
        w.push({ key: String(i), slot: Number(el.dataset.slot), next: el.dataset.next !== undefined, x1: r.right - o.left, y1: r.top + r.height / 2 - o.top, x2: to.left - o.left, y2: to.top + to.height / 2 - o.top });
      });
      const next = { w };
      setWires((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pipe);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [deps]);
  return { ref, ...wires };
}

function Wires({ w }: { w: Wire[] }) {
  return (
    <svg className="ty-pipe__wires" aria-hidden="true" focusable="false">
      {w.map((x) => {
        const mid = (x.x1 + x.x2) / 2;
        return (
          <g key={x.key}>
            <path className={`${colour('ty-wire', x.slot)}${x.next ? ' ty-wire--next' : ''}`} d={`M${x.x1} ${x.y1} C${mid} ${x.y1}, ${mid} ${x.y2}, ${x.x2} ${x.y2}`} />
            <circle className={colour('ty-port', x.slot)} cx={x.x1} cy={x.y1} r={4} />
            <circle className={colour('ty-port', x.slot)} cx={x.x2} cy={x.y2} r={4} />
          </g>
        );
      })}
    </svg>
  );
}

function Box({ box, sections, closed, from, onSource, onStep }: {
  box: PipelineBox; sections: Pipeline['sections']; closed: boolean; from: string; onSource: (s: PipelineBox['sources'][number]) => void; onStep: (s?: PipelineBox['steps'][number]) => void;
}) {
  const section = (id: number) => sections.find((s) => s.id === id);
  const multi = box.sources.length > 1;
  const old = !multi && box.sources[0]?.isLeftovers;
  const wireLeft = box.leftOverMinor > 0;
  const left = (minor: number, last: boolean) => (
    <div className="ty-pipe__left" {...(last && wireLeft ? { 'data-from': 'left', 'data-slot': 0 } : {})}>{formatMinor(minor)} left</div>
  );
  const row = (sectionId: number, n: string, rule: string, taken: number) => {
    const s = section(sectionId);
    return (
      <div className="ty-step" key={`${n}${sectionId}`} data-from={`s${sectionId}`} data-slot={s?.colorSlot ?? 0}>
        <span className="ty-step__n">{n}</span><span className="ty-step__rule">{rule}</span>
        <span className="ty-tag"><span className={dot(s?.colorSlot ?? 0)} />{s?.name}</span>
        <span className="ty-num">{formatMinor(taken)}</span>
      </div>
    );
  };
  return (
    <article className={old ? 'ty-node ty-node--old' : 'ty-node'} aria-label={box.sources.map((s) => s.name).join(' and ')}>
      {box.sources.map((s) => (
        <div className={multi ? 'ty-node__src' : 'ty-node__head'} key={s.id}>
          {old ? <span className="ty-node__title"><b>{s.name}</b><span className="ty-cap">From {from}</span></span> : <b>{s.name}</b>}
          {!closed && <button className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => onSource(s)}>Edit</button>}
          <span className="ty-grow" /><span className="ty-num">{formatMinor(s.incomeMinor)}</span>
        </div>
      ))}
      {multi && (
        <div className="ty-node__head ty-node__head--sum"><span className="ty-label">Together</span><span className="ty-grow" /><span className="ty-num">{formatMinor(box.incomeMinor)}</span></div>
      )}
      {box.steps.length === 0 && (<>
        <div className="ty-step ty-step--empty"><span className="ty-cap">No steps yet. All of it is left over.</span></div>
        {left(box.incomeMinor, true)}
      </>)}
      {box.steps.map((st, i) => {
        const rows = st.kind === 'amount'
          ? [row(st.sectionId, String(st.position), formatMinor(st.amountMinor), st.takenMinor)]
          : st.shares.map((x, j) => row(x.sectionId, j === 0 ? String(st.position) : '', `${percentText(x.basisPoints)}%`, x.takenMinor));
        const name = st.kind === 'amount'
          ? `${formatMinor(st.amountMinor)} to ${section(st.sectionId)?.name}`
          : st.shares.map((x) => `${percentText(x.basisPoints)}% to ${section(x.sectionId)?.name}`).join(', ');
        return (
          <div key={st.id}>
            <div className={closed ? undefined : 'ty-pipe__step'} {...(closed ? {} : { 'aria-label': `Step ${st.position}: ${name}`, ...pick(() => onStep(st)) })}>{rows}</div>
            {left(st.leftMinor, i === box.steps.length - 1)}
          </div>
        );
      })}
      {!closed && <div className="ty-node__foot"><button className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => onStep()}>Add step</button></div>}
    </article>
  );
}

/** One section's rest rows: the shares of its rule, as one selectable group (not selectable on a closed month or for Left over). */
function RestRows({ name, shares, sections, next, onOpen }: {
  name: string; shares: { sectionId: number | null; basisPoints: number }[]; sections: Pipeline['sections']; next: string; onOpen?: () => void;
}) {
  const target = (id: number | null) => sections.find((x) => x.id === id);
  const label = (id: number | null) => (id === null ? "next month's income" : target(id)?.name);
  const spoken = shares.map((x) => `${shares.length === 1 && x.basisPoints === 10000 ? 'all' : `${percentText(x.basisPoints)}%`} to ${label(x.sectionId)}`).join(', ');
  return (
    <div className={onOpen ? 'ty-pipe__step' : undefined} {...(onOpen ? { 'aria-label': `Rest of ${name}: ${spoken}`, ...pick(onOpen) } : {})}>
      {shares.map((x, i) => {
        const t = target(x.sectionId);
        return (
          <div className="ty-step ty-step--rest" key={i} data-from={t ? `n${t.id}` : 'n-income'} data-next data-slot={t?.colorSlot ?? 0}>
            <span className="ty-label">{i === 0 ? 'Rest' : ''}</span>
            <span className="ty-step__rule">{x.basisPoints === 10000 ? 'All' : `${percentText(x.basisPoints)}%`}</span>
            <span className="ty-tag">{t && <span className={dot(t.colorSlot)} />}{t ? `${t.name}, ${next}` : `Income, ${next}`}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function PipelinePage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const now = currentMonth();
  const asked = params.get('month');
  const month = isMonth(asked) ? asked : now;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  const go = (m: string) => setParams(m === now ? {} : { month: m });

  const state = useLoad(
    async () => {
      const [pipeline, s] = await Promise.all([api<Pipeline>('GET', `/pipeline?month=${month}`), api<{ sections: Section[] }>('GET', '/sections')]);
      return { pipeline, sections: s.sections };
    },
    [month],
  );
  const wires = useWires(state.data);
  const next = monthName(shiftMonth(month, 1));
  const from = monthName(shiftMonth(month, -1));

  return (
    <>
      <Topbar
        title="Pipeline"
        month={{ label: monthTitle(month), onPrev: () => go(shiftMonth(month, -1)), onNext: () => go(shiftMonth(month, 1)), nextDisabled: month >= now }}
        actions={state.data && (<span className="ty-wide" style={{ display: 'contents' }}>
          <StatePill closed={state.data.pipeline.closed} />
          {!state.data.pipeline.closed && (<>
            <button className="ty-btn" onClick={() => setDialog({ t: 'section' })}>Add section</button>
            <button className="ty-btn ty-btn--primary" onClick={() => setDialog({ t: 'source' })}>Add income source</button>
          </>)}
        </span>)}
      />
      <div className="app-phone-card ty-card">The pipeline needs a wider screen for now.</div>
      <div className="ty-wide app-pipe-wrap">
        <Load state={state}>
          {({ pipeline: p }) => p.boxes.length === 0 ? (
            <EmptyCard text="No income sources yet. A source is where money comes from, such as a paycheck." action="Add income source" onAction={() => setDialog({ t: 'source' })} />
          ) : (
            <div className="ty-pipe-frame">
              <div className="ty-pipe ty-pipe--next" ref={wires.ref}>
                <div className="ty-pipe__col">
                  <div className="ty-label">Income</div>
                  <div className="ty-pipe__stack">
                    {p.boxes.map((b) => (
                      <Box key={b.id} box={b} sections={p.sections} closed={p.closed} from={from}
                        onSource={(s) => setDialog({ t: 'source', source: { id: s.id, name: s.name, boxId: b.id, isLeftovers: s.isLeftovers } })}
                        onStep={(step) => setDialog({ t: 'step', box: b, step })} />
                    ))}
                    {p.sections.filter((s) => s.carriedMinor !== 0).map((s) => (
                      <article className="ty-node ty-node--next" key={s.id} aria-label={`Rest of ${s.name} from ${from}`} data-from={`s${s.id}`} data-next data-slot={s.colorSlot}>
                        <div className="ty-node__line"><span className={dot(s.colorSlot)} /><b>Rest of {s.name}</b><span className="ty-grow" /><span className="ty-num">{formatMinor(s.carriedMinor)}</span></div>
                        <div className="ty-cap">From {from}</div>
                      </article>
                    ))}
                  </div>
                </div>
                <div className="ty-pipe__col">
                  <div className="ty-label">Sections</div>
                  <div className="ty-pipe__stack ty-pipe__stack--sections">
                    {p.sections.map((s) => (
                      <article className="ty-node" key={s.id} aria-label={s.name}>
                        <div className="ty-node__head" data-to={`s${s.id}`}>
                          <span className={dot(s.colorSlot)} /><b>{s.name}</b>
                          {!p.closed && <button className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => setDialog({ t: 'section', id: s.id })}>Edit</button>}
                          <span className="ty-grow" /><span className="ty-num">{formatMinor(s.receivedMinor)}</span>
                        </div>
                        <RestRows name={s.name} shares={s.rest.shares} sections={p.sections} next={next} onOpen={p.closed ? undefined : () => setDialog({ t: 'rest', id: s.id })} />
                      </article>
                    ))}
                    <article className="ty-node" aria-label="Left over">
                      <div className="ty-node__head" data-to="left">
                        <span className="ty-dot" /><b>Left over</b><span className="ty-grow" /><span className="ty-num">{formatMinor(p.leftOverMinor)}</span>
                      </div>
                      <RestRows name="Left over" shares={[{ sectionId: null, basisPoints: 10000 }]} sections={p.sections} next={next} />
                    </article>
                  </div>
                </div>
                <div className="ty-pipe__col">
                  <div className="ty-label">{next}</div>
                  <div className="ty-pipe__stack">
                    {p.sections.filter((s) => p.sections.some((o) => o.rest.shares.some((x) => x.sectionId === s.id))).map((s) => (
                      <article className="ty-node ty-node--next" key={s.id} aria-label={`${s.name}, ${next}`} data-to={`n${s.id}`}>
                        <div className="ty-node__line"><span className={dot(s.colorSlot)} /><b>{s.name}</b></div>
                        <div className="ty-cap">Arrives as extra</div>
                      </article>
                    ))}
                    <article className="ty-node ty-node--next" aria-label={`Last month's leftovers, ${next}`} data-to="n-income">
                      <div className="ty-node__line"><b>Last month's leftovers</b></div>
                      <div className="ty-cap">Arrives as income</div>
                    </article>
                  </div>
                </div>
                <Wires w={wires.w} />
              </div>
            </div>
          )}
        </Load>
      </div>
      {dialog?.t === 'source' && <SourceDialog source={dialog.source} boxes={state.data?.pipeline.boxes ?? []} onClose={close} />}
      {dialog?.t === 'step' && state.data && (
        <StepDialog box={dialog.box} step={dialog.step} sections={state.data.pipeline.sections} currency={baseCurrency(user)} onClose={close} />
      )}
      {dialog?.t === 'rest' && state.data && (
        <RestDialog section={state.data.pipeline.sections.find((x) => x.id === dialog.id)!} sections={state.data.pipeline.sections} onClose={close} />
      )}
      {dialog?.t === 'section' && <SectionDialog section={state.data?.sections.find((s) => s.id === dialog.id)} onClose={close} />}
    </>
  );
}

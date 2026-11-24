import { Alert, Button, Input, InputRef, Radio, Select, Spin } from 'antd';
import { useRef } from 'react';
import {
  drawnRun,
  type ExpectedDraw,
  expectedColors,
  formatError,
  formatMz,
  insertAt,
  orderVerdict,
  precursorMiss,
  sequencePositions,
  stretchVerdict,
} from './annotateFormat';
import { useErrorUnit } from './annotateUnit';
import {
  ExpectedResult,
  OrderControl,
  PeakPair,
  Topology,
} from './annotateTypes';

type InputProps = {
  sequence: string;
  topology: Topology;
  onSequenceChange: (value: string) => void;
  modified: { label: string; mass: number }[];
  onTopologyChange: (value: Topology) => void;
  onSearch: () => void;
  onClear: () => void;
  searched: boolean;
  remote: {
    data: ExpectedResult | null;
    error: string | null;
    loading: boolean;
  };
  peaks: PeakPair[];
  precursorIndex: number;
  onPick: (nodes: number[]) => void;
  onHover: (nodes: number[]) => void;
  onPlot: ExpectedDraw;
  onPlotChange: (value: ExpectedDraw) => void;
  hiddenRuns: Set<number>;
  onToggleRun: (n: number) => void;
};

// a whole molecule only: the peaks at the mass of a piece of it, which test its order
function WholePieces({
  result,
  control,
  onPick,
  onHover,
}: {
  result: ExpectedResult;
  control: OrderControl;
  onPick: (nodes: number[]) => void;
  onHover: (nodes: number[]) => void;
}) {
  const unit = useErrorUnit();
  return (
    <>
      <h4>Pieces of your sequence</h4>
      <p>
        <b>
          {result.fragments_seen} of {result.n_fragment_masses}
        </b>{' '}
        piece masses have a peak. {orderVerdict(control)}
      </p>
      {control.better.length > 0 && (
        <p className="annotate-hint">
          Better orders:{' '}
          {control.better
            .map((b) => `${b.order.join('-')} (${b.score})`)
            .join('; ')}
        </p>
      )}
      {result.fragments.length > 0 && (
        <>
          <div className="annotate-table-wrap">
            <table className="annotate-table">
              <thead>
                <tr>
                  <th>m/z</th>
                  <th>Piece</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {result.fragments.map((f) => (
                  <tr
                    key={f.peak}
                    onMouseEnter={() => onHover([f.peak])}
                    onMouseLeave={() => onHover([])}
                  >
                    <td>{formatMz(f.mz)}</td>
                    <td>
                      {f.fits.map((fit, n) => (
                        <div key={n}>
                          {fit.ion !== 'b' ? <b>{fit.ion} </b> : null}
                          {fit.labels.join('-')}{' '}
                          <span className="annotate-hint">
                            ({sequencePositions(fit.positions)})
                          </span>
                        </div>
                      ))}
                    </td>
                    <td>{formatError(f.fits[0], unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            size="small"
            onClick={() => onPick(result.fragments.map((f) => f.peak))}
          >
            Pick these peaks
          </Button>
        </>
      )}
    </>
  );
}

function Result({
  result,
  peaks,
  precursorIndex,
  onPick,
  onHover,
  onPlot,
  onPlotChange,
  hiddenRuns,
  onToggleRun,
}: {
  result: ExpectedResult;
  peaks: PeakPair[];
  precursorIndex: number;
  onPick: (nodes: number[]) => void;
  onHover: (nodes: number[]) => void;
  onPlot: ExpectedDraw;
  onPlotChange: (value: ExpectedDraw) => void;
  hiddenRuns: Set<number>;
  onToggleRun: (n: number) => void;
}) {
  const unit = useErrorUnit();
  const fc = result.control.fragments;
  const rc = result.control.runs;
  const whole = fc !== null;
  const mzOf = (i: number) =>
    i === precursorIndex ? 'precursor' : formatMz(peaks[i][0]);
  const pre = result.precursor;
  return (
    <>
      <div className="annotate-known-residues">
        {result.sequence.map((r, n) => (
          <span key={n} className="annotate-known-residue" title={`${r.mass}`}>
            <sup>{n + 1}</sup> {r.label}
          </span>
        ))}
      </div>
      <p className="annotate-hint">
        {result.neutral_mass === null
          ? `${result.residue_sum.toFixed(4)} Da${
              result.rest_of_molecule === null
                ? ''
                : result.rest_of_molecule > 0
                  ? `; ${result.rest_of_molecule.toFixed(4)} Da left for the rest of the molecule`
                  : '; heavier than the whole molecule'
            }`
          : `Whole, ${result.topology}: M ${result.neutral_mass.toFixed(4)}, [M+H]+ ${(
              result.neutral_mass + 1.00727646
            ).toFixed(4)}`}
        . Limit {result.limit}.
      </p>
      {whole && pre && (
        <Alert
          type={pre.within ? 'success' : 'warning'}
          showIcon
          title={
            pre.within
              ? `Precursor fits (${formatError(pre, unit)}).`
              : `Precursor is ${precursorMiss(pre, unit)} off${
                  pre.hint ? `: ${pre.hint}` : '.'
                }`
          }
        />
      )}
      {whole && !pre && (
        <p className="annotate-hint">No precursor: mass not checked.</p>
      )}

      {fc && (
        <WholePieces
          result={result}
          control={fc}
          onPick={onPick}
          onHover={onHover}
        />
      )}

      <h4>Where the steps spell it</h4>
      <p>
        {whole
          ? `Longest: ${result.longest} of ${result.n_residues} residues. ${rc.as_high} of ${rc.n_orders} other orders as long.`
          : stretchVerdict(
              result.n_full,
              result.longest,
              result.n_residues,
              rc,
            )}
      </p>
      {!whole && rc.better.length > 0 && (
        <p className="annotate-hint">
          Spelled further:{' '}
          {rc.better.map((b) => `${b.order.join('-')} (${b.score})`).join('; ')}
        </p>
      )}
      {result.runs.length === 0 && (
        <p className="annotate-hint">No chain of two steps or more.</p>
      )}
      {result.runs.length > 0 && (
        <div className="annotate-expected-form">
          <span>Draw:</span>
          <Radio.Group
            value={onPlot}
            optionType="button"
            size="small"
            onChange={(e) => onPlotChange(e.target.value as ExpectedDraw)}
            options={[
              {
                label: `${
                  !whole && result.runs[0].residues === result.n_residues
                    ? 'Whole stretch'
                    : 'Longest'
                } (${result.runs.filter((r) => drawnRun(r, result.runs, 'longest')).length})`,
                value: 'longest',
              },
              { label: `All (${result.runs.length})`, value: 'all' },
              { label: 'None', value: 'none' },
            ]}
          />
        </div>
      )}
      {result.runs.length > 0 && (
        <ul className="annotate-saved annotate-expected-runs">
          {result.runs.map((run, n) => (
            <li
              key={n}
              onMouseEnter={() => onHover(run.nodes)}
              onMouseLeave={() => onHover([])}
            >
              <i
                style={{
                  background: expectedColors[n % expectedColors.length],
                  opacity:
                    drawnRun(run, result.runs, onPlot) && !hiddenRuns.has(n)
                      ? 1
                      : 0.25,
                }}
              />
              <span>
                <b>S{n + 1}</b> {run.labels.join('-')}{' '}
                <span className="annotate-hint">
                  ({run.direction === 'forward' ? 'up' : 'down'}
                  {run.jumps > 0 ? `, ${run.jumps} jump` : ''}
                  {run.to_precursor ? ', to precursor' : ''}){' '}
                  {run.nodes.map(mzOf).join(' → ')}
                </span>
              </span>
              {drawnRun(run, result.runs, onPlot) && (
                <Button size="small" onClick={() => onToggleRun(n)}>
                  {hiddenRuns.has(n) ? 'Show' : 'Hide'}
                </Button>
              )}
              <Button size="small" onClick={() => onPick(run.nodes)}>
                Pick
              </Button>
            </li>
          ))}
        </ul>
      )}
      {result.n_runs > result.runs.length && (
        <p className="annotate-hint">
          The {result.runs.length} longest of {result.n_runs} shown.
        </p>
      )}
    </>
  );
}

function AnnotateExpected({
  sequence,
  topology,
  onSequenceChange,
  modified,
  onTopologyChange,
  onSearch,
  onClear,
  searched,
  remote,
  peaks,
  precursorIndex,
  onPick,
  onHover,
  onPlot,
  onPlotChange,
  hiddenRuns,
  onToggleRun,
}: InputProps) {
  const input = useRef<InputRef>(null);
  // where the cursor was when the box was left, so a picked modification lands there
  const cursor = useRef<number | null>(null);
  return (
    <section className="annotate-card">
      <h3>Expected sequence (optional)</h3>
      <p className="annotate-hint">
        GVPV or Gly Val Pro. Modifications in brackets: S[phospho] or
        S[-18.0106].
      </p>
      <div className="annotate-expected-form">
        <Input
          ref={input}
          value={sequence}
          placeholder="e.g. GVPV, or Gly Val Pro Val"
          onChange={(e) => onSequenceChange(e.target.value)}
          onBlur={(e) => (cursor.current = e.target.selectionStart)}
          onPressEnter={() => sequence.trim() && onSearch()}
          allowClear
        />
        <Select
          aria-label="Add a modified residue"
          className="annotate-expected-mod"
          size="small"
          showSearch
          popupMatchSelectWidth={false}
          placeholder="Add a modified residue"
          value={null}
          options={modified.map((r) => ({
            value: r.label,
            label: `${r.label} (${r.mass.toFixed(4)})`,
          }))}
          optionFilterProp="label"
          onChange={(label: string) => {
            const at = cursor.current ?? sequence.length;
            onSequenceChange(insertAt(sequence, at, label));
            cursor.current = null;
            input.current?.focus();
          }}
        />
        <Radio.Group
          value={topology}
          optionType="button"
          size="small"
          onChange={(e) => onTopologyChange(e.target.value as Topology)}
          options={[
            { label: 'Part of the molecule', value: 'stretch' },
            { label: 'Whole, linear', value: 'linear' },
            { label: 'Whole, cyclic', value: 'cyclic' },
          ]}
        />
        <Button
          type="primary"
          size="small"
          disabled={!sequence.trim()}
          onClick={onSearch}
        >
          Search
        </Button>
        {searched && (
          <Button size="small" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
      {searched && remote.loading && <Spin size="small" />}
      {searched && remote.error && (
        <Alert type="error" title={remote.error} showIcon />
      )}
      {searched && remote.data && (
        <Result
          result={remote.data}
          peaks={peaks}
          precursorIndex={precursorIndex}
          onPick={onPick}
          onHover={onHover}
          onPlot={onPlot}
          onPlotChange={onPlotChange}
          hiddenRuns={hiddenRuns}
          onToggleRun={onToggleRun}
        />
      )}
    </section>
  );
}

export default AnnotateExpected;

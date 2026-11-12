import { Alert, Button, Spin } from 'antd';
import { ReactNode } from 'react';
import {
  Candidate,
  ChainPath,
  ConnectResult,
  GapResult,
  Neighbour,
  PeakPair,
  PrecursorGaps,
  SavedChain,
  SelectionStep,
} from './annotateTypes';
import { formatError, formatMz, savedSummary } from './annotateFormat';
import { useErrorUnit } from './annotateUnit';

type Remote<T> = { data: T | null; loading: boolean; error: string | null };

function Status<T>({
  remote,
  children,
}: {
  remote: Remote<T>;
  children: (data: T) => ReactNode;
}) {
  if (remote.error) {
    return <Alert type="error" title={remote.error} showIcon />;
  }
  if (remote.data === null) {
    return <Spin size="small" />;
  }
  return <>{children(remote.data)}</>;
}

function ErrorText({ candidate }: { candidate: Candidate }) {
  return <>{formatError(candidate, useErrorUnit())}</>;
}

function Errors({ candidates }: { candidates: Candidate[] }) {
  return (
    <>
      {candidates.map((c) => (
        <span className="annotate-residue" key={c.label}>
          <b>{c.label}</b>
          <small>
            <ErrorText candidate={c} />
          </small>
        </span>
      ))}
    </>
  );
}

function NeighbourPanel({
  peaks,
  anchor,
  remote,
  picks,
  widen,
  onTogglePeak,
}: {
  peaks: PeakPair[];
  anchor: number;
  remote: Remote<Neighbour[]>;
  picks: number[];
  widen: string;
  onTogglePeak: (peak: number) => void;
}) {
  return (
    <section className="annotate-card">
      <h3>One residue from m/z {formatMz(peaks[anchor][0])}</h3>
      <Status remote={remote}>
        {(neighbours) =>
          neighbours.length === 0 ? (
            <p className="annotate-empty">
              No peak in this spectrum sits one residue from here. The next
              fragment may not have been observed, the peak may be noise or
              belong to another ion series, or the residue may be modified:{' '}
              {widen}.
            </p>
          ) : (
            <>
              <p className="annotate-hint">
                Closest fit first. A mass match can happen by accident, so these
                are options to check, not assignments.
              </p>
              <div className="annotate-table-wrap">
                <table className="annotate-table">
                  <thead>
                    <tr>
                      <th>Peak (m/z)</th>
                      <th>Direction</th>
                      <th>Residue and error</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {neighbours.map((n) => (
                      <tr key={n.peak}>
                        <td>{formatMz(n.mz)}</td>
                        <td>{n.direction === 'up' ? 'above' : 'below'}</td>
                        <td>
                          <Errors candidates={n.candidates} />
                        </td>
                        <td>
                          <Button
                            size="small"
                            disabled={picks.includes(n.peak)}
                            onClick={() => onTogglePeak(n.peak)}
                          >
                            Add
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        }
      </Status>
    </section>
  );
}

function SavedPanel({
  chains,
  peaks,
  onLoad,
  onDelete,
  gapMass,
}: {
  chains: SavedChain[];
  peaks: PeakPair[];
  onLoad: (chain: SavedChain) => void;
  onDelete: (id: number) => void;
  gapMass: boolean;
}) {
  return (
    <section className="annotate-card">
      <h3>Saved chains</h3>
      <ul className="annotate-saved">
        {chains.map((chain) => (
          <li key={chain.id}>
            <i style={{ background: chain.color }} />
            <span>
              <b>Chain {chain.id}</b>, {chain.charge}+, {chain.picks.length}{' '}
              peaks: {savedSummary(chain, gapMass)} (m/z{' '}
              {peaks[Math.min(...chain.picks)][0].toFixed(2)} to{' '}
              {peaks[Math.max(...chain.picks)][0].toFixed(2)})
              {chain.tolerance
                ? `, error limit ${chain.tolerance.value} ${chain.tolerance.unit}`
                : ''}
            </span>
            <Button size="small" onClick={() => onLoad(chain)}>
              Load
            </Button>
            <Button size="small" onClick={() => onDelete(chain.id)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PrecursorPanel({
  peaks,
  remote,
  picks,
  widen,
  onTogglePeak,
}: {
  peaks: PeakPair[];
  remote: Remote<PrecursorGaps>;
  picks: number[];
  widen: string;
  onTogglePeak: (peak: number) => void;
}) {
  return (
    <section className="annotate-card">
      <h3>One residue from the precursor</h3>
      <Status remote={remote}>
        {(result) => (
          <>
            <p className="annotate-hint">
              Measured to [M+H]+ {formatMz(result.precursor.mh1)}
              {result.precursor.charge > 1 &&
                `, the 1+ equivalent of this ${result.precursor.charge}+ precursor`}
              . Cyclic and linear molecules give different distances, about a
              water apart, and nothing here decides which applies, so both
              readings are shown.
            </p>
            {result.matches.length === 0 ? (
              <p className="annotate-empty">
                No peak in this spectrum sits one residue from the precursor
                under either reading. The fragment that would show it may not
                have been observed, or the residue may be modified: {widen}.
              </p>
            ) : (
              <div className="annotate-table-wrap">
                <table className="annotate-table">
                  <thead>
                    <tr>
                      <th>Peak (m/z)</th>
                      <th>Reading</th>
                      <th>Distance (Da)</th>
                      <th>Residue and error</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {result.matches.flatMap((match) =>
                      match.hypotheses.map((reading) => (
                        <tr key={match.peak + reading.hypothesis}>
                          <td>{formatMz(peaks[match.peak][0])}</td>
                          <td title={reading.why}>{reading.hypothesis}</td>
                          <td>{reading.distance.toFixed(4)}</td>
                          <td>
                            <Errors candidates={reading.candidates} />
                          </td>
                          <td>
                            <Button
                              size="small"
                              disabled={picks.includes(match.peak)}
                              onClick={() => onTogglePeak(match.peak)}
                            >
                              Add
                            </Button>
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Status>
    </section>
  );
}

function SingleGap({ gap, widen }: { gap: GapResult; widen: string }) {
  if (gap.candidates.length === 0) {
    return (
      <p className="annotate-empty">
        These peaks are {gap.gap.toFixed(4)} Da apart, which is not one residue
        in this alphabet ({gap.tol.toFixed(4)} Da allowed). That is an answer:
        the gap may span several residues, shown below if the peaks between them
        exist, the two peaks may belong to different ion series, or a modified
        residue may sit here: {widen}.
      </p>
    );
  }
  return (
    <>
      <p className="annotate-hint">
        Gap {gap.gap.toFixed(4)} Da, {gap.tol.toFixed(4)} Da allowed. Nearest
        fit first; the choice is yours.
      </p>
      <div className="annotate-table-wrap">
        <table className="annotate-table">
          <thead>
            <tr>
              <th>Residue</th>
              <th>Residue mass</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {gap.candidates.map((c) => (
              <tr key={c.label}>
                <td>
                  <b>{c.label}</b>
                </td>
                <td>{c.mass.toFixed(5)}</td>
                <td>
                  <ErrorText candidate={c} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ChainRow({
  path,
  onHover,
  onUse,
}: {
  path: ChainPath;
  onHover: (peaks: number[]) => void;
  onUse: (peaks: number[]) => void;
}) {
  return (
    <li
      className="annotate-read"
      onMouseEnter={() => onHover(path.nodes)}
      onMouseLeave={() => onHover([])}
    >
      <div className="annotate-sequence">
        {path.gaps.map((step, n) => (
          <span className="annotate-step" key={n}>
            <Errors candidates={step.candidates} />
          </span>
        ))}
      </div>
      <div className="annotate-read-meta">
        <span>
          {path.steps} {path.steps === 1 ? 'step' : 'steps'}
        </span>
        <Button size="small" onClick={() => onUse(path.nodes)}>
          Select these peaks
        </Button>
      </div>
    </li>
  );
}

function PairPanel({
  peaks,
  pair,
  gap,
  chains,
  widen,
  onHover,
  onUse,
}: {
  peaks: PeakPair[];
  pair: [number, number];
  gap: Remote<SelectionStep[]>;
  chains: Remote<ConnectResult>;
  widen: string;
  onHover: (peaks: number[]) => void;
  onUse: (peaks: number[]) => void;
}) {
  return (
    <section className="annotate-card">
      <h3>
        Between m/z {formatMz(peaks[pair[0]][0])} and{' '}
        {formatMz(peaks[pair[1]][0])}
      </h3>
      <Status remote={gap}>
        {(steps) =>
          steps[0] ? <SingleGap gap={steps[0].result} widen={widen} /> : null
        }
      </Status>
      <h4>Chains that span them</h4>
      <Status remote={chains}>
        {(result) =>
          result.paths.length === 0 ? (
            <p className="annotate-empty">
              No chain of these residues reaches from one peak to the other
              through peaks in this spectrum. Fragments may be missing between
              them, or the route may need a modified residue: {widen}.
            </p>
          ) : (
            <>
              <p className="annotate-hint">
                {result.n_paths} {result.n_paths === 1 ? 'chain' : 'chains'},
                fewest steps first. Order is not confidence: rival chains over
                the same mass are normal (Gly + Ala has the mass of Gln), and a
                chain turning up in a search is not evidence by itself.
              </p>
              <ul className="annotate-reads annotate-chains">
                {result.paths.map((path) => (
                  <ChainRow
                    key={path.nodes.join('-')}
                    path={path}
                    onHover={onHover}
                    onUse={onUse}
                  />
                ))}
              </ul>
            </>
          )
        }
      </Status>
    </section>
  );
}

function StepsPanel({
  peaks,
  remote,
}: {
  peaks: PeakPair[];
  remote: Remote<SelectionStep[]>;
}) {
  return (
    <section className="annotate-card">
      <h3>Gaps between your peaks, in m/z order</h3>
      <Status remote={remote}>
        {(steps) => (
          <div className="annotate-table-wrap">
            <table className="annotate-table">
              <thead>
                <tr>
                  <th>From m/z</th>
                  <th>To m/z</th>
                  <th>Gap (Da)</th>
                  <th>Residue and error</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step) => (
                  <tr key={step.from + '-' + step.to}>
                    <td>{formatMz(peaks[step.from][0])}</td>
                    <td>{formatMz(peaks[step.to][0])}</td>
                    <td>{step.result.gap.toFixed(4)}</td>
                    <td>
                      {step.result.candidates.length > 0 ? (
                        <Errors candidates={step.result.candidates} />
                      ) : (
                        <span className="annotate-none">
                          not one residue here
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Status>
    </section>
  );
}

export { NeighbourPanel, PairPanel, PrecursorPanel, SavedPanel, StepsPanel };

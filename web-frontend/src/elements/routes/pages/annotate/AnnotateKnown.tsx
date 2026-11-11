import { Alert, Collapse, Spin } from 'antd';
import StructureView from '../../../basic/StructureView';
import { runVerdict, stepVerdict } from './annotateFormat';
import { KnownComparison, KnownStructure, SavedChain } from './annotateTypes';

type InputProps = {
  known: KnownStructure;
  collisionEnergy: string | null;
  seenLabels: Set<string>;
  saved: SavedChain[];
  comparisons: {
    data: (KnownComparison | null)[] | null;
    error: string | null;
  };
};

function SavedComparison({
  chains,
  remote,
}: {
  chains: SavedChain[];
  remote: { data: (KnownComparison | null)[] | null; error: string | null };
}) {
  return (
    <>
      <h4>Your saved chains against this structure</h4>
      {remote.error && <Alert type="error" title={remote.error} showIcon />}
      {!remote.data && !remote.error && <Spin size="small" />}
      {remote.data && (
        <ul className="annotate-saved">
          {chains.map((chain, n) => {
            const comparison = remote.data?.[n] ?? null;
            return (
              <li key={chain.id}>
                <i style={{ background: chain.color }} />
                <span>
                  <b>Chain {chain.id}</b> ({chain.charge}+):{' '}
                  {comparison
                    ? `${comparison.steps.map(stepVerdict).join('; ')}. ${runVerdict(comparison)}`
                    : 'no residue marks to compare.'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="annotate-hint">
        Matched by mass, so a step can fit inside a fused unit that does not
        share its name. A match says the mass fits this compound, not that the
        step is correct.
      </p>
    </>
  );
}

function Residues({
  known,
  seenLabels,
}: {
  known: KnownStructure;
  seenLabels: Set<string>;
}) {
  // units are only residues where that has been recorded; a wrong true is worse than saying nothing
  const residues = known.residues ?? known.unit_labels;
  if (known.units_are_residues !== true || !residues) {
    return (
      <p className="annotate-hint">
        No residue list is shown because it is not established that this
        compound&apos;s units are single residues.
      </p>
    );
  }
  return (
    <>
      <div className="annotate-known-residues">
        {residues.map((label, n) => (
          <span
            key={n}
            className={
              seenLabels.has(label)
                ? 'annotate-known-residue annotate-known-hit'
                : 'annotate-known-residue'
            }
          >
            {label}
          </span>
        ))}
      </div>
      <p className="annotate-hint">
        Blue residues also appear in your gaps or reads. A shared label is not a
        match to the structure: it says nothing about position.
      </p>
    </>
  );
}

function AnnotateKnown({
  known,
  collisionEnergy,
  seenLabels,
  saved,
  comparisons,
}: InputProps) {
  const facts: [string, string | number | null][] = [
    ['Class', known.class],
    ['Formula', known.formula],
    ['Neutral mass', known.neutral_mass],
    ['Topology', known.topology],
    ['Collision energy', collisionEnergy],
    ['SMILES', known.smiles],
  ];
  return (
    <Collapse
      className="annotate-known"
      items={[
        {
          key: 'known',
          label: 'Known structure',
          children: (
            <>
              <StructureView
                smiles={known.smiles}
                imageWidth={460}
                imageHeight={260}
                disableExport
              />
              <dl className="annotate-known-grid">
                {facts
                  .filter(([, value]) => value !== null && value !== '')
                  .map(([name, value]) => (
                    <div key={name} style={{ display: 'contents' }}>
                      <dt>{name}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
              </dl>
              <Residues known={known} seenLabels={seenLabels} />
              {saved.length > 0 && (
                <SavedComparison chains={saved} remote={comparisons} />
              )}
            </>
          ),
        },
      ]}
    />
  );
}

export default AnnotateKnown;

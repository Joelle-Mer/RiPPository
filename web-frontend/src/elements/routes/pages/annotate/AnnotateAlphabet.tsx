import { Button, Checkbox, Tag } from 'antd';
import AnnotateCustom from './AnnotateCustom';
import { CustomEntry, CustomRecord, ResidueClass } from './annotateTypes';
import { signed } from './annotateFormat';

type InputProps = {
  classes: ResidueClass[];
  classNames: string[];
  standard: [string, number][];
  include: string[];
  exclude: string[];
  custom: CustomEntry[];
  customRecords: CustomRecord[];
  tolerance?: string;
  onClasses: (names: string[]) => void;
  onAll: () => void;
  onResidue: (label: string, onByDefault: boolean, on: boolean) => void;
  onAddCustom: (entry: CustomEntry) => Promise<string | null>;
  onRemoveCustom: (name: string) => void;
  onReset: () => void;
};

function AnnotateAlphabet({
  classes,
  classNames,
  standard,
  include,
  exclude,
  custom,
  customRecords,
  tolerance,
  onClasses,
  onAll,
  onResidue,
  onAddCustom,
  onRemoveCustom,
  onReset,
}: InputProps) {
  const sets = classes.filter((c) => c.name !== 'standard');
  const families = sets.filter((c) => c.kind !== 'group');
  const kinds = sets.filter((c) => c.kind === 'group');
  // every chosen set, in the order the list shows them
  const selected = [...families, ...kinds].filter((c) =>
    classNames.includes(c.name),
  );
  const isOn = (label: string, onByDefault: boolean) =>
    onByDefault ? !exclude.includes(label) : include.includes(label);

  const toggle = (name: string, on: boolean) =>
    onClasses(
      on ? [...classNames, name] : classNames.filter((n) => n !== name),
    );
  const checklist = (title: string, list: ResidueClass[]) =>
    list.length > 0 && (
      <fieldset className="annotate-sets">
        <legend>{title}</legend>
        {list.map((c) => (
          <Checkbox
            key={c.name}
            checked={classNames.includes(c.name)}
            onChange={(event) => toggle(c.name, event.target.checked)}
          >
            {c.label}
          </Checkbox>
        ))}
      </fieldset>
    );

  return (
    <section className="annotate-card annotate-alphabet">
      <h3>Residues</h3>
      <p className="annotate-hint">
        Choose these before or after loading a spectrum. Tick as many as fit
        what you are holding. Each only adds residues to the standard 19, so a
        wrong tick cannot remove the right answer. Leu and Ile have the same
        mass, so they are one residue here, Leu/Ile.
      </p>
      <div className="annotate-set-buttons">
        <Button size="small" onClick={onAll}>
          Add every modification
        </Button>
        {classNames.length > 0 && (
          <Button size="small" onClick={() => onClasses([])}>
            Back to the standard 19
          </Button>
        )}
      </div>
      <div className="annotate-alphabet-grid">
        {checklist('RiPP classes', families)}
        {checklist('Kinds of modification', kinds)}
        <fieldset className="annotate-sets">
          <legend>Standard 19</legend>
          <div className="annotate-chips">
            {standard.map(([label, mass]) => (
              <Tag.CheckableTag
                key={label}
                checked={isOn(label, true)}
                onChange={(on) => onResidue(label, true, on)}
              >
                <span title={mass.toFixed(5) + ' Da'}>{label}</span>
              </Tag.CheckableTag>
            ))}
          </div>
        </fieldset>
      </div>

      {selected.length > 0 && (
        <div className="annotate-set-grid">
          {selected.map((set) => (
            <div className="annotate-set" key={set.name}>
              <h4>{set.label}</h4>
              {set.modifications.length === 0 && (
                <p className="annotate-hint">
                  {set.label} adds no modified residues, so it reads with the
                  standard 19 above.
                </p>
              )}
              {set.modifications.map((m) => (
                <details className="annotate-modification" key={m.name}>
                  <summary>
                    {m.name}
                    <small>
                      {signed(m.delta, 5)} Da,{' '}
                      {
                        m.residues.filter((r) => isOn(r.label, r.on_by_default))
                          .length
                      }{' '}
                      of {m.residues.length} on
                    </small>
                  </summary>
                  <div className="annotate-chips">
                    {m.residues.map((r) => (
                      <Tag.CheckableTag
                        key={r.label}
                        className={r.observed ? undefined : 'annotate-unseen'}
                        checked={isOn(r.label, r.on_by_default)}
                        onChange={(on) =>
                          onResidue(r.label, r.on_by_default, on)
                        }
                      >
                        <span
                          title={`${r.mass.toFixed(5)} Da, ${r.observed ? 'seen in known RiPP structures' : 'allowed by the rule, not seen in a known structure'}`}
                        >
                          {r.label}
                        </span>
                      </Tag.CheckableTag>
                    ))}
                  </div>
                </details>
              ))}
              {set.modifications.length > 0 &&
                set.modifications.every(
                  (m) =>
                    m.n_on_by_default === 0 &&
                    m.residues.every((r) => !r.observed),
                ) && (
                  <p className="annotate-hint">
                    No known RiPP structure shows {set.label.toLowerCase()}, so
                    all of its residues start switched off. Open the list above
                    and switch any on if you have reason to expect them.
                  </p>
                )}
            </div>
          ))}
        </div>
      )}
      {selected.some((c) => c.modifications.length > 0) && (
        <p className="annotate-hint">
          A dashed outline means the chemistry allows it but it has not been
          seen in a known structure. A residue that two of your choices both
          offer is switched on or off in both at once.
        </p>
      )}

      <AnnotateCustom
        residues={standard.map(([label]) => label)}
        entries={custom}
        records={customRecords}
        exclude={exclude}
        onAdd={onAddCustom}
        onRemove={onRemoveCustom}
        onResidue={onResidue}
      />

      {(include.length > 0 || exclude.length > 0) && (
        <Button size="small" onClick={onReset}>
          Reset residues
        </Button>
      )}

      <p className="annotate-hint">
        Residues in a cross-link cannot be read here yet, in any class. They
        appear as unexplained gaps.
      </p>
      {tolerance && <p className="annotate-hint">Tolerance: {tolerance}.</p>}
    </section>
  );
}

export default AnnotateAlphabet;

import { useState } from 'react';
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Segmented,
  Select,
  Tag,
} from 'antd';
import { CustomEntry, CustomRecord } from './annotateTypes';
import { signed } from './annotateFormat';

type InputProps = {
  residues: string[];
  entries: CustomEntry[];
  records: CustomRecord[];
  exclude: string[];
  onAdd: (entry: CustomEntry) => Promise<string | null>;
  onRemove: (name: string) => void;
  onResidue: (label: string, onByDefault: boolean, on: boolean) => void;
};

const anyResidue = 'any';

function AnnotateCustom({
  residues,
  entries,
  records,
  exclude,
  onAdd,
  onRemove,
  onResidue,
}: InputProps) {
  const [kind, setKind] = useState<'modification' | 'residue'>('modification');
  const [name, setName] = useState('');
  const [value, setValue] = useState<number | null>(null);
  const [parents, setParents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ready =
    name.trim().length > 0 &&
    value !== null &&
    (kind === 'residue' || parents.length > 0);

  const handleAdd = async () => {
    if (value === null) {
      return;
    }
    const entry: CustomEntry =
      kind === 'residue'
        ? { name: name.trim(), mass: value }
        : {
            name: name.trim(),
            delta: value,
            applies_to: parents.includes(anyResidue) ? anyResidue : parents,
          };
    setSaving(true);
    const refused = await onAdd(entry);
    setSaving(false);
    setError(refused);
    if (!refused) {
      setName('');
      setValue(null);
      setParents([]);
    }
  };

  const recordsOf = (entry: CustomEntry) =>
    records.filter((r) =>
      entry.mass !== undefined
        ? r.label === entry.name
        : r.label.endsWith(`[${entry.name}]`),
    );

  return (
    <div className="annotate-custom">
      <h4>Your own residues</h4>
      {entries.map((entry) => {
        const own = recordsOf(entry);
        const on = own.filter((r) => !exclude.includes(r.label)).length;
        return (
          <details className="annotate-modification" key={entry.name}>
            <summary>
              {entry.name}
              <small>
                {entry.mass !== undefined
                  ? `${entry.mass.toFixed(5)} Da, mass you entered`
                  : `${signed(entry.delta ?? 0, 5)} Da, ${on} of ${own.length} on`}
              </small>
            </summary>
            <div className="annotate-chips">
              {own.map((r) => (
                <Tag.CheckableTag
                  key={r.label}
                  checked={!exclude.includes(r.label)}
                  onChange={(checked) => onResidue(r.label, true, checked)}
                >
                  <span title={r.mass.toFixed(5) + ' Da'}>{r.label}</span>
                </Tag.CheckableTag>
              ))}
            </div>
            <Button size="small" onClick={() => onRemove(entry.name)}>
              Remove {entry.name}
            </Button>
          </details>
        );
      })}
      <Segmented
        block
        size="small"
        value={kind}
        options={[
          { label: 'Modification', value: 'modification' },
          { label: 'New residue', value: 'residue' },
        ]}
        onChange={(next) => {
          setKind(next as 'modification' | 'residue');
          setValue(null);
          setError(null);
        }}
      />
      <Input
        size="small"
        aria-label="Name"
        placeholder="Name"
        maxLength={32}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
      />
      <InputNumber
        size="small"
        aria-label={
          kind === 'residue' ? 'Residue mass in Da' : 'Mass shift in Da'
        }
        className="annotate-custom-number"
        placeholder={
          kind === 'residue' ? 'Residue mass (Da)' : 'Mass shift (Da)'
        }
        step={0.0001}
        value={value}
        onChange={(next) => setValue(next as number | null)}
      />
      {kind === 'modification' && (
        <Select
          size="small"
          mode="multiple"
          aria-label="Applies to"
          className="annotate-class-select"
          placeholder="Applies to"
          value={parents}
          options={[
            { value: anyResidue, label: 'Any residue' },
            ...residues.map((r) => ({ value: r, label: r })),
          ]}
          onChange={setParents}
        />
      )}
      <Button
        size="small"
        disabled={!ready}
        loading={saving}
        onClick={handleAdd}
      >
        Add
      </Button>
      {error && <Alert type="error" title={error} showIcon />}
    </div>
  );
}

export default AnnotateCustom;

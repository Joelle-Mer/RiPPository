import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Collapse, Descriptions, Divider, Form, Input, Modal,
  Row, Select, Space, Steps, Table, Tag, Typography, message,
} from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Content } from 'antd/es/layout/layout';
import SubmitView, { SUBMISSIONS_KEY, type RiPPSubmission } from './SubmitView';

const { Title, Paragraph, Text } = Typography;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitize(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/<[^>]*>/g, '').replace(/javascript:|data:|vbscript:/gi, '').trim();
}

function loadSubmissions(): RiPPSubmission[] {
  try { return JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) ?? '[]'); }
  catch { return []; }
}

function generateTempAccession(original: string): string {
  const stored = loadSubmissions();
  const base = original + '-TEMP';
  if (!stored.find(s => s.accession === base)) return base;
  let n = 2;
  while (stored.find(s => s.accession === base + '-' + n)) n++;
  return base + '-' + n;
}

// ── Record detail (read-only) ─────────────────────────────────────────────────

function RecordDetail({ record: r }: { record: RiPPSubmission }) {
  const statusColor = r.status === 'Approved' ? 'green' : r.status === 'Rejected' ? 'red' : 'orange';
  const defaultOpen = ['general'];
  if (r.smiles || r.inchi || r.precursorSeq) defaultOpen.push('structure');

  const allSpectra = r.spectra && r.spectra.length > 0 ? r.spectra : [{
    instrument: r.instrument, instrumentType: r.instrumentType, msType: r.msType,
    ionMode: r.ionMode, ionization: r.ionization, precursorType: r.precursorType,
    collisionEnergy: r.collisionEnergy, inputMode: 'peaks' as const,
    peakText: '', mgfFileName: '', mgfContent: '', peaks: r.peaks,
  }];

  const panels: NonNullable<React.ComponentProps<typeof Collapse>['items']> = [
    {
      key: 'general',
      label: 'General',
      children: (
        <Descriptions bordered size="small" column={2} items={[
          { key: 'acc',      label: 'Accession',    children: <Text code>{r.accession}</Text> },
          { key: 'status',   label: 'Status',       children: <Tag color={statusColor}>{r.status}</Tag> },
          { key: 'title',    label: 'Record title', children: r.recordTitle, span: 2 },
          { key: 'compound', label: 'Compound',     children: r.compoundName },
          { key: 'class',    label: 'Class',        children: r.compoundClass },
          { key: 'formula',  label: 'Formula',      children: r.formula },
          { key: 'mass',     label: 'Exact mass',   children: r.exactMass?.toFixed(4) ?? 'N/A' },
          { key: 'license',  label: 'License',      children: r.license },
          { key: 'date',     label: 'Submitted',    children: r.submittedAt?.slice(0, 10) ?? 'N/A' },
          { key: 'orcid',    label: 'Submitter',    children: <>{r.orcidName ?? r.orcid}{r.orcidName && <Text type="secondary" style={{ fontSize: 11 }}> ({r.orcid})</Text>}</> },
          ...(r.dois?.length ? [{ key: 'dois', label: 'DOI(s)', children: r.dois.join(', '), span: 2 as const }] : []),
          ...(r.note ? [{ key: 'note', label: 'Note', children: r.note, span: 2 as const }] : []),
        ]} />
      ),
    },
  ];

  if (r.smiles || r.inchi || r.inchikey || r.precursorSeq || r.splash) {
    panels.push({
      key: 'structure',
      label: 'Structure & sequence',
      children: (
        <Descriptions bordered size="small" column={1} items={[
          ...(r.smiles       ? [{ key: 'smiles', label: 'SMILES',              children: <Text code style={{ wordBreak: 'break-all' }}>{r.smiles}</Text> }] : []),
          ...(r.inchi        ? [{ key: 'inchi',  label: 'InChI',               children: <Text code style={{ wordBreak: 'break-all', fontSize: 11 }}>{r.inchi}</Text> }] : []),
          ...(r.inchikey     ? [{ key: 'ikey',   label: 'InChIKey',            children: <Text code>{r.inchikey}</Text> }] : []),
          ...(r.precursorSeq ? [{ key: 'seq',    label: 'Precursor sequence',  children: <Text code style={{ wordBreak: 'break-all' }}>{r.precursorSeq}</Text> }] : []),
          ...(r.splash       ? [{ key: 'splash', label: 'SPLASH',              children: <Text code>{r.splash}</Text> }] : []),
        ]} />
      ),
    });
  }

  panels.push({
    key: 'ms',
    label: `MS data (${allSpectra.length} spectrum${allSpectra.length !== 1 ? 'a' : ''}, ${r.numPeak} peaks total)`,
    children: (
      <>
        {allSpectra.map((sp, i) => (
          <div key={i}>
            {allSpectra.length > 1 && <Divider orientation="left" plain style={{ fontSize: 12 }}>Spectrum {i + 1}</Divider>}
            <Descriptions bordered size="small" column={3} items={[
              { key: 'inst',  label: 'Instrument',       children: sp.instrument },
              { key: 'itype', label: 'Instrument type',  children: sp.instrumentType },
              { key: 'ms',    label: 'MS type',          children: sp.msType },
              { key: 'ion',   label: 'Ion mode',         children: sp.ionMode },
              { key: 'ioniz', label: 'Ionization',       children: sp.ionization },
              { key: 'prec',  label: 'Precursor type',   children: sp.precursorType },
              { key: 'ce',    label: 'Collision energy', children: sp.collisionEnergy },
              ...(sp.peaks?.length ? [{ key: 'npeaks', label: 'Peaks', children: String(sp.peaks.length) }] : []),
            ]} />
            {sp.peaks && sp.peaks.length > 0 && (
              <Table size="small" pagination={false} scroll={{ y: 180 }} style={{ marginTop: 8 }}
                dataSource={sp.peaks.map((p, j) => ({ ...p, key: j }))}
                columns={[
                  { title: 'm/z',       dataIndex: 'mz',        width: 110, render: (v: number) => v.toFixed(4) },
                  { title: 'Intensity', dataIndex: 'intensity', width: 110, render: (v: number) => v.toFixed(0) },
                  { title: 'Rel. int.', dataIndex: 'rel',       width: 90,  render: (v: number) => v.toFixed(0) },
                ]}
              />
            )}
          </div>
        ))}
      </>
    ),
  });

  if (r.bioactivity && r.bioactivity.length > 0) {
    panels.push({
      key: 'bio',
      label: `Bioactivity (${r.bioactivity.length} entr${r.bioactivity.length !== 1 ? 'ies' : 'y'})`,
      children: (
        <Table size="small" pagination={false}
          dataSource={r.bioactivity.map((b, i) => ({ ...b, key: i }))}
          columns={[
            { title: 'Activity', dataIndex: 'activity' },
            { title: 'Target',   dataIndex: 'target',  render: (v?: string) => v ?? 'N/A' },
            { title: 'MIC',      dataIndex: 'mic',     render: (v?: string) => v ?? 'N/A' },
            { title: 'IC50',     dataIndex: 'ic50',    render: (v?: string) => v ?? 'N/A' },
          ]}
        />
      ),
    });
  }

  if (r.dbLinks && r.dbLinks.length > 0) {
    panels.push({
      key: 'dblinks',
      label: `Database links (${r.dbLinks.length})`,
      children: (
        <Descriptions bordered size="small" column={2} items={
          r.dbLinks.map((l, i) => ({ key: String(i), label: l.db, children: <Text code>{l.id}</Text> }))
        } />
      ),
    });
  }

  if (r.origin && Object.values(r.origin).some(Boolean)) {
    panels.push({
      key: 'origin',
      label: 'Origin',
      children: (
        <Descriptions bordered size="small" column={2} items={[
          ...(r.origin.organism  ? [{ key: 'org', label: 'Organism',  children: r.origin.organism }]  : []),
          ...(r.origin.strain    ? [{ key: 'str', label: 'Strain',    children: r.origin.strain }]    : []),
          ...(r.origin.source    ? [{ key: 'src', label: 'Source',    children: r.origin.source }]    : []),
          ...(r.origin.geography ? [{ key: 'geo', label: 'Geography', children: r.origin.geography }] : []),
        ]} />
      ),
    });
  }

  if (r.genome && Object.values(r.genome).some(v => v !== undefined && v !== '')) {
    panels.push({
      key: 'genome',
      label: 'Genome / BGC',
      children: (
        <Descriptions bordered size="small" column={2} items={[
          ...(r.genome.mibig    ? [{ key: 'mibig', label: 'MIBiG',     children: <Text code>{r.genome.mibig}</Text> }]   : []),
          ...(r.genome.genbank  ? [{ key: 'gb',    label: 'GenBank',   children: <Text code>{r.genome.genbank}</Text> }] : []),
          ...(r.genome.bgcStart != null ? [{ key: 'bgcs', label: 'BGC start', children: String(r.genome.bgcStart) }] : []),
          ...(r.genome.bgcEnd   != null ? [{ key: 'bgce', label: 'BGC end',   children: String(r.genome.bgcEnd) }]   : []),
        ]} />
      ),
    });
  }

  return (
    <Collapse style={{ marginTop: 16 }} defaultActiveKey={defaultOpen} items={panels} />
  );
}

// ── Diff helper ───────────────────────────────────────────────────────────────

type DiffRow = { field: string; before: string; after: string };

function computeDiff(original: RiPPSubmission, updated: RiPPSubmission): DiffRow[] {
  const rows: DiffRow[] = [];
  function check(field: string, a: unknown, b: unknown) {
    const as = a == null ? '' : String(a);
    const bs = b == null ? '' : String(b);
    if (as !== bs) rows.push({ field, before: as, after: bs });
  }
  check('Compound name',     original.compoundName,          updated.compoundName);
  check('Compound class',    original.compoundClass,         updated.compoundClass);
  check('Formula',           original.formula,               updated.formula);
  check('SMILES',            original.smiles,                updated.smiles);
  check('InChI',             original.inchi,                 updated.inchi);
  check('InChIKey',          original.inchikey,              updated.inchikey);
  check('Precursor seq.',    original.precursorSeq,          updated.precursorSeq);
  check('DOIs',              original.dois?.join('; '),      updated.dois?.join('; '));
  check('Note',              original.note,                  updated.note);
  check('Organism',          original.origin?.organism,      updated.origin?.organism);
  check('Strain',            original.origin?.strain,        updated.origin?.strain);
  check('Source',            original.origin?.source,        updated.origin?.source);
  check('Geography',         original.origin?.geography,     updated.origin?.geography);
  check('MIBiG',             original.genome?.mibig,         updated.genome?.mibig);
  check('GenBank',           original.genome?.genbank,       updated.genome?.genbank);
  check('BGC start',         original.genome?.bgcStart,      updated.genome?.bgcStart);
  check('BGC end',           original.genome?.bgcEnd,        updated.genome?.bgcEnd);
  check('Bioactivity count', original.bioactivity?.length,   updated.bioactivity?.length);
  check('DB links count',    original.dbLinks?.length,       updated.dbLinks?.length);
  return rows;
}

// ── Edit form ─────────────────────────────────────────────────────────────────

type EditFormValues = {
  orcid: string;
  compoundName: string;
  compoundClass: string;
  formula: string;
  dois: string[];
  note: string;
  smiles: string;
  inchi: string;
  inchikey: string;
  precursorSeq: string;
  bioactivity: Array<{ activity: string; target: string; mic: string; ic50: string }>;
  dbLinks: Array<{ db: string; id: string }>;
  originOrganism: string;
  originStrain: string;
  originSource: string;
  originGeography: string;
  genomeMibig: string;
  genomeGenbank: string;
  genomeBgcStart: string;
  genomeBgcEnd: string;
};

function initialValues(r: RiPPSubmission): Omit<EditFormValues, 'orcid'> {
  return {
    compoundName:    r.compoundName  ?? '',
    compoundClass:   r.compoundClass ?? '',
    formula:         r.formula       ?? '',
    dois:            r.dois?.length ? r.dois : [''],
    note:            r.note          ?? '',
    smiles:          r.smiles        ?? '',
    inchi:           r.inchi         ?? '',
    inchikey:        r.inchikey      ?? '',
    precursorSeq:    r.precursorSeq  ?? '',
    bioactivity:     r.bioactivity?.map(b => ({
      activity: b.activity ?? '', target: b.target ?? '', mic: b.mic ?? '', ic50: b.ic50 ?? '',
    })) ?? [],
    dbLinks: r.dbLinks?.map(l => ({ db: l.db ?? '', id: l.id ?? '' })) ?? [],
    originOrganism:  r.origin?.organism  ?? '',
    originStrain:    r.origin?.strain    ?? '',
    originSource:    r.origin?.source    ?? '',
    originGeography: r.origin?.geography ?? '',
    genomeMibig:     r.genome?.mibig     ?? '',
    genomeGenbank:   r.genome?.genbank   ?? '',
    genomeBgcStart:  r.genome?.bgcStart != null ? String(r.genome.bgcStart) : '',
    genomeBgcEnd:    r.genome?.bgcEnd   != null ? String(r.genome.bgcEnd)   : '',
  };
}

function buildUpdatedSubmission(
  original: RiPPSubmission,
  vals: EditFormValues,
  orcidName: string | null,
  tempAccession: string,
): RiPPSubmission {
  return {
    ...original,
    accession:       tempAccession,
    status:          'Pending',
    submittedAt:     new Date().toISOString(),
    orcid:           sanitize(vals.orcid),
    orcidName:       orcidName ?? undefined,
    compoundName:    sanitize(vals.compoundName),
    compoundClass:   sanitize(vals.compoundClass),
    formula:         sanitize(vals.formula),
    dois:            vals.dois.map(sanitize).filter(Boolean),
    note:            sanitize(vals.note) || undefined,
    smiles:          sanitize(vals.smiles)        || undefined,
    inchi:           sanitize(vals.inchi)         || undefined,
    inchikey:        sanitize(vals.inchikey)      || undefined,
    precursorSeq:    sanitize(vals.precursorSeq)  || undefined,
    bioactivity: vals.bioactivity
      .filter(b => b.activity?.trim())
      .map(b => ({
        activity: sanitize(b.activity),
        target:   sanitize(b.target)  || undefined,
        mic:      sanitize(b.mic)     || undefined,
        ic50:     sanitize(b.ic50)    || undefined,
      })),
    dbLinks: vals.dbLinks
      .filter(l => l.db?.trim() && l.id?.trim())
      .map(l => ({ db: sanitize(l.db), id: sanitize(l.id) })),
    origin: {
      organism:  sanitize(vals.originOrganism)  || undefined,
      strain:    sanitize(vals.originStrain)     || undefined,
      source:    sanitize(vals.originSource)     || undefined,
      geography: sanitize(vals.originGeography) || undefined,
    },
    genome: {
      mibig:    sanitize(vals.genomeMibig)    || undefined,
      genbank:  sanitize(vals.genomeGenbank)  || undefined,
      bgcStart: vals.genomeBgcStart ? Number(vals.genomeBgcStart) : undefined,
      bgcEnd:   vals.genomeBgcEnd   ? Number(vals.genomeBgcEnd)   : undefined,
    },
  };
}

// ── DB link row with verify button ────────────────────────────────────────────

const EDIT_DB_URLS: Record<string, (id: string) => string> = {
  'KEGG':           (i) => `https://www.genome.jp/entry/${i}`,
  'PubChem CID':    (i) => `https://pubchem.ncbi.nlm.nih.gov/compound/${i}`,
  'CompTox DTXSID': (i) => `https://comptox.epa.gov/dashboard/chemical/details/${i}`,
  'ChemSpider':     (i) => `https://www.chemspider.com/Chemical-Structure.${i}.html`,
  'ChEBI':          (i) => `https://www.ebi.ac.uk/chebi/searchId.do?chebiId=${i}`,
  'HMDB':           (i) => `https://hmdb.ca/metabolites/${i}`,
  'NPAtlas':        (i) => `https://www.npatlas.org/explore/compounds/${i}`,
  'LOTUS':          (i) => `https://www.wikidata.org/wiki/${i}`,
  'Wikidata':       (i) => `https://www.wikidata.org/wiki/${i}`,
};

const EDIT_DB_OPTIONS = Object.keys(EDIT_DB_URLS).map((k) => ({ value: k, label: k }));

function EditDbLinkRow({ fieldName, onRemove }: { fieldName: number; onRemove: () => void }) {
  const form = Form.useFormInstance();
  const db: string = Form.useWatch(['dbLinks', fieldName, 'db'], form) ?? '';
  const id: string = Form.useWatch(['dbLinks', fieldName, 'id'], form) ?? '';
  const verifyUrl = id.trim() && EDIT_DB_URLS[db] ? EDIT_DB_URLS[db](id.trim()) : null;
  return (
    <Space style={{ display: 'flex', marginBottom: 8 }} align="baseline">
      <Form.Item name={[fieldName, 'db']} noStyle rules={[{ required: true }]}>
        <Select options={EDIT_DB_OPTIONS} placeholder="Database" style={{ width: 180 }} />
      </Form.Item>
      <Form.Item name={[fieldName, 'id']} noStyle rules={[{ required: true }]}>
        <Input placeholder="ID" style={{ width: 220 }} />
      </Form.Item>
      {verifyUrl ? (
        <a href={verifyUrl} target="_blank" rel="noreferrer">
          <Button size="small">Verify ↗</Button>
        </a>
      ) : (
        <Button size="small" disabled style={{ visibility: 'hidden' }}>Verify ↗</Button>
      )}
      <Button size="small" danger icon={<DeleteOutlined />} onClick={onRemove} />
    </Space>
  );
}

// ── Edit form fields (inside Collapse) ────────────────────────────────────────

function EditFormPanels({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  const panels: NonNullable<React.ComponentProps<typeof Collapse>['items']> = [
    {
      key: 'general',
      label: 'General',
      children: (
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="compoundName" label="Compound name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="compoundClass" label="Compound class" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="formula" label="Molecular formula" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item label="DOIs">
              <Form.List name="dois">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map((field) => (
                      <Space key={field.key} style={{ display: 'flex', marginBottom: 6 }} align="baseline">
                        <Form.Item name={field.name} noStyle>
                          <Input placeholder="10.xxxx/..." style={{ width: 360 }} />
                        </Form.Item>
                        {fields.length > 1 && (
                          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                        )}
                      </Space>
                    ))}
                    <Button size="small" onClick={() => add('')} icon={<PlusOutlined />}>Add DOI</Button>
                  </>
                )}
              </Form.List>
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="note" label="Note">
              <Input.TextArea rows={3} maxLength={1000} showCount />
            </Form.Item>
          </Col>
        </Row>
      ),
    },
    {
      key: 'structure',
      label: 'Structure & sequence',
      children: (
        <Row gutter={16}>
          <Col span={24}>
            <Form.Item name="smiles" label="SMILES">
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="inchi" label="InChI">
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="inchikey" label="InChIKey">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="precursorSeq" label="Precursor peptide sequence">
              <Input />
            </Form.Item>
          </Col>
        </Row>
      ),
    },
    {
      key: 'bioactivity',
      label: 'Bioactivity',
      children: (
        <Form.List name="bioactivity">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Card
                  key={field.key}
                  size="small"
                  style={{ marginBottom: 8 }}
                  extra={<Button size="small" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                >
                  <Row gutter={8}>
                    <Col span={8}>
                      <Form.Item name={[field.name, 'activity']} label="Activity" rules={[{ required: true }]}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name={[field.name, 'target']} label="Target">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item name={[field.name, 'mic']} label="MIC">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item name={[field.name, 'ic50']} label="IC50">
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              ))}
              <Button icon={<PlusOutlined />} onClick={() => add({ activity: '', target: '', mic: '', ic50: '' })}>
                Add bioactivity entry
              </Button>
            </>
          )}
        </Form.List>
      ),
    },
    {
      key: 'dblinks',
      label: 'Database links',
      children: (
        <Form.List name="dbLinks">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <EditDbLinkRow key={field.key} fieldName={field.name} onRemove={() => remove(field.name)} />
              ))}
              <Button icon={<PlusOutlined />} onClick={() => add({ db: '', id: '' })}>
                Add link
              </Button>
            </>
          )}
        </Form.List>
      ),
    },
    {
      key: 'origin',
      label: 'Origin',
      children: (
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="originOrganism" label="Organism"><Input /></Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="originStrain" label="Strain"><Input /></Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="originSource" label="Source"><Input /></Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="originGeography" label="Geography"><Input /></Form.Item>
          </Col>
        </Row>
      ),
    },
    {
      key: 'genome',
      label: 'Genome / BGC',
      children: (
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="genomeMibig" label="MIBiG accession"><Input /></Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="genomeGenbank" label="GenBank accession"><Input /></Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="genomeBgcStart" label="BGC start (bp)">
              <Input type="number" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="genomeBgcEnd" label="BGC end (bp)">
              <Input type="number" />
            </Form.Item>
          </Col>
        </Row>
      ),
    },
  ];

  return (
    <Collapse
      defaultActiveKey={['general', 'structure']}
      items={panels}
    />
  );
}

// ── Add-to-Existing flow ──────────────────────────────────────────────────────

function AddToExistingFlow({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(0);
  const [form] = Form.useForm<EditFormValues>();
  const [messageApi, ctx] = message.useMessage();
  const [selected, setSelected] = useState<RiPPSubmission | null>(null);
  const [orcidName, setOrcidName] = useState<string | null>(null);
  const [orcidLoading, setOrcidLoading] = useState(false);
  const [orcidError, setOrcidError] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [diff, setDiff] = useState<DiffRow[]>([]);
  const [newAccession, setNewAccession] = useState('');
  const [done, setDone] = useState(false);
  const [prefillModalOpen, setPrefillModalOpen] = useState(false);
  const [prefillSource, setPrefillSource] = useState<RiPPSubmission | null>(null);

  const submissions = loadSubmissions();

  // Pre-fill form when user selects a record and advances to step 1
  useEffect(() => {
    if (step === 1 && selected) {
      form.setFieldsValue(initialValues(selected));
    }
  }, [step, selected, form]);

  const fetchOrcidName = useCallback(async () => {
    const id: string = (form.getFieldValue('orcid') as string | undefined)?.trim() ?? '';
    if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id)) return;
    setOrcidLoading(true); setOrcidError(false);
    try {
      const res = await fetch(`https://pub.orcid.org/v3.0/${id}/person`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) { setOrcidError(true); return; }
      const json = await res.json() as Record<string, unknown>;
      const nameObj = json?.name as Record<string, { value?: string }> | undefined;
      const given = nameObj?.['given-names']?.value ?? '';
      const family = nameObj?.['family-name']?.value ?? '';
      const full = [given, family].filter(Boolean).join(' ');
      if (full) setOrcidName(full); else setOrcidError(true);
    } catch { setOrcidError(true); }
    finally { setOrcidLoading(false); }
  }, [form]);

  function handleSelectAccession(acc: string) {
    const sub = submissions.find(s => s.accession === acc) ?? null;
    setSelected(sub);
  }

  async function handleNext() {
    if (step === 0) {
      if (!selected) { messageApi.warning('Please select a record first.'); return; }
      setStep(1);
    } else if (step === 1) {
      try {
        await form.validateFields();
        const vals = form.getFieldsValue() as EditFormValues;
        const tempAcc = generateTempAccession(selected!.accession);
        const updated = buildUpdatedSubmission(selected!, vals, orcidName, tempAcc);
        setDiff(computeDiff(selected!, updated));
        setNewAccession(tempAcc);
        setConfirmOpen(true);
      } catch { /* form validation messages shown inline */ }
    }
  }

  function handleConfirm() {
    const vals = form.getFieldsValue() as EditFormValues;
    const updated = buildUpdatedSubmission(selected!, vals, orcidName, newAccession);
    const existing = loadSubmissions();
    existing.push(updated);
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(existing));
    setConfirmOpen(false);
    setDone(true);
    setStep(2);
  }

  if (done) {
    return (
      <div style={{ maxWidth: 600, margin: '48px auto', textAlign: 'center' }}>
        <Alert
          type="success"
          showIcon
          message="Revision submitted!"
          description={
            <>
              A new job <Text code>{newAccession}</Text> has been created with status{' '}
              <Tag color="orange">Pending</Tag>. It will be reviewed before the changes
              are applied to <Text strong>{selected?.accession}</Text>.
            </>
          }
          style={{ marginBottom: 24 }}
        />
        <Space>
          <Button onClick={onBack}>Back to Submit</Button>
          <Button type="primary" onClick={() => {
            setDone(false); setStep(0); setSelected(null);
            setOrcidName(null); setNewAccession(''); form.resetFields();
          }}>
            Edit another record
          </Button>
        </Space>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      {ctx}
      <Button icon={<ArrowLeftOutlined />} type="link" onClick={onBack} style={{ paddingLeft: 0, marginBottom: 16 }}>
        Back
      </Button>

      <Steps
        current={step}
        items={[{ title: 'Select record' }, { title: 'Edit fields' }, { title: 'Done' }]}
        style={{ marginBottom: 32 }}
      />

      {/* ── Step 0: select + preview ── */}
      {step === 0 && (
        <Card title="Select an existing record">
          {submissions.length === 0 ? (
            <Alert type="info" showIcon message="No submissions found"
              description="There are no records in the local database yet. Submit a new record first." />
          ) : (
            <>
              <Form.Item label="Accession / compound name" required style={{ marginBottom: 16 }}>
                <Select
                  showSearch
                  style={{ width: '100%' }}
                  placeholder="Search by accession or compound name…"
                  optionFilterProp="label"
                  onChange={handleSelectAccession}
                  options={submissions.map(s => ({
                    value: s.accession,
                    label: `${s.accession}: ${s.compoundName ?? s.recordTitle}`,
                  }))}
                />
              </Form.Item>
              {selected && <RecordDetail record={selected} />}
            </>
          )}
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="primary" onClick={handleNext} disabled={!selected} icon={<EditOutlined />}>
              Edit this record
            </Button>
          </div>
        </Card>
      )}

      {/* ── Step 1: edit form ── */}
      {step === 1 && selected && (
        <Card
          title={
            <>
              Editing <Text code>{selected.accession}</Text>{' '}
              <Text type="secondary" style={{ fontWeight: 400, fontSize: 13 }}>{selected.compoundName}</Text>
            </>
          }
          extra={
            <Button size="small" onClick={() => { setPrefillSource(null); setPrefillModalOpen(true); }}>
              Pre-fill from another record
            </Button>
          }
        >
          <Alert
            type="warning"
            showIcon
            message="Your changes will be saved as a new Pending job"
            description={
              <>
                Changes will be stored as a new record with accession{' '}
                <Text code>{generateTempAccession(selected.accession)}</Text> and status{' '}
                <Tag color="orange">Pending</Tag> until approved by a curator.
              </>
            }
            style={{ marginBottom: 24 }}
          />

          <Form form={form} layout="vertical">
            {/* ORCID at top */}
            <Form.Item
              name="orcid"
              label="Your ORCID iD"
              rules={[
                { required: true, message: 'ORCID is required' },
                { pattern: /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, message: 'Format: 0000-0000-0000-0000' },
              ]}
              style={{ maxWidth: 320 }}
            >
              <Input
                placeholder="0000-0000-0000-0000"
                onBlur={fetchOrcidName}
                suffix={
                  orcidLoading ? <span style={{ fontSize: 11, color: '#888' }}>…</span>
                  : orcidError  ? <span style={{ fontSize: 11, color: '#dc2626' }}>Not found</span>
                  : orcidName   ? <span style={{ fontSize: 11, color: '#16a34a' }}>{orcidName}</span>
                  : null
                }
              />
            </Form.Item>

            <Divider style={{ margin: '8px 0 16px' }} />
            <EditFormPanels form={form} />
          </Form>

          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button type="primary" onClick={handleNext}>Review changes</Button>
          </div>
        </Card>
      )}

      {/* ── Pre-fill modal ── */}
      <Modal
        open={prefillModalOpen}
        title="Pre-fill from another record"
        onCancel={() => setPrefillModalOpen(false)}
        onOk={() => {
          if (prefillSource) {
            form.setFieldsValue(initialValues(prefillSource));
            messageApi.success(`Form pre-filled from ${prefillSource.accession}`);
          }
          setPrefillModalOpen(false);
        }}
        okText="Pre-fill"
        okButtonProps={{ disabled: !prefillSource }}
      >
        <Alert
          type="info"
          showIcon
          message="Select a record to copy its metadata into the edit form. Your ORCID and the MS data are not affected."
          style={{ marginBottom: 16 }}
        />
        <Select
          showSearch
          style={{ width: '100%' }}
          placeholder="Search by accession or compound name…"
          optionFilterProp="label"
          value={prefillSource?.accession ?? undefined}
          onChange={(acc: string) => {
            setPrefillSource(submissions.find(s => s.accession === acc) ?? null);
          }}
          options={submissions.map(s => ({
            value: s.accession,
            label: `${s.accession}: ${s.compoundName ?? s.recordTitle}`,
          }))}
        />
      </Modal>

      {/* ── Confirmation modal ── */}
      <Modal
        open={confirmOpen}
        title="Confirm revision"
        width={680}
        onCancel={() => setConfirmOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setConfirmOpen(false)}>Back (keep editing)</Button>,
          <Button key="submit" type="primary" onClick={handleConfirm}>Submit revision</Button>,
        ]}
      >
        <Alert
          type="warning"
          showIcon
          message={
            <>
              This will create a new job <Text code>{newAccession}</Text> with status{' '}
              <Tag color="orange">Pending</Tag> based on{' '}
              <Text code>{selected?.accession}</Text>.
            </>
          }
          style={{ marginBottom: 16 }}
        />

        {diff.length === 0 ? (
          <Alert type="info" showIcon message="No fields were changed from the original." />
        ) : (
          <>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {diff.length} field{diff.length !== 1 ? 's' : ''} changed:
            </Text>
            <Table
              size="small"
              pagination={false}
              dataSource={diff.map((d, i) => ({ ...d, key: i }))}
              columns={[
                { title: 'Field',    dataIndex: 'field',  width: 140 },
                { title: 'Original', dataIndex: 'before', ellipsis: true,
                  render: (v: string) => v || <Text type="secondary">N/A</Text> },
                { title: 'New value', dataIndex: 'after', ellipsis: true,
                  render: (v: string) => <Text strong>{v || <Text type="secondary">N/A</Text>}</Text> },
              ]}
            />
          </>
        )}
      </Modal>
    </div>
  );
}

// ── Use-as-template flow ──────────────────────────────────────────────────────

const TEMPLATE_KEY = 'rippository_new_template';

function UseAsTemplateFlow({ onBack, onStart }: { onBack: () => void; onStart: () => void }) {
  const [selected, setSelected] = useState<RiPPSubmission | null>(null);
  const submissions = loadSubmissions().filter((s) => s.status === 'Approved');

  function handleUseTemplate() {
    if (!selected) return;
    sessionStorage.setItem(TEMPLATE_KEY, JSON.stringify(selected));
    onStart();
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <Button icon={<ArrowLeftOutlined />} type="link" onClick={onBack} style={{ paddingLeft: 0, marginBottom: 16 }}>
        Back
      </Button>
      <Card title="Choose a record to use as template">
        <Alert
          type="info"
          showIcon
          message="A new, independent submission will be created pre-filled with the selected record's data."
          description="All fields can be edited freely. The result gets a new accession and starts as Pending."
          style={{ marginBottom: 20 }}
        />
        {submissions.length === 0 ? (
          <Alert type="warning" showIcon message="No approved records available to use as a template." />
        ) : (
          <>
            <Form.Item label="Record" required style={{ marginBottom: 16 }}>
              <Input.Search
                placeholder="Search accession or compound name…"
                enterButton={false}
                onSearch={(val) => {
                  const lower = val.toLowerCase();
                  const found = submissions.find(
                    (s) =>
                      s.accession.toLowerCase().includes(lower) ||
                      (s.compoundName ?? '').toLowerCase().includes(lower),
                  );
                  if (found) setSelected(found);
                }}
                allowClear
                style={{ marginBottom: 12 }}
              />
              <select
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 14 }}
                onChange={(e) => {
                  const sub = submissions.find((s) => s.accession === e.target.value) ?? null;
                  setSelected(sub);
                }}
                defaultValue=""
              >
                <option value="" disabled>Select a record</option>
                {submissions.map((s) => (
                  <option key={s.accession} value={s.accession}>
                    {s.accession}: {s.compoundName ?? s.recordTitle}
                  </option>
                ))}
              </select>
            </Form.Item>
            {selected && <RecordDetail record={selected} />}
          </>
        )}
        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="primary" disabled={!selected} onClick={handleUseTemplate} icon={<PlusOutlined />}>
            Start new submission from this record
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ── Landing / top-level ───────────────────────────────────────────────────────

type Mode = null | 'new' | 'addTo';

function SubmitLandingView() {
  const [mode, setMode] = useState<Mode>(null);

  if (mode === 'new') return <SubmitView />;

  if (mode === 'addTo') {
    return (
      <Content style={{ padding: '24px 48px', width: '100%', height: '100%', overflowY: 'auto' }}>
        <Title level={3} style={{ marginBottom: 24 }}>Edit an existing record</Title>
        <AddToExistingFlow onBack={() => setMode(null)} />
      </Content>
    );
  }

  return (
    <Content style={{ padding: '48px 48px', width: '100%', height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <Title level={2} style={{ textAlign: 'center', marginBottom: 8 }}>Submit to RiPPository</Title>
        <Paragraph style={{ textAlign: 'center', color: '#6b7280', marginBottom: 48 }}>
          Add a new RiPP record or propose edits to an existing one.
        </Paragraph>

        <Row gutter={32} justify="center">
          <Col xs={24} sm={11}>
            <Card
              hoverable
              onClick={() => setMode('new')}
              style={{ textAlign: 'center', cursor: 'pointer', height: '100%' }}
              styles={{ body: { padding: '40px 32px' } }}
            >
              <PlusOutlined style={{ fontSize: 48, color: '#810e15', marginBottom: 16 }} />
              <Title level={4} style={{ marginBottom: 8 }}>New submission</Title>
              <Paragraph style={{ color: '#6b7280', marginBottom: 24 }}>
                Submit a brand-new RiPP compound record including structure, MS data,
                and biosynthetic gene cluster information.
              </Paragraph>
              <Button type="primary" size="large" icon={<PlusOutlined />}>
                Start new record
              </Button>
            </Card>
          </Col>

          <Col xs={24} sm={11}>
            <Card
              hoverable
              onClick={() => setMode('addTo')}
              style={{ textAlign: 'center', cursor: 'pointer', height: '100%' }}
              styles={{ body: { padding: '40px 32px' } }}
            >
              <EditOutlined style={{ fontSize: 48, color: '#1677ff', marginBottom: 16 }} />
              <Title level={4} style={{ marginBottom: 8 }}>Edit existing record</Title>
              <Paragraph style={{ color: '#6b7280', marginBottom: 24 }}>
                Propose corrections to metadata, structure, or annotations of a record already
                in the database.
              </Paragraph>
              <Button size="large" icon={<EditOutlined />}>
                Edit existing
              </Button>
            </Card>
          </Col>
        </Row>

        <Paragraph style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 40 }}>
          All new submissions and revisions are reviewed by curators before being published.
        </Paragraph>
      </div>
    </Content>
  );
}

export default SubmitLandingView;

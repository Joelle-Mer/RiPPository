import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Col, Collapse, Divider, Form, Input, Modal, Radio, Row, Select, message } from 'antd';
import { Content } from 'antd/es/layout/layout';
import { calculateExactMass, calculateSplash, parsePeakList } from '../../../../utils/chemistry';
import { Molecule, SmilesParser } from 'openchemlib';
import { MolfileSvgRenderer } from 'react-ocl';

export const SUBMISSIONS_KEY = 'rippository_submissions';

// Strip HTML/script tags and trim whitespace
function sanitize(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/<[^>]*>/g, '').replace(/javascript:|data:|vbscript:/gi, '').trim();
}

// BGC types imported from shared component
import {
  BgcGene, BGC_COLORS, BGC_CATEGORY_LABELS,
  categorizeBgcGene, parseGenbankCds, BgcGeneMap,
} from '../../../basic/BgcViewer';

// Allowed chars for database IDs: letters, digits, colon, hyphen, dot, slash, underscore
const DB_ID_PATTERN = /^[A-Za-z0-9:._\/\-]+$/;
const DOI_PATTERN = /^10\.\d{4,}\/.+/;
const FORMULA_PATTERN = /^[A-Za-z0-9]+$/;
const GENBANK_PATTERN = /^[A-Za-z]{1,2}[0-9]{5,8}(\.[0-9]+)?$/;
const ORGANISM_PATTERN = /^[A-Za-z0-9 .\-'()]+$/;

export type SpectrumEntry = {
  instrument: string; instrumentType: string; msType: string; ionMode: string;
  ionization: string; precursorType: string; collisionEnergy: string;
  inputMode: 'peaks' | 'mgf';
  peakText: string;
  mgfFileName: string;
  mgfContent: string;
  peaks?: Array<{ mz: number; intensity: number; rel: number }>;
};

export type RiPPSubmission = {
  orcid: string;
  orcidName?: string;
  accession: string; recordTitle: string; date: string; license: 'CC BY-SA';
  exactMass: number | null; numPeak: number;
  status: 'Pending' | 'Approved' | 'Rejected'; submittedAt: string;
  dois: string[]; compoundName: string; compoundClass: string; compoundSubClass?: string; formula: string;
  smiles?: string; precursorSeq?: string; inchi?: string; inchikey?: string; splash?: string;
  instrument: string; instrumentType: string; msType: string; ionMode: string;
  collisionEnergy: string; ionization: string; precursorType: string;
  peaks: Array<{ mz: number; intensity: number; rel: number }>;
  spectra?: SpectrumEntry[];
  note?: string;
  dbLinks?: Array<{ db: string; id: string }>;
  bioactivity?: Array<{ activity: string; target?: string; mic?: string; ic50?: string }>;
  origin?: { organism?: string; strain?: string; source?: string; geography?: string };
  genome?: { mibig?: string; genbank?: string; bgcStart?: number; bgcEnd?: number };
};

function generateAccession(): string {
  const stored: RiPPSubmission[] = JSON.parse(
    localStorage.getItem(SUBMISSIONS_KEY) ?? '[]',
  );
  const next = stored.length + 1;
  return 'RIPPOS-LU-' + String(next).padStart(4, '0');
}

const RIPP_CLASSES = [
  'Biarylitide',
  'Borosin',
  'Bottromycin',
  'Cyanobactin',
  'Epipeptide',
  'Glycocin',
  'Graspetide',
  'Head-to-tail cyclized peptide',
  'Lanthipeptide',
  'Lasso peptide',
  'Microcin',
  'Microviridin',
  'Ranthipeptide',
  'RiPP-Unknown',
  'Ryptide',
  'Sactipeptide',
  'Streptide',
  'Thiopeptide',
];

const RIPP_SUBCLASSES: Record<string, string[]> = {
  'Lanthipeptide': ['Class I', 'Class II', 'Class III', 'Class IV', 'Class V'],
  'Lasso peptide': ['Class I', 'Class II', 'Class III'],
  'Thiopeptide': ['Series a (Class I)', 'Series b (Class II)', 'Series c (Class III)', 'Series d (Class IV)', 'Series e (Class V)'],
  'Cyanobactin': ['Linear', 'Macrocyclic'],
  'Sactipeptide': ['Class I', 'Class II', 'Class III'],
};

const INSTRUMENTS = [
  'API QSTAR Pulsar i',
  'Bruker micrOTOF-Q II', 'Bruker timsTOF Pro', 'Bruker maXis Impact',
  'Thermo Q Exactive', 'Thermo Q Exactive Plus', 'Thermo Q Exactive HF',
  'Thermo Orbitrap Fusion Lumos', 'Thermo LTQ Orbitrap XL', 'Thermo TSQ Quantiva',
  'Waters Synapt G2-Si', 'Waters Xevo G2-XS QTof', 'Waters Acquity TQD',
  'Agilent 6530 Q-TOF', 'Agilent 6550 iFunnel Q-TOF', 'Agilent 6495 Triple Quad',
  'Shimadzu LCMS-8060', 'Shimadzu LCMS-8040', 'Shimadzu LCMS-8045',
  'Shimadzu LCMS-IT-TOF', 'Shimadzu LCMS-9030',
  'SCIEX TripleTOF 6600', 'SCIEX QTRAP 6500+',
];

const INSTRUMENT_TYPES = [
  'LC-ESI-QTOF', 'LC-ESI-ITFT', 'LC-ESI-QFT', 'LC-ESI-QIT',
  'LC-ESI-TOF', 'LC-APCI-QTOF', 'MALDI-TOF', 'MALDI-QTOF',
];

const IONIZATIONS = ['ESI', 'APCI', 'MALDI', 'APPI', 'EI', 'NSI'];
const MS_TYPES = ['MS1', 'MS2', 'MS3', 'MS4'];
const ION_MODES = ['POSITIVE', 'NEGATIVE'];

const COLLISION_ENERGIES = [
  '10 eV', '15 eV', '20 eV', '25 eV', '30 eV',
  '35 eV', '40 eV', '45 eV', '50 eV', 'Ramp 10-50 eV', 'Not reported',
];

const PRECURSOR_TYPES = [
  '[M+H]+', '[M+2H]2+', '[M+3H]3+', '[M+4H]4+',
  '[M-H]-', '[M-2H]2-', '[M+Na]+', '[M+K]+', '[M+NH4]+', '[M+H-H2O]+', '[M-H2O-H]-',
];

const toOptions = (arr: string[]) => arr.map((v) => ({ value: v, label: v }));

const DB_OPTIONS = [
  { value: 'KEGG', label: 'KEGG' },
  { value: 'PubChem CID', label: 'PubChem CID' },
  { value: 'CompTox DTXSID', label: 'CompTox DTXSID' },
  { value: 'ChemSpider', label: 'ChemSpider' },
  { value: 'ChEBI', label: 'ChEBI' },
  { value: 'HMDB', label: 'HMDB' },
  { value: 'NPAtlas', label: 'NPAtlas' },
  { value: 'LOTUS', label: 'LOTUS' },
  { value: 'Wikidata', label: 'Wikidata' },
];

const DB_PLACEHOLDERS: Record<string, string> = {
  KEGG: 'C05625',
  'PubChem CID': '5280805',
  'CompTox DTXSID': 'DTXSID3022326',
  ChemSpider: '4444',
  ChEBI: 'CHEBI:17234',
  HMDB: 'HMDB0000122',
  NPAtlas: 'NPA000001',
  LOTUS: 'Q27104402',
  Wikidata: 'Q407635',
};

const DB_URL_BUILDER: Record<string, (id: string) => string> = {
  'KEGG':            (id) => `https://www.genome.jp/entry/${id}`,
  'PubChem CID':     (id) => `https://pubchem.ncbi.nlm.nih.gov/compound/${id}`,
  'CompTox DTXSID':  (id) => `https://comptox.epa.gov/dashboard/chemical/details/${id}`,
  'ChemSpider':      (id) => `https://www.chemspider.com/Chemical-Structure.${id}.html`,
  'ChEBI':           (id) => `https://www.ebi.ac.uk/chebi/searchId.do?chebiId=${id}`,
  'HMDB':            (id) => `https://hmdb.ca/metabolites/${id}`,
  'NPAtlas':         (id) => `https://www.npatlas.org/explore/compounds/${id}`,
  'LOTUS':           (id) => `https://www.wikidata.org/wiki/${id}`,
  'Wikidata':        (id) => `https://www.wikidata.org/wiki/${id}`,
};

// Per-database ID format validators (used to warn the user, not block submission)
const DB_ID_VALIDATORS: Record<string, RegExp> = {
  'KEGG':            /^C\d{5}$/,
  'PubChem CID':     /^\d+$/,
  'CompTox DTXSID':  /^DTXSID\d+$/i,
  'ChemSpider':      /^\d+$/,
  'ChEBI':           /^CHEBI:\d+$/i,
  'HMDB':            /^HMDB\d{5,7}$/i,
  'NPAtlas':         /^NPA\d{6}$/i,
  'LOTUS':           /^Q\d+$/,
  'Wikidata':        /^Q\d+$/,
};

// Auto-fix common formatting mistakes (e.g. bare digits for ChEBI)
function normalizeDbId(db: string, raw: string): string {
  const id = raw.trim();
  if (db === 'ChEBI' && /^\d+$/.test(id)) return `CHEBI:${id}`;
  if (db === 'HMDB' && /^\d+$/.test(id)) return `HMDB${id.padStart(7, '0')}`;
  if (db === 'KEGG' && /^\d{5}$/.test(id)) return `C${id}`;
  if ((db === 'LOTUS' || db === 'Wikidata') && /^\d+$/.test(id)) return `Q${id}`;
  if (db === 'CompTox DTXSID' && /^\d+$/.test(id)) return `DTXSID${id}`;
  return id;
}

function DbLinkRow({
  db, id, onChange, onRemove,
}: {
  db: string; id: string;
  onChange: (field: 'db' | 'id', val: string) => void;
  onRemove: () => void;
}) {
  const validator = DB_ID_VALIDATORS[db];
  const trimmed = id.trim();
  const isValid = !trimmed || !validator || validator.test(trimmed);
  const url = trimmed && DB_URL_BUILDER[db] ? DB_URL_BUILDER[db](trimmed) : null;

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Select
        value={db}
        options={DB_OPTIONS}
        onChange={(v) => onChange('db', v)}
        style={{ width: 160, flexShrink: 0 }}
      />
      <Input
        value={id}
        placeholder={DB_PLACEHOLDERS[db] ?? 'ID'}
        onChange={(e) => onChange('id', e.target.value)}
        onBlur={() => {
          const normalized = normalizeDbId(db, id);
          if (normalized !== id) onChange('id', normalized);
        }}
        status={isValid ? undefined : 'warning'}
        style={{ flex: 1 }}
      />
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" title="Verify this ID in the database">
          <Button size="small" style={{ flexShrink: 0 }}>Verify ↗</Button>
        </a>
      ) : (
        <Button size="small" disabled style={{ flexShrink: 0, visibility: 'hidden' }}>Verify ↗</Button>
      )}
      <Button size="small" danger onClick={onRemove} style={{ flexShrink: 0 }}>Remove</Button>
    </div>
  );
}

const BIO_ACTIVITIES = [
  'Antimicrobial', 'Antibacterial', 'Antifungal', 'Antiviral',
  'Cytotoxic', 'Anticancer', 'Antitumor', 'Antiparasitic',
  'Immunosuppressive', 'Enzyme inhibitor', 'Unknown',
];

const ISOLATION_SOURCES = [
  'Soil', 'Forest soil', 'Desert soil', 'Compost',
  'Marine sediment', 'Marine water', 'Deep sea', 'Freshwater lake or river',
  'Plant (endophyte)', 'Plant (rhizosphere)', 'Plant surface', 'Mangrove',
  'Animal gut', 'Human gut', 'Human skin', 'Insect',
  'Fungus', 'Cave', 'Hot spring', 'Arctic / Antarctic',
];

const OTHER = '__other__';

function defaultSpectrum(): SpectrumEntry {
  return {
    instrument: '', instrumentType: '', msType: 'MS2', ionMode: 'POSITIVE',
    ionization: '', precursorType: '', collisionEnergy: '',
    inputMode: 'peaks', peakText: '', mgfFileName: '', mgfContent: '',
  };
}

function parseMgf(text: string): Array<{ mz: number; intensity: number; rel: number }> | null {
  const lines = text.split('\n');
  const raw: Array<{ mz: number; intensity: number }> = [];
  let inBlock = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.toUpperCase() === 'BEGIN IONS') { inBlock = true; continue; }
    if (t.toUpperCase() === 'END IONS') break;
    if (!inBlock) continue;
    if (t.includes('=')) continue;
    const parts = t.split(/\s+/);
    if (parts.length >= 2) {
      const mz = parseFloat(parts[0]);
      const intensity = parseFloat(parts[1]);
      if (!isNaN(mz) && !isNaN(intensity)) raw.push({ mz, intensity });
    }
  }
  if (raw.length === 0) return null;
  const maxInt = Math.max(...raw.map((p) => p.intensity));
  return raw.map((p) => ({ ...p, rel: Math.round((p.intensity / maxInt) * 999) }));
}

function SelectWithOther({
  value, onChange, options, placeholder, showSearch,
}: {
  value?: string; onChange?: (val: string) => void; options: string[];
  placeholder?: string; showSearch?: boolean;
}) {
  const [isOther, setIsOther] = useState(() => !!value && !options.includes(value));
  useEffect(() => { if (value === undefined) setIsOther(false); }, [value]);
  const dropdownVal = isOther ? OTHER : (options.includes(value ?? '') ? value : undefined);
  const opts = [...options.map((o) => ({ value: o, label: o })), { value: OTHER, label: 'Other...' }];
  return (
    <div>
      <Select
        value={dropdownVal}
        onChange={(v) => { if (v === OTHER) { setIsOther(true); onChange?.(''); } else { setIsOther(false); onChange?.(v); } }}
        options={opts} placeholder={placeholder} showSearch={showSearch} style={{ width: '100%' }}
      />
      {isOther && (
        <Input value={value || ''} onChange={(e) => onChange?.(e.target.value)}
          placeholder="Specify..." style={{ marginTop: 8 }} autoFocus />
      )}
    </div>
  );
}

function DoiInputRow({
  value, onChange, onRemove, canRemove,
}: {
  value: string; onChange: (v: string) => void; onRemove: () => void; canRemove: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<{ title: string; authors: string } | null>(null);
  const [notFound, setNotFound] = useState(false);
  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed) { setMeta(null); setNotFound(false); return; }
    setNotFound(false);
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          'https://api.crossref.org/works/' + encodeURIComponent(trimmed),
          { headers: { 'User-Agent': 'RiPPository/1.0' } },
        );
        if (!res.ok) { setMeta(null); setNotFound(true); return; }
        const json = await res.json();
        const msg = json?.message;
        const title: string = msg?.title?.[0] ?? '';
        const authors: string = (msg?.author ?? [])
          .map((a: { given?: string; family?: string }) => [a.given, a.family].filter(Boolean).join(' '))
          .join(', ');
        if (title) { setMeta({ title, authors }); setNotFound(false); }
        else { setMeta(null); setNotFound(true); }
      } catch { setMeta(null); setNotFound(true); }
      finally { setLoading(false); }
    }, 800);
    return () => clearTimeout(timer);
  }, [value]);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input addonBefore="https://doi.org/" value={value} onChange={(e) => onChange(e.target.value)}
          placeholder="10.xxxx/xxxxxxx" style={{ flex: 1 }} />
        {canRemove && <Button size="small" danger onClick={onRemove} style={{ flexShrink: 0 }}>Remove</Button>}
      </div>
      {loading && <div style={{ marginTop: 4, fontSize: 12, color: '#9ca3af', paddingLeft: 4 }}>Fetching from CrossRef...</div>}
      {!loading && meta && (
        <div style={{ marginTop: 4, fontSize: 12, paddingLeft: 4 }}>
          <span style={{ color: '#1e3a5f', fontWeight: 500 }}>{meta.title}</span>
          {meta.authors && <span style={{ color: '#6b7280' }}> &mdash; {meta.authors}</span>}
        </div>
      )}
      {!loading && notFound && value.trim() && (
        <div style={{ marginTop: 4, fontSize: 12, color: '#dc2626', paddingLeft: 4 }}>DOI not found in CrossRef</div>
      )}
    </div>
  );
}

// -- Database Suggestion Panel -------------------------------------------------
type DbSuggestion = {
  db: string;
  id: string;
  matchedBy: 'SMILES' | 'Name' | 'InChIKey';
  url: string;
  displayName?: string;
};

const DB_SUGGESTION_BADGE: Record<string, { bg: string; text: string }> = {
  'PubChem CID': { bg: '#dbeafe', text: '#1e40af' },
  'ChEBI':       { bg: '#dcfce7', text: '#166534' },
  'KEGG':        { bg: '#fef3c7', text: '#92400e' },
  'Wikidata':    { bg: '#ede9fe', text: '#5b21b6' },
  'HMDB':        { bg: '#fce7f3', text: '#9d174d' },
  'NPAtlas':     { bg: '#ecfdf5', text: '#065f46' },
};

function DbSuggestionPanel({
  smiles, smilesValid, compoundName, inchikey, addedLinks, onAdd,
}: {
  smiles: string;
  smilesValid: boolean;
  compoundName: string | undefined;
  inchikey: string | undefined;
  addedLinks: Array<{ db: string; id: string }>;
  onAdd: (db: string, id: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<DbSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const prevKeyRef = useRef('');

  const runSearch = useCallback(async (force = false) => {
    const name = compoundName?.trim() ?? '';
    const currentKey = smiles + '|||' + name + '|||' + (inchikey ?? '');
    if (!force && currentKey === prevKeyRef.current) return;
    prevKeyRef.current = currentKey;
    setSearching(true);
    setSuggestions([]);
    const results: DbSuggestion[] = [];

    // PubChem by SMILES
    if (smilesValid && smiles) {
      try {
        const enc = encodeURIComponent(smiles);
        const res = await fetch(
          `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${enc}/property/IUPACName,CID/JSON`,
        );
        if (res.ok) {
          const data = await res.json();
          const props = data?.PropertyTable?.Properties?.[0];
          if (props?.CID) {
            results.push({
              db: 'PubChem CID', id: String(props.CID), matchedBy: 'SMILES',
              url: `https://pubchem.ncbi.nlm.nih.gov/compound/${props.CID}`,
              displayName: props.IUPACName,
            });
          }
        }
      } catch (_) { /* ignore */ }
    }

    // PubChem by InChIKey
    if (inchikey && !results.some((r) => r.db === 'PubChem CID')) {
      try {
        const res = await fetch(
          `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/${encodeURIComponent(inchikey)}/property/IUPACName,CID/JSON`,
        );
        if (res.ok) {
          const data = await res.json();
          const props = data?.PropertyTable?.Properties?.[0];
          if (props?.CID) {
            results.push({
              db: 'PubChem CID', id: String(props.CID), matchedBy: 'InChIKey',
              url: `https://pubchem.ncbi.nlm.nih.gov/compound/${props.CID}`,
              displayName: props.IUPACName,
            });
          }
        }
      } catch (_) { /* ignore */ }
    }

    // PubChem by name (fallback)
    if (name && !results.some((r) => r.db === 'PubChem CID')) {
      try {
        const res = await fetch(
          `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/IUPACName,CID/JSON`,
        );
        if (res.ok) {
          const data = await res.json();
          const props = data?.PropertyTable?.Properties?.[0];
          if (props?.CID) {
            results.push({
              db: 'PubChem CID', id: String(props.CID), matchedBy: 'Name',
              url: `https://pubchem.ncbi.nlm.nih.gov/compound/${props.CID}`,
              displayName: props.IUPACName,
            });
          }
        }
      } catch (_) { /* ignore */ }
    }

    // ChEBI by name
    if (name) {
      try {
        const res = await fetch(
          `https://www.ebi.ac.uk/ebisearch/ws/rest/chebi?query=${encodeURIComponent(name)}&fields=id,name&format=json&size=1`,
        );
        if (res.ok) {
          const data = await res.json();
          const hit = data?.entries?.[0];
          if (hit?.id) {
            const chebiId = hit.id.replace('CHEBI:', '');
            results.push({
              db: 'ChEBI', id: `CHEBI:${chebiId}`, matchedBy: 'Name',
              url: `https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:${chebiId}`,
              displayName: hit.fields?.name?.[0],
            });
          }
        }
      } catch (_) { /* ignore */ }
    }

    // KEGG by name
    if (name) {
      try {
        const res = await fetch(
          `https://rest.kegg.jp/find/compound/${encodeURIComponent(name)}`,
        );
        if (res.ok) {
          const text = await res.text();
          const firstLine = text.trim().split('\n')[0];
          if (firstLine) {
            const parts = firstLine.split('\t');
            const rawId = parts[0]?.trim();   // e.g. "cpd:C05687"
            const label = parts[1]?.split(';')[0]?.trim();
            if (rawId) {
              const keggId = rawId.replace(/^cpd:/, '');
              results.push({
                db: 'KEGG', id: keggId, matchedBy: 'Name',
                url: `https://www.genome.jp/entry/${keggId}`,
                displayName: label,
              });
            }
          }
        }
      } catch (_) { /* ignore */ }
    }

    // Wikidata by InChIKey (covers LOTUS natural products entries)
    if (inchikey) {
      try {
        const sparql = `SELECT ?item ?itemLabel WHERE { ?item wdt:P235 "${inchikey}". SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
        const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
        const res = await fetch(url, { headers: { Accept: 'application/sparql-results+json' } });
        if (res.ok) {
          const data = await res.json();
          const binding = data?.results?.bindings?.[0];
          if (binding?.item?.value) {
            const qid = binding.item.value.replace('http://www.wikidata.org/entity/', '');
            results.push({
              db: 'Wikidata', id: qid, matchedBy: 'InChIKey',
              url: `https://www.wikidata.org/wiki/${qid}`,
              displayName: binding.itemLabel?.value,
            });
          }
        }
      } catch (_) { /* ignore */ }
    }

    // HMDB by name
    if (name) {
      try {
        const res = await fetch(
          `https://hmdb.ca/metabolites.json?q=${encodeURIComponent(name)}&utf8=true`,
        );
        if (res.ok) {
          const data = await res.json();
          const hit = data?.[0];
          if (hit?.accession) {
            results.push({
              db: 'HMDB', id: hit.accession, matchedBy: 'Name',
              url: `https://hmdb.ca/metabolites/${hit.accession}`,
              displayName: hit.name,
            });
          }
        }
      } catch (_) { /* ignore */ }
    }

    // NPAtlas by InChIKey (most reliable)
    if (inchikey) {
      try {
        const res = await fetch(
          `https://www.npatlas.org/api/v1/compounds?inchikey=${encodeURIComponent(inchikey)}&limit=1`,
        );
        if (res.ok) {
          const data = await res.json();
          const hit = data?.[0];
          if (hit?.npaid) {
            results.push({
              db: 'NPAtlas', id: hit.npaid, matchedBy: 'InChIKey',
              url: `https://www.npatlas.org/explore/compounds/${hit.npaid}`,
              displayName: hit.original_name,
            });
          }
        }
      } catch (_) { /* ignore */ }
    }

    // NPAtlas by name (fallback)
    if (name && !results.some((r) => r.db === 'NPAtlas')) {
      try {
        const res = await fetch(
          `https://www.npatlas.org/api/v1/compounds?compound_name=${encodeURIComponent(name)}&limit=1`,
        );
        if (res.ok) {
          const data = await res.json();
          const hit = data?.[0];
          if (hit?.npaid) {
            results.push({
              db: 'NPAtlas', id: hit.npaid, matchedBy: 'Name',
              url: `https://www.npatlas.org/explore/compounds/${hit.npaid}`,
              displayName: hit.original_name,
            });
          }
        }
      } catch (_) { /* ignore */ }
    }

    setSuggestions(results);
    setSearching(false);
    setSearched(true);
  }, [smiles, smilesValid, compoundName, inchikey]);

  useEffect(() => {
    if (smilesValid && smiles) runSearch();
  }, [smilesValid, smiles, runSearch]);

  const isAdded = (db: string, id: string) => addedLinks.some((l) => l.db === db && l.id === id);

  if (!smilesValid && !compoundName?.trim()) return null;

  return (
    <div style={{ marginBottom: 16, padding: '12px 16px', border: '1px solid #e5e7eb', borderRadius: 8, backgroundColor: '#f9fafb' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: searched || searching ? 10 : 0 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#374151' }}>Database Matches</span>
        <Button size="small" onClick={() => runSearch(true)} loading={searching} style={{ fontSize: 12 }}>
          {searched ? 'Re-search' : 'Search databases'}
        </Button>
      </div>
      {searching && <div style={{ fontSize: 12, color: '#6b7280' }}>Searching PubChem, ChEBI, KEGG, Wikidata, HMDB and NPAtlas...</div>}
      {searched && !searching && suggestions.length === 0 && (
        <div style={{ fontSize: 12, color: '#6b7280' }}>No matches found.</div>
      )}
      {suggestions.map((s, i) => {
        const badge = DB_SUGGESTION_BADGE[s.db] ?? { bg: '#f3f4f6', text: '#374151' };
        const added = isAdded(s.db, s.id);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0', borderTop: i > 0 ? '1px solid #e5e7eb' : undefined }}>
            <span style={{ fontSize: 11, background: badge.bg, color: badge.text, borderRadius: 4, padding: '2px 7px', fontWeight: 600, whiteSpace: 'nowrap' }}>{s.db}</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>{s.id}</span>
            {s.displayName && <span style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>{s.displayName}</span>}
            <span style={{ fontSize: 11, background: '#f3f4f6', color: '#6b7280', borderRadius: 10, padding: '1px 8px', whiteSpace: 'nowrap' }}>matched by {s.matchedBy}</span>
            <a href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb', whiteSpace: 'nowrap' }}>View &#8599;</a>
            <Button
              size="small" disabled={added} type={added ? 'default' : 'primary'}
              onClick={() => onAdd(s.db, s.id)}
              style={{ marginLeft: 'auto', fontSize: 11, minWidth: 90 }}>
              {added ? 'Added' : 'Add to record'}
            </Button>
          </div>
        );
      })}
    </div>
  );
}


function SpectrumCard({
  idx, entry, onChange, onRemove, canRemove,
}: {
  idx: number; entry: SpectrumEntry;
  onChange: (updates: Partial<SpectrumEntry>) => void;
  onRemove: () => void; canRemove: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const parsedPeaks = useMemo(() => parsePeakList(entry.peakText), [entry.peakText]);
  const mgfPeaks = useMemo(() => (entry.mgfContent ? parseMgf(entry.mgfContent) : null), [entry.mgfContent]);

  return (
    <div style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '16px 20px', marginBottom: 16, backgroundColor: '#fafafa' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: '#1e3a5f' }}>Spectrum {idx + 1}</span>
        {canRemove && <Button size="small" danger onClick={onRemove}>Remove</Button>}
      </div>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="Instrument" style={{ marginBottom: 12 }}>
            <SelectWithOther options={INSTRUMENTS} placeholder="Select instrument" showSearch
              value={entry.instrument} onChange={(v) => onChange({ instrument: v })} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="Instrument Type" style={{ marginBottom: 12 }}>
            <SelectWithOther options={INSTRUMENT_TYPES} placeholder="Select type"
              value={entry.instrumentType} onChange={(v) => onChange({ instrumentType: v })} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={6}>
          <Form.Item label="MS Type" style={{ marginBottom: 12 }}>
            <Select options={toOptions(MS_TYPES)} value={entry.msType}
              onChange={(v) => onChange({ msType: v })} />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item label="Ion Mode" style={{ marginBottom: 12 }}>
            <Select options={toOptions(ION_MODES)} value={entry.ionMode}
              onChange={(v) => onChange({ ionMode: v })} />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item label="Ionization" style={{ marginBottom: 12 }}>
            <SelectWithOther options={IONIZATIONS} placeholder="Select"
              value={entry.ionization} onChange={(v) => onChange({ ionization: v })} />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item label="Precursor Type" style={{ marginBottom: 12 }}>
            <SelectWithOther options={PRECURSOR_TYPES} placeholder="Select"
              value={entry.precursorType} onChange={(v) => onChange({ precursorType: v })} />
          </Form.Item>
        </Col>
      </Row>
      {entry.msType !== 'MS1' && (
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="Collision Energy" style={{ marginBottom: 12 }}>
              <SelectWithOther options={COLLISION_ENERGIES} placeholder="Select"
                value={entry.collisionEnergy} onChange={(v) => onChange({ collisionEnergy: v })} />
            </Form.Item>
          </Col>
        </Row>
      )}
      <Form.Item label="Peak Data" style={{ marginBottom: 0 }}>
        <Radio.Group value={entry.inputMode}
          onChange={(e) => onChange({ inputMode: e.target.value as 'peaks' | 'mgf' })}
          style={{ marginBottom: 12 }}>
          <Radio.Button value="peaks">Enter peak list</Radio.Button>
          <Radio.Button value="mgf">Upload MGF file</Radio.Button>
        </Radio.Group>
        {entry.inputMode === 'peaks' ? (
          <>
            <Input.TextArea
              rows={6}
              placeholder={'147.063 121.684\n303.050 10000.000\n449.108 657.368'}
              value={entry.peakText}
              onChange={(e) => onChange({ peakText: e.target.value })}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            {entry.peakText.trim() && !parsedPeaks && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#dc2626' }}>
                Invalid format: each line must be: m/z intensity (e.g. 303.05 10000)
              </div>
            )}
            {parsedPeaks && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#059669' }}>
                {parsedPeaks.length} peak{parsedPeaks.length !== 1 ? 's' : ''} parsed, relative intensities auto-calculated
              </div>
            )}
          </>
        ) : (
          <div>
            <input ref={fileInputRef} type="file" accept=".mgf" style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => onChange({ mgfFileName: file.name, mgfContent: ev.target?.result as string });
                reader.readAsText(file);
                e.target.value = '';
              }}
            />
            <Button onClick={() => fileInputRef.current?.click()}>
              {entry.mgfFileName ? 'Change file' : 'Choose MGF file'}
            </Button>
            {entry.mgfFileName && (
              <span style={{ marginLeft: 12, fontSize: 12, color: '#374151' }}>{entry.mgfFileName}</span>
            )}
            {entry.mgfContent && mgfPeaks && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#059669' }}>
                {mgfPeaks.length} peak{mgfPeaks.length !== 1 ? 's' : ''} parsed from MGF
              </div>
            )}
            {entry.mgfContent && !mgfPeaks && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626' }}>Could not parse peaks from MGF file</div>
            )}
          </div>
        )}
      </Form.Item>
    </div>
  );
}

function SubmitView() {
  const [form] = Form.useForm();
  const [messageApi, ctx] = message.useMessage();
  const [structureValue, setStructureValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orcidName, setOrcidName] = useState<string | null>(null);
  const [orcidLoading, setOrcidLoading] = useState(false);
  const [orcidError, setOrcidError] = useState(false);

  const fetchOrcidName = useCallback(async () => {
    const id: string = (form.getFieldValue('orcid') as string | undefined)?.trim() ?? '';
    if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id)) return;
    setOrcidLoading(true);
    setOrcidError(false);
    try {
      const res = await fetch(`https://pub.orcid.org/v3.0/${id}/person`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) { setOrcidError(true); return; }
      const json = await res.json();
      const given = json?.name?.['given-names']?.value ?? '';
      const family = json?.name?.['family-name']?.value ?? '';
      const full = [given, family].filter(Boolean).join(' ');
      if (full) { setOrcidName(full); }
      else { setOrcidError(true); }
    } catch { setOrcidError(true); }
    finally { setOrcidLoading(false); }
  }, [form]);
  const [note, setNote] = useState('');
  const [dbLinks, setDbLinks] = useState<Array<{ db: string; id: string }>>([]);

  const addDbLink = useCallback(() => setDbLinks((prev) => [...prev, { db: DB_OPTIONS[0].value, id: '' }]), []);
  const removeDbLink = useCallback((idx: number) => setDbLinks((prev) => prev.filter((_, i) => i !== idx)), []);
  const updateDbLink = useCallback((idx: number, field: 'db' | 'id', val: string) => {
    setDbLinks((prev) => prev.map((row, i) => i === idx ? { ...row, [field]: val } : row));
  }, []);

  const addDbLinkEntry = useCallback((db: string, id: string) => {
    setDbLinks((prev) =>
      prev.some((l) => l.db === db && l.id === id) ? prev : [...prev, { db, id }],
    );
  }, []);


  const [dois, setDois] = useState<string[]>(['']);
  const addDoi = useCallback(() => setDois((prev) => [...prev, '']), []);
  const removeDoi = useCallback((idx: number) => setDois((prev) => prev.filter((_, i) => i !== idx)), []);
  const updateDoi = useCallback((idx: number, val: string) => setDois((prev) => prev.map((d, i) => i === idx ? val : d)), []);

  const [bioactivities, setBioactivities] = useState<Array<{ activity: string; target: string; mic: string; ic50: string }>>([]);
  const addBioactivity = useCallback(() => setBioactivities((prev) => [...prev, { activity: '', target: '', mic: '', ic50: '' }]), []);
  const removeBioactivity = useCallback((idx: number) => setBioactivities((prev) => prev.filter((_, i) => i !== idx)), []);
  const updateBioactivity = useCallback((idx: number, field: string, val: string) => {
    setBioactivities((prev) => prev.map((b, i) => i === idx ? { ...b, [field]: val } : b));
  }, []);

  const [spectra, setSpectra] = useState<SpectrumEntry[]>([defaultSpectrum()]);
  const addSpectrum = useCallback(() => setSpectra((prev) => [...prev, defaultSpectrum()]), []);
  const removeSpectrum = useCallback((idx: number) => setSpectra((prev) => prev.filter((_, i) => i !== idx)), []);
  const updateSpectrum = useCallback((idx: number, updates: Partial<SpectrumEntry>) => {
    setSpectra((prev) => prev.map((s, i) => i === idx ? { ...s, ...updates } : s));
  }, []);

  const accessionRef = useRef(generateAccession());

  // Pre-fill from template (set by "Use as template" in SubmitLandingView)
  useEffect(() => {
    const raw = sessionStorage.getItem('rippository_new_template');
    if (!raw) return;
    sessionStorage.removeItem('rippository_new_template');
    try {
      const t = JSON.parse(raw) as RiPPSubmission;
      form.setFieldsValue({
        compoundName: t.compoundName ?? '',
        compoundClass: t.compoundClass ?? '',
        compoundSubClass: t.compoundSubClass ?? undefined,
        formula: t.formula ?? '',
        orcid: '',
        license: t.license ?? '',
        genomeMibig: t.genome?.mibig ?? '',
        genomeGenbank: t.genome?.genbank ?? '',
        originOrganism: t.origin?.organism ?? '',
        originStrain: t.origin?.strain ?? '',
        originSource: t.origin?.source ?? '',
        originGeography: t.origin?.geography ?? '',
        ...(t.smiles ? { smiles: t.smiles } : {}),
        ...(t.inchi ? { inchi: t.inchi } : {}),
        ...(t.inchikey ? { inchikey: t.inchikey } : {}),
        ...(t.precursorSeq ? { precursorSeq: t.precursorSeq } : {}),
      });
      if (t.smiles) setStructureValue(t.smiles);
      if (t.dois?.length) setDois(t.dois);
      if (t.note) setNote(t.note);
      if (t.dbLinks?.length) setDbLinks(t.dbLinks.map((l) => ({ db: l.db ?? '', id: l.id ?? '' })));
      if (t.bioactivity?.length) setBioactivities(t.bioactivity.map((b) => ({
        activity: b.activity ?? '', target: b.target ?? '', mic: b.mic ?? '', ic50: b.ic50 ?? '',
      })));
      if (t.genome?.bgcStart != null) form.setFieldValue('bgcStart', String(t.genome.bgcStart));
      if (t.genome?.bgcEnd != null) form.setFieldValue('bgcEnd', String(t.genome.bgcEnd));
    } catch { /* ignore parse errors */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [debouncedSmiles, setDebouncedSmiles] = useState('');
  const [smilesInfo, setSmilesInfo] = useState<{ formula: string; inchi: string; inchikey: string } | null>(null);
  const [smilesMolfile, setSmilesMolfile] = useState<string | null>(null);
  const [smilesError, setSmilesError] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSmiles(structureValue), 400);
    return () => clearTimeout(t);
  }, [structureValue]);

  useEffect(() => {
    const smiles = debouncedSmiles.trim();
    if (!smiles) { setSmilesInfo(null); setSmilesMolfile(null); setSmilesError(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const smilesParser = new SmilesParser({ smartsMode: 'smiles', createSmartsWarnings: false });
        const mol = smilesParser.parseMolecule(smiles);
        mol.inventCoordinates();
        const mf = mol.getMolecularFormula();
        const molfile = mol.toMolfileV3();
        if (cancelled) return;
        setSmilesMolfile(molfile);
        setSmilesInfo({ formula: mf.formula, inchi: '', inchikey: '' });
        setSmilesError(false);
        if (mf.formula) form.setFieldValue('formula', mf.formula);
        // Fetch InChI and InChIKey from PubChem
        try {
          const res = await fetch(
            `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/property/InChI,InChIKey/JSON`,
          );
          if (!cancelled && res.ok) {
            const data = await res.json();
            const props = data?.PropertyTable?.Properties?.[0];
            if (props) {
              setSmilesInfo({ formula: mf.formula, inchi: props.InChI || '', inchikey: props.InChIKey || '' });
            }
          }
        } catch { /* InChI fetch failed silently */ }
      } catch {
        if (!cancelled) { setSmilesInfo(null); setSmilesMolfile(null); setSmilesError(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedSmiles, form]);

  const formula = Form.useWatch('formula', form) as string | undefined;
  const compoundName = Form.useWatch('compoundName', form) as string | undefined;
  const selectedRippClass = Form.useWatch('compoundClass', form) as string | undefined;
  const exactMass = useMemo(() => (formula ? calculateExactMass(formula) : null), [formula]);

  const [mibigLoading, setMibigLoading] = useState(false);
  const [mibigStatus, setMibigStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [bgcStart, setBgcStart] = useState<number | null>(null);
  const [bgcEnd, setBgcEnd] = useState<number | null>(null);
  const [bgcGenes, setBgcGenes] = useState<BgcGene[]>([]);
  const [bgcLoading, setBgcLoading] = useState(false);
  const [bgcError, setBgcError] = useState(false);
  const [bgcClass, setBgcClass] = useState<string[]>([]);
  const loadBgcGenes = useCallback(async (genbank: string, start: string, end: string) => {
    setBgcGenes([]); setBgcError(false); setBgcLoading(true);
    try {
      const startParam = start ? `&seq_start=${start}` : '';
      const endParam = end ? `&seq_stop=${end}` : '';
      const ncbiRes = await fetch(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nucleotide&id=${encodeURIComponent(genbank)}&rettype=gb&retmode=text${startParam}${endParam}`,
      );
      if (ncbiRes.ok) {
        const gbText = await ncbiRes.text();
        const genes = parseGenbankCds(gbText);
        if (genes.length > 0) setBgcGenes(genes);
        else setBgcError(true);
      } else {
        setBgcError(true);
      }
    } catch { setBgcError(true); }
    finally { setBgcLoading(false); }
  }, []);

  const fetchMibig = useCallback(async () => {
    const trimmed = (form.getFieldValue('genomeMibig') as string | undefined)?.trim().toUpperCase();
    if (!trimmed) return;
    if (!/^BGC\d+$/.test(trimmed)) { setMibigStatus('error'); return; }
    setMibigLoading(true);
    setMibigStatus('idle');
    setBgcStart(null); setBgcEnd(null); setBgcGenes([]); setBgcError(false); setBgcClass([]);
    form.setFieldsValue({
      genomeGenbank: '',
      originOrganism: '', originStrain: '', originSource: '', originGeography: '',
    });
    try {
      const res = await fetch('https://raw.githubusercontent.com/mibig-secmet/mibig-json/master/data/' + trimmed + '.json');
      if (!res.ok) { setMibigStatus('error'); return; }
      const json = await res.json();
      const cluster = json?.cluster;
      if (!cluster) { setMibigStatus('error'); return; }
      const biosyn: string[] = cluster?.biosyn_class ?? [];
      setBgcClass(biosyn);
      const genbank = cluster?.loci?.accession ?? '';
      const start = cluster?.loci?.start_coord?.toString() ?? '';
      const end = cluster?.loci?.end_coord?.toString() ?? '';
      const fullName: string = cluster?.organism_name ?? '';
      const nameParts = fullName.split(/\s+/);
      const organism = nameParts.slice(0, 2).join(' ');
      const strainRaw = nameParts.slice(2).join(' ');
      if (genbank) form.setFieldValue('genomeGenbank', genbank);
      if (start) setBgcStart(parseInt(start));
      if (end) setBgcEnd(parseInt(end));
      if (organism) form.setFieldValue('originOrganism', organism);
      if (strainRaw) form.setFieldValue('originStrain', strainRaw);
      if (genbank) {
        // Fetch metadata (isolation source, country, strain) from NCBI
        try {
          const metaRes = await fetch(
            `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nucleotide&id=${encodeURIComponent(genbank)}&rettype=gb&retmode=text`,
          );
          if (metaRes.ok) {
            const gbText = await metaRes.text();
            const isoMatch = gbText.match(/\/isolation_source="([^"]+)"/);
            const countryMatch = gbText.match(/\/country="([^"]+)"/);
            const strainMatch = gbText.match(/\/strain="([^"]+)"/);
            if (isoMatch?.[1]) form.setFieldValue('originSource', isoMatch[1]);
            if (countryMatch?.[1]) form.setFieldValue('originGeography', countryMatch[1]);
            if (strainMatch?.[1]) form.setFieldValue('originStrain', strainMatch[1]);
          }
        } catch { /* metadata fetch failed, ignore */ }
        // Load BGC gene map
        await loadBgcGenes(genbank, start, end);
      }
      setMibigStatus('ok');
    } catch { setMibigStatus('error'); }
    finally { setMibigLoading(false); }
  }, [form, loadBgcGenes]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const handleSubmit = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const filteredDois = dois.filter((d) => d.trim());
      if (filteredDois.length === 0) {
        messageApi.error('Please enter at least one publication DOI.'); return;
      }
      const invalidDois = filteredDois.filter((d) => !DOI_PATTERN.test(d.trim()));
      if (invalidDois.length > 0) {
        messageApi.error('Invalid DOI format. Must start with "10." (e.g. 10.1038/s41586-021-03564-6).'); return;
      }
      const invalidDbLinks = dbLinks.filter((l) => l.db && l.id.trim() && !DB_ID_PATTERN.test(l.id.trim()));
      if (invalidDbLinks.length > 0) {
        messageApi.error('Database IDs may only contain letters, numbers, colons, hyphens, dots, slashes, and underscores.'); return;
      }
      if (!structureValue.trim() && !values.precursorSeq?.trim()) {
        messageApi.error('Please provide a SMILES structure or a precursor peptide sequence.'); return;
      }
      for (let i = 0; i < spectra.length; i++) {
        const s = spectra[i];
        if (!s.instrument) { messageApi.error(`Spectrum ${i + 1}: please select an instrument.`); return; }
        if (!s.instrumentType) { messageApi.error(`Spectrum ${i + 1}: please select an instrument type.`); return; }
        if (!s.ionization) { messageApi.error(`Spectrum ${i + 1}: please select ionization.`); return; }
        if (!s.precursorType) { messageApi.error(`Spectrum ${i + 1}: please select precursor type.`); return; }
        if (s.msType !== 'MS1' && !s.collisionEnergy && s.collisionEnergy !== 'Not reported') { messageApi.error(`Spectrum ${i + 1}: please select collision energy.`); return; }
        const peaks = s.inputMode === 'peaks' ? parsePeakList(s.peakText) : parseMgf(s.mgfContent);
        if (!peaks || peaks.length === 0) { messageApi.error(`Spectrum ${i + 1}: please provide valid peak data.`); return; }
      }
      setSubmitting(true);
      const spectraWithPeaks = spectra.map((s) => ({
        ...s,
        peaks: (s.inputMode === 'peaks' ? parsePeakList(s.peakText) : parseMgf(s.mgfContent)) ?? [],
      }));
      const firstS = spectraWithPeaks[0];
      const splash = await calculateSplash(firstS.peaks).catch(() => '');
      const sub: RiPPSubmission = {
        orcid: values.orcid,
        orcidName: orcidName ?? undefined,
        accession: accessionRef.current,
        recordTitle: [compoundName || '?', firstS.instrumentType || '?', firstS.msType].join('; '),
        date: today, license: 'CC BY-SA', exactMass, numPeak: firstS.peaks.length,
        status: 'Pending', submittedAt: new Date().toISOString(),
        dois: dois.filter((d) => d.trim()),
        compoundName: sanitize(values.compoundName), compoundClass: sanitize(values.compoundClass), compoundSubClass: sanitize(values.compoundSubClass) || undefined, formula: sanitize(values.formula),
        smiles: structureValue.trim() || undefined,
        inchi: smilesInfo?.inchi || undefined,
        inchikey: smilesInfo?.inchikey || undefined,
        splash: splash || undefined,
        precursorSeq: sanitize(values.precursorSeq) || undefined,
        instrument: firstS.instrument, instrumentType: firstS.instrumentType,
        msType: firstS.msType, ionMode: firstS.ionMode,
        collisionEnergy: firstS.collisionEnergy, ionization: firstS.ionization,
        precursorType: firstS.precursorType, peaks: firstS.peaks,
        spectra: spectraWithPeaks,
        note: sanitize(note) || undefined,
        dbLinks: dbLinks.filter((l) => l.db && l.id.trim()).length > 0
          ? dbLinks.filter((l) => l.db && l.id.trim()).map((l) => ({ db: l.db, id: l.id.trim() }))
          : undefined,
        bioactivity: bioactivities.filter((b) => b.activity.trim()).length > 0
          ? bioactivities.filter((b) => b.activity.trim()).map((b) => ({
              activity: sanitize(b.activity), target: sanitize(b.target) || undefined,
              mic: sanitize(b.mic) || undefined, ic50: sanitize(b.ic50) || undefined,
            })) : undefined,
        origin: (values.originOrganism || values.originStrain || values.originSource || values.originGeography)
          ? { organism: sanitize(values.originOrganism) || undefined, strain: sanitize(values.originStrain) || undefined,
              source: sanitize(values.originSource) || undefined, geography: sanitize(values.originGeography) || undefined }
          : undefined,
        genome: (values.genomeMibig || values.genomeGenbank)
          ? { mibig: values.genomeMibig?.trim() || undefined, genbank: values.genomeGenbank?.trim() || undefined,
              bgcStart: bgcStart ?? undefined, bgcEnd: bgcEnd ?? undefined }
          : undefined,
      };
      const existing: RiPPSubmission[] = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) ?? '[]');
      existing.unshift(sub);
      localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(existing));
      messageApi.success('Submitted! Job ID: ' + sub.accession + '. Track status in More -> My Submissions.', 7);
      form.resetFields();
      setOrcidName(null); setOrcidLoading(false); setOrcidError(false);
      setStructureValue(''); setNote(''); setDbLinks([]);
      setDois(['']); setBioactivities([]); setSmilesInfo(null); setSmilesMolfile(null);
      setSmilesError(false); setDebouncedSmiles('');
      setSpectra([defaultSpectrum()]); setMibigStatus('idle'); setBgcClass([]);
      accessionRef.current = generateAccession();
    } catch { /* Ant Design shows field-level errors automatically */ }
    finally { setSubmitting(false); }
  }, [form, structureValue, spectra, today, exactMass, messageApi, note, dbLinks, dois, bioactivities, smilesInfo, compoundName]);

  const req = (label: string) => ({ required: true, message: label + ' is required.' });

  // ── Fill-from-existing modal ─────────────────────────────────────────────
  const [fillModalOpen, setFillModalOpen] = useState(false);
  const [fillSelected, setFillSelected] = useState<RiPPSubmission | null>(null);
  const allRecords: RiPPSubmission[] = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) ?? '[]'); } catch { return []; }
  }, []);

  const handleFillFromExisting = useCallback(() => {
    if (!fillSelected) return;
    const t = fillSelected;
    form.setFieldsValue({
      compoundName: t.compoundName ?? '',
      compoundClass: t.compoundClass ?? '',
      formula: t.formula ?? '',
      license: t.license ?? '',
      genomeMibig: t.genome?.mibig ?? '',
      genomeGenbank: t.genome?.genbank ?? '',
      originOrganism: t.origin?.organism ?? '',
      originStrain: t.origin?.strain ?? '',
      originSource: t.origin?.source ?? '',
      originGeography: t.origin?.geography ?? '',
      ...(t.inchi ? { inchi: t.inchi } : {}),
      ...(t.inchikey ? { inchikey: t.inchikey } : {}),
      ...(t.precursorSeq ? { precursorSeq: t.precursorSeq } : {}),
    });
    if (t.smiles) setStructureValue(t.smiles);
    if (t.dois?.length) setDois(t.dois);
    if (t.note) setNote(t.note);
    if (t.dbLinks?.length) setDbLinks(t.dbLinks.map((l) => ({ db: l.db ?? '', id: l.id ?? '' })));
    if (t.bioactivity?.length) setBioactivities(t.bioactivity.map((b) => ({
      activity: b.activity ?? '', target: b.target ?? '', mic: b.mic ?? '', ic50: b.ic50 ?? '',
    })));
    setFillModalOpen(false);
    setFillSelected(null);
    messageApi.success('Form pre-filled from existing record. Please review and update all fields as needed.');
  }, [fillSelected, form, messageApi]);

  return (
    <Content style={{ width: '100%', height: '100%', overflowY: 'auto', backgroundColor: '#f8fafc' }}>
      {ctx}

      {/* Fill-from-existing modal */}
      <Modal
        open={fillModalOpen}
        title="Pre-fill from existing record"
        onCancel={() => { setFillModalOpen(false); setFillSelected(null); }}
        onOk={handleFillFromExisting}
        okText="Pre-fill form"
        okButtonProps={{ disabled: !fillSelected }}
        width={640}
      >
        <p style={{ color: '#6b7280', marginBottom: 12, fontSize: 13 }}>
          Select a record to copy its compound data, structure, origin, and other fields into
          the form. You can edit everything freely afterwards; a new accession will be assigned.
        </p>
        {allRecords.length === 0 ? (
          <div style={{ color: '#9ca3af', fontStyle: 'italic' }}>No existing records found.</div>
        ) : (
          <select
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 14 }}
            onChange={(e) => setFillSelected(allRecords.find((r) => r.accession === e.target.value) ?? null)}
            defaultValue=""
          >
            <option value="" disabled>Select a record</option>
            {allRecords.map((r) => (
              <option key={r.accession} value={r.accession}>
                {r.accession}: {r.compoundName ?? r.recordTitle}
              </option>
            ))}
          </select>
        )}
      </Modal>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 32px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 style={{ color: '#1e3a5f', marginBottom: 0 }}>Submit a RiPP Spectral Record</h2>
          {allRecords.length > 0 && (
            <Button
              size="small"
              onClick={() => setFillModalOpen(true)}
              style={{ fontSize: 13, color: '#2563eb', borderColor: '#bfdbfe' }}
            >
              Pre-fill from existing record
            </Button>
          )}
        </div>
        <Form form={form} layout="vertical" requiredMark={false}>

          <Divider orientation="left">
            <span style={{ color: '#2563eb', fontWeight: 600, fontSize: 14 }}>Part 1: Compound</span>
          </Divider>

          <Form.Item
            label="ORCID iD" name="orcid"
            rules={[
              req('ORCID iD'),
              { pattern: /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, message: 'Enter a valid ORCID iD (e.g. 0000-0001-2345-6789)' },
            ]}
            extra={
              orcidLoading ? (
                <span style={{ fontSize: 12, color: '#6b7280' }}>Looking up ORCID record…</span>
              ) : orcidName ? (
                <span style={{ fontSize: 12, color: '#059669' }}>✓ {orcidName}</span>
              ) : orcidError ? (
                <span style={{ fontSize: 12, color: '#f59e0b' }}>ORCID record not found or profile is private.</span>
              ) : (
                <span style={{ fontSize: 12, color: '#6b7280' }}>
                  Your ORCID iD links this submission to your researcher profile.{' '}
                  <a href="https://orcid.org/register" target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>Register at orcid.org</a>
                </span>
              )
            }
          >
            <Input
              placeholder="0000-0001-2345-6789"
              addonBefore="orcid.org/"
              style={{ maxWidth: 420 }}
              onBlur={fetchOrcidName}
            />
          </Form.Item>

          <Form.Item label="Publication DOI(s)" required>
            {dois.map((d, idx) => (
              <DoiInputRow key={idx} value={d} onChange={(v) => updateDoi(idx, v)}
                onRemove={() => removeDoi(idx)} canRemove={dois.length > 1} />
            ))}
            <Button type="dashed" onClick={addDoi} style={{ marginTop: 4 }}>+ Add another DOI</Button>
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Compound Name" name="compoundName" rules={[req('Compound name')]}>
                <Input placeholder="e.g. Nisin A" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="RiPP Class" name="compoundClass" rules={[req('RiPP class')]}>
                <SelectWithOther options={RIPP_CLASSES} placeholder="Select class" showSearch />
              </Form.Item>
              {selectedRippClass && RIPP_SUBCLASSES[selectedRippClass] && (
                <Form.Item label="Sub-class" name="compoundSubClass" style={{ marginTop: -8 }}>
                  <Select
                    options={RIPP_SUBCLASSES[selectedRippClass].map((s) => ({ value: s, label: s }))}
                    placeholder="Select sub-class (optional)"
                    allowClear
                  />
                </Form.Item>
              )}
            </Col>
          </Row>

          <Form.Item
            label={<span>SMILES <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 12 }}>(optional if precursor sequence is provided below)</span></span>}
          >
            <Input.TextArea rows={3} placeholder="e.g. CC[C@@H](C)[C@H]1NC(=O)..."
              value={structureValue} onChange={(e) => setStructureValue(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: 11 }} />
            {smilesError && debouncedSmiles && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626' }}>
                Invalid SMILES: could not parse structure. Formula will not be auto-filled.
              </div>
            )}
          </Form.Item>

          {debouncedSmiles && smilesMolfile ? (
            <Row gutter={16} style={{ marginTop: -8, marginBottom: 16 }}>
              <Col span={8}>
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, backgroundColor: '#fff', minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <MolfileSvgRenderer molfile={smilesMolfile} width={260} height={150} />
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Structure preview (offline)</div>
                </div>
              </Col>
              <Col span={16}>
                <Row gutter={[16, 8]}>
                  <Col span={24}>
                    <Form.Item label="Molecular Formula" name="formula" rules={[req('Formula'), { pattern: FORMULA_PATTERN, message: 'Formula must contain only letters and numbers (e.g. C10H12N2O).' }]} style={{ marginBottom: 4 }}>
                      <Input placeholder="auto-filled from SMILES" />
                    </Form.Item>
                    {formula && (
                      <p style={{ marginTop: 0, marginBottom: 8, fontSize: 12, color: exactMass ? '#059669' : '#dc2626' }}>
                        {exactMass ? 'Exact mass: ' + exactMass + ' Da' : 'Could not calculate: check formula'}
                      </p>
                    )}
                  </Col>
                </Row>
              </Col>
            </Row>
          ) : (
            <Row gutter={16}>
              <Col span={24}>
                <Form.Item label="Molecular Formula" name="formula" rules={[req('Formula'), { pattern: FORMULA_PATTERN, message: 'Formula must contain only letters and numbers (e.g. C10H12N2O).' }]}>
                  <Input placeholder="e.g. C143H230N42O37S7 (auto-filled when SMILES is entered)" />
                </Form.Item>
                {formula && (
                  <p style={{ marginTop: -12, marginBottom: 16, fontSize: 12, color: exactMass ? '#059669' : '#dc2626' }}>
                    {exactMass ? 'Exact mass: ' + exactMass + ' Da' : 'Could not calculate: check formula'}
                  </p>
                )}
              </Col>
            </Row>
          )}

          <Form.Item
            label="Precursor Peptide Sequence"
            name="precursorSeq"
            extra={<span style={{ fontSize: 12, color: '#6b7280' }}>One-letter amino acid codes. Required if SMILES is not provided.</span>}
            rules={[{ pattern: /^[ACDEFGHIKLMNPQRSTVWYBZJUOXacdefghiklmnpqrstvwybzjuox*\s]+$/, message: 'Use standard one-letter amino acid codes.', warningOnly: true }]}
          >
            <Input placeholder="e.g. ITSIISLCTPGCKTGALMGCNMKTATCHCSIHVSK" style={{ fontFamily: 'monospace' }} />
          </Form.Item>

          <Divider orientation="left">
            <span style={{ color: '#2563eb', fontWeight: 600, fontSize: 14 }}>Part 2: Spectra</span>
          </Divider>

          {spectra.map((s, idx) => (
            <SpectrumCard key={idx} idx={idx} entry={s}
              onChange={(updates) => updateSpectrum(idx, updates)}
              onRemove={() => removeSpectrum(idx)}
              canRemove={spectra.length > 1} />
          ))}
          <Button type="dashed" onClick={addSpectrum} block style={{ marginBottom: 24 }}>
            + Add another spectrum
          </Button>

          <Divider orientation="left">
            <span style={{ color: '#6b7280', fontWeight: 600, fontSize: 14 }}>Extra Information (Optional)</span>
          </Divider>

          <Collapse style={{ marginBottom: 24 }} items={[
            {
              key: 'databases',
              label: <span style={{ fontWeight: 600 }}>Databases</span>,
              children: (
                <>
                <DbSuggestionPanel
                smiles={debouncedSmiles}
                smilesValid={smilesMolfile !== null}
                compoundName={compoundName}
                inchikey={smilesInfo?.inchikey}
                addedLinks={dbLinks}
                onAdd={addDbLinkEntry}
              />
              <Form.Item label="Database Links" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {dbLinks.map((row, idx) => (
                      <DbLinkRow
                        key={idx}
                        db={row.db}
                        id={row.id}
                        onChange={(field, val) => updateDbLink(idx, field, val)}
                        onRemove={() => removeDbLink(idx)}
                      />
                    ))}
                    <Button type="dashed" onClick={addDbLink} style={{ alignSelf: 'flex-start', marginTop: dbLinks.length > 0 ? 4 : 0 }}>+ Add database link</Button>
                  </div>
                </Form.Item>
                </>
              ),
            },
            {
              key: 'bioactivity',
              label: <span style={{ fontWeight: 600 }}>Bioactivity</span>,
              children: (
                <div>
                  {bioactivities.map((b, idx) => (
                    <div key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 16px', marginBottom: 12, backgroundColor: '#fafafa' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontWeight: 500, fontSize: 13, color: '#374151' }}>Entry {idx + 1}</span>
                        <Button size="small" danger onClick={() => removeBioactivity(idx)}>Remove</Button>
                      </div>
                      <Row gutter={16}>
                        <Col span={12}>
                          <Form.Item label="Biological Activity" style={{ marginBottom: 8 }}>
                            <SelectWithOther options={BIO_ACTIVITIES} placeholder="Select activity" showSearch
                              value={b.activity} onChange={(v) => updateBioactivity(idx, 'activity', v)} />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item label="Target Organism" style={{ marginBottom: 8 }}>
                            <Input placeholder="e.g. Staphylococcus aureus" value={b.target}
                              onChange={(e) => updateBioactivity(idx, 'target', e.target.value)} />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Row gutter={16}>
                        <Col span={12}>
                          <Form.Item label="MIC (optional)" style={{ marginBottom: 0 }}>
                            <Input placeholder="e.g. 2 ug/mL" value={b.mic}
                              onChange={(e) => updateBioactivity(idx, 'mic', e.target.value)} />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item label="IC50 (optional)" style={{ marginBottom: 0 }}>
                            <Input placeholder="e.g. 5.3 uM" value={b.ic50}
                              onChange={(e) => updateBioactivity(idx, 'ic50', e.target.value)} />
                          </Form.Item>
                        </Col>
                      </Row>
                    </div>
                  ))}
                  <Button type="dashed" onClick={addBioactivity} style={{ width: '100%' }}>+ Add bioactivity entry</Button>
                </div>
              ),
            },
            {
              key: 'genome',
              label: <span style={{ fontWeight: 600 }}>Genome</span>,
              children: (
                <div>
                  <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                    Enter a MiBIG accession to auto-fill the GenBank accession, BGC coordinates, and producing organism, and render a gene map below.
                  </p>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item label="MiBIG Accession" name="genomeMibig">
                        <Input.Search placeholder="e.g. BGC0000535" addonBefore="MiBIG:"
                          enterButton={<Button type="primary" loading={mibigLoading}>Fetch</Button>}
                          onSearch={fetchMibig} />
                      </Form.Item>
                      {mibigStatus === 'ok' && <div style={{ marginTop: -12, marginBottom: 8, fontSize: 12, color: '#059669' }}>Fields auto-filled from MiBIG.</div>}
                      {mibigStatus === 'error' && <div style={{ marginTop: -12, marginBottom: 8, fontSize: 12, color: '#dc2626' }}>Could not fetch: check the accession (e.g. BGC0000535).</div>}
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item label="GenBank Accession" name="genomeGenbank" rules={[{ pattern: GENBANK_PATTERN, message: 'e.g. CP003112.1', warningOnly: true }]}>
                        <Input.Search
                          placeholder="auto-filled from MiBIG, or enter manually"
                          enterButton={<Button loading={bgcLoading}>Load Gene Map</Button>}
                          onSearch={(val) => {
                            const acc = val.trim();
                            if (!acc) return;
                            const s = bgcStart?.toString() ?? '';
                            const e = bgcEnd?.toString() ?? '';
                            void loadBgcGenes(acc, s, e);
                          }}
                        />
                      </Form.Item>
                    </Col>
                    {bgcStart !== null && bgcEnd !== null && (
                      <Col span={12}>
                        <Form.Item label="BGC Region">
                          <Input value={`${bgcStart.toLocaleString()} – ${bgcEnd.toLocaleString()} bp`} disabled style={{ color: '#374151', backgroundColor: '#f3f4f6' }} />
                        </Form.Item>
                      </Col>
                    )}
                  </Row>
                  <BgcGeneMap genes={bgcGenes} bgcStart={bgcStart} bgcEnd={bgcEnd} loading={bgcLoading} error={bgcError} bgcClass={bgcClass} />
                </div>
              ),
            },
            {
              key: 'origin',
              label: <span style={{ fontWeight: 600 }}>Origin</span>,
              children: (
                <div>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item label="Producing Organism" name="originOrganism">
                        <Input placeholder="e.g. Lactococcus lactis" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Strain / Isolate" name="originStrain">
                        <Input placeholder="e.g. ATCC 11454" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item label="Isolation Source" name="originSource">
                        <SelectWithOther options={ISOLATION_SOURCES} placeholder="Select source" showSearch />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Geographic Origin (optional)" name="originGeography">
                        <Input placeholder="e.g. North Sea, Norway" />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>
              ),
            },
            {
              key: 'notes',
              label: <span style={{ fontWeight: 600 }}>Notes</span>,
              children: (
                <Form.Item label="Notes" style={{ marginBottom: 0 }}>
                  <Input.TextArea rows={4}
                    placeholder="Any additional information about this record, sample preparation, or special conditions..."
                    value={note} onChange={(e) => setNote(e.target.value)} />
                </Form.Item>
              ),
            },
          ]} />

          <Card title={<span style={{ color: '#2563eb', fontSize: 13 }}>Auto-calculated Fields</span>}
            size="small" style={{ backgroundColor: '#f0f9ff', borderColor: '#bfdbfe', marginBottom: 24 }}>
            <Row gutter={[16, 6]} style={{ fontSize: 12, color: '#374151' }}>
              <Col span={12}><strong>Accession:</strong> {accessionRef.current}</Col>
              <Col span={12}><strong>Date:</strong> {today}</Col>
              <Col span={12}>
                <strong>Exact Mass:</strong>{' '}
                {exactMass ? exactMass + ' Da' : <span style={{ color: '#9ca3af' }}>enter formula above</span>}
              </Col>
              <Col span={12}><strong>License:</strong> CC BY-SA</Col>
              <Col span={12}><strong>Spectra:</strong> {spectra.length}</Col>
              <Col span={12}><strong>SPLASH:</strong> <span style={{ color: '#9ca3af' }}>calculated upon review</span></Col>
              <Col span={24}>
                <strong>DOIs:</strong>{' '}
                {dois.filter((d) => d.trim()).length > 0
                  ? dois.filter((d) => d.trim()).join(', ')
                  : <span style={{ color: '#9ca3af' }}>enter DOI above</span>}
              </Col>
            </Row>
          </Card>

          <Button type="primary" size="large" onClick={handleSubmit}
            loading={submitting} block style={{ height: 48 }}>
            Submit Record for Review
          </Button>
        </Form>
      </div>
    </Content>
  );
}

export default SubmitView;

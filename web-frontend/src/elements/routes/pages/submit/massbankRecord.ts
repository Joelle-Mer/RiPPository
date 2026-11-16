// Records in the format the database loader reads (pkg/massbank/parser.go). The Submit page writes
// them, the site's server checks them again before a pull request is opened, and a record already
// in the database can be read back into the form to start a new submission from it.

export type Peak = { mz: number; intensity: number; rel: number };

export type SpectrumSettings = {
  instrument: string;
  instrumentType: string;
  msType: string;
  ionMode: string;
  ionization: string;
  precursorType: string;
  collisionEnergy: string;
  precursorMz?: string;
};

export type RecordSpectrum = SpectrumSettings & { peaks: Peak[]; splash?: string };

export type RecordFields = {
  orcid: string;
  orcidName?: string;
  date: string; // YYYY-MM-DD
  compoundName: string;
  compoundClass: string;
  compoundSubClass?: string;
  formula: string;
  exactMass: number | null;
  smiles?: string;
  inchi?: string;
  precursorSeq?: string;
  dois: string[];
  note?: string;
  dbLinks?: Array<{ db: string; id: string }>;
  bioactivity?: Array<{ activity: string; target?: string; mic?: string; ic50?: string }>;
  origin?: { organism?: string; strain?: string; source?: string; geography?: string };
  genome?: { mibig?: string; genbank?: string };
};

// a new record carries this until the server gives it its accession
export const NEW_ACCESSION = 'NEW';

// every tag pkg/massbank/model.go knows; any other tag stops the loader outright
export const KNOWN_TAGS = [
  'ACCESSION', 'DEPRECATED', 'RECORD_TITLE', 'DATE', 'AUTHORS', 'LICENSE', 'COPYRIGHT',
  'PUBLICATION', 'PROJECT', 'COMMENT',
  'CH$NAME', 'CH$COMPOUND_CLASS', 'CH$FORMULA', 'CH$EXACT_MASS', 'CH$SMILES', 'CH$IUPAC',
  'CH$LINK', 'CH$ATOM_COUNT',
  'SP$SCIENTIFIC_NAME', 'SP$LINEAGE', 'SP$LINK', 'SP$SAMPLE',
  'AC$INSTRUMENT', 'AC$INSTRUMENT_TYPE', 'AC$MASS_SPECTROMETRY', 'AC$CHROMATOGRAPHY', 'AC$GENERAL',
  'MS$FOCUSED_ION', 'MS$DATA_PROCESSING',
  'PK$SPLASH', 'PK$ANNOTATION', 'PK$NUM_PEAK', 'PK$PEAK',
];

// tags held as a list; a second line of any other tag silently replaces the first
const REPEATABLE = new Set([
  'COMMENT', 'CH$NAME', 'CH$COMPOUND_CLASS', 'CH$LINK', 'SP$LINEAGE', 'SP$LINK', 'SP$SAMPLE',
  'AC$MASS_SPECTROMETRY', 'AC$CHROMATOGRAPHY', 'AC$GENERAL', 'MS$FOCUSED_ION', 'MS$DATA_PROCESSING',
]);
// a value the loader splits into "KEY value"; without a space it refuses the line
const SUBTAGGED = new Set([
  'AC$MASS_SPECTROMETRY', 'AC$CHROMATOGRAPHY', 'AC$GENERAL', 'MS$FOCUSED_ION', 'MS$DATA_PROCESSING',
  'CH$LINK', 'SP$LINK',
]);
const REQUIRED = [
  'ACCESSION', 'RECORD_TITLE', 'DATE', 'AUTHORS', 'LICENSE', 'CH$NAME', 'CH$COMPOUND_CLASS',
  'CH$FORMULA', 'CH$EXACT_MASS', 'AC$INSTRUMENT', 'AC$INSTRUMENT_TYPE', 'PK$NUM_PEAK', 'PK$PEAK',
];
const PEAK_HEADER = 'm/z int. rel.int.';
const NUMBER = /^-?\d+(\.\d+)?$/;

// one line of text: a line break inside a value would start a line the loader cannot read
export const oneLine = (value: string | undefined | null) =>
  (value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

const PROTON = 1.007276;
const ADDUCTS: Record<string, { add: number; charge: number; count?: number }> = {
  '[M+H]+': { add: PROTON, charge: 1 },
  '[M+2H]2+': { add: 2 * PROTON, charge: 2 },
  '[M+3H]3+': { add: 3 * PROTON, charge: 3 },
  '[M+4H]4+': { add: 4 * PROTON, charge: 4 },
  '[M-H]-': { add: -PROTON, charge: 1 },
  '[M-2H]2-': { add: -2 * PROTON, charge: 2 },
  '[M+Na]+': { add: 22.989218, charge: 1 },
  '[M+K]+': { add: 38.963158, charge: 1 },
  '[M+NH4]+': { add: 18.033823, charge: 1 },
  '[M+H-H2O]+': { add: PROTON - 18.010565, charge: 1 },
  '[M-H2O-H]-': { add: -18.010565 - PROTON, charge: 1 },
};

// the precursor m/z the formula predicts for this ion type, or null when it is not known
export function expectedPrecursorMz(exactMass: number | null, precursorType: string) {
  const ion = ADDUCTS[precursorType];
  if (exactMass == null || !ion) return null;
  return (exactMass + ion.add) / ion.charge;
}

// the form's database names and the names MassBank records use; the loader splits a link at its
// first space into database and identifier, so the database name itself has none
const LINK_NAMES: Record<string, string> = {
  'KEGG': 'KEGG', 'PubChem CID': 'PUBCHEM', 'CompTox DTXSID': 'COMPTOX', 'ChemSpider': 'CHEMSPIDER',
  'ChEBI': 'CHEBI', 'HMDB': 'HMDB', 'NPAtlas': 'NPATLAS', 'LOTUS': 'LOTUS', 'Wikidata': 'WIKIDATA',
};

function linkLine(db: string, rawId: string) {
  const id = oneLine(rawId).replace(/\s+/g, '');
  const name = LINK_NAMES[db] ?? oneLine(db).toUpperCase().replace(/\s+/g, '_');
  if (!id || !name) return '';
  if (name === 'PUBCHEM') return `PUBCHEM CID:${id.replace(/^CID:/i, '')}`;
  if (name === 'CHEBI') return `CHEBI ${id.replace(/^CHEBI:/i, '')}`;
  return `${name} ${id}`;
}

function readLink(name: string, id: string) {
  const db = Object.keys(LINK_NAMES).find((k) => LINK_NAMES[k] === name) ?? name;
  if (db === 'PubChem CID') return { db, id: id.replace(/^CID:/i, '') };
  if (db === 'ChEBI') return { db, id: /^CHEBI:/i.test(id) ? id : `CHEBI:${id}` };
  return { db, id };
}

function titleFor(fields: RecordFields, s: SpectrumSettings, detail: string[]) {
  return [fields.compoundName, s.instrumentType, s.msType, ...detail].map(oneLine).join('; ');
}

// one title per spectrum, told apart when two spectra of one submission would share one
function titles(fields: RecordFields, spectra: SpectrumSettings[]) {
  const steps: Array<(s: SpectrumSettings, i: number) => string[]> = [
    () => [],
    (s) => (s.collisionEnergy && s.collisionEnergy !== 'Not reported' ? [s.collisionEnergy] : []),
    (s) => [
      ...(s.collisionEnergy && s.collisionEnergy !== 'Not reported' ? [s.collisionEnergy] : []),
      s.precursorType,
    ],
    (_s, i) => [`spectrum ${i + 1}`],
  ];
  for (const step of steps) {
    const made = spectra.map((s, i) => titleFor(fields, s, step(s, i).filter(Boolean)));
    if (new Set(made).size === made.length) return made;
  }
  return spectra.map((s, i) => titleFor(fields, s, [`spectrum ${i + 1}`]));
}

function formatOne(fields: RecordFields, s: RecordSpectrum, title: string, accession: string) {
  const lines: string[] = [];
  const push = (tag: string, value: string | undefined | null) => {
    const v = oneLine(value);
    if (v) lines.push(`${tag}: ${v}`);
  };
  push('ACCESSION', accession);
  push('RECORD_TITLE', title);
  push('DATE', fields.date.replace(/-/g, '.'));
  push('AUTHORS', fields.orcidName ? `${fields.orcidName} (ORCID:${fields.orcid})` : `ORCID:${fields.orcid}`);
  push('LICENSE', 'CC BY-SA');
  lines.push('');

  push('CH$NAME', fields.compoundName);
  push('CH$COMPOUND_CLASS', ['Natural Product', 'RiPP', fields.compoundClass, fields.compoundSubClass]
    .map(oneLine).filter(Boolean).join('; '));
  push('CH$FORMULA', fields.formula);
  if (fields.exactMass != null) push('CH$EXACT_MASS', fields.exactMass.toFixed(4));
  push('CH$SMILES', fields.smiles);
  push('CH$IUPAC', fields.inchi);
  for (const link of fields.dbLinks ?? []) {
    const written = linkLine(link.db, link.id);
    if (written) push('CH$LINK', written);
  }
  lines.push('');

  const o = fields.origin ?? {};
  if (o.organism || o.strain || o.source || o.geography) {
    push('SP$SCIENTIFIC_NAME', o.organism);
    if (oneLine(o.strain)) push('SP$LINEAGE', `strain: ${o.strain}`);
    push('SP$SAMPLE', o.source);
    if (oneLine(o.geography)) push('SP$SAMPLE', `Geographic origin: ${o.geography}`);
    lines.push('');
  }

  push('AC$INSTRUMENT', s.instrument);
  push('AC$INSTRUMENT_TYPE', s.instrumentType);
  push('AC$MASS_SPECTROMETRY', `MS_TYPE ${oneLine(s.msType)}`);
  push('AC$MASS_SPECTROMETRY', `ION_MODE ${oneLine(s.ionMode).toUpperCase()}`);
  if (oneLine(s.collisionEnergy)) push('AC$MASS_SPECTROMETRY', `COLLISION_ENERGY ${s.collisionEnergy}`);
  if (oneLine(s.ionization)) push('AC$MASS_SPECTROMETRY', `IONIZATION ${s.ionization}`);
  if (oneLine(s.precursorMz)) push('MS$FOCUSED_ION', `PRECURSOR_M/Z ${s.precursorMz}`);
  if (oneLine(s.precursorType)) push('MS$FOCUSED_ION', `PRECURSOR_TYPE ${s.precursorType}`);
  lines.push('');

  for (const doi of fields.dois) push('COMMENT', `Publication DOI: ${doi}`);
  if (oneLine(fields.precursorSeq)) push('COMMENT', `PRECURSOR_SEQ ${fields.precursorSeq}`);
  if (oneLine(fields.genome?.mibig)) push('COMMENT', `MiBIG ${fields.genome?.mibig}`);
  if (oneLine(fields.genome?.genbank)) push('COMMENT', `GenBank ${fields.genome?.genbank}`);
  for (const b of fields.bioactivity ?? []) {
    const parts = [b.activity, b.target && `target: ${b.target}`, b.mic && `MIC: ${b.mic}`,
      b.ic50 && `IC50: ${b.ic50}`].map(oneLine).filter(Boolean);
    if (parts.length) push('COMMENT', `BIOACTIVITY ${parts.join('; ')}`);
  }
  // each line of the note is a comment of its own
  for (const line of (fields.note ?? '').split(/\r?\n/)) push('COMMENT', line);
  lines.push('');

  push('PK$SPLASH', s.splash);
  push('PK$NUM_PEAK', String(s.peaks.length));
  lines.push(`PK$PEAK: ${PEAK_HEADER}`);
  for (const p of s.peaks) lines.push(`  ${p.mz.toFixed(4)} ${p.intensity.toFixed(4)} ${p.rel}`);
  lines.push('//');
  return lines.join('\n');
}

// one record per spectrum: a record holds one peak list and one set of instrument settings
export function formatRecords(fields: RecordFields, spectra: RecordSpectrum[], accessions?: string[]) {
  const names = titles(fields, spectra);
  return spectra.map((s, i) => formatOne(fields, s, names[i], accessions?.[i] ?? NEW_ACCESSION));
}

// why the loader would refuse or misread this record, or null when it reads it as written
export function checkRecord(text: string): string | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines[lines.length - 1] !== '//') return 'The record does not end with //.';
  const seen = new Map<string, number>();
  let last = '';
  let peaks = 0;
  for (let n = 0; n < lines.length - 1; n++) {
    const line = lines[n];
    const at = `Line ${n + 1}`;
    if (line === '') continue;
    if (line.startsWith('//')) return `${at}: // may only end the record.`;
    if (line.startsWith('  ')) {
      if (last === 'PK$PEAK') {
        const v = line.trim().split(' ');
        if (v.length !== 3 || !NUMBER.test(v[0]) || !NUMBER.test(v[1]) || !/^\d+$/.test(v[2])) {
          return `${at}: a peak must be "m/z intensity relative-intensity".`;
        }
        peaks++;
        continue;
      }
      if (last === 'PK$ANNOTATION') continue;
      return `${at}: an indented line may only follow PK$PEAK or PK$ANNOTATION.`;
    }
    const colon = line.indexOf(':');
    if (colon < 0) return `${at}: not a tag line.`;
    const tag = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!KNOWN_TAGS.includes(tag)) return `${at}: ${tag} is not a tag the database reads.`;
    if (!value) return `${at}: ${tag} is empty.`;
    if (seen.has(tag) && !REPEATABLE.has(tag)) return `${at}: ${tag} appears twice.`;
    if (SUBTAGGED.has(tag) && !value.includes(' ')) return `${at}: ${tag} needs a name and a value.`;
    if (tag === 'DATE' && !/^\d{4}\.\d{2}\.\d{2}$/.test(value)) return `${at}: the date must be YYYY.MM.DD.`;
    if (tag === 'CH$EXACT_MASS' && !NUMBER.test(value)) return `${at}: the exact mass must be a number.`;
    if (tag === 'PK$NUM_PEAK' && !/^\d+$/.test(value)) return `${at}: the peak count must be a whole number.`;
    if (tag === 'PK$PEAK' && value !== PEAK_HEADER) return `${at}: PK$PEAK must read "${PEAK_HEADER}".`;
    seen.set(tag, n);
    last = tag;
  }
  for (const tag of REQUIRED) if (!seen.has(tag)) return `${tag} is missing.`;
  const counted = Number(lines[seen.get('PK$NUM_PEAK')!].split(':')[1]);
  if (counted !== peaks) return `PK$NUM_PEAK says ${counted} but the record has ${peaks} peaks.`;
  if (peaks === 0) return 'The record has no peaks.';
  return null;
}

export type ReadRecord = {
  accession: string;
  title: string;
  fields: Partial<RecordFields>;
  spectrum: SpectrumSettings;
};

// a record read back into the form's fields; the peaks and the precursor m/z are left out
export function readRecord(text: string): ReadRecord {
  const fields: Partial<RecordFields> = { dois: [] };
  const spectrum: SpectrumSettings = {
    instrument: '', instrumentType: '', msType: 'MS2', ionMode: 'POSITIVE', ionization: '',
    precursorType: '', collisionEnergy: '',
  };
  const origin: NonNullable<RecordFields['origin']> = {};
  const genome: NonNullable<RecordFields['genome']> = {};
  const notes: string[] = [];
  let accession = '';
  let title = '';
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.startsWith('  ') || raw.startsWith('//')) continue;
    const colon = raw.indexOf(':');
    if (colon < 0) continue;
    const tag = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    const [key, ...rest] = value.split(' ');
    const after = rest.join(' ').trim();
    switch (tag) {
      case 'ACCESSION': accession = value; break;
      case 'RECORD_TITLE': title = value; break;
      case 'CH$NAME': fields.compoundName ??= value; break;
      case 'CH$COMPOUND_CLASS': {
        const parts = value.split(';').map((p) => p.trim())
          .filter((p) => p && p !== 'Natural Product' && p !== 'RiPP');
        fields.compoundClass = parts[0] ?? '';
        fields.compoundSubClass = parts[1];
        break;
      }
      case 'CH$FORMULA': fields.formula = value; break;
      case 'CH$EXACT_MASS': fields.exactMass = Number(value); break;
      case 'CH$SMILES': if (value !== 'N/A') fields.smiles = value; break;
      case 'CH$IUPAC': if (value !== 'N/A') fields.inchi = value; break;
      case 'CH$LINK':
        if (after) (fields.dbLinks ??= []).push(readLink(key, after));
        break;
      case 'SP$SCIENTIFIC_NAME': origin.organism = value; break;
      case 'SP$LINEAGE':
        if (/^strain:/i.test(value)) origin.strain = value.replace(/^strain:\s*/i, '');
        break;
      case 'SP$SAMPLE':
        if (/^Geographic origin:/i.test(value)) origin.geography = value.replace(/^Geographic origin:\s*/i, '');
        else origin.source = value;
        break;
      case 'AC$INSTRUMENT': spectrum.instrument = value; break;
      case 'AC$INSTRUMENT_TYPE': spectrum.instrumentType = value; break;
      case 'AC$MASS_SPECTROMETRY':
        if (key === 'MS_TYPE') spectrum.msType = after;
        else if (key === 'ION_MODE') spectrum.ionMode = after.toUpperCase();
        else if (key === 'COLLISION_ENERGY') spectrum.collisionEnergy = after;
        else if (key === 'IONIZATION') spectrum.ionization = after;
        break;
      case 'MS$FOCUSED_ION':
        if (key === 'PRECURSOR_TYPE') spectrum.precursorType = after;
        break;
      case 'COMMENT':
        if (/^Publication DOI:/i.test(value)) fields.dois!.push(value.replace(/^Publication DOI:\s*/i, ''));
        else if (key === 'PRECURSOR_SEQ') fields.precursorSeq = after;
        else if (key === 'MiBIG') genome.mibig = after;
        else if (key === 'GenBank') genome.genbank = after;
        else if (key === 'BIOACTIVITY') {
          const [activity, ...more] = after.split(';').map((p) => p.trim());
          const b: NonNullable<RecordFields['bioactivity']>[number] = { activity };
          for (const m of more) {
            if (/^target:/i.test(m)) b.target = m.replace(/^target:\s*/i, '');
            else if (/^MIC:/i.test(m)) b.mic = m.replace(/^MIC:\s*/i, '');
            else if (/^IC50:/i.test(m)) b.ic50 = m.replace(/^IC50:\s*/i, '');
          }
          (fields.bioactivity ??= []).push(b);
        } else notes.push(value);
        break;
    }
  }
  if (Object.keys(origin).length) fields.origin = origin;
  if (Object.keys(genome).length) fields.genome = genome;
  if (notes.length) fields.note = notes.join('\n');
  return { accession, title, fields, spectrum };
}

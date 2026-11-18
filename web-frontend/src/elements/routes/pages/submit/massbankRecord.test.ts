import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KNOWN_TAGS,
  NEW_ACCESSION,
  checkRecord,
  expectedPrecursorMz,
  formatRecords,
  pdbIdsIn,
  readRecord,
  type RecordFields,
  type RecordSpectrum,
} from './massbankRecord';

// the repository root, and the data repository checked out beside it
const ROOT = join(__dirname, '../../../../../..');
const MODEL = join(ROOT, 'pkg/massbank/model.go');
const DATA = join(ROOT, '../RiPPository-data/RiPP-data');

const fields: RecordFields = {
  orcid: '0000-0002-7894-3039',
  orcidName: 'Testa Person',
  date: '2026-11-16',
  compoundName: 'Testamide A',
  compoundClass: 'Cyanobactin',
  compoundSubClass: 'Macrocyclic',
  formula: 'C24H34N6O4S2',
  exactMass: 534.2083,
  smiles: 'CC(=O)N',
  inchi: 'InChI=1S/C2H5NO/c1-2(3)4/h1H3,(H2,3,4)',
  precursorSeq: 'ITGCIC',
  dois: ['10.1021/np800118g', '10.1000/xyz'],
  note: 'Extracted in methanol.\nSample: freeze-dried cells\n\n',
  dbLinks: [{ db: 'PubChem CID', id: '5280805' }, { db: 'ChEBI', id: 'CHEBI:17234' }],
  bioactivity: [{ activity: 'Cytotoxic', target: 'HeLa', ic50: '5 uM' }],
  origin: {
    organism: 'Microcystis aeruginosa', strain: 'NIES-298', source: 'Freshwater lake or river',
    geography: 'Lake Kasumigaura, Japan', production: 'Heterologous expression',
    host: 'Escherichia coli BL21(DE3)',
  },
  genome: { mibig: 'BGC0000473', genbank: 'AM774406.1' },
  pdb: ['7ZWJ', '2MMW'],
};
const spectrum = (instrument: string, ce: string, peaks: number[][]): RecordSpectrum => ({
  instrument, instrumentType: 'LC-ESI-QTOF', msType: 'MS2', ionMode: 'POSITIVE', ionization: 'ESI',
  precursorType: '[M+H]+', collisionEnergy: ce, precursorMz: '535.2156', splash: 'splash10-x',
  peaks: peaks.map(([mz, intensity, rel]) => ({ mz, intensity, rel })),
});
const two = formatRecords(fields, [
  spectrum('Bruker maXis Impact', '20 eV', [[147.063, 121.684, 12], [303.05, 10000, 999]]),
  spectrum('Thermo Q Exactive', '40 eV', [[100, 50, 50], [200, 999, 999], [300, 10, 10]]),
]);
const tagsOf = (text: string) => text.split('\n').filter((l) => /^[A-Z$_]+:/.test(l)).map((l) => l.split(':')[0]);

describe('records the database loader reads', () => {
  // shown as skipped, not passed, where the loader's source or the data is not beside this code
  it.skipIf(!existsSync(MODEL))('knows exactly the tags the loader knows', () => {
    const go = [...readFileSync(MODEL, 'utf-8').matchAll(/mb2:"([^"]+)"/g)].map((m) => m[1]);
    expect([...KNOWN_TAGS].sort()).toEqual([...new Set(go)].sort());
  });

  it.skipIf(!existsSync(DATA))('passes every record already in RiPPository', () => {
    const files = readdirSync(DATA).filter((f) => f.endsWith('.txt'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect([f, checkRecord(readFileSync(join(DATA, f), 'utf-8'))]).toEqual([f, null]);
  });

  it('writes one record per spectrum, each with its own peaks and settings', () => {
    expect(two).toHaveLength(2);
    for (const r of two) expect(checkRecord(r)).toBeNull();
    expect(two[0]).toContain('AC$INSTRUMENT: Bruker maXis Impact');
    expect(two[0]).not.toContain('Thermo');
    expect(two[0]).toContain('PK$NUM_PEAK: 2');
    expect(two[1]).toContain('AC$INSTRUMENT: Thermo Q Exactive');
    expect(two[1]).toContain('PK$NUM_PEAK: 3');
    expect(two[1]).toContain('  300.0000 10.0000 10');
    for (const r of two) {
      expect(r.startsWith(`ACCESSION: ${NEW_ACCESSION}\n`)).toBe(true);
      expect(r).toContain('MS$FOCUSED_ION: PRECURSOR_M/Z 535.2156');
    }
    // two spectra of one submission are told apart by their titles
    expect(two.map((r) => /^RECORD_TITLE: (.*)$/m.exec(r)![1])).toEqual([
      'Testamide A; LC-ESI-QTOF; MS2; 20 eV',
      'Testamide A; LC-ESI-QTOF; MS2; 40 eV',
    ]);
    expect(/^RECORD_TITLE: (.*)$/m.exec(formatRecords(fields, [spectrum('X', '20 eV', [[1, 1, 1]])])[0])![1])
      .toBe('Testamide A; LC-ESI-QTOF; MS2');
  });

  it('only writes tags the loader knows, and each single tag once', () => {
    for (const r of two) {
      const tags = tagsOf(r);
      expect(tags.filter((t) => !KNOWN_TAGS.includes(t))).toEqual([]);
      for (const single of ['AC$INSTRUMENT', 'AC$INSTRUMENT_TYPE', 'PK$NUM_PEAK', 'CH$FORMULA', 'SP$SCIENTIFIC_NAME']) {
        expect(tags.filter((t) => t === single)).toHaveLength(1);
      }
    }
  });

  it('turns each line of a note into its own comment, and keeps line breaks out of every value', () => {
    expect(two[0]).toContain('COMMENT: Extracted in methanol.\nCOMMENT: Sample: freeze-dried cells\n');
    expect(two[0]).toContain('SP$SAMPLE: Geographic origin: Lake Kasumigaura, Japan');
    const odd = formatRecords({ ...fields, compoundName: 'Two\nlines', origin: { strain: 'A\r\nB' } },
      [spectrum('X', '20 eV', [[1, 1, 1]])])[0];
    expect(checkRecord(odd)).toBeNull();
    expect(odd).toContain('CH$NAME: Two lines');
    expect(odd).toContain('SP$LINEAGE: strain: A B');
  });

  it('writes links the way the loader splits them, database then identifier', () => {
    expect(two[0]).toContain('CH$LINK: PUBCHEM CID:5280805');
    expect(two[0]).toContain('CH$LINK: CHEBI 17234');
  });

  // the controls: each fault the old form could produce is refused
  it.each([
    ['an unknown tag', (r: string) => r.replace('LICENSE:', 'SP$GEOGRAPHY: Japan\nLICENSE:'), /SP\$GEOGRAPHY is not a tag/],
    ['a note line read as a tag', (r: string) => r.replace('COMMENT: Extracted in methanol.', 'COMMENT: Extracted\nSample: cells'), /Sample is not a tag/],
    ['a note line with no tag', (r: string) => r.replace('COMMENT: Extracted in methanol.', 'COMMENT: Extracted\nin methanol'), /not a tag line/],
    ['a second instrument', (r: string) => r.replace('AC$INSTRUMENT_TYPE:', 'AC$INSTRUMENT: Other\nAC$INSTRUMENT_TYPE:'), /AC\$INSTRUMENT appears twice/],
    ['a peak count that is wrong', (r: string) => r.replace('PK$NUM_PEAK: 2', 'PK$NUM_PEAK: 3'), /says 3 but the record has 2/],
    ['a peak with two columns', (r: string) => r.replace('  303.0500 10000.0000 999', '  303.0500 10000.0000'), /a peak must be/],
    ['an indented line out of place', (r: string) => r.replace('CH$FORMULA:', '  stray\nCH$FORMULA:'), /indented line/],
    ['no end mark', (r: string) => r.replace(/\/\/$/, ''), /does not end/],
    ['a settings line without a value', (r: string) => r.replace('MS_TYPE MS2', 'MS_TYPE'), /needs a name and a value/],
    ['a missing tag', (r: string) => r.replace(/^CH\$FORMULA: .*\n/m, ''), /CH\$FORMULA is missing/],
    ['a bad date', (r: string) => r.replace('DATE: 2026.11.16', 'DATE: 16-11-2026'), /YYYY\.MM\.DD/],
    ['a peak of zero intensity', (r: string) => r.replace('  303.0500 10000.0000 999', '  303.0500 0.0000 0'), /intensity above zero/],
  ])('refuses %s', (_name, spoil, why) => {
    const spoiled = spoil(two[0]);
    expect(spoiled).not.toBe(two[0]);
    expect(checkRecord(spoiled)).toMatch(why);
  });

  it('reads a record back into the same fields, leaving the peaks out', () => {
    const back = readRecord(two[1]);
    expect(back.fields).toEqual({
      compoundName: 'Testamide A', compoundClass: 'Cyanobactin', compoundSubClass: 'Macrocyclic',
      formula: 'C24H34N6O4S2', exactMass: 534.2083, smiles: 'CC(=O)N', inchi: fields.inchi,
      precursorSeq: 'ITGCIC', dois: fields.dois, note: 'Extracted in methanol.\nSample: freeze-dried cells',
      dbLinks: fields.dbLinks, bioactivity: [{ activity: 'Cytotoxic', target: 'HeLa', ic50: '5 uM' }],
      origin: fields.origin, genome: fields.genome, pdb: ['7ZWJ', '2MMW'],
    });
    expect(back.spectrum).toEqual({
      instrument: 'Thermo Q Exactive', instrumentType: 'LC-ESI-QTOF', msType: 'MS2', ionMode: 'POSITIVE',
      ionization: 'ESI', precursorType: '[M+H]+', collisionEnergy: '40 eV',
    });
  });

  it.skipIf(!existsSync(join(DATA, 'RIPPOS-LU-0001.txt')))('reads a record already in RiPPository', () => {
    const file = join(DATA, 'RIPPOS-LU-0001.txt');
    const text = readFileSync(file, 'utf-8');
    const r = readRecord(text);
    expect(r.accession).toBe('RIPPOS-LU-0001');
    expect(r.fields.compoundName).toBe('Aerucyclamide A');
    expect([r.fields.compoundClass, r.fields.compoundSubClass]).toEqual(['Cyanobactin', 'Macrocyclic']);
    expect(r.fields.dois).toEqual(['10.1021/np800118g']);
    expect(r.fields.precursorSeq).toBe('ITGCIC');
    expect(r.fields.genome).toEqual({ mibig: 'BGC0000473', genbank: 'AM774406.1' });
    expect(r.fields.origin?.strain).toBe('NIES-298');
    expect(r.fields.bioactivity?.[0].activity).toBe('Grazer');
    expect(r.fields.note).toBeUndefined();
    expect(r.spectrum.instrument).toBe('Micromass ESI Q-TOF Ultima API');
    // and the precursor the formula predicts is the one written in that record
    const written = Number(/PRECURSOR_M\/Z (\S+)/.exec(text)![1]);
    expect(Math.abs(expectedPrecursorMz(r.fields.exactMass!, '[M+H]+')! - written)).toBeLessThan(0.0005);
  });

  it('says how the compound was made, apart from where its gene cluster comes from', () => {
    expect(two[0]).toContain('SP$SCIENTIFIC_NAME: Microcystis aeruginosa\n');
    expect(two[0]).toContain('SP$SAMPLE: Production: Heterologous expression\n');
    expect(two[0]).toContain('SP$SAMPLE: Expression host: Escherichia coli BL21(DE3)\n');
    expect(two[0]).not.toContain('Enzymes');
    const vitro = formatRecords({ ...fields, origin: { production: 'In vitro enzymatic modification', enzymes: 'LasB, LasC' } },
      [spectrum('X', '30 NCE', [[1, 1, 1]])])[0];
    expect(checkRecord(vitro)).toBeNull();
    expect(readRecord(vitro).fields.origin).toEqual({ production: 'In vitro enzymatic modification', enzymes: 'LasB, LasC' });
    expect(vitro).toContain('AC$MASS_SPECTROMETRY: COLLISION_ENERGY 30 NCE');
  });

  it('writes PDB identifiers as comments, and reads them back from a note too', () => {
    expect(two[0]).toContain('COMMENT: PDB 7ZWJ\nCOMMENT: PDB 2MMW\n');
    const bad = formatRecords({ ...fields, pdb: ['7zwj', 'not-an-id'] }, [spectrum('X', '20 eV', [[1, 1, 1]])])[0];
    expect(bad).toContain('COMMENT: PDB 7ZWJ');
    expect(bad).not.toContain('not-an-id');
    // the way the first lasso submissions gave it, in the notes
    const noted = formatRecords({ ...fields, pdb: undefined, note: 'PDB ID: 7ZWJ' }, [spectrum('X', '20 eV', [[1, 1, 1]])])[0];
    expect(readRecord(noted).fields.pdb).toEqual(['7ZWJ']);
    expect(pdbIdsIn('PDB ID: 7ZWJ')).toEqual(['7ZWJ']);
    expect(pdbIdsIn('PDB 7zwj, 2MMW')).toEqual(['7ZWJ', '2MMW']);
    expect(pdbIdsIn('PDB structures were not solved')).toEqual([]);
    expect(pdbIdsIn('Extracted in methanol.')).toEqual([]);
  });

  it('records that peaks were converted from profile data, and refuses profile data left as it was', () => {
    const conv = formatRecords(fields, [{ ...spectrum('X', '20 eV', [[100, 5, 5], [200, 10, 10]]),
      processing: 'FIND_PEAK centroided from profile data on submission to RiPPository (40 points, 2 peaks)' }])[0];
    expect(checkRecord(conv)).toBeNull();
    expect(conv).toContain('MS$DATA_PROCESSING: FIND_PEAK centroided from profile data');
    // a peak sampled as seven points 0.004 Da apart, as the first lasso submissions came
    const run = Array.from({ length: 7 }, (_, k) => [500 + k * 0.004, 100 + 50 * (3 - Math.abs(k - 3)), 1]);
    const prof = formatRecords(fields, [spectrum('X', '20 eV', [...run, ...run.map(([m, i, r]) => [m + 10, i, r])])])[0];
    expect(checkRecord(prof)).toMatch(/profile data/);
  });

  it('predicts the precursor m/z of each ion type', () => {
    expect(expectedPrecursorMz(1000, '[M+2H]2+')).toBeCloseTo(501.007276, 5);
    expect(expectedPrecursorMz(1000, '[M-H]-')).toBeCloseTo(998.992724, 5);
    expect(expectedPrecursorMz(1000, '[M+Na]+')).toBeCloseTo(1022.989218, 5);
    expect(expectedPrecursorMz(null, '[M+H]+')).toBeNull();
    expect(expectedPrecursorMz(1000, 'something else')).toBeNull();
  });
});

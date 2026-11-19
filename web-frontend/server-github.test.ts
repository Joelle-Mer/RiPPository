import { describe, expect, it } from 'vitest';
import {
  checkSubmission,
  githubConfig,
  openSubmissionPr,
  prepareSubmission,
  prStatus,
  rdkitInchi,
  rateLimiter,
  readConfig,
  recordReader,
  takenNumbers,
} from './server-github';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRecord, formatRecords, withInchi } from './src/elements/routes/pages/submit/massbankRecord';

const cfg = { token: 'SECRET-KEY', owner: 'own', repo: 'data', base: 'main' };

const fields = {
  orcid: '0000-0002-7894-3039',
  orcidName: 'Testa Person',
  date: '2026-11-16',
  compoundName: 'Testamide A',
  compoundClass: 'Cyanobactin',
  formula: 'C10H10N2O2',
  exactMass: 190.0742,
  dois: ['10.1021/np800118g'],
};
const spectrum = (instrument: string, ce: string) => ({
  instrument,
  instrumentType: 'LC-ESI-QTOF',
  msType: 'MS2',
  ionMode: 'POSITIVE',
  ionization: 'ESI',
  precursorType: '[M+H]+',
  collisionEnergy: ce,
  precursorMz: '191.0815',
  peaks: [
    { mz: 100.5, intensity: 50, rel: 50 },
    { mz: 150.25, intensity: 999, rel: 999 },
  ],
});
const records = formatRecords(fields, [
  spectrum('Bruker maXis Impact', '20 eV'),
  spectrum('Thermo Q Exactive', '40 eV'),
]);
const good = {
  compoundName: 'Testamide A',
  compoundClass: 'Cyanobactin',
  formula: 'C10H10N2O2',
  orcid: '0000-0002-7894-3039',
  orcidName: 'Testa Person',
  submittedAt: '2026-11-11T10:00:00Z',
  records,
};

type Call = { url: string; init?: RequestInit };

// a stand-in for GitHub that records every call and answers each step
function fakeGitHub(
  opts: { failAt?: string; files?: string[]; branches?: string[]; taken?: Set<string> } = {},
) {
  const calls: Call[] = [];
  const files = opts.files ?? ['README.md', 'RIPPOS-LU-0001.txt', 'RIPPOS-LU-0009.txt'];
  const branches = opts.branches ?? [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const step = url.endsWith('/heads/main')
      ? 'ref'
      : url.includes('/contents/RiPP-data?')
        ? 'list'
        : url.includes('/matching-refs/')
          ? 'branches'
          : url.endsWith('/git/refs')
            ? 'branch'
            : url.includes('/contents/')
              ? 'file'
              : 'pr';
    if (step === opts.failAt) {
      return new Response('{"message":"Bad credentials SECRET-KEY"}', {
        status: 401,
      });
    }
    if (step === 'branch') {
      const ref = JSON.parse(init!.body as string).ref as string;
      if (opts.taken?.has(ref)) {
        return new Response('{"message":"Reference already exists"}', { status: 422 });
      }
    }
    const body =
      step === 'ref'
        ? { object: { sha: 'abc123' } }
        : step === 'list'
          ? files.map((name) => ({ name }))
          : step === 'branches'
            ? branches.map((b) => ({ ref: `refs/heads/${b}` }))
            : step === 'pr'
              ? { html_url: 'https://github.com/own/data/pull/7' }
              : {};
    return new Response(JSON.stringify(body), { status: 201 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('GitHub submissions on the server', () => {
  it('is off without a key, and reads the key at run time', () => {
    expect(githubConfig({})).toBeNull();
    expect(githubConfig({ GITHUB_TOKEN: '  ' })).toBeNull();
    expect(githubConfig({ GITHUB_TOKEN: 'k' })).toEqual({
      token: 'k',
      owner: 'Joelle-Mer',
      repo: 'RiPPository-data',
      base: 'main',
    });
    // reading the public records needs no key
    expect(readConfig({})).toEqual({ owner: 'Joelle-Mer', repo: 'RiPPository-data', base: 'main' });
  });

  it('refuses what it should, and keeps fields to one line', () => {
    expect(checkSubmission(null)).toBeTypeOf('string');
    expect(checkSubmission({ ...good, records: [] })).toBeTypeOf('string');
    expect(checkSubmission({ ...good, records: 'x' })).toBeTypeOf('string');
    expect(checkSubmission({ ...good, records: Array(21).fill(records[0]) })).toBeTypeOf('string');
    expect(checkSubmission({ ...good, records: [''] })).toBeTypeOf('string');
    expect(
      checkSubmission({ ...good, records: [records[0] + 'x'.repeat(1_000_001)] }),
    ).toBeTypeOf('string');
    expect(checkSubmission({ ...good, compoundName: '' })).toBeTypeOf('string');
    expect(checkSubmission({ ...good, orcid: '1234' })).toBeTypeOf('string');
    const sub = checkSubmission({ ...good, compoundName: 'A\n| injected |' });
    expect(typeof sub).toBe('object');
    expect((sub as { compoundName: string }).compoundName).toBe('A injected');
  });

  it('lets no record choose its own accession', () => {
    const chosen = records[0].replace('ACCESSION: NEW', 'ACCESSION: RIPPOS-0001');
    expect(checkSubmission({ ...good, records: [chosen] })).toMatch(/accession/);
  });

  it('refuses a record the database loader would choke on, naming the spectrum', () => {
    const broken = records[1].replace('AC$INSTRUMENT_TYPE:', 'SP$GEOGRAPHY: Japan\nAC$INSTRUMENT_TYPE:');
    expect(checkSubmission({ ...good, records: [records[0], broken] })).toMatch(
      /^Spectrum 2: Line \d+: SP\$GEOGRAPHY is not a tag the database reads\.$/,
    );
  });

  it('counts every number taken, by records and by open submission branches, under old and new names', () => {
    expect(
      takenNumbers(
        ['README.md', 'RIPPOS-LU-0001.txt', 'RIPPOS-0009.txt', 'notes.txt'],
        [
          'refs/heads/submission/rippos-lu-0008-20260513093000',
          'refs/heads/submission/rippos-0012-0014',
          'refs/heads/submission/rippos-lu-0020',
          'refs/heads/main',
        ],
      ).sort((a, b) => a - b),
    ).toEqual([1, 8, 9, 12, 13, 14, 20]);
  });

  it('gives each spectrum the next free accession, on one branch, in one pull request', async () => {
    const { calls, fetchImpl } = fakeGitHub({
      branches: ['submission/rippos-lu-0010-0011'],
    });
    const sub = checkSubmission(good);
    if (typeof sub === 'string') throw new Error(sub);
    const out = await openSubmissionPr(sub, cfg, fetchImpl);
    expect(out).toEqual({
      prUrl: 'https://github.com/own/data/pull/7',
      accessions: ['RIPPOS-0012', 'RIPPOS-0013'],
    });
    expect(calls.map((c) => c.init?.method ?? 'GET')).toEqual([
      'GET', 'GET', 'GET', 'POST', 'PUT', 'PUT', 'POST',
    ]);
    expect(calls.every((c) => c.url.startsWith('https://api.github.com/repos/own/data/'))).toBe(true);
    expect(
      calls.every(
        (c) => (c.init?.headers as Record<string, string>).Authorization === 'token SECRET-KEY',
      ),
    ).toBe(true);
    expect(JSON.parse(calls[3].init!.body as string)).toEqual({
      ref: 'refs/heads/submission/rippos-0012-0013',
      sha: 'abc123',
    });
    for (const [n, acc] of [[4, 'RIPPOS-0012'], [5, 'RIPPOS-0013']] as const) {
      expect(calls[n].url).toContain(`/contents/RiPP-data/${acc}.txt`);
      const file = JSON.parse(calls[n].init!.body as string);
      expect(file.branch).toBe('submission/rippos-0012-0013');
      const text = Buffer.from(file.content, 'base64').toString('utf-8');
      // the record exactly as sent, with only its accession filled in
      expect(text).toBe(records[n - 4].replace('ACCESSION: NEW\n', `ACCESSION: ${acc}\n`));
    }
    const pr = JSON.parse(calls[6].init!.body as string);
    expect(pr.title).toBe('[Submission] Testamide A (RIPPOS-0012 to RIPPOS-0013)');
    expect(pr.head).toBe('submission/rippos-0012-0013');
    expect(pr.base).toBe('main');
    expect(pr.body).toContain('https://orcid.org/0000-0002-7894-3039');
  });

  it('moves on to the next numbers when another submission took them a moment ago', async () => {
    const { calls, fetchImpl } = fakeGitHub({
      taken: new Set(['refs/heads/submission/rippos-0010-0011']),
    });
    const sub = checkSubmission(good);
    if (typeof sub === 'string') throw new Error(sub);
    const out = await openSubmissionPr(sub, cfg, fetchImpl);
    expect(out.accessions).toEqual(['RIPPOS-0012', 'RIPPOS-0013']);
    const tried = calls
      .filter((c) => c.url.endsWith('/git/refs'))
      .map((c) => JSON.parse(c.init!.body as string).ref);
    expect(tried).toEqual([
      'refs/heads/submission/rippos-0010-0011',
      'refs/heads/submission/rippos-0012-0013',
    ]);
  });

  it('never passes GitHub error text, which can hold the key, back to the browser', async () => {
    for (const failAt of ['ref', 'list', 'branches', 'branch', 'file', 'pr']) {
      const { fetchImpl } = fakeGitHub({ failAt });
      const sub = checkSubmission(good);
      if (typeof sub === 'string') throw new Error(sub);
      const error = await openSubmissionPr(sub, cfg, fetchImpl).catch((e: Error) => e.message);
      expect(error).toContain('401');
      expect(error).not.toContain('SECRET-KEY');
    }
  });

  it('reads a pull request state from the data repository only', async () => {
    const answer = (body: object, status = 200) =>
      (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    let asked = '';
    const spy = (async (url: string) => {
      asked = url;
      return new Response('{"merged":true}', { status: 200 });
    }) as typeof fetch;
    expect(await prStatus(7, cfg, spy)).toBe('Approved');
    expect(asked).toBe('https://api.github.com/repos/own/data/pulls/7');
    expect(await prStatus(7, cfg, answer({ state: 'closed', merged: false }))).toBe('Rejected');
    expect(await prStatus(7, cfg, answer({ state: 'open' }))).toBe('Pending');
    expect(await prStatus(7, cfg, answer({}, 404))).toBe('Pending');
  });

  it('lists the records and reads one, asking GitHub again only when a file changed', async () => {
    const asked: string[] = [];
    let sha = 'a1';
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      if (url.includes('/contents/RiPP-data')) {
        return new Response(JSON.stringify([
          { name: 'README.md', sha: 'r', download_url: 'https://raw/README.md' },
          { name: 'RIPPOS-0002.txt', sha: 'b2', download_url: 'https://raw/2' },
          { name: 'RIPPOS-0001.txt', sha, download_url: 'https://raw/1' },
        ]), { status: 200 });
      }
      const n = url.endsWith('/1') ? `One ${sha}` : 'Two';
      return new Response(`ACCESSION: x\nRECORD_TITLE: ${n}; LC-ESI-QTOF; MS2\n//`, { status: 200 });
    }) as typeof fetch;
    const reader = recordReader({ owner: 'own', repo: 'data', base: 'main' }, fetchImpl, 1000);
    expect(await reader.list(0)).toEqual([
      { accession: 'RIPPOS-0001', title: 'One a1; LC-ESI-QTOF; MS2' },
      { accession: 'RIPPOS-0002', title: 'Two; LC-ESI-QTOF; MS2' },
    ]);
    expect(asked).toHaveLength(3);
    // within the minute nothing is asked again, and a record is served from what was read
    expect(await reader.get('RIPPOS-0002', 500)).toContain('Two');
    expect(asked).toHaveLength(3);
    // later the listing is read again; only the file whose content changed is fetched again
    sha = 'a9';
    await reader.list(5000);
    expect(asked.slice(3)).toEqual([
      'https://api.github.com/repos/own/data/contents/RiPP-data?ref=main',
      'https://raw/1',
    ]);
    expect(await reader.get('../../etc/passwd', 5000)).toBeNull();
    expect(await reader.get('RIPPOS-0404', 5000)).toBeNull();
  });

  it('limits submissions per address over time', () => {
    const allowed = rateLimiter(2, 1000);
    expect([allowed('a', 0), allowed('a', 10), allowed('a', 20)]).toEqual([true, true, false]);
    expect(allowed('b', 20)).toBe(true);
    expect(allowed('a', 1015)).toBe(true);
  });
});

describe('profile data sent to the server', () => {
  // two peaks, each sampled as an Orbitrap profile: seven points 0.004 Da apart, zeros between
  const profilePeaks = [303.05, 449.108].flatMap((centre) =>
    [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((k) => {
      const mz = centre + k * 0.004;
      const y = Math.abs(k) === 4 ? 0 : 1000 * Math.exp(-((k * 0.004) ** 2) / (2 * 0.004 ** 2));
      return { mz, intensity: y, rel: Math.round(y) };
    }),
  );
  const profileRecord = formatRecords(fields, [{ ...spectrum('Thermo Orbitrap Exploris 120', '30 NCE'), peaks: profilePeaks }])[0];

  it('would be refused as it is, which is what the conversion is for', () => {
    expect(checkRecord(profileRecord)).not.toBeNull();
    expect(checkSubmission({ ...good, records: [profileRecord] })).toMatch(/intensity above zero|profile/);
  });

  it('is converted to peaks and accepted, saying so in the record', async () => {
    const sub = await prepareSubmission({ ...good, records: [profileRecord] });
    expect(typeof sub).toBe('object');
    const rec = (sub as { records: string[] }).records[0];
    expect(checkRecord(rec)).toBeNull();
    expect(rec).toContain('PK$NUM_PEAK: 2\n');
    expect(rec).toMatch(/\n {2}303\.0500 1000\.0000 999\n {2}449\.1080 1000\.0000 999\n\/\//);
    expect(rec).toContain('MS$DATA_PROCESSING: FIND_PEAK centroided from profile data on submission to RiPPository (18 points, 2 peaks)');
    // every line above the peaks is kept, apart from the count, the SPLASH and the added line
    const above = (r: string) => r.split('\n').filter((l) => !l.startsWith('  ') && !/^(PK\$NUM_PEAK|PK\$SPLASH|MS\$DATA_PROCESSING)/.test(l));
    expect(above(rec)).toEqual(above(profileRecord));
  });

  it('leaves a peak list as it came, apart from the SPLASH the server sets', async () => {
    const sub = await prepareSubmission({ ...good, records });
    const noSplash = (r: string) => r.split('\n').filter((l) => !l.startsWith('PK$SPLASH:'));
    expect((sub as { records: string[] }).records.map(noSplash)).toEqual(records.map(noSplash));
  });
});

describe('the SPLASH of a submitted record', () => {
  // the reference implementation's code (spectra-hash, python) for peaks 100.5:50 and 150.25:999
  const REFERENCE = 'splash10-0udi-0900000000-1509cff7874978a0a9d8';

  it('is computed by the server from the peaks, replacing what the record carried', async () => {
    const one = formatRecords(fields, [{ ...spectrum('Bruker maXis Impact', '20 eV'), splash: 'splash10-a5d6abe3d2-333ab93682-693949c323' }])[0];
    expect(one).toContain('PK$SPLASH: splash10-a5d6abe3d2-333ab93682-693949c323');
    const rec = ((await prepareSubmission({ ...good, records: [one] })) as { records: string[] }).records[0];
    expect(rec.split('\n').filter((l) => l.startsWith('PK$SPLASH:'))).toEqual([`PK$SPLASH: ${REFERENCE}`]);
  });

  it('is added when a record has none', async () => {
    const none = formatRecords(fields, [spectrum('Bruker maXis Impact', '20 eV')])[0];
    expect(none).not.toContain('PK$SPLASH');
    const rec = ((await prepareSubmission({ ...good, records: [none] })) as { records: string[] }).records[0];
    expect(rec).toContain(`\nPK$SPLASH: ${REFERENCE}\nPK$NUM_PEAK: 2\n`);
  });
});

describe('the InChI of a submitted record', () => {
  // acetamide, as Python RDKit 2026.03 writes it
  const INCHI = 'InChI=1S/C2H5NO/c1-2(3)4/h1H3,(H2,3,4)';
  const KEY = 'DLFVBJFMPXGRIB-UHFFFAOYSA-N';
  const withSmiles = formatRecords({ ...fields, smiles: 'CC(=O)N' }, [spectrum('Bruker maXis Impact', '20 eV')])[0];
  const first = async (body: unknown, ...more: [] | [Parameters<typeof prepareSubmission>[1]]) =>
    ((await prepareSubmission(body, ...more)) as { records: string[] }).records[0];

  it('is made from the SMILES by the server when the record has none, with its InChIKey', async () => {
    expect(withSmiles).not.toContain('CH$IUPAC');
    const rec = await first({ ...good, records: [withSmiles] });
    expect(rec).toContain(`\nCH$SMILES: CC(=O)N\nCH$IUPAC: ${INCHI}\nCH$LINK: INCHIKEY ${KEY}\n`);
    expect(checkRecord(rec)).toBeNull();
  });

  it('is missing when nothing can make it, as it was before (the control)', async () => {
    const nothing = async () => ({ inchiOf: () => null, keyOf: () => null });
    const rec = await first({ ...good, records: [withSmiles] }, nothing);
    expect(rec).not.toContain('CH$IUPAC');
    expect(rec).not.toContain('INCHIKEY');
  });

  it('does not stop a submission when RDKit cannot be loaded', async () => {
    const broken = () => Promise.reject(new Error('no wasm'));
    const sub = await prepareSubmission({ ...good, records: [withSmiles] }, broken);
    expect(typeof sub).toBe('object');
    expect((sub as { records: string[] }).records[0]).not.toContain('CH$IUPAC');
  });

  it('keeps an InChI the record carries and adds only its key', async () => {
    const given = formatRecords({ ...fields, smiles: 'CC(=O)N', inchi: INCHI }, [spectrum('Bruker maXis Impact', '20 eV')])[0];
    const rec = await first({ ...good, records: [given] });
    expect(rec.split('\n').filter((l) => l.startsWith('CH$IUPAC:'))).toEqual([`CH$IUPAC: ${INCHI}`]);
    expect(rec).toContain(`\nCH$LINK: INCHIKEY ${KEY}\n`);
  });

  const real = join(__dirname, '../../RiPPository-data/RiPP-data/RIPPOS-0001.txt');
  it.skipIf(!existsSync(real))('gives back the stored InChI of a real record from its SMILES', async () => {
    const file = real;
    const stored = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const inchi = stored.split('\n').find((l) => l.startsWith('CH$IUPAC: '))!;
    const make = await rdkitInchi();
    const remade = withInchi(stored.split('\n').filter((l) => l !== inchi).join('\n'), make);
    expect(remade.split('\n').find((l) => l.startsWith('CH$IUPAC: '))).toBe(inchi);
  });
});

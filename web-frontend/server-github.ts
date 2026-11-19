// GitHub calls for the Submit page, made by the site's own server so the key never reaches a
// browser. The key is read at run time from GITHUB_TOKEN; it is never built into the client code.
import {
  NEW_ACCESSION,
  type InchiMaker,
  centroidRecord,
  checkRecord,
  withInchi,
  withSplash,
} from './src/elements/routes/pages/submit/massbankRecord.js';

export type RepoConfig = {
  owner: string;
  repo: string;
  base: string;
};

export type GitHubConfig = RepoConfig & { token: string };

export type Submission = {
  compoundName: string;
  compoundClass: string;
  compoundSubClass?: string;
  formula: string;
  orcid: string;
  orcidName?: string;
  submittedAt: string;
  records: string[];
};

type Fetch = typeof fetch;

// RIPPOS-0001; records before 2026-11-19 were named RIPPOS-LU-0001, and those names are still read
// so their numbers are never given out again
export const ACCESSION_PREFIX = 'RIPPOS-';
const ACCESSION = /^RIPPOS-(?:LU-)?\d{4,6}$/;
const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
const MAX_RECORD = 1_000_000;
const MAX_SPECTRA = 20;
const MAX_FIELD = 300;
const DATA_DIR = 'RiPP-data';

function repoOf(env: NodeJS.ProcessEnv): RepoConfig {
  return {
    owner: (env.GITHUB_OWNER ?? '').trim() || 'Joelle-Mer',
    repo: (env.GITHUB_DATA_REPO ?? '').trim() || 'RiPPository-data',
    base: (env.GITHUB_BASE_BRANCH ?? '').trim() || 'main',
  };
}

export function githubConfig(env: NodeJS.ProcessEnv): GitHubConfig | null {
  const token = (env.GITHUB_TOKEN ?? '').trim();
  if (!token) {
    return null;
  }
  return { token, ...repoOf(env) };
}

// reading the public data repository needs no key; the key, when there is one, raises the limit
export function readConfig(env: NodeJS.ProcessEnv): RepoConfig & { token?: string } {
  const token = (env.GITHUB_TOKEN ?? '').trim();
  return { ...repoOf(env), ...(token ? { token } : {}) };
}

// one line of plain text, so a field cannot add lines to a title or a table
const oneLine = (value: unknown, max = MAX_FIELD) =>
  typeof value === 'string'
    ? value
        .replace(/[\r\n\t|`]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';

// what came in from a browser, checked; a string is the reason it was refused
export function checkSubmission(body: unknown): Submission | string {
  if (typeof body !== 'object' || body === null) {
    return 'The submission is empty.';
  }
  const b = body as Record<string, unknown>;
  if (
    !Array.isArray(b.records) ||
    b.records.length === 0 ||
    b.records.length > MAX_SPECTRA
  ) {
    return `A submission holds between 1 and ${MAX_SPECTRA} spectra.`;
  }
  for (const [i, record] of b.records.entries()) {
    const which = b.records.length > 1 ? `Spectrum ${i + 1}: ` : '';
    if (typeof record !== 'string' || record.trim().length === 0) {
      return which + 'The record is empty.';
    }
    if (record.length > MAX_RECORD) {
      return which + 'The record is too long.';
    }
    // the server gives the accession; a record may not choose its own
    if (!record.startsWith(`ACCESSION: ${NEW_ACCESSION}\n`)) {
      return which + 'The record must start without an accession.';
    }
    const problem = checkRecord(record);
    if (problem) {
      return which + problem;
    }
  }
  const compoundName = oneLine(b.compoundName);
  if (!compoundName) {
    return 'The compound name is missing.';
  }
  const orcid = oneLine(b.orcid, 19);
  if (!ORCID.test(orcid)) {
    return 'The ORCID iD is not valid.';
  }
  const submittedAt = oneLine(b.submittedAt, 40);
  return {
    compoundName,
    compoundClass: oneLine(b.compoundClass),
    compoundSubClass: oneLine(b.compoundSubClass) || undefined,
    formula: oneLine(b.formula),
    orcid,
    orcidName: oneLine(b.orcidName) || undefined,
    submittedAt: Number.isNaN(Date.parse(submittedAt))
      ? new Date().toISOString()
      : submittedAt,
    records: b.records as string[],
  };
}

// RDKit, loaded once, on the first submission; the browser never loads it
let rdkit: Promise<InchiMaker> | null = null;
export function rdkitInchi(): Promise<InchiMaker> {
  rdkit ??= import('@rdkit/rdkit').then(async ({ default: load }) => {
    const RDKit = await load();
    return {
      inchiOf(smiles: string) {
        const mol = RDKit.get_mol(smiles);
        if (!mol) return null;
        try {
          return mol.is_valid() ? mol.get_inchi() : null;
        } finally {
          mol.delete();
        }
      },
      keyOf: (inchi: string) => RDKit.get_inchikey_for_inchi(inchi) || null,
    };
  });
  return rdkit;
}

// what the server does with a submission: profile data is converted to peaks first, as the Submit
// page does, so a spectrum is never turned away for being profile data; the SPLASH is computed here
// from the peaks, whatever the record carried; a missing InChI and InChIKey are made from the
// SMILES; then everything is checked
export async function prepareSubmission(
  body: unknown,
  inchi: () => Promise<InchiMaker> = rdkitInchi,
): Promise<Submission | string> {
  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.records) && b.records.length <= MAX_SPECTRA) {
      // without RDKit the records go on as they came, never turned away for it
      const make = await inchi().catch(() => ({ inchiOf: () => null, keyOf: () => null }));
      b.records = await Promise.all(
        b.records.map((r) =>
          typeof r === 'string' && r.length <= MAX_RECORD
            ? centroidRecord(r).then(withSplash).then((t) => withInchi(t, make))
            : r,
        ),
      );
    }
  }
  return checkSubmission(body);
}

const headersFor = (token?: string) => ({
  ...(token ? { Authorization: `token ${token}` } : {}),
  Accept: 'application/vnd.github.v3+json',
  'Content-Type': 'application/json',
  'User-Agent': 'RiPPository-site',
});

// GitHub's own error text can echo request details, so only the status goes back to a browser
async function expectOk(res: Response, step: string) {
  if (!res.ok) {
    throw new Error(`${step} failed (GitHub answered ${res.status}).`);
  }
  return res.json();
}

export const accessionFor = (n: number) =>
  ACCESSION_PREFIX + String(n).padStart(4, '0');

// every number already taken: records on the main branch, and the range each submission branch
// holds (submission/rippos-0010 or submission/rippos-0010-0012, earlier submission/rippos-lu-0010);
// older branches end in a 14-digit time, which is not a number
export function takenNumbers(files: string[], branches: string[]): number[] {
  const taken: number[] = [];
  for (const f of files) {
    const m = /^RIPPOS-(?:LU-)?(\d+)\.txt$/i.exec(f);
    if (m) taken.push(Number(m[1]));
  }
  for (const b of branches) {
    const m = /submission\/rippos-(?:lu-)?(\d+)(?:-(\d+))?$/i.exec(b);
    if (!m) continue;
    const first = Number(m[1]);
    const last = m[2] && m[2].length < 8 ? Number(m[2]) : first;
    for (let n = first; n <= Math.max(first, last); n++) taken.push(n);
  }
  return taken;
}

const branchFor = (first: number, count: number) =>
  `submission/${accessionFor(first).toLowerCase()}` +
  (count > 1 ? `-${String(first + count - 1).padStart(4, '0')}` : '');

// accessions for the records, a branch holding them, and a pull request; the branch's name is the
// claim on the numbers, so two submissions at once cannot be given the same one
export async function openSubmissionPr(
  sub: Submission,
  cfg: GitHubConfig,
  fetchImpl: Fetch = fetch,
): Promise<{ prUrl: string; accessions: string[] }> {
  const headers = headersFor(cfg.token);
  const apiBase = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;

  const ref = await expectOk(
    await fetchImpl(`${apiBase}/git/ref/heads/${cfg.base}`, { headers }),
    'Reading the base branch',
  );
  const files = (await expectOk(
    await fetchImpl(`${apiBase}/contents/${DATA_DIR}?ref=${cfg.base}`, { headers }),
    'Reading the records',
  )) as Array<{ name: string }>;
  const branches = (await expectOk(
    await fetchImpl(`${apiBase}/git/matching-refs/heads/submission/`, { headers }),
    'Reading the open submissions',
  )) as Array<{ ref: string }>;
  const count = sub.records.length;
  let first =
    Math.max(
      0,
      ...takenNumbers(
        files.map((f) => f.name),
        branches.map((b) => b.ref),
      ),
    ) + 1;

  let branch = '';
  for (let attempt = 0; attempt < 5 && !branch; attempt++) {
    const name = branchFor(first, count);
    const res = await fetchImpl(`${apiBase}/git/refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: `refs/heads/${name}`, sha: ref.object.sha }),
    });
    if (res.status === 422) {
      // someone took these numbers a moment ago
      first += count;
      continue;
    }
    await expectOk(res, 'Creating the branch');
    branch = name;
  }
  if (!branch) {
    throw new Error('Could not reserve an accession number; please try again.');
  }

  const accessions = sub.records.map((_, i) => accessionFor(first + i));
  for (const [i, record] of sub.records.entries()) {
    const text = record.replace(
      `ACCESSION: ${NEW_ACCESSION}\n`,
      `ACCESSION: ${accessions[i]}\n`,
    );
    await expectOk(
      await fetchImpl(`${apiBase}/contents/${DATA_DIR}/${accessions[i]}.txt`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: `submission: ${sub.compoundName} (${accessions[i]})`,
          content: Buffer.from(text, 'utf-8').toString('base64'),
          branch,
        }),
      }),
      'Adding the record',
    );
  }

  const submitted = new Date(sub.submittedAt).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const named =
    count > 1 ? `${accessions[0]} to ${accessions[count - 1]}` : accessions[0];
  const body = [
    `## New RiPP Submission`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Accession${count > 1 ? 's' : ''}** | ${accessions.map((a) => `\`${a}\``).join(', ')} |`,
    `| **Spectra** | ${count} |`,
    `| **Compound** | ${sub.compoundName} |`,
    `| **Class** | ${sub.compoundClass}${sub.compoundSubClass ? ' / ' + sub.compoundSubClass : ''} |`,
    `| **Formula** | ${sub.formula} |`,
    `| **Submitted by** | ${sub.orcidName ? sub.orcidName + ', ' : ''}[${sub.orcid}](https://orcid.org/${sub.orcid}) |`,
    `| **Submitted** | ${submitted} |`,
    ``,
    `*Submitted via the RiPPository web form.*`,
  ].join('\n');
  const pr = await expectOk(
    await fetchImpl(`${apiBase}/pulls`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `[Submission] ${sub.compoundName} (${named})`,
        body,
        head: branch,
        base: cfg.base,
      }),
    }),
    'Opening the pull request',
  );
  return { prUrl: pr.html_url as string, accessions };
}

export type PrState = 'Approved' | 'Rejected' | 'Pending';

// the state of one pull request in the configured data repository, and no other
export async function prStatus(
  number: number,
  cfg: GitHubConfig,
  fetchImpl: Fetch = fetch,
): Promise<PrState> {
  const res = await fetchImpl(
    `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/pulls/${number}`,
    { headers: headersFor(cfg.token) },
  );
  if (!res.ok) {
    return 'Pending';
  }
  const data = await res.json();
  if (data.merged) {
    return 'Approved';
  }
  return data.state === 'closed' ? 'Rejected' : 'Pending';
}

export type RecordEntry = { accession: string; title: string };

// the records on the main branch of the data repository, for starting a submission from one; the
// listing is kept for a minute and each file by its content hash, so GitHub is asked rarely
export function recordReader(
  cfg: RepoConfig & { token?: string },
  fetchImpl: Fetch = fetch,
  listFor = 60_000,
) {
  const texts = new Map<string, string>();
  let listing: { at: number; files: Array<{ name: string; sha: string; download_url: string }> } | null =
    null;

  async function files(now: number) {
    if (listing && now - listing.at < listFor) return listing.files;
    const res = await fetchImpl(
      `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${DATA_DIR}?ref=${cfg.base}`,
      { headers: headersFor(cfg.token) },
    );
    const found = (await expectOk(res, 'Reading the records')) as Array<{
      name: string;
      sha: string;
      download_url: string;
    }>;
    listing = {
      at: now,
      files: found.filter((f) => ACCESSION.test(f.name.replace(/\.txt$/, ''))),
    };
    return listing.files;
  }

  async function text(file: { sha: string; download_url: string }) {
    const kept = texts.get(file.sha);
    if (kept !== undefined) return kept;
    const res = await fetchImpl(file.download_url, {
      headers: { 'User-Agent': 'RiPPository-site' },
    });
    if (!res.ok) {
      throw new Error(`Reading a record failed (GitHub answered ${res.status}).`);
    }
    const got = await res.text();
    texts.set(file.sha, got);
    return got;
  }

  return {
    async list(now = Date.now()): Promise<RecordEntry[]> {
      const all = await files(now);
      const entries = await Promise.all(
        all.map(async (f) => {
          const t = await text(f);
          const title = /^RECORD_TITLE:\s*(.*)$/m.exec(t)?.[1]?.trim() ?? '';
          return { accession: f.name.replace(/\.txt$/, ''), title };
        }),
      );
      return entries.sort((a, b) => a.accession.localeCompare(b.accession));
    },
    async get(accession: string, now = Date.now()): Promise<string | null> {
      if (!ACCESSION.test(accession)) return null;
      const file = (await files(now)).find((f) => f.name === `${accession}.txt`);
      return file ? text(file) : null;
    },
  };
}

// at most `limit` calls per key in any `windowMs`, kept in memory
export function rateLimiter(limit: number, windowMs: number) {
  const seen = new Map<string, number[]>();
  return (key: string, at: number = Date.now()) => {
    const recent = (seen.get(key) ?? []).filter((t) => at - t < windowMs);
    if (recent.length >= limit) {
      seen.set(key, recent);
      return false;
    }
    recent.push(at);
    seen.set(key, recent);
    return true;
  };
}

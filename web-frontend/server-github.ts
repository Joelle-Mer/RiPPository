// GitHub calls for the Submit page, made by the site's own server so the key never reaches a
// browser. The key is read at run time from GITHUB_TOKEN; it is never built into the client code.

export type GitHubConfig = {
  token: string;
  owner: string;
  repo: string;
  base: string;
};

export type Submission = {
  accession: string;
  compoundName: string;
  compoundClass: string;
  compoundSubClass?: string;
  formula: string;
  submittedAt: string;
  record: string;
};

type Fetch = typeof fetch;

const ACCESSION = /^[A-Z0-9-]{3,40}$/;
const MAX_RECORD = 1_000_000;
const MAX_FIELD = 300;

export function githubConfig(env: NodeJS.ProcessEnv): GitHubConfig | null {
  const token = (env.GITHUB_TOKEN ?? '').trim();
  if (!token) {
    return null;
  }
  return {
    token,
    owner: (env.GITHUB_OWNER ?? '').trim() || 'Joelle-Mer',
    repo: (env.GITHUB_DATA_REPO ?? '').trim() || 'RiPPository-data',
    base: (env.GITHUB_BASE_BRANCH ?? '').trim() || 'main',
  };
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
  if (typeof b.accession !== 'string' || !ACCESSION.test(b.accession)) {
    return 'The accession is not valid.';
  }
  if (typeof b.record !== 'string' || b.record.trim().length === 0) {
    return 'The record is empty.';
  }
  if (b.record.length > MAX_RECORD) {
    return 'The record is too long.';
  }
  const compoundName = oneLine(b.compoundName);
  if (!compoundName) {
    return 'The compound name is missing.';
  }
  const submittedAt = oneLine(b.submittedAt, 40);
  return {
    accession: b.accession,
    compoundName,
    compoundClass: oneLine(b.compoundClass),
    compoundSubClass: oneLine(b.compoundSubClass) || undefined,
    formula: oneLine(b.formula),
    submittedAt: Number.isNaN(Date.parse(submittedAt))
      ? new Date().toISOString()
      : submittedAt,
    record: b.record,
  };
}

const headersFor = (cfg: GitHubConfig) => ({
  Authorization: `token ${cfg.token}`,
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

// a branch, the record file on it, and a pull request; returns the pull request's address
export async function openSubmissionPr(
  sub: Submission,
  cfg: GitHubConfig,
  fetchImpl: Fetch = fetch,
  now: Date = new Date(),
): Promise<string> {
  const headers = headersFor(cfg);
  const apiBase = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;

  const ref = await expectOk(
    await fetchImpl(`${apiBase}/git/ref/heads/${cfg.base}`, { headers }),
    'Reading the base branch',
  );
  // the time keeps two submissions with the same accession on separate branches
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
  const branch = `submission/${sub.accession.toLowerCase()}-${stamp}`;
  await expectOk(
    await fetchImpl(`${apiBase}/git/refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: ref.object.sha,
      }),
    }),
    'Creating the branch',
  );
  await expectOk(
    await fetchImpl(`${apiBase}/contents/RiPP-data/${sub.accession}.txt`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `submission: ${sub.compoundName} (${sub.accession})`,
        content: Buffer.from(sub.record, 'utf-8').toString('base64'),
        branch,
      }),
    }),
    'Adding the record',
  );
  const submitted = new Date(sub.submittedAt).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const body = [
    `## New RiPP Submission`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Accession** | \`${sub.accession}\` |`,
    `| **Compound** | ${sub.compoundName} |`,
    `| **Class** | ${sub.compoundClass}${sub.compoundSubClass ? ' / ' + sub.compoundSubClass : ''} |`,
    `| **Formula** | ${sub.formula} |`,
    `| **Submitted** | ${submitted} |`,
    ``,
    `*Submitted via the RiPPository web form.*`,
  ].join('\n');
  const pr = await expectOk(
    await fetchImpl(`${apiBase}/pulls`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `[Submission] ${sub.compoundName} (${sub.accession})`,
        body,
        head: branch,
        base: cfg.base,
      }),
    }),
    'Opening the pull request',
  );
  return pr.html_url as string;
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
    { headers: headersFor(cfg) },
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

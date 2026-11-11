import { describe, expect, it } from 'vitest';
import {
  checkSubmission,
  githubConfig,
  openSubmissionPr,
  prStatus,
  rateLimiter,
} from './server-github';

const cfg = { token: 'SECRET-KEY', owner: 'own', repo: 'data', base: 'main' };
const good = {
  accession: 'RIPPOS-LU-0001',
  compoundName: 'Testamide A',
  compoundClass: 'Cyanobactin',
  formula: 'C10H10N2O2',
  submittedAt: '2026-11-11T10:00:00Z',
  record: 'ACCESSION: RIPPOS-LU-0001\nCH$NAME: Testamide A ü\n//',
};

type Call = { url: string; init?: RequestInit };

// a stand-in for GitHub that records every call and answers each step
function fakeGitHub(failAt?: string) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const step = url.endsWith('/heads/main')
      ? 'ref'
      : url.endsWith('/git/refs')
        ? 'branch'
        : url.includes('/contents/')
          ? 'file'
          : 'pr';
    if (step === failAt) {
      return new Response('{"message":"Bad credentials SECRET-KEY"}', {
        status: 401,
      });
    }
    const body =
      step === 'ref'
        ? { object: { sha: 'abc123' } }
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
  });

  it('refuses what it should, and keeps fields to one line', () => {
    expect(checkSubmission(null)).toBeTypeOf('string');
    expect(checkSubmission({ ...good, accession: '../../etc' })).toBeTypeOf(
      'string',
    );
    expect(checkSubmission({ ...good, record: '' })).toBeTypeOf('string');
    expect(
      checkSubmission({ ...good, record: 'x'.repeat(1_000_001) }),
    ).toBeTypeOf('string');
    expect(checkSubmission({ ...good, compoundName: '' })).toBeTypeOf('string');
    const sub = checkSubmission({ ...good, compoundName: 'A\n| injected |' });
    expect(typeof sub).toBe('object');
    expect((sub as { compoundName: string }).compoundName).toBe('A injected');
  });

  it('opens a branch, adds the record exactly, and opens a pull request', async () => {
    const { calls, fetchImpl } = fakeGitHub();
    const sub = checkSubmission(good);
    if (typeof sub === 'string') throw new Error(sub);
    const url = await openSubmissionPr(
      sub,
      cfg,
      fetchImpl,
      new Date('2026-11-11T10:20:30Z'),
    );
    expect(url).toBe('https://github.com/own/data/pull/7');
    expect(calls.map((c) => c.init?.method ?? 'GET')).toEqual([
      'GET',
      'POST',
      'PUT',
      'POST',
    ]);
    expect(
      calls.every((c) =>
        c.url.startsWith('https://api.github.com/repos/own/data/'),
      ),
    ).toBe(true);
    expect(
      calls.every(
        (c) =>
          (c.init?.headers as Record<string, string>).Authorization ===
          'token SECRET-KEY',
      ),
    ).toBe(true);
    const branch = JSON.parse(calls[1].init!.body as string);
    expect(branch).toEqual({
      ref: 'refs/heads/submission/rippos-lu-0001-20261111102030',
      sha: 'abc123',
    });
    const file = JSON.parse(calls[2].init!.body as string);
    expect(calls[2].url).toContain('/contents/RiPP-data/RIPPOS-LU-0001.txt');
    expect(Buffer.from(file.content, 'base64').toString('utf-8')).toBe(
      good.record,
    );
    const pr = JSON.parse(calls[3].init!.body as string);
    expect(pr.head).toBe('submission/rippos-lu-0001-20261111102030');
    expect(pr.base).toBe('main');
  });

  it('never passes GitHub error text, which can hold the key, back to the browser', async () => {
    for (const step of ['ref', 'branch', 'file', 'pr']) {
      const { fetchImpl } = fakeGitHub(step);
      const sub = checkSubmission(good);
      if (typeof sub === 'string') throw new Error(sub);
      const error = await openSubmissionPr(sub, cfg, fetchImpl).catch(
        (e: Error) => e.message,
      );
      expect(error).toContain('401');
      expect(error).not.toContain('SECRET-KEY');
    }
  });

  it('reads a pull request state from the data repository only', async () => {
    const answer = (body: object, status = 200) =>
      (async () =>
        new Response(JSON.stringify(body), { status })) as typeof fetch;
    let asked = '';
    const spy = (async (url: string) => {
      asked = url;
      return new Response('{"merged":true}', { status: 200 });
    }) as typeof fetch;
    expect(await prStatus(7, cfg, spy)).toBe('Approved');
    expect(asked).toBe('https://api.github.com/repos/own/data/pulls/7');
    expect(
      await prStatus(7, cfg, answer({ state: 'closed', merged: false })),
    ).toBe('Rejected');
    expect(await prStatus(7, cfg, answer({ state: 'open' }))).toBe('Pending');
    expect(await prStatus(7, cfg, answer({}, 404))).toBe('Pending');
  });

  it('limits submissions per address over time', () => {
    const allowed = rateLimiter(2, 1000);
    expect([allowed('a', 0), allowed('a', 10), allowed('a', 20)]).toEqual([
      true,
      true,
      false,
    ]);
    expect(allowed('b', 20)).toBe(true);
    expect(allowed('a', 1015)).toBe(true);
  });
});

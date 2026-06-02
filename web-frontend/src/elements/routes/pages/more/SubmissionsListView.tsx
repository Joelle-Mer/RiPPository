import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Table, Tag } from 'antd';
import { Content } from 'antd/es/layout/layout';
import { SUBMISSIONS_KEY, RiPPSubmission } from '../submit/SubmitView';
import type { ColumnsType } from 'antd/es/table';

const GH_TOKEN = import.meta.env.VITE_GITHUB_TOKEN as string | undefined;

// Parse "https://github.com/{owner}/{repo}/pull/{number}" → { owner, repo, number }
function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}

async function fetchPrStatus(
  prUrl: string,
): Promise<'Approved' | 'Rejected' | 'Pending'> {
  const parsed = parsePrUrl(prUrl);
  if (!parsed) return 'Pending';
  const { owner, repo, number } = parsed;
  try {
    const headers: HeadersInit = { Accept: 'application/vnd.github+json' };
    if (GH_TOKEN) headers['Authorization'] = `token ${GH_TOKEN}`;
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
      { headers },
    );
    if (!res.ok) return 'Pending';
    const data = await res.json();
    if (data.merged) return 'Approved';
    if (data.state === 'closed') return 'Rejected';
    return 'Pending';
  } catch {
    return 'Pending';
  }
}

function SubmissionsListView() {
  const [submissions, setSubmissions] = useState<RiPPSubmission[]>([]);
  const [checking, setChecking] = useState(false);

  const load = useCallback(() => {
    const stored: RiPPSubmission[] = JSON.parse(
      localStorage.getItem(SUBMISSIONS_KEY) ?? '[]',
    );
    setSubmissions(stored);
    return stored;
  }, []);

  const syncStatuses = useCallback(async (subs: RiPPSubmission[]) => {
    const pending = subs.filter((s) => s.status === 'Pending' && s.prUrl);
    if (pending.length === 0) return;
    setChecking(true);
    const updated = [...subs];
    await Promise.all(
      pending.map(async (sub) => {
        const newStatus = await fetchPrStatus(sub.prUrl!);
        if (newStatus !== sub.status) {
          const idx = updated.findIndex((s) => s.accession === sub.accession);
          if (idx >= 0) updated[idx] = { ...updated[idx], status: newStatus };
        }
      }),
    );
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(updated));
    setSubmissions(updated);
    setChecking(false);
  }, []);

  useEffect(() => {
    const subs = load();
    syncStatuses(subs);
  }, [load, syncStatuses]);

  const columns: ColumnsType<RiPPSubmission> = useMemo(
    () => [
      {
        title: 'Job ID',
        dataIndex: 'accession',
        key: 'accession',
        render: (val: string) => (
          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{val}</span>
        ),
      },
      {
        title: 'Compound Name',
        dataIndex: 'compoundName',
        key: 'compoundName',
      },
      {
        title: 'Date',
        dataIndex: 'submittedAt',
        key: 'submittedAt',
        render: (val: string) =>
          new Date(val).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          }),
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        render: (val: string) => {
          const colors: Record<string, string> = {
            Pending: 'orange',
            Approved: 'green',
            Rejected: 'red',
          };
          return <Tag color={colors[val] ?? 'default'}>{val}</Tag>;
        },
      },
      {
        title: 'Pull Request',
        key: 'prUrl',
        render: (_: unknown, record: RiPPSubmission) =>
          record.prUrl ? (
            <a href={record.prUrl} target="_blank" rel="noopener noreferrer">
              View on GitHub
            </a>
          ) : (
            <span style={{ color: '#9ca3af' }}>—</span>
          ),
      },
    ],
    [],
  );

  return (
    <Content style={{ padding: '32px 48px', maxWidth: 1000, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={{ color: '#6b7280', margin: 0, lineHeight: 1.7 }}>
          Each submission opens a pull request on GitHub. Once the PR is merged the
          record becomes part of the database. Click <strong>View on GitHub</strong> to
          follow the review progress.
        </p>
        <Button
          size="small"
          loading={checking}
          onClick={() => {
            const subs = load();
            syncStatuses(subs);
          }}
          style={{ marginLeft: 16, flexShrink: 0 }}
        >
          Refresh
        </Button>
      </div>

      {submissions.length === 0 ? (
        <Empty description="No submissions yet" style={{ marginTop: 60 }} />
      ) : (
        <Table
          dataSource={submissions}
          columns={columns}
          rowKey="accession"
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          size="middle"
        />
      )}
    </Content>
  );
}

export default SubmissionsListView;

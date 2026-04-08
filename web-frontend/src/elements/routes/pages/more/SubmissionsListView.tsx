import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Popconfirm, Table, Tag } from 'antd';
import { Content } from 'antd/es/layout/layout';
import { SUBMISSIONS_KEY, RiPPSubmission } from '../submit/SubmitView';
import type { ColumnsType } from 'antd/es/table';

function SubmissionsListView() {
  const [submissions, setSubmissions] = useState<RiPPSubmission[]>([]);

  const load = useCallback(() => {
    const stored: RiPPSubmission[] = JSON.parse(
      localStorage.getItem(SUBMISSIONS_KEY) ?? '[]',
    );
    setSubmissions(stored);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = useCallback((accession: string) => {
    const stored: RiPPSubmission[] = JSON.parse(
      localStorage.getItem(SUBMISSIONS_KEY) ?? '[]',
    );
    const updated = stored.map((s) =>
      s.accession === accession ? { ...s, status: 'Approved' as const } : s,
    );
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(updated));
    setSubmissions(updated);
  }, []);

  const handleDelete = useCallback((accession: string) => {
    const stored: RiPPSubmission[] = JSON.parse(
      localStorage.getItem(SUBMISSIONS_KEY) ?? '[]',
    );
    const updated = stored.filter((s) => s.accession !== accession);
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(updated));
    setSubmissions(updated);
  }, []);

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
        title: 'Actions',
        key: 'actions',
        render: (_: unknown, record: RiPPSubmission) => (
          <div style={{ display: 'flex', gap: 8 }}>
            {record.status !== 'Approved' && (
              <Popconfirm
                title="Approve this submission?"
                description="It will immediately appear in the search results."
                onConfirm={() => handleApprove(record.accession)}
                okText="Approve"
                cancelText="Cancel"
              >
                <Button type="primary" size="small" style={{ background: '#16a34a', borderColor: '#16a34a' }}>
                  Approve
                </Button>
              </Popconfirm>
            )}
            <Popconfirm
              title="Delete this submission?"
              description="This action cannot be undone."
              onConfirm={() => handleDelete(record.accession)}
              okText="Delete"
              okButtonProps={{ danger: true }}
              cancelText="Cancel"
            >
              <Button danger size="small">
                Delete
              </Button>
            </Popconfirm>
          </div>
        ),
      },
    ],
    [handleApprove, handleDelete],
  );

  return (
    <Content style={{ padding: '32px 48px', maxWidth: 1000, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={{ color: '#6b7280', margin: 0, lineHeight: 1.7 }}>
          Track the status of your submitted RiPP records. Use the Approve button
          to immediately publish a record to the search results.
        </p>
        <Button size="small" onClick={load} style={{ marginLeft: 16, flexShrink: 0 }}>
          Refresh
        </Button>
      </div>

      {submissions.length === 0 ? (
        <Empty
          description="No submissions yet"
          style={{ marginTop: 60 }}
        />
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

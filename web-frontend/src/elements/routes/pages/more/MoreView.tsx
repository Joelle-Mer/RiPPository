import { useMemo } from 'react';
import { Layout } from 'antd';
import { Content } from 'antd/es/layout/layout';
import Segmented from '../../../basic/Segmented';
import SectionDivider from '../../../basic/SectionDivider';
import SubmissionsListView from './SubmissionsListView';
import DatabaseOverviewView from './DatabaseOverviewView';

function MoreView() {
  const elements = useMemo(() => {
    const submissions = (
      <Content style={{ width: '100%', height: '100%' }}>
        <SectionDivider label="Submissions" />
        <div style={{ padding: '12px 24px', backgroundColor: '#f0f9ff', borderBottom: '1px solid #bfdbfe', fontSize: 13, color: '#1e3a5f' }}>
          All submissions are manually reviewed before being added to the database. Accepted records are published under the <strong>CC BY-SA</strong> licence.
        </div>
        <SubmissionsListView />
      </Content>
    );

    const database = (
      <Content style={{ width: '100%', height: '100%' }}>
        <DatabaseOverviewView />
      </Content>
    );

    const contact = (
      <Content style={{ padding: '40px 60px', width: '100%', lineHeight: 1.8, color: '#2d3748', fontSize: 15 }}>
        <SectionDivider label="Contact" />
        <p>
          For questions, data issues, or collaboration inquiries regarding RiPPository,
          please reach out using the details below.
        </p>
        <table style={{ borderCollapse: 'collapse', marginTop: 16 }}>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600, paddingRight: 24, paddingBottom: 10, verticalAlign: 'top' }}>Name</td>
              <td style={{ paddingBottom: 10 }}>Joelle Mergola Greef</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, paddingRight: 24, paddingBottom: 10, verticalAlign: 'top' }}>Institution</td>
              <td style={{ paddingBottom: 10 }}>Leiden University / Wageningen University &amp; Research</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, paddingRight: 24, paddingBottom: 10, verticalAlign: 'top' }}>Email</td>
              <td style={{ paddingBottom: 10 }}>
                <a href="mailto:mergolagreefj@vuw.leidenuniv.nl">mergolagreefj@vuw.leidenuniv.nl</a>
                <br />
                <a href="mailto:joelle.mergolagreef@wur.nl">joelle.mergolagreef@wur.nl</a>
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, paddingRight: 24, paddingBottom: 10, verticalAlign: 'top' }}>GitHub</td>
              <td style={{ paddingBottom: 10 }}>
                <a href="https://github.com/Joelle-Mer/RiPPository" target="_blank" rel="noopener noreferrer">
                  github.com/Joelle-Mer/RiPPository
                </a>
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, paddingRight: 24, paddingBottom: 10, verticalAlign: 'top' }}>Issues</td>
              <td style={{ paddingBottom: 10 }}>
                Please report bugs or data errors via the{' '}
                <a href="https://github.com/Joelle-Mer/RiPPository/issues" target="_blank" rel="noopener noreferrer">
                  GitHub issue tracker
                </a>.
              </td>
            </tr>
          </tbody>
        </table>
      </Content>
    );

    return [submissions, database, contact];
  }, []);

  const elementLabels = useMemo(
    () => ['Submissions', 'Database', 'Contact'],
    [],
  );

  return useMemo(
    () => (
      <Layout style={{ width: '100%', height: '100%' }}>
        <Segmented elements={elements} elementLabels={elementLabels} />
      </Layout>
    ),
    [elementLabels, elements],
  );
}

export default MoreView;

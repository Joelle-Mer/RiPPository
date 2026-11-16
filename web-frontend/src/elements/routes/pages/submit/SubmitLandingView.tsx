import { useState } from 'react';
import { Button, Card, Col, Row, Typography } from 'antd';
import { CopyOutlined, PlusOutlined } from '@ant-design/icons';
import { Content } from 'antd/es/layout/layout';
import SubmitView, { CONTACT_EMAIL } from './SubmitView';

const { Title, Paragraph } = Typography;

type Mode = null | 'new' | 'from';

const correctionMail =
  `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Correction to a RiPPository record')}` +
  `&body=${encodeURIComponent('Accession:\n\nWhat should change, and why:\n')}`;

function SubmitLandingView() {
  const [mode, setMode] = useState<Mode>(null);

  if (mode) {
    // a fresh form each time, so leaving and coming back starts clean
    return <SubmitView key={mode} startFromExisting={mode === 'from'} onBack={() => setMode(null)} />;
  }

  return (
    <Content style={{ padding: '48px 48px', width: '100%', height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <Title level={2} style={{ textAlign: 'center', marginBottom: 8 }}>Submit to RiPPository</Title>
        <Paragraph style={{ textAlign: 'center', color: '#6b7280', marginBottom: 48 }}>
          Add a new RiPP record, from scratch or starting from one that is already filled in.
        </Paragraph>

        <Row gutter={[32, 24]} justify="center">
          <Col xs={24} sm={11}>
            <Card
              hoverable
              onClick={() => setMode('new')}
              style={{ textAlign: 'center', cursor: 'pointer', height: '100%' }}
              styles={{ body: { padding: '40px 32px' } }}
            >
              <PlusOutlined style={{ fontSize: 48, color: '#810e15', marginBottom: 16 }} />
              <Title level={4} style={{ marginBottom: 8 }}>New submission</Title>
              <Paragraph style={{ color: '#6b7280', marginBottom: 24 }}>
                Submit a brand-new RiPP compound record including structure, MS data,
                and biosynthetic gene cluster information.
              </Paragraph>
              <Button type="primary" size="large" icon={<PlusOutlined />}>
                Start new record
              </Button>
            </Card>
          </Col>

          <Col xs={24} sm={11}>
            <Card
              hoverable
              onClick={() => setMode('from')}
              style={{ textAlign: 'center', cursor: 'pointer', height: '100%' }}
              styles={{ body: { padding: '40px 32px' } }}
            >
              <CopyOutlined style={{ fontSize: 48, color: '#1677ff', marginBottom: 16 }} />
              <Title level={4} style={{ marginBottom: 8 }}>Start from an existing record</Title>
              <Paragraph style={{ color: '#6b7280', marginBottom: 24 }}>
                Copy every field of your earlier submission, or of a record in RiPPository, into
                a new form. You only add the new MS/MS data.
              </Paragraph>
              <Button size="large" icon={<CopyOutlined />}>
                Choose a record
              </Button>
            </Card>
          </Col>
        </Row>

        <Paragraph style={{ textAlign: 'center', color: '#6b7280', marginTop: 40, marginBottom: 8 }}>
          Found a mistake in a published record?{' '}
          <a href={correctionMail}>Write to {CONTACT_EMAIL}</a> with its accession and what
          should change.
        </Paragraph>
        <Paragraph style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
          All new submissions are reviewed by curators before being published.
        </Paragraph>
      </div>
    </Content>
  );
}

export default SubmitLandingView;

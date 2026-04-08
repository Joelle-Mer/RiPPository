import { useMemo } from 'react';
import { Layout } from 'antd';
import { Content } from 'antd/es/layout/layout';
import SectionDivider from '../../../basic/SectionDivider';
import Segmented from '../../../basic/Segmented';
import Imprint from './Imprint';
import InfoText from './InfoText';

function AboutView() {
  const elements = useMemo(() => {
    const infoText = <InfoText />;

    const imprint = (
      <Content>
        <SectionDivider label="Imprint" />
        <Imprint />
      </Content>
    );

    return [infoText, imprint];
  }, []);

  const elementLabels = useMemo(() => ['Information', 'Imprint'], []);

  return useMemo(
    () => (
      <Layout style={{ width: '100%', height: '100%' }}>
        <Segmented elements={elements} elementLabels={elementLabels} />
      </Layout>
    ),
    [elementLabels, elements],
  );
}

export default AboutView;

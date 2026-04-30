import { Content } from 'antd/es/layout/layout';
import Paragraph from 'antd/es/typography/Paragraph';
import { memo } from 'react';

import nwoLogo from '../../assets/nwo_logo.png';

function AcknowledgementNWO() {
  return (
    <Content
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 24,
      }}
    >
      <img src={nwoLogo} style={{ height: 250 }} alt="NWO logo" />
      <Paragraph style={{ fontWeight: 'bolder' }}>
        This project is funded by{' '}
        <a
          href="https://www.nwo.nl/"
          target="_blank"
          style={{ color: 'black', textDecoration: 'underline' }}
        >
          NWO (Dutch Research Council)
        </a>{' '}
        under the KIC project. <br />
        Project number: KICH1.LWV04.21.013.
      </Paragraph>
    </Content>
  );
}

export default memo(AcknowledgementNWO);

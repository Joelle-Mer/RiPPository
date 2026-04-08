import { useMemo } from 'react';
import { Content } from 'antd/es/layout/layout';
import Paragraph from 'antd/es/typography/Paragraph';
import Text from 'antd/es/typography/Text';

function CitationText() {
  return useMemo(
    () => (
      <Content
        style={{
          width: '100%',
          padding: 20,
        }}
      >
        <Paragraph
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Text style={{ width: '100%', textAlign: 'left' }}>
            Please cite RiPPository using the following reference:
          </Text>
          <br />
          <Text
            style={{
              width: '100%',
              textAlign: 'left',
              paddingLeft: 30,
            }}
          >
            RiPPository: an open-access spectral library for ribosomally
            synthesized and post-translationally modified peptides (RiPPs).
            Leiden University &amp; Wageningen University &amp; Research.{' '}
            <a href="https://github.com/Joelle-Mer/RiPPository" target="_blank">
              https://github.com/Joelle-Mer/RiPPository
            </a>
          </Text>
        </Paragraph>
      </Content>
    ),
    [],
  );
}

export default CitationText;

import { Content } from 'antd/es/layout/layout';
import { memo } from 'react';
import rippositoryLogo from '../../../../assets/rippository_logo.png';

function InfoText() {
  return (
    <Content
      style={{
        padding: '40px 60px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        maxWidth: 860,
        margin: '0 auto',
      }}
    >
      <img
        src={rippositoryLogo}
        style={{ width: 300, marginBottom: 32 }}
        alt="RiPPository logo"
      />
      <div style={{ width: '100%', lineHeight: 1.8, color: '#2d3748', fontSize: 15 }}>
        <p>
          RiPPository is an open-source spectral library dedicated to the identification
          of ribosomally synthesized and post-translationally modified peptides (RiPPs).
          It provides a curated collection of high-resolution mass spectrometry data for
          RiPP natural products, enabling systematic dereplication and discovery of novel
          bioactive peptides.
        </p>
        <p>
          RiPPository is developed and maintained at Leiden University and Wageningen University &amp; Research
          as a resource for the natural products and metabolomics communities.
        </p>

        <h3 style={{ marginTop: 32, marginBottom: 8, color: '#1a2e44' }}>Origin &amp; Technology</h3>
        <p>
          RiPPository is built on the{' '}
          <a href="https://massbank.eu" target="_blank" rel="noopener noreferrer">
            MassBank
          </a>{' '}
          platform, a public, open-access repository for sharing high-resolution mass
          spectral data developed by the MassBank consortium. The underlying web
          infrastructure, record format, and search functionality of RiPPository are
          derived from the{' '}
          <a href="https://github.com/MassBank/MassBank-web" target="_blank" rel="noopener noreferrer">
            MassBank-web
          </a>{' '}
          open-source project, which is licensed under the GNU General Public License v2.
        </p>

        <h3 style={{ marginTop: 32, marginBottom: 8, color: '#1a2e44' }}>Please Cite</h3>
        <p style={{ marginBottom: 8 }}>
          If you use RiPPository in your research, please cite:
        </p>
        <div
          style={{
            background: '#f7fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            padding: '14px 18px',
            fontSize: 14,
            lineHeight: 1.7,
          }}
        >
          RiPPository: an open-access spectral library for ribosomally synthesized
          and post-translationally modified peptides (RiPPs). Leiden University &amp; Wageningen University &amp; Research.{' '}
          <a
            href="https://github.com/Joelle-Mer/RiPPository"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://github.com/Joelle-Mer/RiPPository
          </a>
        </div>

        <h3 style={{ marginTop: 32, marginBottom: 8, color: '#1a2e44' }}>License</h3>
        <p>
          Spectral records in RiPPository are released under the{' '}
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
          </a>{' '}
          licence unless otherwise stated. The source code is available on{' '}
          <a
            href="https://github.com/Joelle-Mer/RiPPository"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>{' '}
          under the GNU General Public License v2.
        </p>
      </div>
    </Content>
  );
}

export default memo(InfoText);

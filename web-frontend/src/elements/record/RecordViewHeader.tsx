import { CSSProperties, JSX, useCallback, useEffect, useMemo, useState } from 'react';
import copyTextToClipboard from '../../utils/copyTextToClipboard';
import { Button, Dropdown, Skeleton, Tooltip } from 'antd';
import Record from '../../types/record/Record';
import { MF } from 'react-mf';
import StructureView from '../basic/StructureView';
import LabelWrapper from '../basic/LabelWrapper';
import { usePropertiesContext } from '../../context/properties/properties';
import buildSearchUrl from '../../utils/buildSearchUrl';
import NotAvailableLabel from '../basic/NotAvailableLabel';
import DownloadMenuItems from '../common/DownloadMenuItems';
import downloadRawRecord from '../../utils/request/downloadRawMassBankRecord';
import DownloadFormat from '../../types/DownloadFormat';
import downloadRecords from '../../utils/request/downloadRecords';
import ExportableContent from '../common/ExportableContent';

// ── DOI → publication title + authors via CrossRef ────────────────────────────
type DoiMeta = { title: string; authors: string } | null;

function useDoiMeta(doi: string): { loading: boolean; meta: DoiMeta } {
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<DoiMeta>(null);
  useEffect(() => {
    const trimmed = doi.trim();
    if (!trimmed) { setMeta(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          'https://api.crossref.org/works/' + encodeURIComponent(trimmed),
          { headers: { 'User-Agent': 'RiPPository/1.0' } },
        );
        if (!res.ok || cancelled) { setLoading(false); return; }
        const json = await res.json();
        const msg = json?.message;
        const title: string = msg?.title?.[0] ?? '';
        const authors: string = (msg?.author ?? [])
          .map((a: { given?: string; family?: string }) => [a.given, a.family].filter(Boolean).join(' '))
          .join(', ');
        if (!cancelled) setMeta(title ? { title, authors } : null);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [doi]);
  return { loading, meta };
}

function PublicationRow({ doi }: { doi: string }) {
  const { loading, meta } = useDoiMeta(doi);
  if (loading) return <Skeleton active paragraph={{ rows: 1 }} title={false} style={{ maxWidth: 500 }} />;
  if (!meta) return (
    <Tooltip title={doi}>
      <span style={{ color: '#9ca3af', fontSize: 12 }}>{doi || 'N/A'}</span>
    </Tooltip>
  );
  return (
    <div>
      <div style={{ fontWeight: 500 }}>{meta.title}</div>
      {meta.authors && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{meta.authors}</div>}
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
        <a href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer">{doi}</a>
      </div>
    </div>
  );
}

// ── Shared row style ──────────────────────────────────────────────────────────

const LABEL_W = 140;

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `${LABEL_W}px 1fr`,
      borderBottom: '1px solid #f3f4f6',
      padding: '7px 0',
      alignItems: 'start',
      minHeight: 36,
    }}>
      <span style={{ fontWeight: 600, color: '#6b7280', fontSize: 13, paddingRight: 8, paddingTop: 2 }}>
        {label}
      </span>
      <div style={{ fontSize: 13, color: '#111827', minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type InputProps = {
  record: Record;
  width: CSSProperties['width'];
  imageWidth?: number;
};

function RecordViewHeader({ record, width, imageWidth = 260 }: InputProps) {
  const { baseUrl, exportServiceUrl, frontendUrl } = usePropertiesContext();

  const [isRequestingDownload, setIsRequestingDownload] = useState<boolean>(false);

  const handleOnCopy = useCallback((label: string, text: string) => {
    copyTextToClipboard(label, text);
  }, []);

  const handleOnDownloadResult = useCallback(
    async (format: DownloadFormat) => {
      setIsRequestingDownload(true);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      format === 'massbank'
        ? await downloadRawRecord(exportServiceUrl, record.accession)
        : await downloadRecords(exportServiceUrl, format, [record.accession]);
      setIsRequestingDownload(false);
    },
    [exportServiceUrl, record.accession],
  );

  const downloadMenuItems = useMemo(
    () => DownloadMenuItems({ onDownload: handleOnDownloadResult }),
    [handleOnDownloadResult],
  );

  return useMemo(() => {
    const compoundClasses: string[] = [];
    record.compound.classes.forEach((c) => {
      if (c.includes(';')) {
        c.split(';').forEach((cc) => compoundClasses.push(cc.trim()));
      } else {
        compoundClasses.push(c.trim());
      }
    });
    compoundClasses.sort((a, b) => a.localeCompare(b));

    // Publication DOIs
    const dois = record.publication
      ? record.publication.split(/[,;]+/).map((d) => d.trim()).filter(Boolean)
      : [];

    // Formula display
    let formulaComponent: JSX.Element = <MF mf={record.compound.formula} />;
    if (
      record.compound.formula.length >= 4 &&
      record.compound.formula[0] === '[' &&
      record.compound.formula.includes(']') &&
      (record.compound.formula[record.compound.formula.length - 1] === '+' ||
        record.compound.formula[record.compound.formula.length - 1] === '-')
    ) {
      const formula = record.compound.formula.split('[')[1].split(']')[0];
      const count = record.compound.formula.split(']')[1].slice(0, -1);
      const sign = record.compound.formula[record.compound.formula.length - 1];
      formulaComponent = (
        <span><MF mf={formula} /><sup>{count}{sign}</sup></span>
      );
    }

    return (
      <div style={{ width, backgroundColor: 'white' }}>
        {/* ── Title + Download ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px 12px',
          borderBottom: '2px solid #f0f0f0',
          gap: 12,
        }}>
          <ExportableContent
            component={
              <span style={{ fontSize: 17, fontWeight: 700, color: '#111827', lineHeight: 1.4 }}>
                {record.title}
              </span>
            }
            mode="copy"
            onClick={() => handleOnCopy('Title', record.title)}
            title="Copy title to clipboard"
          />
          <Dropdown menu={{ items: downloadMenuItems }} trigger={['click']}>
            <Button
              style={{ flexShrink: 0, minWidth: 100, color: 'black', borderColor: 'black' }}
              disabled={isRequestingDownload}
            >
              {isRequestingDownload ? 'Preparing…' : 'Download'}
            </Button>
          </Dropdown>
        </div>

        {/* ── Details + Structure ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, padding: '0 20px 16px' }}>

          {/* Left: field rows */}
          <div style={{ flex: 1, minWidth: 0, paddingRight: 24 }}>

            <InfoRow label="Accession ID">
              <ExportableContent
                component={<LabelWrapper value={record.accession} />}
                mode="copy"
                onClick={() => handleOnCopy('Accession', record.accession)}
                title="Copy Accession to clipboard"
              />
            </InfoRow>

            <InfoRow label="Names">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {record.compound.names.map((name, i) => (
                  <ExportableContent
                    key={'name-' + name}
                    component={<LabelWrapper value={name} />}
                    mode="copy"
                    onClick={() => handleOnCopy(`Compound name ${i + 1}`, name)}
                    title={`Copy compound name ${i + 1} to clipboard`}
                    enableSearch
                    searchTitle={`Search for compound name ${i + 1}`}
                    searchUrl={buildSearchUrl('compound_name', name, baseUrl, frontendUrl)}
                  />
                ))}
              </div>
            </InfoRow>

            <InfoRow label="Classes">
              {compoundClasses.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {compoundClasses.map((name, i) => (
                    <ExportableContent
                      key={'class-' + name}
                      component={<LabelWrapper value={name} />}
                      mode="copy"
                      onClick={() => handleOnCopy(`Compound class ${i + 1}`, name)}
                      title={`Copy compound class ${i + 1} to clipboard`}
                      enableSearch
                      searchTitle={`Search for compound class ${i + 1}`}
                      searchUrl={buildSearchUrl('compound_class', name, baseUrl, frontendUrl)}
                    />
                  ))}
                </div>
              ) : (
                <NotAvailableLabel />
              )}
            </InfoRow>

            <InfoRow label="SMILES">
              <ExportableContent
                component={
                  <span style={{ wordBreak: 'break-all', fontSize: 12, fontFamily: 'monospace' }}>
                    {record.compound.smiles || 'N/A'}
                  </span>
                }
                mode="copy"
                onClick={() => handleOnCopy('SMILES', record.compound.smiles)}
                title="Copy SMILES to clipboard"
                enableSearch
                searchTitle="Search for SMILES"
                searchUrl={buildSearchUrl('substructure', record.compound.smiles, baseUrl, frontendUrl)}
              />
            </InfoRow>

            <InfoRow label="InChI">
              <ExportableContent
                component={
                  <span style={{ wordBreak: 'break-all', fontSize: 12, fontFamily: 'monospace' }}>
                    {record.compound.inchi || 'N/A'}
                  </span>
                }
                mode="copy"
                onClick={() => handleOnCopy('InChI', record.compound.inchi)}
                title="Copy InChI to clipboard"
                enableSearch
                searchTitle="Search for InChI"
                searchUrl={buildSearchUrl('inchi', record.compound.inchi, baseUrl, frontendUrl)}
              />
            </InfoRow>

            <InfoRow label="SPLASH">
              <ExportableContent
                component={<span style={{ fontFamily: 'monospace', fontSize: 12 }}>{record.peak.splash || 'N/A'}</span>}
                mode="copy"
                onClick={() => handleOnCopy('SPLASH', record.peak.splash)}
                title="Copy SPLASH to clipboard"
                enableSearch
                searchTitle="Search for SPLASH"
                searchUrl={buildSearchUrl('splash', record.peak.splash, baseUrl, frontendUrl)}
              />
            </InfoRow>

            {dois.length > 0 && dois.map((doi, i) => (
              <InfoRow key={`pub-${i}`} label={i === 0 ? 'Publication' : ''}>
                <PublicationRow doi={doi} />
              </InfoRow>
            ))}

          </div>

          {/* Right: structure + formula/mass */}
          <div style={{
            width: imageWidth,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: 12,
          }}>
            {record.compound.smiles && record.compound.smiles !== '' ? (
              <StructureView
                smiles={record.compound.smiles}
                imageWidth={imageWidth}
                imageHeight={imageWidth}
              />
            ) : (
              <div style={{ height: imageWidth, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>
                No structure available
              </div>
            )}

            <div style={{ marginTop: 12, width: '100%', borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontWeight: 600, color: '#6b7280', fontSize: 12 }}>Formula</span>
                <ExportableContent
                  component={<span style={{ fontWeight: 700, fontSize: 13 }}>{formulaComponent}</span>}
                  mode="copy"
                  onClick={() => copyTextToClipboard('Formula', record.compound.formula)}
                  title="Copy molecular formula to clipboard"
                  enableSearch
                  searchTitle="Search for molecular formula"
                  searchUrl={buildSearchUrl('formula', record.compound.formula, baseUrl, frontendUrl)}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: '#6b7280', fontSize: 12 }}>Exact Mass</span>
                <ExportableContent
                  component={<span style={{ fontWeight: 700, fontSize: 13 }}>{record.compound.mass.toString()}</span>}
                  mode="copy"
                  onClick={() => copyTextToClipboard('Molecular Mass', record.compound.mass.toString())}
                  title="Copy molecular mass to clipboard"
                  enableSearch
                  searchTitle="Search for molecular mass"
                  searchUrl={buildSearchUrl('exact_mass', record.compound.mass.toString(), baseUrl, frontendUrl)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }, [
    baseUrl,
    downloadMenuItems,
    frontendUrl,
    handleOnCopy,
    imageWidth,
    isRequestingDownload,
    record.accession,
    record.authors,
    record.compound,
    record.peak.splash,
    record.publication,
    record.title,
    width,
  ]);
}

export default RecordViewHeader;

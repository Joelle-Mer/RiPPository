import { JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RecordView from '../../../record/RecordView';
import Record from '../../../../types/record/Record';
import { Button, Spin } from 'antd';
import useContainerDimensions from '../../../../utils/useContainerDimensions';
import { Content } from 'antd/es/layout/layout';
import { useSearchParams } from 'react-router-dom';
import { usePropertiesContext } from '../../../../context/properties/properties';
import getRecord from '../../../../utils/request/fetchRecord';
import Text from 'antd/es/typography/Text';
import { CopyOutlined } from '@ant-design/icons';
import fetchRawMassBankRecord from '../../../../utils/request/fetchRawMassBankRecord';
import copyTextToClipboard from '../../../../utils/copyTextToClipboard';
import { SUBMISSIONS_KEY, RiPPSubmission } from '../submit/SubmitView';
import ErrorElement from '../../../basic/ErrorElement';

const toolButtonStyle = {
  width: '40px',
  border: 'none',
  boxShadow: 'none',
  backgroundColor: 'rgb(225, 231, 245)',
  marginLeft: 5,
  marginRight: 5,
  overallWidth: '50px',
};


function buildLocalRecord(sub: RiPPSubmission): Record {
  const peaks = (sub.peaks ?? []).map((p, i) => ({ ...p, id: String(i) }));
  return {
    accession: sub.accession,
    title: sub.recordTitle,
    date: { created: sub.date, modified: sub.date, updated: sub.date },
    authors: [{ name: sub.orcidName ? `${sub.orcidName} (${sub.orcid})` : sub.orcid }],
    publication: (sub.dois ?? []).join(', '),
    license: sub.license,
    copyright: '',
    compound: {
      names: [sub.compoundName],
      classes: [sub.compoundClass],
      formula: sub.formula,
      mass: sub.exactMass ?? 0,
      smiles: sub.smiles ?? '',
      inchi: sub.inchi ?? '',
      link: (sub.dbLinks ?? []).map((l) => ({ db: l.db, id: l.id, url: '' })),
    },
    species: {
      name: sub.origin?.organism ?? '',
      strain: sub.origin?.strain ?? undefined,
      lineage: [],
      link: [],
      sample: sub.origin?.source ? [sub.origin.source] : [],
    },
    acquisition: {
      instrument: sub.instrument,
      instrument_type: sub.instrumentType,
      chromatography: [],
      mass_spectrometry: {
        ion_mode: sub.ionMode,
        ms_type: sub.msType,
        subtags: [
          ...(sub.collisionEnergy ? [{ subtag: 'COLLISION_ENERGY', value: sub.collisionEnergy }] : []),
          ...(sub.ionization ? [{ subtag: 'IONIZATION', value: sub.ionization }] : []),
        ],
      },
    },
    mass_spectrometry: {
      focused_ion: sub.precursorType
        ? [{ subtag: 'PRECURSOR_TYPE', value: sub.precursorType }]
        : [],
      data_processing: [],
    },
    peak: {
      splash: sub.splash ?? '',
      numPeak: sub.numPeak,
      peak: {
        header: ['m/z', 'int.', 'rel.int.'],
        values: peaks,
      },
      neutral_loss: [],
    },
    comments: [
      ...(sub.bioactivity ?? []).map((b) => ({
        subtag: 'BIOACTIVITY',
        value: b.activity + (b.target ? ` (${b.target})` : ''),
      })),
      ...(sub.note ? [{ subtag: 'NOTE', value: sub.note }] : []),
      ...(sub.genome?.mibig ? [{ subtag: 'MIBIG', value: sub.genome.mibig }] : []),
    ],
  } as Record;
}

function getLocalRecord(accession: string): Record | null {
  try {
    const stored: RiPPSubmission[] = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) ?? '[]');
    const sub = stored.find((s) => s.accession === accession);
    if (!sub) return null;
    return buildLocalRecord(sub);
  } catch {
    return null;
  }
}

function AccessionView() {
  const ref = useRef(null);
  const { width, height } = useContainerDimensions(ref);
  const { backendUrl, exportServiceUrl } = usePropertiesContext();

  const [isRequesting, setIsRequesting] = useState<boolean>(false);
  const [requestedAccession, setRequestedAccession] = useState<string>('');
  const [record, setRecord] = useState<Record | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  const accession = searchParams.get('id');
  const showRaw = searchParams.get('raw') !== null;

  const notFoundElement = useMemo(
    () => (
      <div
        key={'no-record-found-' + requestedAccession}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <p style={{ fontWeight: 'bolder', fontSize: 'larger' }}>
          No database entry found for "{requestedAccession}".
        </p>
      </div>
    ),
    [requestedAccession],
  );

  const handleOnSearch = useCallback(
    async (acc: string, raw: boolean) => {
      setIsRequesting(true);
      setRequestedAccession(acc);

      if (raw) {
        let _rawText: string | null = null;
        try {
          const rawMassBankRecordText = await fetchRawMassBankRecord(
            exportServiceUrl,
            acc,
          );
          if (rawMassBankRecordText) {
            _rawText = rawMassBankRecordText as string;
          } else {
            _rawText = null;
          }
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
          // console.error('Error fetching raw MassBank record:', error);
          _rawText = null;
        }
        setRawText(_rawText);
      } else {
        const localRecord = getLocalRecord(acc);
        if (localRecord) {
          setErrorMessage(null);
          setRecord(localRecord);
        } else {
          const response = await getRecord(acc, backendUrl);
          if (response.status !== 'success') {
            setErrorMessage(response.message);
            setRecord(null);
          } else {
            setErrorMessage(null);
            if (typeof response.data === 'object') {
              setRecord(response.data);
            } else {
              setRecord(null);
            }
          }
        }
      }

      setIsRequesting(false);
    },
    [backendUrl, exportServiceUrl],
  );

  useEffect(() => {
    if (accession) {
      if (showRaw) {
        handleOnSearch(accession, true);
      } else {
        handleOnSearch(accession, false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accession, showRaw]);

  const handleOnCopy = useCallback(() => {
    copyTextToClipboard('Record Text', rawText ? rawText : '');
  }, [rawText]);

  const recordView = useMemo(() => {
    let rawTextElements: JSX.Element[] = [];
    if (rawText) {
      rawTextElements = (rawText as string)
        .split(/\n/g)
        .map((line: string, i: number) => (
          <label key={line + '_' + i}>
            {line}
            <br />
          </label>
        ));
    } else {
      rawTextElements = [notFoundElement];
    }
    return showRaw && rawText && rawText.length > 0 ? (
      <Content
        style={{
          width,
          height,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Button
          children={
            <CopyOutlined title="Copy record data to clipboard" />
          }
          onClick={() => handleOnCopy()}
          style={toolButtonStyle}
        />
        <Text
          style={{
            width: `calc(100% - ${toolButtonStyle.overallWidth})`,
            height,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: 10,
            backgroundColor: 'white',
          }}
        >
          {rawTextElements}
        </Text>
      </Content>
    ) : record ? (
      <RecordView record={record} width={width} height={height} />
    ) : requestedAccession !== '' ? (
      notFoundElement
    ) : undefined;
  }, [
    rawText,
    showRaw,
    width,
    height,
    record,
    requestedAccession,
    notFoundElement,
    handleOnCopy,
  ]);

  return useMemo(
    () => (
      <Content
        ref={ref}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {isRequesting ? (
          <Spin size="large" />
        ) : errorMessage ? (
          <ErrorElement
            message={`An error occurred while trying to fetch the record for "${requestedAccession}".`}
          />
        ) : (
          recordView
        )}
      </Content>
    ),
    [isRequesting, errorMessage, requestedAccession, recordView],
  );
}

export default AccessionView;

import './Annotate.scss';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Tag,
  Upload,
  Checkbox,
} from 'antd';
import {
  DownloadOutlined,
  InboxOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import FileSaver from 'file-saver';
const { saveAs } = FileSaver;
import { usePropertiesContext } from '../../../../context/properties/properties';
import AnnotateAlphabet from './AnnotateAlphabet';
import AnnotateFeedback from './AnnotateFeedback';
import AnnotateKnown from './AnnotateKnown';
import AnnotateSimilar from './AnnotateSimilar';
import AnnotateSpectrum from './AnnotateSpectrum';
import {
  NeighbourPanel,
  PairPanel,
  PrecursorPanel,
  SavedPanel,
  StepsPanel,
} from './AnnotateResults';
import { annotateClient, messageOf } from './annotateApi';
import {
  chainMarks,
  chargeOf,
  errorIn,
  ErrorUnit,
  formatMz,
  keptPeaks,
  movedChain,
  precursorLinks,
  precursorNeighbours,
  safeFileName,
  toCsv,
  withPrecursor,
  gapOnlyMarks,
} from './annotateFormat';
import { ErrorUnitContext } from './annotateUnit';
import {
  Candidate,
  CustomEntry,
  Query,
  SavedChain,
  SpectrumRecord,
  Tolerance,
} from './annotateTypes';

const standardClass = 'standard';
const savedColors = ['#15803d', '#be185d', '#b45309', '#0e7490', '#4d7c0f'];

type Run<T> = (signal: AbortSignal) => Promise<T>;

// a result belongs to the request that made it, so an answer for an old selection is never shown
function useRequest<T>(run: Run<T> | null) {
  const [done, setDone] = useState<{
    run: Run<T>;
    data: T | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!run) {
      return;
    }
    const controller = new AbortController();
    run(controller.signal)
      .then((data) => setDone({ run, data, error: null }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setDone({ run, data: null, error: messageOf(err) });
        }
      });
    return () => controller.abort();
  }, [run]);

  const current = done && done.run === run ? done : null;
  return {
    // the last answer of any request, for what should not blink while the next one is on its way
    latest: done?.data ?? null,
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: run !== null && current === null,
  };
}

function AnnotateView() {
  const { baseUrl } = usePropertiesContext();
  const client = useMemo(() => annotateClient(baseUrl), [baseUrl]);
  const svgRef = useRef<SVGSVGElement>(null);

  const [spectra, setSpectra] = useState<SpectrumRecord[]>([]);
  const [position, setPosition] = useState(0);
  const [fileName, setFileName] = useState('');
  const [example, setExample] = useState<string | null>(null);
  // label gaps no residue fits with their mass
  const [gapMass, setGapMass] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pastedPrecursor, setPastedPrecursor] = useState<number | null>(null);
  const [pastedCharge, setPastedCharge] = useState(1);
  const [picks, setPicks] = useState<number[]>([]);
  const [charge, setCharge] = useState(1);
  // the classes and kinds of modification ticked; none means the standard 19 alone
  const [classNames, setClassNames] = useState<string[]>([]);
  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [custom, setCustom] = useState<CustomEntry[]>([]);
  // the error limit the user typed, per unit; empty means the default for that unit
  const [limits, setLimits] = useState<Partial<Record<ErrorUnit, number>>>({});
  const [errorUnit, setErrorUnit] = useState<ErrorUnit>('mDa');
  const [minIntensity, setMinIntensity] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number[]>([]);
  const [savedBySpectrum, setSavedBySpectrum] = useState<
    Record<number, SavedChain[]>
  >({});

  const meta = useRequest(client.meta);
  const examples = useRequest(client.examples);
  const alphabet = useRequest(client.alphabet);

  const className = useMemo(
    () => (classNames.length > 0 ? classNames : standardClass),
    [classNames],
  );
  const spectrum = spectra[position] ?? null;
  const full = useMemo(
    () => (spectrum ? withPrecursor(spectrum.peaks, spectrum.precursor) : null),
    [spectrum],
  );
  // the peaks every call sees: the full list, less any below the user's intensity filter
  const view = useMemo(() => {
    if (!full) {
      return null;
    }
    const kept = keptPeaks(full.peaks, full.precursorIndex, minIntensity);
    const toView = new Map(kept.map((f, v) => [f, v]));
    return {
      kept,
      toView,
      peaks: kept.map((i) => full.peaks[i]),
      precursorIndex: toView.get(full.precursorIndex) ?? -1,
    };
  }, [full, minIntensity]);
  const peaks = view?.peaks;
  const precursorIndex = view?.precursorIndex ?? -1;
  const customTolerance = limits[errorUnit] !== undefined;
  const tolerance = useMemo(
    (): Tolerance => ({
      unit: errorUnit,
      value:
        limits[errorUnit] ?? meta.data?.tolerance.defaults[errorUnit] ?? 10,
    }),
    [errorUnit, limits, meta.data],
  );
  const query = useMemo((): Query | null => {
    return peaks
      ? {
          peaks,
          class_name: className,
          charge,
          include,
          exclude,
          custom,
          tolerance,
        }
      : null;
  }, [charge, className, custom, exclude, include, peaks, tolerance]);

  const ordered = useMemo(() => [...picks].sort((a, b) => a - b), [picks]);
  const anchor = picks.length > 0 ? picks[picks.length - 1] : null;
  // the precursor is picked like a peak, but its distances are not gaps between peaks
  const fragments = useMemo(
    () => ordered.filter((i) => i !== precursorIndex),
    [ordered, precursorIndex],
  );
  const precursorPicked = picks.includes(precursorIndex);

  const customRun = useMemo(
    () =>
      custom.length > 0
        ? (s: AbortSignal) =>
            client.customResidues(custom, className, include, s)
        : null,
    [className, client, custom, include],
  );
  const neighbourRun = useMemo(
    () =>
      query && anchor !== null && anchor !== precursorIndex
        ? (s: AbortSignal) => client.neighbours(query, anchor, s)
        : null,
    [anchor, client, precursorIndex, query],
  );
  const stepsRun = useMemo(
    () =>
      query && fragments.length >= 2
        ? (s: AbortSignal) => client.steps(query, fragments, s)
        : null,
    [client, fragments, query],
  );
  const chainRun = useMemo(
    () =>
      query && fragments.length === 2
        ? (s: AbortSignal) =>
            client.connect(query, fragments[0], fragments[1], s)
        : null,
    [client, fragments, query],
  );
  const linkRun = useMemo(
    () =>
      query && fragments.length >= 2
        ? (s: AbortSignal) => client.links(query, fragments, s)
        : null,
    [client, fragments, query],
  );
  const precursorMz = spectrum?.precursor ?? null;
  const precursorCharge = chargeOf(spectrum?.charge_hint ?? null);
  const precursorRun = useMemo(
    () =>
      query && precursorPicked && precursorMz !== null
        ? (s: AbortSignal) =>
            client.precursorGaps(
              query,
              precursorIndex,
              precursorMz,
              precursorCharge,
              s,
            )
        : null,
    [
      client,
      precursorCharge,
      precursorIndex,
      precursorMz,
      precursorPicked,
      query,
    ],
  );

  // the closest records in the database, for the measured peaks alone (the precursor point is not one)
  const measured = useMemo(
    () => (peaks ?? []).filter((_, i) => i !== precursorIndex),
    [peaks, precursorIndex],
  );
  const similarRun = useMemo(
    () =>
      measured.length > 0
        ? (s: AbortSignal) => client.similar(measured, precursorMz, s)
        : null,
    [client, measured, precursorMz],
  );
  const similar = useRequest(similarRun);
  const rawNeighbours = useRequest(neighbourRun);
  const rawSteps = useRequest(stepsRun);
  const rawChains = useRequest(chainRun);
  const rawLinks = useRequest(linkRun);
  const rawPrecursor = useRequest(precursorRun);

  const neighbours = {
    ...rawNeighbours,
    data: useMemo(
      () =>
        rawNeighbours.data &&
        rawNeighbours.data.filter((n) => n.peak !== precursorIndex),
      [precursorIndex, rawNeighbours.data],
    ),
  };
  const steps = rawSteps;
  const chains = {
    ...rawChains,
    data: useMemo(() => {
      if (!rawChains.data) {
        return null;
      }
      const paths = rawChains.data.paths.filter(
        (path) => !path.nodes.includes(precursorIndex),
      );
      return { ...rawChains.data, n_paths: paths.length, paths };
    }, [precursorIndex, rawChains.data]),
  };
  const toPrecursor = rawPrecursor;
  const shownLinks = useMemo(
    () => [
      ...(rawLinks.latest ?? []),
      ...(toPrecursor.data
        ? precursorLinks(toPrecursor.data, fragments, precursorIndex)
        : []),
    ],
    [fragments, precursorIndex, rawLinks.latest, toPrecursor.data],
  );
  const plotNeighbours = useMemo(() => {
    if (anchor === precursorIndex && toPrecursor.data && peaks) {
      return precursorNeighbours(toPrecursor.data, peaks);
    }
    return neighbours.data ?? [];
  }, [anchor, neighbours.data, peaks, precursorIndex, toPrecursor.data]);
  const shownSteps = useMemo(() => rawSteps.latest ?? [], [rawSteps.latest]);
  const customRecords = useRequest(customRun);

  const showSpectra = useCallback((found: SpectrumRecord[], source: string) => {
    setSpectra(found);
    setPosition(0);
    setPicks([]);
    setHighlight([]);
    setSavedBySpectrum({});
    setFileName(source);
  }, []);

  const handleExample = useCallback(
    async (accession: string) => {
      setExample(accession);
      setUploading(true);
      setUploadNote(null);
      try {
        showSpectra(await client.loadExample(accession), accession);
      } catch (err) {
        setExample(null);
        setUploadNote(messageOf(err));
      } finally {
        setUploading(false);
      }
    },
    [client, showSpectra],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setExample(null);
      setUploading(true);
      setUploadNote(null);
      try {
        const found = await client.upload(file);
        showSpectra(found, file.name);
        if (found.length === 0) {
          setUploadNote(
            `No spectra found in ${file.name}. Check that it is an mgf with peak lists.`,
          );
        }
      } catch (err) {
        setUploadNote(messageOf(err));
      } finally {
        setUploading(false);
      }
    },
    [client, showSpectra],
  );

  const handlePaste = useCallback(async () => {
    setExample(null);
    setUploading(true);
    setUploadNote(null);
    try {
      showSpectra(
        await client.peakList(pasted, pastedPrecursor, pastedCharge),
        'pasted peak list',
      );
      setPasting(false);
    } catch (err) {
      setUploadNote(messageOf(err));
    } finally {
      setUploading(false);
    }
  }, [client, pasted, pastedCharge, pastedPrecursor, showSpectra]);

  const beforeUpload = useCallback(
    (file: File) => {
      handleFile(file);
      return false;
    },
    [handleFile],
  );

  const handleSpectrum = useCallback((value: number) => {
    setPosition(value);
    setPicks([]);
    setHighlight([]);
  }, []);

  const handleToggle = useCallback((peak: number) => {
    setPicks((current) =>
      current.includes(peak)
        ? current.filter((p) => p !== peak)
        : [...current, peak],
    );
  }, []);

  // a right-button box adds every peak in it that is not picked yet; it never unpicks
  const handleAddPeaks = useCallback((found: number[]) => {
    setPicks((current) => [
      ...current,
      ...found.filter((peak) => !current.includes(peak)),
    ]);
  }, []);

  const handleClasses = useCallback(
    (names: string[]) => {
      // a residue toggle that no remaining choice offers would be refused, so it goes; toggles on
      // the standard 19 and on your own residues stay
      const all = meta.data?.classes ?? [];
      const labelsOf = (list: typeof all) =>
        new Set(
          list.flatMap((c) =>
            c.modifications.flatMap((m) => m.residues.map((r) => r.label)),
          ),
        );
      const offered = labelsOf(all.filter((c) => names.includes(c.name)));
      const fromSets = labelsOf(all);
      const keep = (label: string) =>
        offered.has(label) || !fromSets.has(label);
      setClassNames(names);
      setInclude((current) => current.filter(keep));
      setExclude((current) => current.filter(keep));
    },
    [meta.data],
  );

  // every class and kind ticked, and every residue they allow switched on
  const handleAllModifications = useCallback(() => {
    const sets = (meta.data?.classes ?? []).filter(
      (c) => c.name !== standardClass,
    );
    const residues = sets.flatMap((c) =>
      c.modifications.flatMap((m) => m.residues),
    );
    const fromSets = new Set(residues.map((r) => r.label));
    setClassNames(sets.map((c) => c.name));
    setInclude([
      ...new Set(residues.filter((r) => !r.on_by_default).map((r) => r.label)),
    ]);
    setExclude((current) => current.filter((label) => !fromSets.has(label)));
  }, [meta.data]);

  const handleResidue = useCallback(
    (label: string, onByDefault: boolean, on: boolean) => {
      if (onByDefault) {
        setExclude((current) =>
          on ? current.filter((l) => l !== label) : [...current, label],
        );
      } else {
        setInclude((current) =>
          on ? [...current, label] : current.filter((l) => l !== label),
        );
      }
    },
    [],
  );

  const handleAddCustom = useCallback(
    async (entry: CustomEntry) => {
      const next = [...custom, entry];
      try {
        await client.customResidues(next, className, include);
        setCustom(next);
        return null;
      } catch (err) {
        return messageOf(err);
      }
    },
    [className, client, custom, include],
  );

  const handleRemoveCustom = useCallback((name: string) => {
    setCustom((current) => current.filter((e) => e.name !== name));
    setExclude((current) =>
      current.filter((l) => l !== name && !l.endsWith(`[${name}]`)),
    );
  }, []);

  const setLimit = useCallback(
    (value: number | string | null) => {
      setLimits((current) => {
        const next = { ...current };
        if (typeof value === 'number' && value > 0) {
          next[errorUnit] = value;
        } else {
          delete next[errorUnit];
        }
        return next;
      });
    },
    [errorUnit],
  );

  const handleResetResidues = useCallback(() => {
    setInclude([]);
    setExclude([]);
  }, []);

  // saved chains are kept against the full peak list, so an intensity filter hides one rather than
  // losing it, and it comes back when the filter is lowered
  const stored = useMemo(
    () => savedBySpectrum[position] ?? [],
    [position, savedBySpectrum],
  );
  const saved = useMemo(
    () =>
      view
        ? stored.flatMap((chain) => {
            const shown = movedChain(chain, (i) => view.toView.get(i));
            return shown ? [shown] : [];
          })
        : [],
    [stored, view],
  );
  const hiddenChains = stored.length - saved.length;

  const handleSaveChain = useCallback(() => {
    if (!view) {
      return;
    }
    const id = Math.max(0, ...stored.map((c) => c.id)) + 1;
    const chain = movedChain(
      {
        id,
        color: savedColors[(id - 1) % savedColors.length],
        charge,
        tolerance,
        picks: ordered,
        // gaps no residue fits are kept too, shown while gap masses are switched on
        marks: chainMarks([
          ...shownLinks,
          ...gapOnlyMarks(shownSteps, shownLinks, new Set(ordered)),
        ]),
      },
      (i) => view.kept[i],
    );
    if (!chain) {
      return;
    }
    setSavedBySpectrum((current) => ({
      ...current,
      [position]: [...(current[position] ?? []), chain],
    }));
    setPicks([]);
    setHighlight([]);
  }, [
    charge,
    ordered,
    position,
    shownLinks,
    shownSteps,
    stored,
    tolerance,
    view,
  ]);

  // Ctrl+Z (Cmd+Z on a Mac) removes the last peak picked, as the Remove last peak button does,
  // except while typing in a box, where it keeps undoing the typing
  useEffect(() => {
    const undo = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== 'z'
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      if (picks.length === 0) {
        return;
      }
      event.preventDefault();
      setPicks((current) => current.slice(0, -1));
    };
    window.addEventListener('keydown', undo);
    return () => window.removeEventListener('keydown', undo);
  }, [picks.length]);

  const handleMinIntensity = useCallback(
    (value: number | string | null) => {
      const next = typeof value === 'number' && value > 0 ? value : null;
      if (full && view) {
        // keep each picked peak that survives the new filter, at its new position
        const nextKept = keptPeaks(full.peaks, full.precursorIndex, next);
        const nextView = new Map(nextKept.map((f, v) => [f, v]));
        setPicks((current) =>
          current.flatMap((v) => {
            const moved = nextView.get(view.kept[v]);
            return moved === undefined ? [] : [moved];
          }),
        );
      }
      setHighlight([]);
      setMinIntensity(next);
    },
    [full, view],
  );

  const handleLoadChain = useCallback((chain: SavedChain) => {
    setCharge(chain.charge);
    if (chain.tolerance) {
      const { unit, value } = chain.tolerance;
      setErrorUnit(unit);
      setLimits((current) => ({ ...current, [unit]: value }));
    }
    setHighlight([]);
    setPicks(chain.picks);
  }, []);

  const handleDeleteChain = useCallback(
    (id: number) => {
      setSavedBySpectrum((current) => ({
        ...current,
        [position]: (current[position] ?? []).filter((c) => c.id !== id),
      }));
    },
    [position],
  );

  // the known structure is shown only for a record loaded from the database
  const knownStructure = example !== null ? (spectrum?.known ?? null) : null;
  const comparisonRun = useMemo(
    () =>
      query && knownStructure && saved.length > 0
        ? (s: AbortSignal) =>
            Promise.all(
              saved.map((chain) =>
                chain.marks.some((mark) => mark.candidates.length > 0)
                  ? client.compareKnown(chain, knownStructure, query, s)
                  : null,
              ),
            )
        : null,
    [client, knownStructure, query, saved],
  );
  const comparisons = useRequest(comparisonRun);

  const handleUseChain = useCallback((nodes: number[]) => {
    setHighlight([]);
    setPicks(nodes);
  }, []);

  const stem = safeFileName(spectrum?.name ?? 'spectrum');

  const exportSvg = useCallback(() => {
    if (!svgRef.current) {
      return;
    }
    const copy = svgRef.current.cloneNode(true) as SVGSVGElement;
    copy.querySelectorAll('[data-export="no"]').forEach((n) => n.remove());
    const text = new XMLSerializer().serializeToString(copy);
    saveAs(
      new Blob([text], { type: 'image/svg+xml;charset=utf-8' }),
      `ripp_annotation_${stem}.svg`,
    );
  }, [stem]);

  const exportCsv = useCallback(() => {
    if (!peaks) {
      return;
    }
    // one row per residue that fits a step, nearest first, so a step with two fits has two rows
    const mz = (i: number) => formatMz(peaks[i][0]);
    const rows: (string | number | null)[][] = [
      [
        'chain',
        'step',
        'from_mz',
        'to_mz',
        'gap_da',
        'residue',
        'error_' + errorUnit,
      ],
    ];
    const add = (
      chain: string,
      step: number,
      from: number,
      to: number,
      gap: number,
      candidates: Candidate[],
    ) => {
      const head = [chain, step, mz(from), mz(to), gap];
      if (candidates.length === 0) {
        rows.push([...head, 'no single residue', null]);
      }
      candidates.forEach((c) => {
        const e = errorIn(c, errorUnit);
        rows.push([...head, c.label, e.unit === errorUnit ? e.value : null]);
      });
    };
    (steps.data ?? []).forEach((s, n) =>
      add('selection', n + 1, s.from, s.to, s.result.gap, s.result.candidates),
    );
    saved.forEach((chain) =>
      chain.marks.forEach((mark, n) =>
        add(
          'saved ' + chain.id,
          n + 1,
          mark.from,
          mark.to,
          mark.gap,
          mark.candidates,
        ),
      ),
    );
    saveAs(
      new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }),
      `ripp_annotation_${stem}.csv`,
    );
  }, [errorUnit, peaks, saved, stem, steps.data]);

  const exportJson = useCallback(() => {
    if (!spectrum) {
      return;
    }
    const record = {
      exported: new Date().toISOString(),
      file: fileName,
      spectrum: {
        name: spectrum.name,
        index: spectrum.index,
        precursor: spectrum.precursor,
        charge_hint: spectrum.charge_hint,
        collision_energy: spectrum.collision_energy,
        n_peaks: spectrum.n_peaks,
        known: spectrum.known,
      },
      settings: {
        class_name: className,
        series_charge: charge,
        included_residues: include,
        custom_entries: custom,
        custom_residues: customRecords.data ?? [],
        excluded_residues: exclude,
        error_limit: tolerance,
        error_limit_rule: meta.data?.tolerance.rule ?? null,
        intensity_filter_percent: minIntensity,
        saved_chains_hidden_by_filter: hiddenChains,
      },
      picks: ordered.map((i) => ({
        peak: i,
        mz: peaks?.[i][0],
        intensity: peaks?.[i][1],
        is_precursor: i === precursorIndex,
      })),
      gaps: steps.data ?? [],
      chains: chains.data?.paths ?? [],
      to_precursor: toPrecursor.data,
      saved_chains: saved.map((chain, n) => ({
        ...chain,
        peaks: chain.picks.map((i) => peaks?.[i][0]),
        against_known: comparisons.data?.[n] ?? null,
      })),
    };
    saveAs(
      new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }),
      `ripp_annotation_${stem}.json`,
    );
  }, [
    hiddenChains,
    minIntensity,
    chains.data,
    charge,
    className,
    comparisons.data,
    custom,
    customRecords.data,
    exclude,
    fileName,
    include,
    tolerance,
    meta.data,
    ordered,
    peaks,
    precursorIndex,
    saved,
    spectrum,
    stem,
    steps.data,
    toPrecursor.data,
  ]);

  const spectrumOptions = useMemo(
    () =>
      spectra.map((s, i) => ({
        value: i,
        label: `${s.name} · m/z ${s.precursor?.toFixed(4) ?? 'unknown'} · ${s.n_peaks} peaks · #${s.index}`,
      })),
    [spectra],
  );

  const standard = useMemo(
    () => Object.entries(alphabet.data ?? {}),
    [alphabet.data],
  );

  const seenLabels = useMemo(() => {
    const seen = new Set<string>();
    (steps.data ?? []).forEach((s) =>
      s.result.candidates.forEach((c) => seen.add(c.label)),
    );
    return seen;
  }, [steps.data]);

  const widen =
    classNames.length === 0
      ? 'choosing a RiPP class or adding your own under Residues may help'
      : 'switching on a modification or adding your own under Residues may help';

  return (
    <ErrorUnitContext.Provider value={errorUnit}>
      <div className="annotate">
        <header className="annotate-head">
          <h2>RiPP annotator</h2>
          <p>
            Load MS/MS data, pick peaks, and read which residues could lie
            between them. New here? See <a href="#annotate-howto">How to use</a>{' '}
            at the bottom of the page.
          </p>
        </header>

        {meta.error && <Alert type="error" title={meta.error} showIcon />}

        <div
          className={
            spectrum ? 'annotate-controls annotate-loaded' : 'annotate-controls'
          }
        >
          <div className="annotate-sources">
            {spectrum ? (
              <Upload
                accept=".mgf"
                multiple={false}
                showUploadList={false}
                beforeUpload={beforeUpload}
                disabled={uploading}
              >
                <Button icon={<UploadOutlined />} loading={uploading}>
                  Change file
                </Button>
              </Upload>
            ) : (
              <Upload.Dragger
                accept=".mgf"
                multiple={false}
                showUploadList={false}
                beforeUpload={beforeUpload}
                className="annotate-upload"
                disabled={uploading}
              >
                <p className="annotate-upload-text">
                  <InboxOutlined />{' '}
                  {uploading
                    ? 'Reading…'
                    : 'Drop an mgf here, or click to choose'}
                </p>
                <p className="annotate-hint">
                  Your file is read once and discarded. Nothing is stored.
                </p>
              </Upload.Dragger>
            )}
            <Button onClick={() => setPasting((open) => !open)}>
              {pasting ? 'Close the peak list' : 'Paste a peak list'}
            </Button>
          </div>
          <div className="annotate-pickers">
            <label className="annotate-example">
              Example from RiPPository
              <Select
                aria-label="Example from RiPPository"
                className="annotate-example-select"
                popupMatchSelectWidth={false}
                loading={examples.loading}
                disabled={!examples.data || uploading}
                placeholder={
                  examples.error ? 'Database not reachable' : 'Choose a record'
                }
                value={example ?? undefined}
                options={(examples.data ?? []).map((record) => ({
                  value: record.accession,
                  label: `${record.title.split(';')[0]} · ${record.accession}`,
                }))}
                onChange={handleExample}
                showSearch
                optionFilterProp="label"
              />
            </label>
            <label>
              Spectrum
              <Select
                aria-label="Spectrum"
                className="annotate-spectrum-select"
                disabled={spectra.length === 0}
                placeholder="Upload a file or choose an example"
                value={spectrum ? position : undefined}
                options={spectrumOptions}
                onChange={handleSpectrum}
                showSearch
                optionFilterProp="label"
              />
            </label>
            <label>
              Fragment charge
              <Select
                aria-label="Fragment charge"
                className="annotate-charge-select"
                value={charge}
                options={[1, 2, 3].map((z) => ({ value: z, label: `${z}+` }))}
                onChange={setCharge}
              />
            </label>
            <div className="annotate-field">
              Error limit
              <Space.Compact>
                <InputNumber
                  aria-label="Error limit"
                  className="annotate-limit-input"
                  min={0.1}
                  step={1}
                  placeholder={String(
                    meta.data?.tolerance.defaults[errorUnit] ?? '',
                  )}
                  value={limits[errorUnit] ?? null}
                  onChange={setLimit}
                />
                <Radio.Group
                  aria-label="Error unit"
                  optionType="button"
                  buttonStyle="solid"
                  options={['mDa', 'ppm']}
                  value={errorUnit}
                  onChange={(event) => setErrorUnit(event.target.value)}
                />
              </Space.Compact>
            </div>
            <div className="annotate-field">
              Intensity filter
              <InputNumber
                aria-label="Intensity filter, percent of the strongest peak"
                className="annotate-limit-input"
                min={0}
                max={99}
                step={1}
                placeholder="off"
                suffix="%"
                value={minIntensity}
                onChange={handleMinIntensity}
              />
            </div>
            <div className="annotate-field">
              Gaps with no residue
              <Checkbox
                checked={gapMass}
                onChange={(event) => setGapMass(event.target.checked)}
              >
                Show their mass
              </Checkbox>
            </div>
            {spectrum && (
              <p className="annotate-meta">
                Precursor {spectrum.precursor?.toFixed(4) ?? 'unknown'}
                {spectrum.charge_hint ? ` (${spectrum.charge_hint})` : ''},{' '}
                {minIntensity !== null && view
                  ? `${view.kept.length - (precursorIndex >= 0 ? 1 : 0)} of `
                  : ''}
                {spectrum.n_peaks} peaks
                {minIntensity !== null
                  ? ` (at least ${minIntensity}% of the strongest)`
                  : ''}
                {spectrum.n_peaks === meta.data?.max_peaks
                  ? ', strongest kept'
                  : ''}
                .
                {spectrum.precursor_source?.derived &&
                  ` The precursor is worked out from the record's ${spectrum.precursor_source.derived.precursor_type} and neutral mass${
                    spectrum.precursor_source.derived.formula_check
                      ?.error_mda !== undefined
                      ? `, which is ${spectrum.precursor_source.derived.formula_check.error_mda} mDa from its formula`
                      : ''
                  }.`}
                {spectrum.precursor_source?.problem &&
                  ` No precursor: ${spectrum.precursor_source.problem}`}
              </p>
            )}
          </div>
        </div>

        {pasting && (
          <section className="annotate-card annotate-paste">
            <h3>Paste a peak list</h3>
            <Input.TextArea
              aria-label="Peak list"
              rows={7}
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder={`One peak per line: m/z, then intensity
157.0715 100
214.0930 35`}
            />
            <div className="annotate-paste-row">
              <InputNumber
                aria-label="Precursor m/z, optional"
                placeholder="Precursor m/z (optional)"
                min={1}
                value={pastedPrecursor}
                onChange={(value) =>
                  setPastedPrecursor(typeof value === 'number' ? value : null)
                }
                style={{ width: 210 }}
              />
              <Select
                aria-label="Precursor charge"
                value={pastedCharge}
                options={[1, 2, 3].map((z) => ({ value: z, label: `${z}+` }))}
                onChange={setPastedCharge}
              />
              <Button
                type="primary"
                loading={uploading}
                disabled={pasted.trim().length === 0}
                onClick={handlePaste}
              >
                Read peaks
              </Button>
            </div>
            <p className="annotate-hint">
              Spaces, tabs or commas between the two numbers all work. Lines
              starting with # are skipped. Without a precursor the page works,
              but nothing is measured from it.
            </p>
          </section>
        )}
        {uploadNote && <Alert type="warning" title={uploadNote} showIcon />}
        <p className="annotate-hint">
          Only residues within {tolerance.value} {tolerance.unit}
          {tolerance.unit === 'ppm' ? " of the heavier peak's m/z" : ''} are
          marked, and every error is shown in {tolerance.unit}
          {customTolerance ? '' : ' (the default; type your own limit above)'}.
        </p>
        {minIntensity !== null && (
          <p className="annotate-hint">
            Peaks below {minIntensity}% of the strongest are left out of the
            plot and of every match. Peaks you had picked that fall below it are
            unpicked.
            {hiddenChains > 0
              ? ` ${hiddenChains} saved chain${hiddenChains === 1 ? ' uses' : 's use'} such peaks and ${hiddenChains === 1 ? 'is' : 'are'} hidden until you lower the filter.`
              : ''}
          </p>
        )}

        {meta.data && (
          <AnnotateAlphabet
            classes={meta.data?.classes ?? []}
            classNames={classNames}
            standard={standard}
            include={include}
            exclude={exclude}
            custom={custom}
            customRecords={customRecords.data ?? []}
            tolerance={meta.data?.tolerance.rule}
            onClasses={handleClasses}
            onAll={handleAllModifications}
            onResidue={handleResidue}
            onAddCustom={handleAddCustom}
            onRemoveCustom={handleRemoveCustom}
            onReset={handleResetResidues}
          />
        )}

        {spectrum && peaks && (
          <>
            <section className="annotate-card annotate-sticky">
              <AnnotateSpectrum
                key={fileName + position}
                peaks={peaks}
                picks={ordered}
                anchor={anchor}
                precursor={precursorIndex}
                neighbours={plotNeighbours}
                steps={shownSteps}
                links={shownLinks}
                saved={saved}
                highlight={highlight}
                svgRef={svgRef}
                onTogglePeak={handleToggle}
                onAddPeaks={handleAddPeaks}
                onSaveChain={ordered.length >= 2 ? handleSaveChain : null}
                gapMass={gapMass}
                onRemoveSaved={handleDeleteChain}
              />
              <div className="annotate-selection">
                {ordered.length === 0 && (
                  <span className="annotate-inline-hint">
                    Click a peak to select it, click again to remove it, drag
                    across the plot to zoom, drag with the right button to pick
                    every peak whose top is inside the box, or drag along an
                    axis (or scroll on it) to zoom just that axis, and
                    double-click it to zoom back out. Or press Tab to reach the
                    plot, then use the arrow keys and Enter.
                  </span>
                )}
                {ordered.map((i) => (
                  <Tag key={i} closable onClose={() => handleToggle(i)}>
                    {i === precursorIndex ? 'Precursor ' : ''}
                    {formatMz(peaks[i][0])}
                  </Tag>
                ))}
                {precursorIndex >= 0 && !picks.includes(precursorIndex) && (
                  <Button
                    size="small"
                    onClick={() => handleToggle(precursorIndex)}
                  >
                    Select precursor
                  </Button>
                )}
                {ordered.length > 0 && (
                  <>
                    <Button
                      size="small"
                      title="Ctrl+Z"
                      onClick={() =>
                        setPicks((current) => current.slice(0, -1))
                      }
                    >
                      Remove last peak
                    </Button>
                    <Button size="small" onClick={() => setPicks([])}>
                      Clear selection
                    </Button>
                  </>
                )}
                {neighbours.loading && (
                  <span className="annotate-inline-hint">
                    Finding peaks one residue away…
                  </span>
                )}
                <span className="annotate-export">
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={exportSvg}
                  >
                    Figure (SVG)
                  </Button>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={exportCsv}
                  >
                    Numbers (CSV)
                  </Button>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={exportJson}
                  >
                    Full record (JSON)
                  </Button>
                </span>
              </div>
            </section>

            <div className="annotate-columns">
              <div className="annotate-results">
                {saved.length > 0 && (
                  <SavedPanel
                    chains={saved}
                    peaks={peaks}
                    onLoad={handleLoadChain}
                    onDelete={handleDeleteChain}
                    gapMass={gapMass}
                  />
                )}
                {anchor === null && (
                  <section className="annotate-card">
                    <h3>Start by clicking a peak</h3>
                    <p className="annotate-hint">
                      Peaks one residue away are then marked on the plot and
                      listed here with their errors.
                    </p>
                  </section>
                )}
                {anchor !== null && anchor !== precursorIndex && (
                  <NeighbourPanel
                    peaks={peaks}
                    anchor={anchor}
                    remote={neighbours}
                    picks={picks}
                    widen={widen}
                    onTogglePeak={handleToggle}
                  />
                )}
                {precursorPicked && (
                  <PrecursorPanel
                    peaks={peaks}
                    remote={toPrecursor}
                    picks={picks}
                    widen={widen}
                    onTogglePeak={handleToggle}
                  />
                )}
                {fragments.length === 2 && (
                  <PairPanel
                    peaks={peaks}
                    pair={[fragments[0], fragments[1]]}
                    gap={steps}
                    chains={chains}
                    widen={widen}
                    onHover={setHighlight}
                    onUse={handleUseChain}
                  />
                )}
                {fragments.length >= 3 && (
                  <StepsPanel peaks={peaks} remote={steps} />
                )}
                <AnnotateSimilar
                  peaks={measured}
                  example={example}
                  remote={similar}
                />
                {example !== null && spectrum.known && (
                  <AnnotateKnown
                    known={spectrum.known}
                    collisionEnergy={spectrum.collision_energy}
                    seenLabels={seenLabels}
                    saved={saved}
                    comparisons={comparisons}
                  />
                )}
              </div>
            </div>
          </>
        )}
        <section className="annotate-card annotate-howto" id="annotate-howto">
          <h3>How to use</h3>
          <ol>
            <li>
              Load a spectrum: drop an mgf file, paste a peak list, or choose an
              example from RiPPository.
            </li>
            <li>
              Under Residues, above the plot, tick RiPP classes or kinds of
              modification to add their residues, switch single residues on or
              off, or add your own. You can do this before loading a spectrum.
            </li>
            <li>
              Click a peak to pick it, or press Tab to reach the plot and use
              the arrow keys and Enter. Orange marks show peaks one residue
              away, and the table below the plot lists them with their errors.
            </li>
            <li>
              Pick more peaks. Each gap between your picks is labelled with the
              residues that fit it, or &ldquo;no single residue&rdquo; (tick
              Show their mass, under Gaps with no residue, to see its mass
              instead). The dashed purple line is the precursor, which you can
              pick too. Ctrl+Z removes the last peak you picked. To pick many at
              once, drag a box with the right mouse button: it picks the peaks
              whose tops are inside it, so both the m/z range and the height
              count.
            </li>
            <li>
              Press Save chain, next to Reset zoom above the plot, to keep a set
              of picks. Saved chains are drawn on the plot in their own colour,
              and can be loaded, or removed with the × beside them or the Remove
              button in their list.
            </li>
            <li>
              At the top you can set the error limit, in mDa or in ppm of the
              heavier peak&apos;s m/z: no residue with a larger error is marked.
              You can also hide weak peaks with the intensity filter.
            </li>
            <li>
              Download the figure (SVG), the numbers (CSV) or everything (JSON)
              with the buttons under the plot.
            </li>
          </ol>
          <p className="annotate-hint">
            A residue that fits a gap is a mass match, not proof. Check it
            against the rest of the spectrum. Drag along an axis to zoom it
            (right or up zooms in), or scroll on it, and double-click the axis
            to zoom back out.
          </p>
        </section>
        <AnnotateFeedback example={example} />
      </div>
    </ErrorUnitContext.Provider>
  );
}

export default AnnotateView;

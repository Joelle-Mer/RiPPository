import axios, { AxiosError } from 'axios';
import {
  ConnectResult,
  CustomEntry,
  CustomRecord,
  ExampleRecord,
  GapResult,
  KnownComparison,
  KnownStructure,
  Meta,
  Neighbour,
  PeakLink,
  PrecursorGaps,
  Query,
  SavedChain,
  SelectionStep,
  SpectrumRecord,
} from './annotateTypes';
import { chainPath } from './annotateFormat';

function annotateClient(baseUrl: string) {
  const root = baseUrl + '/annotate-api';
  const post = async <T>(path: string, body: unknown, signal?: AbortSignal) =>
    (await axios.post<T>(root + path, body, { signal })).data;

  return {
    meta: async (signal?: AbortSignal) =>
      (await axios.get<Meta>(root + '/meta', { signal })).data,
    alphabet: async (signal?: AbortSignal) =>
      (await axios.get<Record<string, number>>(root + '/alphabet', { signal }))
        .data,
    upload: async (file: File) => {
      const { data } = await axios.post<{ spectra: SpectrumRecord[] }>(
        root + '/spectra',
        file,
        { headers: { 'Content-Type': 'application/octet-stream' } },
      );
      return data.spectra;
    },
    peakList: async (
      text: string,
      precursor_mz: number | null,
      charge: number,
    ) => {
      const { data } = await axios.post<{ spectra: SpectrumRecord[] }>(
        root + '/peak-list',
        { text, precursor_mz, charge },
      );
      return data.spectra;
    },
    examples: async (signal?: AbortSignal) =>
      (await axios.get<ExampleRecord[]>(root + '/examples', { signal })).data,
    loadExample: async (accession: string) => {
      const { data } = await axios.post<{ spectra: SpectrumRecord[] }>(
        root + '/examples/' + encodeURIComponent(accession),
      );
      return data.spectra;
    },
    customResidues: (
      custom: CustomEntry[],
      class_name: string | string[],
      include: string[],
      signal?: AbortSignal,
    ) =>
      post<CustomRecord[]>(
        '/custom-residues',
        { custom, class_name, include },
        signal,
      ),
    neighbours: async (q: Query, i: number, signal?: AbortSignal) =>
      (
        await post<{ neighbours: Neighbour[] }>(
          '/neighbours',
          { ...q, i },
          signal,
        )
      ).neighbours,
    connect: (q: Query, i: number, j: number, signal?: AbortSignal) =>
      post<ConnectResult>('/connect', { ...q, i, j }, signal),
    precursorGaps: (
      q: Query,
      precursor_index: number,
      precursor_mz: number,
      precursor_charge: number,
      signal?: AbortSignal,
    ) =>
      post<PrecursorGaps>(
        '/precursor-gaps',
        { ...q, precursor_index, precursor_mz, precursor_charge },
        signal,
      ),
    compareKnown: (
      chain: SavedChain,
      known: KnownStructure,
      q: Query,
      signal?: AbortSignal,
    ) =>
      post<KnownComparison>(
        '/compare-known',
        {
          steps: chainPath(
            chain.marks.filter((mark) => mark.candidates.length > 0),
          ).map((mark) => ({
            label: mark.candidates[0].label,
            mass: mark.candidates[0].mass,
          })),
          known,
          class_name: q.class_name,
          include: q.include,
          exclude: q.exclude,
          custom: q.custom,
          tolerance: chain.tolerance ?? null,
        },
        signal,
      ),
    links: (q: Query, picks: number[], signal?: AbortSignal) =>
      post<PeakLink[]>('/links', { ...q, picks }, signal),
    steps: async (q: Query, picks: number[], signal?: AbortSignal) => {
      const pairs = picks.slice(1).map((to, n) => [picks[n], to]);
      const results = await Promise.all(
        pairs.map(([i, j]) => post<GapResult>('/gap', { ...q, i, j }, signal)),
      );
      return results.map(
        (result, n): SelectionStep => ({
          from: pairs[n][0],
          to: pairs[n][1],
          result,
        }),
      );
    },
  };
}

function messageOf(err: unknown): string {
  const response = (err as AxiosError<{ detail?: unknown }>).response;
  if (!response) {
    return 'The annotator service did not respond. Check that it is running.';
  }
  const detail = response.data?.detail;
  return typeof detail === 'string'
    ? detail
    : `The annotator service refused this request (${response.status}).`;
}

export { annotateClient, messageOf };

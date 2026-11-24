export type PeakPair = [number, number];

export interface KnownStructure {
  smiles: string;
  inchikey: string | null;
  formula: string | null;
  class: string | null;
  topology: string | null;
  n_units: number | null;
  neutral_mass: number | null;
  residues: string[] | null;
  unit_labels?: string[];
  units_are_residues: boolean | null;
}

export interface SpectrumRecord {
  index: number;
  name: string;
  precursor: number | null;
  charge_hint: string | null;
  collision_energy: string | null;
  n_peaks: number;
  peaks: PeakPair[];
  known: KnownStructure | null;
  precursor_source?: {
    derived: {
      precursor_type: string;
      formula_check: { error_mda?: number; verdict: string } | null;
    } | null;
    problem: string | null;
  };
}

export interface Candidate {
  label: string;
  mass: number;
  error_mda: number;
  error_ppm?: number;
  // two residues across a missing fragment, listed after every single residue
  double?: boolean;
  parts?: { label: string; mass: number }[];
}

export interface GapResult {
  gap: number;
  tol: number;
  charge: number;
  candidates: Candidate[];
  class: string;
  alphabet_size: number;
}

export interface Neighbour {
  peak: number;
  mz: number;
  intensity: number;
  gap: number;
  direction: 'up' | 'down';
  candidates: Candidate[];
}

export interface ChainPath {
  steps: number;
  jumps?: number;
  labels: string[];
  nodes: number[];
  intensity: number;
  gaps: { gap: number; candidates: Candidate[] }[];
}

export interface ConnectResult {
  n_paths: number;
  paths: ChainPath[];
}

export interface ModificationResidue {
  modification: string;
  label: string;
  mass: number;
  on_by_default: boolean;
  observed: boolean;
  applies_to: string | null;
}

export interface Modification {
  name: string;
  delta: number;
  residues: ModificationResidue[];
  n_on_by_default: number;
  note: string;
}

export interface ResidueClass {
  name: string;
  label: string;
  // a RiPP family, or a kind of chemistry for someone who cannot name the family
  kind?: 'class' | 'group';
  alphabet_size: number;
  modifications: Modification[];
}

export interface ExampleRecord {
  accession: string;
  title: string;
}

export interface Meta {
  classes: ResidueClass[];
  tolerance: {
    default: Tolerance;
    defaults: Record<'mDa' | 'ppm', number>;
    rule: string;
  };
  max_peaks: number;
  max_upload_bytes: number;
}

export interface CustomEntry {
  name: string;
  delta?: number;
  applies_to?: string[] | 'any';
  mass?: number;
}

export interface CustomRecord {
  label: string;
  mass: number;
  kind: 'modification' | 'residue';
  delta: number | null;
  applies_to: string | null;
  parent: string | null;
}

export interface Query {
  peaks: PeakPair[];
  // one class or kind of modification, or several at once
  class_name: string | string[];
  charge: number;
  include: string[];
  exclude: string[];
  custom: CustomEntry[];
  tolerance?: Tolerance;
  // also read a gap as two residues where the fragment between them is missing
  doubles?: boolean;
}

// the largest error a shown match may have, in mDa or in ppm of the heavier peak's m/z
export interface Tolerance {
  unit: 'mDa' | 'ppm';
  value: number;
}

export interface PeakLink {
  from: number;
  to: number;
  gap: number;
  candidates: Candidate[];
  toPrecursor?: boolean;
}

export interface PrecursorReading {
  hypothesis: string;
  offset: number;
  why: string;
  distance: number;
  candidates: Candidate[];
}

export interface PrecursorMatch {
  peak: number;
  hypotheses: PrecursorReading[];
}

export interface PrecursorGaps {
  precursor: {
    precursor_mz: number;
    charge: number;
    neutral: number;
    mh1: number;
  };
  matches: PrecursorMatch[];
}

export interface StepMatch {
  kind: 'unit' | 'inside' | 'no match';
  label: string | null;
  mass: number;
  unit_label?: string;
  lost_on_fusion?: string | null;
  remainder?: number;
  error_mda?: number;
}

export interface KnownComparison {
  n_steps: number;
  steps: StepMatch[];
  units_are_residues: boolean | null;
  contiguous_run: boolean | null;
}

// a sequence the user expects, against the spectrum
// a stretch of the molecule (any length), or the whole molecule, linear or cyclic
export type Topology = 'stretch' | 'linear' | 'cyclic';

export interface FragmentFit {
  ion: string;
  positions: number[];
  labels: string[];
  mz: number;
  error_mda: number;
  error_ppm: number;
}

export interface SequenceFragment {
  peak: number;
  mz: number;
  intensity: number;
  fits: FragmentFit[];
}

export interface SequenceStep {
  from: number;
  to: number;
  kind: 'one' | 'two' | 'pre';
  offset: number;
  positions: number[];
  candidate: Candidate;
}

export interface SequenceRun {
  residues: number;
  jumps: number;
  direction: 'forward' | 'backward';
  nodes: number[];
  steps: SequenceStep[];
  positions: number[];
  labels: string[];
  to_precursor: boolean;
  intensity: number;
  fragment_nodes: number[];
}

export interface OrderControl {
  n_orders: number;
  as_high: number;
  higher: number;
  fraction: number | null;
  median: number | null;
  max: number | null;
  yours: number;
  better: { order: string[]; score: number }[];
}

export interface ExpectedResult {
  sequence: { label: string; mass: number }[];
  topology: Topology;
  n_residues: number;
  residue_sum: number;
  // null for a stretch, whose ends are unknown
  neutral_mass: number | null;
  charge: number;
  limit: string;
  longest: number;
  // places where the steps spell every residue in order
  n_full: number;
  n_runs: number;
  runs: SequenceRun[];
  bonds_covered: [number, number][];
  n_bonds: number;
  n_fragment_masses: number;
  fragments_seen: number;
  fragments: SequenceFragment[];
  // fragments are tested only for a whole molecule
  control: { fragments: OrderControl | null; runs: OrderControl };
  // for a stretch: the precursor's neutral mass less the stretch's residues
  rest_of_molecule: number | null;
  precursor: {
    measured_neutral: number;
    error_mda: number;
    error_ppm: number;
    within: boolean;
    hint: string | null;
    in_runs: boolean;
  } | null;
}

export interface SavedChain {
  id: number;
  // shown beside the chain on the plot instead of its number (S1, S2… for a sequence search)
  name?: string;
  color: string;
  charge: number;
  tolerance?: Tolerance;
  doubles?: boolean;
  picks: number[];
  marks: PeakLink[];
}

export interface SelectionStep {
  from: number;
  to: number;
  result: GapResult;
}

export interface SimilarPair {
  query_index: number;
  ref_index: number;
  shifted: boolean;
}

export interface SimilarRecord {
  accession: string;
  name: string;
  ref_precursor: number | null;
  ref_peaks: PeakPair[];
  score: number;
  n_matched: number;
  n_matched_shifted: number;
  n_query_peaks: number;
  precursor_shift: number | null;
  tolerance: number;
  matched_pairs: SimilarPair[];
}

// the site's own spectral search, best first; a rank among the records, never an identity
export interface SimilarResult {
  results: SimilarRecord[];
  n_scored: number;
  method: 'modified cosine' | 'cosine';
}

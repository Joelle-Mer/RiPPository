import Link from './Link';

export default interface Species {
  name: string;
  strain?: string;
  lineage: string[];
  link: Link[];
  sample: string[];
}

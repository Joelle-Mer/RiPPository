// Records were named RIPPOS-LU-0001 until 2026-11-19 and RIPPOS-0001 since; an old name, from a
// link or typed in, leads to the same record under its current name. Anything else is left as it is.
export default function currentAccession(accession: string): string;
export default function currentAccession(accession: string | null): string | null;
export default function currentAccession(accession: string | null): string | null {
  if (accession === null) return null;
  const m = /^\s*RIPPOS-LU-(\d{4,6})\s*$/i.exec(accession);
  return m ? `RIPPOS-${m[1]}` : accession;
}

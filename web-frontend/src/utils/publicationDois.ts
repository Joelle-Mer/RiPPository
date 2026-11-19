import SubTag from '../types/record/SubTag';

const DOI = /^10\.\d{4,9}\/\S+$/;

// The articles a record cites, each once, in the order it lists them: the PUBLICATION field, and the
// "Publication DOI: 10.xxxx/..." comments the Submit page writes (where RiPPository records keep them).
export default function publicationDois(
  publication: string | undefined,
  comments: SubTag[] | undefined,
): string[] {
  const found = (publication ?? '').split(/[,;\s]+/).map((d) => d.replace(/^doi:\s*/i, ''));
  for (const c of comments ?? []) {
    const text = [c.subtag, c.value].filter(Boolean).join(' ').trim();
    const m = /^Publication\s+DOI:?\s*(\S+)$/i.exec(text);
    if (m) found.push(m[1]);
  }
  const seen = new Set<string>();
  return found
    .map((d) => d.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''))
    .filter((d) => DOI.test(d) && !seen.has(d.toLowerCase()) && seen.add(d.toLowerCase()));
}

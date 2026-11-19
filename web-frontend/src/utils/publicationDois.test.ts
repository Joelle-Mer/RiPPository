import { describe, expect, it } from 'vitest';
import publicationDois from './publicationDois';

describe('the articles a record cites', () => {
  // RIPPOS-0010 as the live API returns it: no PUBLICATION, three DOI comments among others
  const comments = [
    { value: 'Publication DOI: 10.1002/anie.202425134' },
    { value: 'Publication DOI: 10.1038/s41429-026-00966-4' },
    { value: 'Publication DOI: 10.1021/acs.jnatprod.2c00065' },
    { subtag: 'PRECURSOR_SEQ', value: 'SKKSKPGDGIRGKGVRG' },
    { subtag: 'MiBIG', value: 'BGC0002150' },
    { subtag: 'PDB', value: 'ID: 7ZWJ' },
  ] as { subtag: string; value: string }[];

  it('are read from the Publication DOI comments, in their order', () => {
    expect(publicationDois(undefined, comments)).toEqual([
      '10.1002/anie.202425134', '10.1038/s41429-026-00966-4', '10.1021/acs.jnatprod.2c00065',
    ]);
  });

  it('were missed when only the PUBLICATION field was read (the control)', () => {
    // the page's earlier rule, which showed no article for any RiPPository record
    const earlier = (publication?: string) =>
      publication ? publication.split(/[,;]+/).map((d) => d.trim()).filter(Boolean) : [];
    expect(earlier(undefined)).toEqual([]);
    expect(publicationDois(undefined, comments)).toHaveLength(3);
  });

  it('include the PUBLICATION field first, each article once, and nothing that is not a DOI', () => {
    expect(
      publicationDois('10.1021/np800118g; https://doi.org/10.1002/ANIE.202425134', [
        ...comments.slice(0, 1),
        { subtag: 'Publication', value: 'DOI: 10.1021/np800118g' },
        { subtag: '', value: 'Publication DOI: not-a-doi' },
        { subtag: '', value: 'Some other note about 10.1000/xyz' },
      ]),
    ).toEqual(['10.1021/np800118g', '10.1002/ANIE.202425134']);
  });
});

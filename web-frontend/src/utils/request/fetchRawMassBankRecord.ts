import axios from 'axios';

async function fetchRawRecord(
  exportServiceUrl: string,
  accession: string,
) {
  const resp = await axios.get(
    exportServiceUrl + '/rawtext/' + accession,

    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/plain',
      },
    },
  );
  if (resp.status === 200) {
    return await resp.data;
  }

  return null;
}

export default fetchRawRecord;

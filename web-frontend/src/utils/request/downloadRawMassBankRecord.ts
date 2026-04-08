import FileSaver from 'file-saver';
import fetchRawRecord from './fetchRawMassBankRecord';
const { saveAs } = FileSaver;

async function downloadRawRecord(
  exportServiceUrl: string,
  accession: string,
) {
  const data = await fetchRawRecord(exportServiceUrl, accession);
  if (data !== null) {
    const filename = accession + '.txt';
    const blob = new Blob([data], {
      type: 'text/plain',
    });
    saveAs(blob, filename);
  } else {
    console.error(
      'Could not fetch raw record for accession ' + accession,
    );
  }
}

export default downloadRawRecord;

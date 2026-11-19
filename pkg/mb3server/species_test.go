package mb3server

import (
	"os"
	"strings"
	"testing"

	"github.com/Joelle-Mer/RiPPository/pkg/database"
	"github.com/Joelle-Mer/RiPPository/pkg/massbank"
)

// A database holding one record, answering the two calls GetRecord makes: the record rebuilt from
// its tables, which has no SP$ lines because the schema has no tables for them, and the full record
// stored as text at load time. Every other call would panic, which no test here makes.
type oneRecordDB struct {
	database.MB3Database
	fromTables *massbank.MassBank2
	storedText string
}

func (d oneRecordDB) Ping() error { return nil }
func (d oneRecordDB) GetRecord(*string) (*massbank.MassBank2, error) {
	return d.fromTables, nil
}
func (d oneRecordDB) GetRecords(*[]string) (*[]string, error) {
	if d.storedText == "" {
		return &[]string{}, nil
	}
	return &[]string{d.storedText}, nil
}

const record = `ACCESSION: RIPPOS-9999
RECORD_TITLE: Testamide A; LC-ESI-QFT; MS2
DATE: 2026.11.18
AUTHORS: ORCID:0000-0002-7894-3039
LICENSE: CC BY-SA
CH$NAME: Testamide A
CH$COMPOUND_CLASS: Natural Product; RiPP; Lasso peptide
CH$FORMULA: C2H5NO
CH$EXACT_MASS: 59.0371
CH$SMILES: CC(N)=O
CH$IUPAC: N/A
SP$SCIENTIFIC_NAME: Streptomyces triculaminicus
SP$LINEAGE: strain: JCM 4242
SP$SAMPLE: Production: Heterologous expression
SP$SAMPLE: Expression host: Streptomyces coelicolor M1146
AC$INSTRUMENT: Thermo Orbitrap Exploris 120
AC$INSTRUMENT_TYPE: LC-ESI-QFT
AC$MASS_SPECTROMETRY: MS_TYPE MS2
AC$MASS_SPECTROMETRY: ION_MODE POSITIVE
PK$SPLASH: splash10-x
PK$NUM_PEAK: 1
PK$PEAK: m/z int. rel.int.
  60.0444 999.0000 999
//
`

func parsed(t *testing.T) *massbank.MassBank2 {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "*.txt")
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString(record)
	f.Seek(0, 0)
	mb, err := massbank.ScanMbFile(f, f.Name())
	f.Close()
	if err != nil {
		t.Fatal(err)
	}
	return mb
}

func TestGetRecordCarriesSpecies(t *testing.T) {
	full := parsed(t)
	mb3, err := ConvertMb2RecordToMb3Record(full)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := ConvertMb3RecordToJsonString(mb3)
	if err != nil {
		t.Fatal(err)
	}
	// what the tables give back: everything but the SP$ lines
	tables := parsed(t)
	tables.Species = massbank.SpeciesProperties{}

	saved := db
	defer func() { db = saved }()

	// the control: without the stored text the species stay empty, as the record page showed them
	db = oneRecordDB{fromTables: tables}
	got, err := GetRecord("RIPPOS-9999")
	if err != nil {
		t.Fatal(err)
	}
	if got.Species.Name != "" || len(got.Species.Sample) != 0 {
		t.Fatalf("expected no species without the stored record, got %+v", got.Species)
	}

	db = oneRecordDB{fromTables: tables, storedText: stored}
	got, err = GetRecord("RIPPOS-9999")
	if err != nil {
		t.Fatal(err)
	}
	if got.Species.Name != "Streptomyces triculaminicus" {
		t.Errorf("name: %q", got.Species.Name)
	}
	if strings.Join(got.Species.Lineage, "|") != "strain: JCM 4242" {
		t.Errorf("lineage: %v", got.Species.Lineage)
	}
	want := "Production: Heterologous expression|Expression host: Streptomyces coelicolor M1146"
	if strings.Join(got.Species.Sample, "|") != want {
		t.Errorf("sample: %v", got.Species.Sample)
	}
	if got.Acquisition.Instrument != "Thermo Orbitrap Exploris 120" {
		t.Errorf("the rest of the record changed: instrument %q", got.Acquisition.Instrument)
	}
}

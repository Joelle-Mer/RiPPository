package massbank

import (
	"strings"
	"testing"
)

const header = "LICENSE: CC BY-SA\nCH$NAME: Testamide\n"

func contributorFrom(t *testing.T, accession, authors string) string {
	t.Helper()
	text := "ACCESSION: " + accession + "\n" + "AUTHORS: " + authors + "\n" + header
	mb, err := ScanMbFile(strings.NewReader(text), "test.txt")
	if err != nil {
		t.Fatal(err)
	}
	if mb.Contributor == nil {
		t.Fatal("no contributor")
	}
	return *mb.Contributor
}

func TestContributor(t *testing.T) {
	cases := []struct{ accession, authors, want string }{
		// MassBank's own form keeps naming the contributor by the accession's middle part
		{"MSBNK-IPB_Halle-PB001341", "Someone (ORCID:0000-0000-0000-0000)", "IPB_Halle"},
		{"RIPPOS-LU-0001", "Joëlle Mérgola-Greef (ORCID:0000-0002-7894-3039)", "LU"},
		// a RiPPository accession has no middle part: the first author, without the ORCID
		{"RIPPOS-0010", "Aske Merrild (ORCID:0009-0005-0360-6176)", "Aske Merrild"},
		{"RIPPOS-0001", "Joëlle Mérgola-Greef (ORCID:0000-0002-7894-3039), Second Author", "Joëlle Mérgola-Greef"},
		{"RIPPOS-0002", "Plain Name", "Plain Name"},
	}
	for _, c := range cases {
		if got := contributorFrom(t, c.accession, c.authors); got != c.want {
			t.Errorf("%s by %q: contributor %q, want %q", c.accession, c.authors, got, c.want)
		}
	}
}

// the control: the old rule, the accession's second part, gives each RIPPOS-0001 style record a
// contributor of its own number, which is what this change avoids
func TestOldRuleWouldUseTheNumber(t *testing.T) {
	if old := strings.Split("RIPPOS-0010", "-")[1]; old != "0010" {
		t.Fatalf("old rule gave %q", old)
	}
	if got := contributorOf("RIPPOS-0010", nil); got == "0010" {
		t.Fatalf("contributor is the record number")
	}
}

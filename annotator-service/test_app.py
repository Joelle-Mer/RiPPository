"""pytest test_app.py; tests that need a real mgf use ANNOTATOR_TEST_MGF, and skip without it"""
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as service  # noqa: E402

client = TestClient(service.app)
# a real mgf to read, if one is given; the tests that need it skip without it
MGF = Path(os.environ.get("ANNOTATOR_TEST_MGF", "no-test-mgf-given"))

# 200 + Gly + Ala + Pro, using the residue table's own masses, plus one unrelated peak
_a = service.core.alphabet_for("standard")
_mz = [200.0, 200.0 + _a["Gly"], 200.0 + _a["Gly"] + _a["Ala"],
       200.0 + _a["Gly"] + _a["Ala"] + _a["Pro"], 999.5]
PEAKS = [[m, 10.0] for m in _mz]


def test_meta_comes_from_the_tables():
    m = client.get("/meta").json()
    assert m["tolerance"] == service.core.TOLERANCE
    assert "standard" in [c["name"] for c in m["classes"]]


def test_gap_matches_the_core_either_way_round():
    expect = service.core.gap(PEAKS, 0, 1, "standard")
    assert client.post("/gap", json={"peaks": PEAKS, "i": 0, "j": 1}).json() == expect
    back = client.post("/gap", json={"peaks": PEAKS, "i": 1, "j": 0}).json()
    assert back["candidates"][0]["label"] == "Gly"


def test_empty_gap_is_a_result_not_an_error():
    r = client.post("/gap", json={"peaks": PEAKS, "i": 0, "j": 4})
    assert r.status_code == 200 and r.json()["candidates"] == []


def test_connect_keeps_the_rival_reads():
    # Gly + Ala has the mass of Gln, so the same two endpoints have two honest answers
    r = client.post("/connect", json={"peaks": PEAKS, "i": 0, "j": 3}).json()
    assert [p["labels"] for p in r["paths"]] == [["Gln", "Pro"], ["Gly", "Ala", "Pro"]]


def test_neighbours_agree_with_gap_and_see_both_directions():
    n = client.post("/neighbours", json={"peaks": PEAKS, "i": 1}).json()["neighbours"]
    assert {x["peak"] for x in n} == {0, 2}
    assert {x["candidates"][0]["label"] for x in n} == {"Gly", "Ala"}
    errors = [abs(x["candidates"][0]["error_mda"]) for x in n]
    assert errors == sorted(errors)


def test_excluding_a_residue_removes_it():
    n = client.post("/neighbours", json={"peaks": PEAKS, "i": 1, "exclude": ["Gly"]}).json()
    assert {x["peak"] for x in n["neighbours"]} == {2}


def test_excluding_every_residue_is_explained():
    every = list(service.core.alphabet_for("standard"))
    r = client.post("/connect", json={"peaks": PEAKS, "i": 0, "j": 3, "exclude": every})
    assert r.status_code == 422 and "fewer than two" in r.json()["detail"]


def test_a_modification_can_be_switched_on_within_its_class():
    off = {"peaks": PEAKS, "i": 0, "j": 1, "class_name": "cyanobactin"}
    on = client.post("/gap", json={**off, "include": ["Ser[phospho]"]}).json()
    assert on["alphabet_size"] == client.post("/gap", json=off).json()["alphabet_size"] + 1
    refused = client.post("/gap", json={"peaks": PEAKS, "i": 0, "j": 1,
                                        "include": ["Ser[phospho]"]})
    assert refused.status_code == 422


def test_a_custom_residue_is_found_by_every_call():
    mod = {"name": "ac", "delta": 42.01057, "applies_to": ["Gly"]}
    mz = 200.0 + service.core.custom_residues([mod])[0]["mass"]
    peaks = [[200.0, 10.0], [mz, 10.0]]
    found = client.post("/gap", json={"peaks": peaks, "i": 0, "j": 1, "custom": [mod]}).json()
    assert [c["label"] for c in found["candidates"]] == ["Gly[ac]"]
    near = client.post("/neighbours", json={"peaks": peaks, "i": 0, "custom": [mod]}).json()
    assert near["neighbours"][0]["peak"] == 1
    off = client.post("/gap", json={"peaks": peaks, "i": 0, "j": 1, "custom": [mod],
                                    "exclude": ["Gly[ac]"]}).json()
    assert off["candidates"] == []


def test_a_free_standing_residue_is_marked_as_asserted():
    r = client.post("/custom-residues", json={"custom": [{"name": "u", "mass": 212.0954}]}).json()
    assert r[0]["kind"] == "residue" and r[0]["parent"] is None


@pytest.mark.parametrize("bad", [{"name": "x", "mass": 10}, {"name": "Gly", "mass": 99},
                                 {"name": "a[b", "mass": 99},
                                 {"name": "x", "delta": 1, "applies_to": ["Xyz"]},
                                 {"name": "x", "delta": 1, "mass": 99}])
def test_a_bad_custom_entry_is_refused_with_a_reason(bad):
    r = client.post("/custom-residues", json={"custom": [bad]})
    assert r.status_code == 422 and r.json()["detail"]


def test_links_keep_every_matching_pair_not_only_neighbours():
    # 0 to 2 is Gln: it must survive picking peak 1 between them
    both = client.post("/links", json={"peaks": PEAKS, "picks": [0, 2]}).json()
    assert [(x["from"], x["to"]) for x in both] == [(0, 2)]
    three = client.post("/links", json={"peaks": PEAKS, "picks": [0, 1, 2]}).json()
    assert {(x["from"], x["to"]) for x in three} == {(0, 1), (0, 2), (1, 2)}
    assert all(x["candidates"] for x in three)


def test_a_bad_tolerance_is_refused_with_a_reason():
    r = client.post("/gap", json={"peaks": PEAKS, "i": 0, "j": 1, "tolerance": {"ppm": 0}})
    assert r.status_code == 422 and "ppm" in r.json()["detail"]


RECORD = {"accession": "RIPPOS-LU-0006",
          "compound": {"names": ["Planosporicin"], "classes": ["Natural Product; RiPP; Lanthipeptide"],
                       "formula": "C2H6O", "smiles": "CCO", "mass": 46.04186},
          "mass_spectrometry": {"focused_ion": [{"subtag": "PRECURSOR_TYPE", "value": "[M+2H]2+"}]},
          "peak": {"peak": {"values": [{"mz": 200.5, "intensity": 7}, {"mz": 100.25, "intensity": 9}]}}}


def test_an_example_takes_the_same_path_as_an_upload(monkeypatch):
    monkeypatch.setattr(service, "from_rippository", lambda path: RECORD)
    found = client.post("/examples/RIPPOS-LU-0006").json()["spectra"]
    assert len(found) == 1
    assert found[0]["name"] == "Planosporicin" and found[0]["charge_hint"] == "2+"
    assert [p[0] for p in found[0]["peaks"]] == [100.25, 200.5]
    # the structure comes cut into residues from the data file, not from the record
    assert found[0]["known"] == service.core.known_structure("RIPPOS-LU-0006")
    expected = service.core.precursor_from_mass(46.04186, "[M+2H]2+", "C2H6O")
    assert found[0]["precursor"] == expected["precursor_mz"]
    assert found[0]["precursor_source"]["derived"]["formula_check"]["verdict"] == "monoisotopic"


def test_an_average_mass_is_refused_and_the_example_still_loads(monkeypatch):
    record = {**RECORD, "compound": {**RECORD["compound"], "mass": 46.069}}
    monkeypatch.setattr(service, "from_rippository", lambda path: record)
    found = client.post("/examples/RIPPOS-LU-0006").json()["spectra"]
    assert found[0]["precursor"] is None
    assert "average mass" in found[0]["precursor_source"]["problem"]


def test_the_example_list_comes_from_the_database(monkeypatch):
    def reply(path):
        return {"data": [{"accession": "A-1"}]} if "search" in path else {"title": "One; MS2"}
    monkeypatch.setattr(service, "from_rippository", reply)
    assert client.get("/examples").json() == [{"accession": "A-1", "title": "One; MS2"}]


@pytest.mark.parametrize("bad", ["a", "..%2F..%2Fetc", "RIPPOS 1", "x" * 60])
def test_only_an_accession_reaches_the_database(monkeypatch, bad):
    calls = []
    monkeypatch.setattr(service, "from_rippository", lambda path: calls.append(path) or RECORD)
    assert client.post("/examples/" + bad).status_code in (404, 422)
    assert calls == []


def test_an_unreachable_database_is_explained(monkeypatch):
    monkeypatch.setattr(service, "RIPPOSITORY_API", "http://127.0.0.1:9")
    r = client.post("/examples/RIPPOS-LU-0001")
    assert r.status_code == 502 and "could not be reached" in r.json()["detail"]


def test_precursor_distance_comes_as_named_readings():
    point = service.core.precursor_point(1000.0, 1)
    peaks = [[point["mh1"] - _a["Gly"], 10.0], [1000.0, 0.0]]
    r = client.post("/precursor-gaps", json={"peaks": peaks, "precursor_index": 1,
                                             "precursor_mz": 1000.0}).json()
    assert r["precursor"]["mh1"] == point["mh1"]
    match = r["matches"][0]
    assert match["peak"] == 0
    assert any(c["label"] == "Gly" for h in match["hypotheses"] for c in h["candidates"])


def test_a_doubly_charged_precursor_is_converted():
    point = service.core.precursor_point(500.0, 2)
    assert point["mh1"] > 900
    r = client.post("/precursor-gaps", json={"peaks": [[100.0, 1.0], [500.0, 0.0]],
                                             "precursor_index": 1, "precursor_mz": 500.0,
                                             "precursor_charge": 2}).json()
    assert r["precursor"]["charge"] == 2


@pytest.mark.parametrize("bad", [-1, 5, 500])
def test_indices_outside_the_spectrum_are_refused(bad):
    assert client.post("/gap", json={"peaks": PEAKS, "i": bad, "j": 0}).status_code == 422
    assert client.post("/links", json={"peaks": PEAKS, "picks": [0, bad]}).status_code == 422
    assert client.post("/neighbours", json={"peaks": PEAKS, "i": bad}).status_code == 422


def test_unknown_class_and_labels_are_refused_not_ignored():
    pair = {"peaks": PEAKS, "i": 0, "j": 1}
    assert client.post("/gap", json={**pair, "class_name": "nosuch"}).status_code == 422
    assert client.post("/gap", json={**pair, "include": ["pSer"]}).status_code == 422
    assert client.post("/gap", json={**pair, "exclude": ["Xyz"]}).status_code == 422


def test_reordered_peaks_are_refused():
    r = client.post("/gap", json={"peaks": PEAKS[::-1], "i": 0, "j": 1})
    assert r.status_code == 422


@pytest.mark.parametrize("charge", [0, 4, -1])
def test_charge_out_of_range_is_refused(charge):
    r = client.post("/gap", json={"peaks": PEAKS, "i": 0, "j": 1, "charge": charge})
    assert r.status_code == 422


def test_upload_reads_the_real_library_in_mz_order():
    if not MGF.exists():
        pytest.skip("set ANNOTATOR_TEST_MGF to a real mgf to run this test")
    found = client.post("/spectra", content=MGF.read_bytes()).json()["spectra"]
    assert len(found) == 120
    for s in found:
        mz = [p[0] for p in s["peaks"]]
        assert mz == sorted(mz)


def test_garbage_upload_is_an_empty_answer():
    r = client.post("/spectra", content=b"\x00\xff not an mgf\n")
    assert r.status_code == 200 and r.json()["spectra"] == []


def test_malformed_mgf_is_explained():
    body = b"BEGIN IONS\nPEPMASS=abc\n100 5\nEND IONS\n"
    r = client.post("/spectra", content=body)
    assert r.status_code == 422 and "could not read" in r.json()["detail"]


def test_oversized_upload_is_refused(monkeypatch):
    monkeypatch.setattr(service, "MAX_UPLOAD_BYTES", 10)
    assert client.post("/spectra", content=b"x" * 11).status_code == 413


def test_several_sets_at_once_take_the_union():
    sets = ["group_dehydration", "group_heterocycle"]
    dha = service.core.alphabet_for(sets)["Dha"]
    peaks = [[300.0, 10.0], [300.0 + dha, 10.0]]
    both = client.post("/gap", json={"peaks": peaks, "i": 0, "j": 1, "class_name": sets}).json()
    assert both == service.core.gap(peaks, 0, 1, sets)
    assert "Dha" in [c["label"] for c in both["candidates"]]
    # control: heterocycle alone has no Dha, so the union is what found it
    alone = client.post("/gap", json={"peaks": peaks, "i": 0, "j": 1,
                                      "class_name": ["group_heterocycle"]}).json()
    assert "Dha" not in [c["label"] for c in alone["candidates"]]


def test_too_many_sets_are_refused():
    names = [c["name"] for c in service.core.CLASSES if c["name"] != "standard"]
    res = client.post("/gap", json={"peaks": PEAKS, "i": 0, "j": 1, "class_name": names * 2})
    assert res.status_code == 422


def test_a_pasted_peak_list_reads_like_the_same_mgf():
    text = "# my peaks\n100.05 20\n\n157.0715\t100\n214.093, 35\n"
    pasted = client.post("/peak-list", json={"text": text, "precursor_mz": 500.2, "charge": 1}).json()
    mgf = (b"BEGIN IONS\nNAME=Pasted peak list\nPEPMASS=500.2\nCHARGE=1+\n"
           b"100.05 20\n157.0715 100\n214.093 35\nEND IONS\n")
    uploaded = client.post("/spectra", content=mgf).json()
    assert pasted == uploaded
    spectrum = pasted["spectra"][0]
    assert [p[0] for p in spectrum["peaks"]] == [100.05, 157.0715, 214.093]
    assert spectrum["precursor"] == 500.2


def test_a_pasted_peak_list_without_a_precursor_is_fine():
    spectrum = client.post("/peak-list", json={"text": "100 1\n200 2"}).json()["spectra"][0]
    assert spectrum["precursor"] is None and len(spectrum["peaks"]) == 2


def test_a_bad_line_is_named_not_skipped():
    res = client.post("/peak-list", json={"text": "100 1\nhello\n200 2"})
    assert res.status_code == 422 and "line 2" in res.json()["detail"]
    assert client.post("/peak-list", json={"text": "# nothing\n"}).status_code == 422


def test_tolerance_is_applied_inside_the_chain_search():
    # Ala 3 mDa out: inside the default window, outside a tight one, so that chain must go
    peaks = [[200.0, 10.0], [200.0 + _a["Gly"], 10.0],
             [200.0 + _a["Gly"] + _a["Ala"] + 0.003, 10.0]]
    loose = client.post("/connect", json={"peaks": peaks, "i": 0, "j": 2}).json()
    tight = client.post("/connect", json={"peaks": peaks, "i": 0, "j": 2,
                                          "tolerance": {"ppm": 1, "floor_mda": 0.5}}).json()
    assert ["Gly", "Ala"] in [p["labels"] for p in loose["paths"]]
    assert ["Gly", "Ala"] not in [p["labels"] for p in tight["paths"]]


def test_an_upload_carries_no_structure():
    body = b"BEGIN IONS\nNAME=x\nSMILES=CCO\nPEPMASS=500\n100 5\nEND IONS\n"
    spectrum = client.post("/spectra", content=body).json()["spectra"][0]
    assert spectrum["known"] is None


def test_a_step_inside_a_fused_unit_is_found_by_mass():
    # RIPPOS-LU-0001 starts with Leu/Ile-Thn, Leu/Ile and Cys fused with the loss of a water
    known = service.core.known_structure("RIPPOS-LU-0001")
    assert known["unit_labels"][0] == "Leu/Ile-Thn"
    steps = [{"label": "Cys", "mass": _a["Cys"]}, {"label": "Trp", "mass": _a["Trp"]}]
    r = client.post("/compare-known", json={"steps": steps, "known": known}).json()
    assert [s["kind"] for s in r["steps"]] == ["inside", "no match"]
    assert r["steps"][0]["unit_label"] == "Leu/Ile-Thn"


def test_a_record_without_a_structure_loads_without_one(monkeypatch):
    monkeypatch.setattr(service, "from_rippository", lambda path: {**RECORD, "accession": "NEW-1"})
    found = client.post("/examples/NEW-1").json()["spectra"]
    assert found[0]["known"] is None


def test_no_endpoint_left_over_from_the_removed_panels():
    for path in ("/read", "/spectrum-null", "/bridges", "/similar"):
        assert client.post(path, json={}).status_code == 404


def test_leu_is_called_leu_ile_everywhere():
    assert "Leu/Ile" in service.core.STANDARD and "Leu" not in service.core.STANDARD
    peaks = [[200.0, 10.0], [200.0 + _a["Leu/Ile"], 10.0]]
    r = client.post("/gap", json={"peaks": peaks, "i": 0, "j": 1}).json()
    assert [c["label"] for c in r["candidates"]] == ["Leu/Ile"]
    mod = {"name": "m", "delta": 14.01565, "applies_to": ["Leu/Ile"]}
    made = client.post("/custom-residues", json={"custom": [mod]}).json()
    assert made[0]["label"] == "Leu/Ile[m]"

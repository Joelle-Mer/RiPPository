"""pytest test_expected.py: a sequence the user expects, against a spectrum."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as service  # noqa: E402

core = service.core
client = TestClient(service.app)
_a = core.alphabet_for("standard")
P, H2O = core.PROTON, core.H2O
KNOWN = core._known_labels("standard", None, None, None)


def _seq(text):
    return [lab for lab, _m in core.parse_sequence(text, KNOWN)]


def _linear_spectrum(seq, noise=()):
    """b- and y-ions of a linear peptide, the precursor last, and any unrelated peaks."""
    m = [_a[x] for x in seq]
    n = len(m)
    ions = [sum(m[:k]) + P for k in range(1, n)] + [sum(m[k:]) + H2O + P for k in range(1, n)]
    pre = sum(m) + H2O + P
    peaks = sorted([[round(x, 5), 50.0] for x in ions + list(noise)] + [[round(pre, 5), 0.0]])
    return peaks, [round(pre, 5), 0.0], pre


def _cyclic_spectrum(seq, start=0, extra=()):
    """The b-ions of a ring opened before residue `start`, and the precursor."""
    m = [_a[x] for x in seq]
    n = len(m)
    ions = [sum(m[(start + k) % n] for k in range(L)) + P for L in range(1, n)]
    pre = sum(m) + P
    peaks = sorted([[round(x, 5), 50.0] for x in ions + list(extra)] + [[round(pre, 5), 0.0]])
    return peaks, pre


def _run(peaks, seq, topology, pre=None, **kw):
    idx = peaks.index([round(pre, 5), 0.0]) if pre is not None else None
    return core.expected_sequence(peaks, seq, topology, idx, round(pre, 5) if pre else None, **kw)


# --- reading what the user types ------------------------------------------------------------------

def test_one_letter_codes_and_names_read_the_same():
    assert _seq("GAVLF") == _seq("Gly Ala Val Leu Phe") == _seq("Gly-Ala-Val-Leu-Phe") \
        == ["Gly", "Ala", "Val", "Leu/Ile", "Phe"]


def test_leu_and_ile_are_one_residue():
    assert _seq("I L") == _seq("Ile Leu") == ["Leu/Ile", "Leu/Ile"]


def test_a_hyphenated_residue_name_stays_whole():
    assert "Ala-Thz" in KNOWN
    assert _seq("Ala-Thz Gly") == ["Ala-Thz", "Gly"]
    assert _seq("Gly-Ala-Thz-Pro") == ["Gly", "Ala-Thz", "Pro"]


def test_an_unknown_residue_is_named_in_the_refusal():
    with pytest.raises(core.AnnotateError, match="Xyz"):
        core.parse_sequence("Gly Xyz", KNOWN)
    with pytest.raises(core.AnnotateError, match="at least two"):
        core.parse_sequence("G", KNOWN)


def test_a_residue_of_your_own_can_be_used():
    custom = [{"name": "Hyp", "mass": 113.04768}]
    known = core._known_labels("standard", None, None, custom)
    assert core.parse_sequence("Gly Hyp", known)[1] == ("Hyp", 113.04768)


# --- modifications in the sequence ----------------------------------------------------------------

def test_a_named_modification_reads_on_a_name_or_a_letter():
    assert _seq("Gly Ser[phospho] Val") == _seq("GS[phospho]V") == _seq("Gly-Ser[phospho]-Val") \
        == ["Gly", "Ser[phospho]", "Val"]
    assert _seq("L[methyl] G") == ["Leu/Ile[methyl]", "Gly"]


def test_codes_and_names_run_together_in_one_word():
    assert _seq("GVPVal[methyl]") == ["Gly", "Val", "Pro", "Val[methyl]"]
    assert _seq("GVPVal") == _seq("GVPV") == ["Gly", "Val", "Pro", "Val"]
    assert _seq("GS[phospho]DhaP") == ["Gly", "Ser[phospho]", "Dha", "Pro"]
    assert _seq("GLeuP") == ["Gly", "Leu/Ile", "Pro"]
    # capitals stay one-letter codes inside a word
    assert _seq("GVAL") == ["Gly", "Val", "Ala", "Leu/Ile"]
    with pytest.raises(core.AnnotateError, match="could not read 'xl'"):
        core.parse_sequence("GVPxl", KNOWN)
    with pytest.raises(core.AnnotateError, match="not closed"):
        core.parse_sequence("GVS[phospho", KNOWN)


def test_a_mass_shift_adds_to_its_residue():
    seq = core.parse_sequence("G S[-18.0106] M[+15.9949]", KNOWN)
    assert [lab for lab, _m in seq] == ["Gly", "Ser[-18.0106]", "Met[+15.9949]"]
    assert seq[1][1] == pytest.approx(_a["Ser"] - 18.0106)
    assert seq[2][1] == pytest.approx(_a["Met"] + 15.9949)
    # a hyphen inside brackets is a minus sign, not a join
    assert _seq("Gly-Ser[-18.0106]-Val") == ["Gly", "Ser[-18.0106]", "Val"]


def test_an_unknown_modification_is_refused_with_what_exists():
    with pytest.raises(core.AnnotateError, match="on Ser: .*phospho"):
        core.parse_sequence("G Ser[sulfo]", KNOWN)
    with pytest.raises(core.AnnotateError, match="weigh"):
        core.parse_sequence("G G[-100]", KNOWN)


def test_a_modified_stretch_is_found_only_with_its_modification():
    """The control: the same stretch typed without the phosphate must not be spelled in full."""
    masses = [_a["Gly"], _a["Val"], KNOWN["Ser[phospho]"], _a["Pro"], _a["Val"], _a["Trp"]]
    peaks = [[round(sum(masses[:k]) + P, 5), 50.0] for k in range(1, len(masses) + 1)]
    named = core.expected_sequence(peaks, "VS[phospho]PV", "stretch")
    shifted = core.expected_sequence(peaks, "V S[+79.96633] P V", "stretch")
    plain = core.expected_sequence(peaks, "VSPV", "stretch")
    assert named["n_full"] >= 1 and shifted["n_full"] >= 1
    assert plain["n_full"] == 0


def test_the_picker_lists_modified_residues_with_their_mass():
    listed = {r["label"]: r["mass"] for r in client.get("/sequence-residues").json()}
    assert listed["Ser[phospho]"] == pytest.approx(KNOWN["Ser[phospho]"])
    assert "Dha" in listed and "Gly" not in listed


# --- fragments: what the order decides ------------------------------------------------------------

def test_every_b_and_y_ion_of_a_linear_peptide_is_found():
    seq = "GAVLFSE"
    peaks, _p, pre = _linear_spectrum(_seq(seq))
    r = _run(peaks, seq, "linear", pre)
    assert r["fragments_seen"] == r["n_fragment_masses"] == 12
    assert abs(r["precursor"]["error_mda"]) < 0.01 and r["precursor"]["within"]
    names = {f["ion"] for frag in r["fragments"] for f in frag["fits"]}
    assert {"b1", "b6", "y1", "y6"} <= names


def test_the_right_order_beats_its_reorderings_and_wrong_orders_do_not():
    # the control must be able to fail: the same spectrum, read as wrong orders, must not pass
    import random
    seq = "GAVLFSEW"
    order = _seq(seq)
    peaks, _p, pre = _linear_spectrum(order)
    right = _run(peaks, seq, "linear", pre)["control"]["fragments"]
    assert right["fraction"] == 0.0 and right["n_orders"] == 200 and right["better"] == []
    wrongs = core._distinct_orders(order, False, random.Random(3), 8)
    fractions = []
    for w in wrongs:
        c = _run(peaks, " ".join(w), "linear", pre)["control"]["fragments"]
        fractions.append(c["fraction"])
        assert c["yours"] < right["yours"]
        # some other order does better than a wrong one, and is shown
        assert c["better"] and all(b["score"] > c["yours"] for b in c["better"])
    assert sum(1 for f in fractions if f <= 0.05) <= 2
    assert sorted(fractions)[len(fractions) // 2] > 0.05


def test_a_linear_sequence_reversed_is_another_order():
    order = _seq("GAVLF")
    import random
    others = core._distinct_orders(order, False, random.Random(1), 500)
    assert order[::-1] in others


def test_a_wrong_ring_order_explains_fewer_fragments():
    seq = "GVPVWA"
    peaks, pre = _cyclic_spectrum(_seq(seq), start=2)
    right = _run(peaks, seq, "cyclic", pre)
    wrong = _run(peaks, "GVVPAW", "cyclic", pre)
    assert right["control"]["fragments"]["yours"] > wrong["control"]["fragments"]["yours"]
    # the ladder is n-1 steps: the smallest ion is not reached by a step
    assert right["longest"] == 5


def test_reorderings_never_include_the_sequence_read_another_way():
    order = _seq("GAVLF")
    import random
    others = core._distinct_orders(order, True, random.Random(1), 500)
    forms = set()
    for s in range(5):
        rot = tuple(order[s:] + order[:s])
        forms |= {rot, rot[::-1]}
    assert not any(tuple(o) in forms for o in others)
    # 5 different residues on a ring: 4!/2 = 12 rings, less the sequence itself
    assert len(others) == 11
    lin = core._distinct_orders(order, False, random.Random(1), 500)
    assert len(lin) == 120 - 1


def test_repeated_residues_do_not_blow_up_the_reorderings():
    order = _seq("GGGGGGGGGGGGA")
    import random
    assert core._distinct_orders(order, False, random.Random(1), 200) != []


# --- runs: the steps in order ---------------------------------------------------------------------

def test_a_ring_is_read_around_the_join():
    # opened before residue 3 (Val), the ladder steps Trp, Ala, Gly, Val and Pro to the precursor:
    # across the end of the sequence
    seq = "GVPVWA"
    peaks, pre = _cyclic_spectrum(_seq(seq), start=3)
    r = _run(peaks, seq, "cyclic", pre)
    top = r["runs"][0]
    assert top["residues"] == 5 and top["to_precursor"] and top["direction"] == "forward"
    assert top["labels"] == ["Trp", "Ala", "Gly", "Val", "Pro"]
    assert top["positions"] == [4, 5, 0, 1, 2]
    assert r["bonds_covered"] == [[0, 1], [1, 2], [4, 5], [5, 0]] and r["n_bonds"] == 6


def test_a_linear_sequence_is_not_read_around_the_join():
    seq = "GVPVWA"
    peaks, pre = _cyclic_spectrum(_seq(seq), start=3)
    pre_lin = None  # the ring's precursor does not fit a linear peptide; leave it out
    r = _run([p for p in peaks if p[1] > 0], seq, "linear", pre_lin)
    assert r["longest"] <= 3


def test_a_linear_run_ends_at_the_precursor_only_as_its_ion_type_does():
    seq = "GAVLF"
    order = _seq(seq)
    peaks, _p, pre = _linear_spectrum(order)
    r = _run(peaks, seq, "linear", pre)
    ends = [x for x in r["runs"] if x["to_precursor"]]
    assert ends, "no run reached the precursor"
    for x in ends:
        last = x["steps"][-1]
        if x["direction"] == "forward":
            assert last["positions"] == [len(order) - 1] and last["offset"] == round(H2O, 5)
        else:
            assert last["positions"] == [0] and last["offset"] == 0.0


def test_a_jump_covers_two_neighbouring_residues():
    seq = "GAVLF"
    order = _seq(seq)
    peaks, _p, pre = _linear_spectrum(order)
    # take b2 away: from b1 to b3 is then Ala+Val across a missing fragment
    b2 = round(_a["Gly"] + _a["Ala"] + P, 5)
    peaks = [p for p in peaks if p[0] != b2]
    off = _run(peaks, seq, "linear", pre)
    on = _run(peaks, seq, "linear", pre, doubles=True)
    assert on["longest"] >= off["longest"]
    jumped = [s for x in on["runs"] for s in x["steps"] if s["kind"] == "two"]
    assert any(sorted(s["positions"]) == [1, 2] for s in jumped)


def test_a_doubly_charged_ladder_is_read_at_charge_two():
    seq = "GAVLF"
    m = [_a[x] for x in _seq(seq)]
    ions = [(sum(m[:k]) + 2 * P) / 2 for k in range(1, 5)]
    peaks = [[round(x, 5), 50.0] for x in ions]
    one = core.expected_sequence(peaks, seq, "linear")
    two = core.expected_sequence(peaks, seq, "linear", charge=2)
    assert two["fragments_seen"] == 4 and one["fragments_seen"] < 4
    assert two["longest"] == 3


def test_the_error_limit_holds_for_fragments_and_steps():
    seq = "GAVLF"
    peaks, _p, pre = _linear_spectrum(_seq(seq))
    shifted = [[x + 0.02, i] if i else [x, i] for x, i in peaks]
    r = _run(shifted, seq, "linear", pre, tolerance={"unit": "mDa", "value": 10})
    assert r["fragments_seen"] == 0
    wide = _run(shifted, seq, "linear", pre, tolerance={"unit": "mDa", "value": 30})
    assert wide["fragments_seen"] > 0
    for frag in wide["fragments"]:
        assert all(abs(f["error_mda"]) <= 30 for f in frag["fits"])


def test_a_ring_read_as_linear_is_named_as_one_water_off():
    seq = "GVPVWA"
    peaks, pre = _cyclic_spectrum(_seq(seq))
    ring = _run(peaks, seq, "cyclic", pre)["precursor"]
    chain = _run(peaks, seq, "linear", pre)["precursor"]
    assert ring["within"] and ring["hint"] is None
    assert not chain["within"] and "cyclic" in chain["hint"]
    # a mass far from anything named gets no hint
    odd = _run(peaks, "GVPVWAG", "cyclic", pre)["precursor"]
    assert not odd["within"] and odd["hint"] is None


# --- a stretch: part of the molecule, any length ----------------------------------------------------

def test_a_stretch_is_found_inside_a_longer_molecule_without_the_precursor():
    # GVPVWA's b-ladder; search only Val-Pro-Val: spelled in full, nothing about the precursor
    peaks, pre = _cyclic_spectrum(_seq("GVPVWA"), start=0)
    r = _run(peaks, "VPV", "stretch", pre)
    assert r["n_full"] >= 1 and r["longest"] == 3
    assert r["precursor"] is None and r["neutral_mass"] is None
    assert r["control"]["fragments"] is None and r["fragments"] == []
    assert r["rest_of_molecule"] == pytest.approx(pre - P - sum(_a[x] for x in ("Val", "Pro", "Val")),
                                                  abs=1e-4)
    full = [x for x in r["runs"] if x["residues"] == 3]
    assert all(not x["to_precursor"] for x in full)


def test_a_stretch_any_length_is_accepted():
    # opened before Gly, the first ion is Gly itself; the steps are Val, Pro, Val, Trp
    peaks, pre = _cyclic_spectrum(_seq("GVPVWA"), start=0)
    for seq in ("VP", "VPV", "VPVW"):
        r = _run(peaks, seq, "stretch", pre)
        assert r["n_residues"] == len(seq) and r["n_full"] >= 1


def test_a_stretch_in_the_wrong_order_is_not_spelled_in_full():
    peaks, pre = _cyclic_spectrum(_seq("GVPVWA"), start=0)
    right = _run(peaks, "VPVW", "stretch", pre)
    wrong = _run(peaks, "VWPV", "stretch", pre)
    assert right["n_full"] >= 1 and wrong["n_full"] == 0
    assert right["longest"] > wrong["longest"]
    # the other orders of a stretch never include it read backwards: the steps read both ways
    assert all(b["order"] != _seq("VPWV") for b in wrong["control"]["runs"]["better"])


def test_the_default_is_a_stretch():
    peaks = [[100.0, 1.0], [100.0 + _a["Gly"], 1.0], [100.0 + _a["Gly"] + _a["Ala"], 1.0]]
    r = client.post("/expected", json={"peaks": peaks, "sequence": "GA"}).json()
    assert r["topology"] == "stretch" and r["n_full"] == 1


# --- the endpoint ---------------------------------------------------------------------------------

def test_the_endpoint_agrees_with_the_core():
    seq = "GAVLF"
    peaks, _p, pre = _linear_spectrum(_seq(seq))
    idx = peaks.index([round(pre, 5), 0.0])
    body = {"peaks": peaks, "sequence": seq, "topology": "linear", "precursor_index": idx,
            "precursor_mz": round(pre, 5)}
    got = client.post("/expected", json=body)
    assert got.status_code == 200
    assert got.json() == core.expected_sequence(peaks, seq, "linear", idx, round(pre, 5))


def test_the_endpoint_refuses_what_it_cannot_read():
    peaks = [[100.0, 1.0], [200.0, 1.0]]
    base = {"peaks": peaks, "sequence": "GAV", "topology": "linear"}
    assert client.post("/expected", json={**base, "topology": "branched"}).status_code == 422
    r = client.post("/expected", json={**base, "sequence": "Gly Zzz"})
    assert r.status_code == 422 and "Zzz" in r.json()["detail"]
    r = client.post("/expected", json={**base, "precursor_mz": 300.0})
    assert r.status_code == 422

"""Mass arithmetic for the RiPP annotator: which residues fit the gap between two peaks.

Everything here is plain arithmetic on residue masses. The residue tables (the standard residues,
and the modifications each RiPP class or kind of modification adds) are data, read from
data/residues.json. Structures of database records, cut into residues, are in
data/known_structures.json.

Tolerance: each peak gets max(floor, m/z x ppm); a gap's window is the sum for its two peaks,
times the charge of the series being read.
"""
from __future__ import annotations

import bisect
import json
import re
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"
_TABLES = json.loads((DATA / "residues.json").read_text(encoding="utf-8"))
_KNOWN = json.loads((DATA / "known_structures.json").read_text(encoding="utf-8"))

STANDARD: dict[str, float] = _TABLES["standard"]
SETS: dict[str, dict[str, float]] = _TABLES["sets"]
# per set, per modification: {label: mass} for every residue the modification can make
OFFERED: dict[str, dict[str, dict[str, float]]] = _TABLES["offered"]
VOCAB: dict[str, float] = _TABLES["vocab"]
CLASSES: list[dict] = _TABLES["classes"]
MIN_RES: float = _TABLES["min_residue"]
PPM: float = _TABLES["tolerance"]["ppm"]
FLOOR_DA: float = _TABLES["tolerance"]["floor_mda"] / 1000.0
TOLERANCE = dict(_TABLES["tolerance"])

PROTON = 1.00727646
H_ATOM = 1.0078250319
H2O = 18.0105646

CUSTOM_MAX = 50
ALPHABET_MAX = 300
NAME_MAX = 32
SETS_MAX = 12
PPM_MAX = 10000.0
FLOOR_MDA_MAX = 1000.0


class AnnotateError(ValueError):
    """A request that cannot be answered, with a message meant for the person using the page."""


# --- tolerance ------------------------------------------------------------------------------------

def make_tol(ppm=None, floor_mda=None):
    p = PPM if ppm is None else float(ppm)
    f = FLOOR_DA if floor_mda is None else float(floor_mda) / 1000.0
    return lambda mz: max(f, mz * p / 1e6)


DEFAULT_TOL = make_tol()


def tolerance_function(tolerance):
    """{"ppm": 5, "floor_mda": 2} (either key alone is fine) -> a per-peak tolerance function."""
    if tolerance in (None, {}):
        return DEFAULT_TOL
    if not isinstance(tolerance, dict):
        raise AnnotateError('tolerance must be an object like {"ppm": 5, "floor_mda": 2}')
    unknown = set(tolerance) - {"ppm", "floor_mda"}
    if unknown:
        raise AnnotateError(f"unknown tolerance keys: {', '.join(sorted(unknown))}")
    ppm, floor = tolerance.get("ppm"), tolerance.get("floor_mda")
    if ppm is None and floor is None:
        raise AnnotateError("tolerance needs ppm, floor_mda, or both")
    for name, v, hi in (("ppm", ppm, PPM_MAX), ("floor_mda", floor, FLOOR_MDA_MAX)):
        if v is None:
            continue
        try:
            v = float(v)
        except (TypeError, ValueError):
            raise AnnotateError(f"tolerance {name} is not a number")
        if v != v or v in (float("inf"), float("-inf")):
            raise AnnotateError(f"tolerance {name} must be finite")
        if v <= 0:
            raise AnnotateError(f"tolerance {name} must be greater than 0")
        if v > hi:
            raise AnnotateError(f"tolerance {name} of {v:g} is too wide to mean anything")
    return make_tol(ppm, floor)


# --- residue sets ---------------------------------------------------------------------------------

def set_names(class_name):
    """One set name or a list of them -> the sets to combine. "standard" adds nothing."""
    if class_name is None:
        return []
    names = [class_name] if isinstance(class_name, str) else class_name
    if not isinstance(names, (list, tuple)):
        raise AnnotateError("class_name must be a name or a list of names")
    if len(names) > SETS_MAX:
        raise AnnotateError(f"{len(names)} sets chosen; at most {SETS_MAX}")
    out = []
    for n in names:
        if not isinstance(n, str):
            raise AnnotateError("every class name must be text")
        if n == "standard":
            continue
        if n not in SETS:
            raise AnnotateError(f"unknown class {n!r}")
        if n not in out:
            out.append(n)
    return out


def _custom_records(custom, base):
    """User-defined residues: a modification of chosen residues, or a residue given by its mass."""
    if custom in (None, (), []):
        return [], {}
    if isinstance(custom, dict):
        custom = [custom]
    if not isinstance(custom, (list, tuple)):
        raise AnnotateError("custom must be a list of entries")
    if len(custom) > CUSTOM_MAX:
        raise AnnotateError(f"{len(custom)} custom entries; at most {CUSTOM_MAX}")
    out, add = [], {}
    for n, e in enumerate(custom):
        where = f"Your residue {n + 1}"
        if not isinstance(e, dict):
            raise AnnotateError(f"{where} is not an entry")
        name = e.get("name")
        if not isinstance(name, str) or not name.strip():
            raise AnnotateError(f"{where} needs a name")
        name = name.strip()
        if len(name) > NAME_MAX:
            raise AnnotateError(f"{where}: the name is longer than {NAME_MAX} characters")
        if "[" in name or "]" in name:
            raise AnnotateError(f"{where}: the name may not contain [ or ]")
        has_delta, has_mass = "delta" in e, "mass" in e
        if has_delta == has_mass:
            raise AnnotateError(f"{where} needs either a mass change and residues, or a mass")
        if has_mass:
            try:
                mass = float(e["mass"])
            except (TypeError, ValueError):
                raise AnnotateError(f"{where}: the mass is not a number")
            if mass != mass or mass in (float("inf"), float("-inf")):
                raise AnnotateError(f"{where}: the mass must be finite")
            if mass < MIN_RES:
                raise AnnotateError(f"{where}: {mass:.5f} Da is below the lightest residue, "
                                    f"{MIN_RES:.0f} Da")
            if name in base or name in add:
                raise AnnotateError(f"{where}: {name!r} is already a residue; choose another name")
            add[name] = mass
            out.append({"label": name, "mass": round(mass, 5), "kind": "residue",
                        "delta": None, "applies_to": None, "parent": None})
            continue
        try:
            delta = float(e["delta"])
        except (TypeError, ValueError):
            raise AnnotateError(f"{where}: the mass change is not a number")
        if delta != delta or delta in (float("inf"), float("-inf")):
            raise AnnotateError(f"{where}: the mass change must be finite")
        app = e.get("applies_to", "any")
        if isinstance(app, str) and app.lower() == "any":
            parents = sorted(base)
        elif isinstance(app, str):
            parents = [app]
        elif isinstance(app, (list, tuple)) and app:
            parents = [str(x) for x in app]
        else:
            raise AnnotateError(f"{where}: choose the residues it applies to, or any")
        unknown = [p for p in parents if p not in base]
        if unknown:
            raise AnnotateError(f"{where} applies to residues not available: "
                                f"{', '.join(sorted(unknown)[:6])}")
        for p in parents:
            mass = base[p] + delta
            if mass < MIN_RES:
                raise AnnotateError(f"{where} on {p} gives {mass:.5f} Da, below the lightest "
                                    f"residue, {MIN_RES:.0f} Da")
            lab = f"{p}[{name}]"
            if lab in base or lab in add:
                raise AnnotateError(f"{where}: {lab!r} already exists; choose another name")
            add[lab] = mass
            out.append({"label": lab, "mass": round(mass, 5), "kind": "modification",
                        "delta": round(delta, 5), "applies_to": p, "parent": p})
    return out, add


def alphabet_for(class_name="standard", include=None, exclude=None, custom=None):
    """-> {label: mass}: the standard residues, what the chosen sets add, the residues switched on,
    the user's own residues, and minus the residues switched off."""
    names = set_names(class_name)
    a = dict(STANDARD)
    for n in names:
        a.update(SETS[n])
    known = {**VOCAB, **STANDARD}
    # two sets with a modification of the same name offer the later set's version of it
    merged = {}
    for n in names:
        merged.update(OFFERED[n])
    for labels in merged.values():
        known.update(labels)
    for lab in (include or ()):
        if lab not in known:
            raise AnnotateError(f"unknown residue {lab!r}")
        a[lab] = known[lab]
    _recs, extra = _custom_records(custom, dict(a))
    a.update(extra)
    for lab in (exclude or ()):
        a.pop(lab, None)
    if len(a) < 2:
        raise AnnotateError("fewer than two residues are left; nothing can be read")
    if len(a) > ALPHABET_MAX:
        raise AnnotateError(f"{len(a)} residues chosen; at most {ALPHABET_MAX}")
    return a


def custom_residues(custom, class_name="standard", include=None, exclude=None):
    base = alphabet_for(class_name, include, None)
    recs, _extra = _custom_records(custom, dict(base))
    ex = set(exclude or ())
    return [r for r in recs if r["label"] not in ex]


# --- gaps between peaks ---------------------------------------------------------------------------

def _check_index(peaks, *idx):
    n = len(peaks)
    for i in idx:
        if not isinstance(i, int) or i < 0 or i >= n:
            raise AnnotateError(f"peak {i!r} is not in this spectrum, which has {n} peaks")


def _candidate(label, mass, d, ppm_digits=1):
    return {"label": label, "mass": round(mass, 5), "error_mda": round((d - mass) * 1000, 2),
            "error_ppm": round((d - mass) / mass * 1e6, ppm_digits) if mass else None}


def gap(peaks, i, j, class_name="standard", charge=1, include=None, exclude=None,
        custom=None, tolerance=None):
    """Two peaks -> every residue that fits the difference, closest first, with its error."""
    _check_index(peaks, i, j)
    a = alphabet_for(class_name, include, exclude, custom)
    tol = tolerance_function(tolerance)
    mz_i, mz_j = sorted((peaks[i][0], peaks[j][0]))
    d = (mz_j - mz_i) * charge
    t = (tol(mz_i) + tol(mz_j)) * charge
    cands = [_candidate(lab, m, d) for lab, m in sorted(a.items(), key=lambda kv: kv[1])
             if abs(m - d) <= t]
    cands.sort(key=lambda c: abs(c["error_mda"]))
    return {"gap": round(d, 5), "tol": round(t, 5), "charge": charge, "candidates": cands,
            "class": class_name, "alphabet_size": len(a), "peaks": [i, j],
            "custom": custom_residues(custom, class_name, include, exclude)}


def neighbours(peaks, i, class_name="standard", charge=1, include=None, exclude=None,
               direction="both", custom=None, tolerance=None):
    """Every peak one residue away from peak i."""
    _check_index(peaks, i)
    a = alphabet_for(class_name, include, exclude, custom)
    tol = tolerance_function(tolerance)
    items = sorted(a.items(), key=lambda kv: kv[1])
    vals = [m for _l, m in items]
    lo, hi = vals[0] - 0.06, vals[-1] + 0.06
    mz_i = peaks[i][0]
    out = []
    for j, (mz_j, inten) in enumerate(peaks):
        if j == i:
            continue
        d = (mz_j - mz_i) * charge
        up = d > 0
        if (direction == "up" and not up) or (direction == "down" and up):
            continue
        ad = abs(d)
        if ad < lo or ad > hi:
            continue
        t = (tol(mz_i) + tol(mz_j)) * charge
        k = bisect.bisect_left(vals, ad - t)
        cands = []
        while k < len(vals) and vals[k] <= ad + t:
            cands.append(_candidate(items[k][0], items[k][1], ad))
            k += 1
        if cands:
            cands.sort(key=lambda c: abs(c["error_mda"]))
            out.append({"peak": j, "mz": mz_j, "intensity": inten, "gap": round(ad, 5),
                        "direction": "up" if up else "down", "candidates": cands})
    out.sort(key=lambda r: (r["direction"] != "up", r["gap"]))
    return {"peak": i, "class": class_name, "charge": charge, "alphabet_size": len(a),
            "n_neighbours": len(out), "neighbours": out,
            "custom": custom_residues(custom, class_name, include, exclude)}


def _edges(peaks, alphabet, z, tol):
    """Every residue-sized gap between two peaks: {a: [(b, gap, [(label, mass) closest first])]}."""
    ms = sorted(((l, m) for l, m in alphabet.items() if m >= MIN_RES), key=lambda kv: kv[1])
    if not ms:
        raise AnnotateError(f"no residue at or above {MIN_RES:.0f} Da")
    vals = [m for _l, m in ms]
    lo, hi = vals[0] - 0.06, vals[-1] + 0.06
    out = {}
    for a in range(len(peaks)):
        row = []
        for b in range(a + 1, len(peaks)):
            d = (peaks[b][0] - peaks[a][0]) * z
            if d < lo:
                continue
            if d > hi:
                break
            t = (tol(peaks[a][0]) + tol(peaks[b][0])) * z
            k = bisect.bisect_left(vals, d - t)
            hits = []
            while k < len(vals) and vals[k] <= d + t:
                hits.append(ms[k])
                k += 1
            if hits:
                hits.sort(key=lambda h: abs(h[1] - d))
                row.append((b, d, hits))
        if row:
            out[a] = row
    return out


def _paths(peaks, i, j, alphabet, z, max_paths, max_steps, tol):
    """Every way from peak i to peak j in residue-sized steps, fewest steps first."""
    if i == j:
        return []
    if peaks[i][0] > peaks[j][0]:
        i, j = j, i
    edges = _edges(peaks, alphabet, z, tol)
    found = []

    def walk(at, path, gaps, inten):
        if len(found) >= max_paths * 20 or len(gaps) > max_steps:
            return
        if at == j:
            found.append({"nodes": list(path), "gaps": list(gaps),
                          "labels": [g[1][0][0] for g in gaps],
                          "alternatives": [[{"label": l, "mass": round(m, 5),
                                             "error_mda": round((d - m) * 1000, 2)}
                                            for l, m in h] for d, h in gaps],
                          "steps": len(gaps), "intensity": inten})
            return
        for b, d, hits in edges.get(at, ()):
            if peaks[b][0] > peaks[j][0]:
                break
            path.append(b)
            gaps.append((d, hits))
            walk(b, path, gaps, inten + peaks[b][1])
            path.pop()
            gaps.pop()

    walk(i, [i], [], peaks[i][1])
    found.sort(key=lambda p: (p["steps"], -p["intensity"]))
    return found[:max_paths]


def _with_ppm(cands, gap_da):
    out = []
    for c in cands:
        c = dict(c)
        m = c.get("mass")
        if "error_ppm" not in c and m:
            e = c.get("error_mda")
            if e is None and gap_da is not None:
                e = (gap_da - m) * 1000.0
                c["error_mda"] = round(e, 2)
            if e is not None:
                c["error_ppm"] = round((e / 1000.0) / m * 1e6, 2)
        out.append(c)
    return out


def connect(peaks, i, j, class_name="standard", charge=1, max_paths=50, max_steps=12,
            include=None, exclude=None, custom=None, tolerance=None):
    """Two distant peaks -> the chains of residues that span them, fewest steps first."""
    _check_index(peaks, i, j)
    a = alphabet_for(class_name, include, exclude, custom)
    paths = _paths(peaks, i, j, a, charge, max_paths, max_steps, tolerance_function(tolerance))
    return {"class": class_name, "charge": charge, "alphabet_size": len(a),
            "custom": custom_residues(custom, class_name, include, exclude),
            "n_paths": len(paths),
            "paths": [{"steps": p["steps"], "labels": p["labels"], "nodes": p["nodes"],
                       "intensity": round(p["intensity"], 2),
                       "gaps": [{"gap": round(d, 5), "candidates": _with_ppm(alts, d)}
                                for (d, _h), alts in zip(p["gaps"], p["alternatives"])]}
                      for p in paths]}


# --- the precursor --------------------------------------------------------------------------------

def precursor_point(precursor_mz, charge=1):
    """-> the precursor's neutral mass and its singly protonated equivalent."""
    try:
        mz = float(precursor_mz)
        z = int(charge)
    except (TypeError, ValueError):
        raise AnnotateError("the precursor m/z must be a number and its charge a whole number")
    if z < 1:
        raise AnnotateError("the precursor charge must be at least 1")
    if not (mz > 0) or mz != mz:
        raise AnnotateError("the precursor m/z must be a positive number")
    neutral = mz * z - z * PROTON
    return {"precursor_mz": round(mz, 5), "charge": z, "neutral": round(neutral, 5),
            "mh1": round(neutral + PROTON, 5)}


_MONO = {"C": 12.0, "H": 1.0078250319, "N": 14.0030740052, "O": 15.9949146221,
         "S": 31.97207069, "P": 30.97376151, "Se": 79.9165196, "Cl": 34.96885271,
         "Br": 78.9183376, "F": 18.99840320, "I": 126.904473, "Na": 22.98976928,
         "K": 38.9637069}
_AVG = {"C": 12.0107, "H": 1.00794, "N": 14.0067, "O": 15.9994, "S": 32.065,
        "P": 30.973762, "Se": 78.96, "Cl": 35.453, "Br": 79.904, "F": 18.9984032,
        "I": 126.90447, "Na": 22.98977, "K": 39.0983}
_ADDUCTS = {"[M+H]+": (PROTON, 1), "[M+2H]2+": (2 * PROTON, 2), "[M+3H]3+": (3 * PROTON, 3),
            "[M+Na]+": (22.98922, 1), "[M+K]+": (38.96316, 1), "[M+NH4]+": (18.03383, 1)}
FORMULA_MAX_MDA = 10.0


def _formula_mass(formula, table):
    total, seen = 0.0, False
    for sym, num in re.findall(r"([A-Z][a-z]?)(\d*)", formula or ""):
        if sym not in table:
            return None
        total += table[sym] * (int(num) if num else 1)
        seen = True
    return total if seen else None


def precursor_from_mass(neutral_mass, precursor_type="[M+H]+", formula=None):
    """A record's neutral mass and adduct -> its precursor, checked against its formula."""
    try:
        m = float(neutral_mass)
    except (TypeError, ValueError):
        raise AnnotateError("the record's mass is not a number")
    if m != m or m in (float("inf"), float("-inf")) or m <= 0:
        raise AnnotateError("the record's mass must be a positive number")
    key = str(precursor_type or "").replace(" ", "")
    if key not in _ADDUCTS:
        raise AnnotateError(f"precursor type {precursor_type!r} is not one this page can use "
                            f"(positive mode only: {', '.join(sorted(_ADDUCTS))})")
    add, z = _ADDUCTS[key]
    checked = None
    if formula:
        mono, avg = _formula_mass(formula, _MONO), _formula_mass(formula, _AVG)
        if mono is None or avg is None:
            checked = {"formula": formula, "verdict": "unknown element, not checked"}
        else:
            d_mono = abs(m - mono)
            if d_mono > FORMULA_MAX_MDA / 1000.0:
                diff = m - mono
                cause = None
                for off, why in ((PROTON, "it looks like [M+H]+ stored as the neutral mass"),
                                 (-PROTON, "it looks like [M-H]- stored as the neutral mass"),
                                 (H2O, "the mass includes a water the formula does not"),
                                 (-H2O, "the formula includes a water the mass does not")):
                    if abs(diff - off) <= 0.002:
                        cause = why
                        break
                if cause is None:
                    for n in (1, 2, 3):
                        if abs(abs(diff) - n * 1.0033548) <= 0.002:
                            cause = f"it is {n} carbon-13 away, like an isotope peak"
                            break
                if cause is None and abs(m - avg) <= FORMULA_MAX_MDA / 1000.0:
                    cause = "it matches the average mass of the formula, not the monoisotopic one"
                raise AnnotateError(
                    f"the stored mass {m:.4f} is {diff * 1000:+.0f} mDa from the monoisotopic "
                    f"mass of {formula} ({mono:.4f}). " + (cause.capitalize() + ". " if cause
                                                            else "The record looks wrong. ")
                    + "The precursor is left out rather than placed wrongly.")
            checked = {"formula": formula, "monoisotopic": round(mono, 5),
                       "average": round(avg, 5), "error_mda": round((m - mono) * 1000, 2),
                       "limit_mda": FORMULA_MAX_MDA, "verdict": "monoisotopic"}
    out = precursor_point((m + add) / z, z)
    out.update({"precursor_type": key, "from_neutral_mass": round(m, 5), "formula_check": checked})
    return out


_READINGS = [("cyclic b-ion to [M+H]+", 0.0), ("linear b-ion to [M+H]+", H2O),
             ("cyclic b-ion to [M+H-H2O]+", -H2O)]


def precursor_neighbours(peaks, precursor_mz, precursor_charge=1, class_name="standard",
                         charge=1, include=None, exclude=None, custom=None, topology=None,
                         tolerance=None):
    """Every peak one residue below the precursor, under each reading of what the precursor is."""
    if not peaks:
        raise AnnotateError("there are no peaks")
    a = alphabet_for(class_name, include, exclude, custom)
    pre = precursor_point(precursor_mz, precursor_charge)
    tol = tolerance_function(tolerance)
    items = sorted(a.items(), key=lambda kv: kv[1])
    vals = [m for _l, m in items]
    readings = list(_READINGS)
    if topology == "cyclic":
        readings = [readings[0], readings[2], readings[1]]
    elif topology == "linear":
        readings = [readings[1], readings[0], readings[2]]
    elif topology is not None:
        raise AnnotateError("topology must be cyclic, linear or left out")
    tp = tol(pre["mh1"])
    out = []
    for i, p in enumerate(peaks):
        mz = float(p[0])
        raw = (pre["mh1"] - mz) * charge
        tt = (tol(mz) + tp) * charge
        for name, off in readings:
            d = raw - off
            if d < MIN_RES:
                continue
            k = bisect.bisect_left(vals, d - tt)
            cands = []
            while k < len(vals) and vals[k] <= d + tt:
                cands.append(_candidate(items[k][0], items[k][1], d, ppm_digits=2))
                k += 1
            if cands:
                cands.sort(key=lambda c: abs(c["error_mda"]))
                out.append({"peak": i, "peak_mz": round(mz, 5), "hypothesis": name,
                            "offset": round(off, 5), "distance": round(d, 5),
                            "candidates": cands})
    return {"precursor": pre, "class": class_name, "charge": charge, "alphabet_size": len(a),
            "topology": topology, "n_matches": len(out), "matches": out,
            "custom": custom_residues(custom, class_name, include, exclude)}


# --- a saved chain against a database record's structure -----------------------------------------

def known_structure(accession):
    """The structure of a database record cut into residues, or None if there is none."""
    return _KNOWN.get(accession)


def _contiguous(n, seq_idx, cyclic):
    k = len(seq_idx)
    if not k or k > n:
        return False
    for want in (list(seq_idx), list(reversed(seq_idx))):
        for s in range(n):
            if all(((s + off) % n if cyclic else s + off) == pos and (cyclic or s + off < n)
                   for off, pos in enumerate(want)):
                return True
    return False


def compare_to_known(steps, known, tolerance=None, class_name="standard",
                     include=None, exclude=None, custom=None):
    """Each step of a saved chain against the record's residues, by mass.

    "unit": the step is a whole residue of the structure. "inside": it is part of a fused residue
    (the residue minus another residue, allowing for the water or hydrogens lost when they fused).
    "no match": neither. The run test (whether the steps are neighbours in the structure) is only
    given when every step is a whole residue and the residues can be read in order.
    """
    if not isinstance(known, dict):
        raise AnnotateError("there is no structure to compare with")
    if not steps:
        raise AnnotateError("the chain has no steps")
    a = alphabet_for(class_name, include, exclude, custom)
    tol = tolerance_function(tolerance)
    units = known.get("unit_labels") or known.get("residues") or []
    umass = known.get("unit_mass") or []
    want = []
    for n, s in enumerate(steps):
        if isinstance(s, dict):
            m, lab = s.get("mass"), s.get("label")
            if m is None and lab is not None:
                m = a.get(lab)
            if m is None:
                raise AnnotateError(f"step {n + 1} has no mass")
            want.append((lab, float(m)))
        elif isinstance(s, (int, float)):
            want.append((None, float(s)))
        elif isinstance(s, str) and s in a:
            want.append((s, float(a[s])))
        elif isinstance(s, str) and s in units and len(umass) == len(units):
            want.append((s, float(umass[units.index(s)])))
        else:
            raise AnnotateError(f"step {n + 1} is not a residue or a mass")
    if not umass or len(umass) != len(units):
        raise AnnotateError("this record's structure has no residue masses to compare with")
    pairs = list(zip(units, [float(m) for m in umass]))
    alpha_masses = sorted(set(round(v, 5) for v in a.values()))
    out, matched = [], []
    for lab, m in want:
        hit = None
        for i, (ul, um) in enumerate(pairs):
            if abs(um - m) <= tol(um) + tol(m):
                hit = {"kind": "unit", "unit_index": i, "unit_label": ul,
                       "unit_mass": round(um, 5), "error_mda": round((m - um) * 1000, 2)}
                break
        if hit is None:
            for i, (ul, um) in enumerate(pairs):
                for off, oname in ((0.0, "none"), (H2O, "H2O"), (2 * H_ATOM, "2H"),
                                   (H2O + 2 * H_ATOM, "H2O+2H")):
                    rest = um - m + off
                    if rest < MIN_RES:
                        continue
                    am = next((x for x in alpha_masses if abs(x - rest) <= tol(x) + tol(rest)),
                              None)
                    if am is not None:
                        hit = {"kind": "inside", "unit_index": i, "unit_label": ul,
                               "unit_mass": round(um, 5), "lost_on_fusion": oname,
                               "remainder": round(rest, 5), "remainder_matches": round(am, 5),
                               "error_mda": round((rest - am) * 1000, 2)}
                        break
                if hit:
                    break
        if hit is None:
            out.append({"label": lab, "mass": round(m, 5), "kind": "no match"})
        else:
            hit.update({"label": lab, "mass": round(m, 5)})
            out.append(hit)
            if hit["kind"] == "unit":
                matched.append(hit["unit_index"])
    uar = known.get("units_are_residues")
    run = None
    if uar is True and want and len(matched) == len(want):
        run = _contiguous(len(pairs), matched, known.get("topology") == "cyclic")
    return {"n_steps": len(want), "steps": out,
            "n_unit": sum(1 for s in out if s["kind"] == "unit"),
            "n_inside": sum(1 for s in out if s["kind"] == "inside"),
            "n_no_match": sum(1 for s in out if s["kind"] == "no match"),
            "units_are_residues": uar, "contiguous_run": run}


# --- reading spectra ------------------------------------------------------------------------------

def read_mgf(text):
    """mgf text -> [{"fields": {KEY: value}, "peaks": [(mz, intensity)]}]."""
    out, cur, peaks = [], {}, []
    for ln in text.splitlines():
        s = ln.strip()
        if s == "BEGIN IONS":
            cur, peaks = {}, []
        elif s == "END IONS":
            out.append({"fields": cur, "peaks": peaks})
        elif "=" in s and not s[0].isdigit():
            k, v = s.split("=", 1)
            cur[k] = v
        elif s:
            p = s.split()
            try:
                peaks.append((float(p[0]), float(p[1]) if len(p) > 1 else 1.0))
            except ValueError:
                pass
    return out


def read_spectra(text, max_peaks=None):
    """mgf text -> the spectra the page shows, peaks sorted by m/z. Every other call addresses
    peaks by their place in that list."""
    found = []
    for i, s in enumerate(read_mgf(text)):
        f, pk = s["fields"], sorted(s["peaks"], key=lambda p: p[0])
        if not pk:
            continue
        if max_peaks and len(pk) > max_peaks:
            pk = sorted(sorted(pk, key=lambda p: -p[1])[:max_peaks], key=lambda p: p[0])
        raw = str(f.get("PEPMASS") or f.get("PRECURSOR_MZ") or "").split()
        found.append({"index": i,
                      "name": f.get("NAME") or f.get("COMPOUND_NAME") or f"spectrum {i}",
                      "precursor": float(raw[0]) if raw else None,
                      "charge_hint": f.get("CHARGE") or None,
                      "collision_energy": f.get("COLLISION_ENERGY") or None,
                      "n_peaks": len(pk),
                      "peaks": [[round(m, 5), round(it, 3)] for m, it in pk],
                      "known": None})
    return found

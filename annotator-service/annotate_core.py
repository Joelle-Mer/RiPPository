"""Mass arithmetic for the RiPP annotator: which residues fit the gap between two peaks.

Everything here is plain arithmetic on residue masses. The residue tables (the standard residues,
and the modifications each RiPP class or kind of modification adds) are data, read from
data/residues.json. Structures of database records, cut into residues, are in
data/known_structures.json.

Error limit: one limit, in mDa or in ppm. A residue fits a gap only if its error is within the
limit, so no match shown ever exceeds it. ppm is of the heavier peak's m/z (of the precursor, for a
distance to the precursor), the way an instrument's accuracy is stated.

Two-residue jumps (off unless asked for): a gap may also be read as two residues of the chosen
alphabet when the fragment between them is missing, that is when no peak sits where either residue
alone would end. One residue is always listed before two, and a chain counts a jump as two steps.
"""
from __future__ import annotations

import bisect
import json
import math
import random
import re
from collections import Counter
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
DEFAULT_LIMIT = {"unit": "mDa", "value": 10.0}
TOLERANCE = {
    "default": DEFAULT_LIMIT,
    "defaults": {"mDa": 10.0, "ppm": 10.0},
    "rule": "a residue is shown only if its error is within your limit: in mDa, or in ppm of "
            "the heavier peak's m/z",
}

PROTON = 1.00727646
H_ATOM = 1.0078250319
H2O = 18.0105646

CUSTOM_MAX = 50
ALPHABET_MAX = 300
NAME_MAX = 32
SETS_MAX = 12
LIMIT_MAX = {"mDa": 1000.0, "ppm": 10000.0}


class AnnotateError(ValueError):
    """A request that cannot be answered, with a message meant for the person using the page."""


# --- the error limit -----------------------------------------------------------------------------

class Limit:
    """The largest error allowed on a match, and how to state an error in ppm."""

    def __init__(self, unit, value):
        self.unit, self.value = unit, value

    def window(self, ref_mz, charge=1):
        """Largest allowed |error| in Da on a gap read at `charge`, whose heavier end is `ref_mz`."""
        if self.unit == "mDa":
            return self.value / 1000.0
        return self.value * charge * ref_mz / 1e6

    def describe(self):
        return f"{self.value:g} {self.unit}"


def ppm_of(error_da, ref_mz, charge=1):
    """An error in Da on a gap, as ppm of the heavier peak's m/z."""
    return (error_da / charge) / ref_mz * 1e6 if ref_mz else None


def error_limit(tolerance):
    """{"unit": "mDa" | "ppm", "value": 10} -> a Limit; None gives the default."""
    if tolerance in (None, {}):
        return Limit(DEFAULT_LIMIT["unit"], DEFAULT_LIMIT["value"])
    if not isinstance(tolerance, dict) or set(tolerance) - {"unit", "value"}:
        raise AnnotateError('the error limit must look like {"unit": "mDa", "value": 10}')
    unit = tolerance.get("unit")
    if unit not in LIMIT_MAX:
        raise AnnotateError("the error limit's unit must be mDa or ppm")
    try:
        value = float(tolerance.get("value"))
    except (TypeError, ValueError):
        raise AnnotateError("the error limit is not a number")
    if value != value or value in (float("inf"), float("-inf")):
        raise AnnotateError("the error limit must be finite")
    if value <= 0:
        raise AnnotateError("the error limit must be greater than 0")
    if value > LIMIT_MAX[unit]:
        raise AnnotateError(f"an error limit of {value:g} {unit} is too wide to mean anything")
    return Limit(unit, value)


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


def _candidate(label, mass, d, ref_mz, charge=1, ppm_digits=1):
    """A residue that fits a gap, with its error in mDa and in ppm of the heavier peak's m/z."""
    ppm = ppm_of(d - mass, ref_mz, charge)
    return {"label": label, "mass": round(mass, 5), "error_mda": round((d - mass) * 1000, 2),
            "error_ppm": round(ppm, ppm_digits) if ppm is not None else None}


def _double(label, mass, parts, d, ref_mz, charge=1, ppm_digits=1):
    c = _candidate(label, mass, d, ref_mz, charge, ppm_digits)
    c["double"] = True
    c["parts"] = [{"label": l, "mass": round(m, 5)} for l, m in parts]
    return c


class _Fit:
    """What fits a gap in the chosen alphabet: single residues, and two-residue jumps if asked for."""

    def __init__(self, alphabet, peaks, charge, limit, doubles=False):
        self.z = charge
        self.limit = limit
        self.items = sorted(alphabet.items(), key=lambda kv: (kv[1], kv[0]))
        self.vals = [m for _l, m in self.items]
        self.pairs = []
        if doubles:
            use = [(l, m) for l, m in self.items if m >= MIN_RES]
            for x in range(len(use)):
                for y in range(x, len(use)):
                    (l1, m1), (l2, m2) = use[x], use[y]
                    self.pairs.append((m1 + m2, f"{l1}+{l2}", ((l1, m1), (l2, m2))))
            self.pairs.sort()
        self.pvals = [m for m, _l, _p in self.pairs]
        self.mzs = sorted(float(p[0]) for p in peaks)
        self.lowest = self.vals[0] if self.vals else 0.0
        self.highest = max(self.vals[-1] if self.vals else 0.0,
                           self.pvals[-1] if self.pvals else 0.0)

    def _peak_near(self, mz):
        w = self.limit.window(mz, self.z) / self.z
        k = bisect.bisect_left(self.mzs, mz - w)
        return k < len(self.mzs) and self.mzs[k] <= mz + w

    def _single(self, d, ref_mz):
        t = self.limit.window(ref_mz, self.z)
        k = bisect.bisect_left(self.vals, d - t)
        return k < len(self.vals) and self.vals[k] <= d + t

    def middle_missing(self, low_mz, parts, high_mz):
        """True when the fragment between the two residues is missing: no peak sits where either
        residue alone would end, and no peak between the two splits the gap into two residues."""
        if any(self._peak_near(low_mz + m / self.z) for _l, m in parts):
            return False
        k = bisect.bisect_right(self.mzs, low_mz)
        while k < len(self.mzs) and self.mzs[k] < high_mz:
            mid = self.mzs[k]
            if (self._single((mid - low_mz) * self.z, mid)
                    and self._single((high_mz - mid) * self.z, high_mz)):
                return False
            k += 1
        return True

    def fits(self, d, ref_mz, low_mz, ppm_digits=1):
        """-> candidates for a gap d (Da): residues closest first, then two-residue jumps closest first."""
        t = self.limit.window(ref_mz, self.z)
        k = bisect.bisect_left(self.vals, d - t)
        one = []
        while k < len(self.vals) and self.vals[k] <= d + t:
            one.append(_candidate(self.items[k][0], self.items[k][1], d, ref_mz, self.z, ppm_digits))
            k += 1
        one.sort(key=lambda c: abs(c["error_mda"]))
        two = []
        if self.pairs:
            k = bisect.bisect_left(self.pvals, d - t)
            while k < len(self.pvals) and self.pvals[k] <= d + t:
                m, lab, parts = self.pairs[k]
                if self.middle_missing(low_mz, parts, low_mz + d / self.z):
                    two.append(_double(lab, m, parts, d, ref_mz, self.z, ppm_digits))
                k += 1
            two.sort(key=lambda c: abs(c["error_mda"]))
        return one + two


def gap(peaks, i, j, class_name="standard", charge=1, include=None, exclude=None,
        custom=None, tolerance=None, doubles=False):
    """Two peaks -> every residue that fits the difference, closest first, with its error."""
    _check_index(peaks, i, j)
    a = alphabet_for(class_name, include, exclude, custom)
    limit = error_limit(tolerance)
    fit = _Fit(a, peaks, charge, limit, doubles)
    mz_i, mz_j = sorted((peaks[i][0], peaks[j][0]))
    d = (mz_j - mz_i) * charge
    t = limit.window(mz_j, charge)
    cands = fit.fits(d, mz_j, mz_i)
    return {"gap": round(d, 5), "tol": round(t, 5), "charge": charge, "candidates": cands,
            "class": class_name, "alphabet_size": len(a), "peaks": [i, j],
            "custom": custom_residues(custom, class_name, include, exclude)}


def neighbours(peaks, i, class_name="standard", charge=1, include=None, exclude=None,
               direction="both", custom=None, tolerance=None, doubles=False):
    """Every peak one residue away from peak i (or two, across a missing fragment, if asked)."""
    _check_index(peaks, i)
    a = alphabet_for(class_name, include, exclude, custom)
    limit = error_limit(tolerance)
    fit = _Fit(a, peaks, charge, limit, doubles)
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
        heavier = max(mz_i, mz_j)
        t = limit.window(heavier, charge)
        if ad < fit.lowest - t or ad > fit.highest + t:
            continue
        cands = fit.fits(ad, heavier, min(mz_i, mz_j))
        if cands:
            out.append({"peak": j, "mz": mz_j, "intensity": inten, "gap": round(ad, 5),
                        "direction": "up" if up else "down", "candidates": cands})
    out.sort(key=lambda r: (r["direction"] != "up", r["gap"]))
    return {"peak": i, "class": class_name, "charge": charge, "alphabet_size": len(a),
            "n_neighbours": len(out), "neighbours": out,
            "custom": custom_residues(custom, class_name, include, exclude)}


def _edges(peaks, alphabet, z, limit, doubles=False):
    """Every residue-sized gap between two peaks: {a: [(b, gap, [candidates, singles first])]}."""
    ms = {l: m for l, m in alphabet.items() if m >= MIN_RES}
    if not ms:
        raise AnnotateError(f"no residue at or above {MIN_RES:.0f} Da")
    fit = _Fit(ms, peaks, z, limit, doubles)
    # the widest window any pair can have, so the sweep can stop early
    reach = limit.window(max(p[0] for p in peaks), z) if peaks else 0.0
    out = {}
    for a in range(len(peaks)):
        row = []
        for b in range(a + 1, len(peaks)):
            d = (peaks[b][0] - peaks[a][0]) * z
            if d < fit.lowest - reach:
                continue
            if d > fit.highest + reach:
                break
            hits = fit.fits(d, peaks[b][0], peaks[a][0])
            if hits:
                row.append((b, d, hits))
        if row:
            out[a] = row
    return out


def _paths(peaks, i, j, alphabet, z, max_paths, max_steps, limit, doubles=False):
    """Every way from peak i to peak j in residue-sized steps, fewest residues first.

    A two-residue jump counts as two residues, and of two chains with as many residues the one with
    fewer jumps comes first, so a chain of single residues is always preferred.
    """
    if i == j:
        return []
    if peaks[i][0] > peaks[j][0]:
        i, j = j, i
    edges = _edges(peaks, alphabet, z, limit, doubles)
    found = []

    def walk(at, path, gaps, inten):
        if len(found) >= max_paths * 20 or len(gaps) > max_steps:
            return
        if at == j:
            jumps = sum(1 for g in gaps if g[1][0].get("double"))
            found.append({"nodes": list(path), "gaps": list(gaps),
                          "labels": [g[1][0]["label"] for g in gaps],
                          "alternatives": [list(h) for _d, h, _top in gaps],
                          "steps": len(gaps), "residues": len(gaps) + jumps,
                          "jumps": jumps, "intensity": inten})
            return
        for b, d, hits in edges.get(at, ()):
            if peaks[b][0] > peaks[j][0]:
                break
            path.append(b)
            gaps.append((d, hits, peaks[b][0]))
            walk(b, path, gaps, inten + peaks[b][1])
            path.pop()
            gaps.pop()

    walk(i, [i], [], peaks[i][1])
    found.sort(key=lambda p: (p["residues"], p["jumps"], -p["intensity"]))
    return found[:max_paths]


def connect(peaks, i, j, class_name="standard", charge=1, max_paths=50, max_steps=12,
            include=None, exclude=None, custom=None, tolerance=None, doubles=False):
    """Two distant peaks -> the chains of residues that span them, fewest residues first."""
    _check_index(peaks, i, j)
    a = alphabet_for(class_name, include, exclude, custom)
    paths = _paths(peaks, i, j, a, charge, max_paths, max_steps, error_limit(tolerance), doubles)
    return {"class": class_name, "charge": charge, "alphabet_size": len(a),
            "custom": custom_residues(custom, class_name, include, exclude),
            "n_paths": len(paths),
            "paths": [{"steps": p["steps"], "jumps": p["jumps"], "labels": p["labels"],
                       "nodes": p["nodes"],
                       "intensity": round(p["intensity"], 2),
                       "gaps": [{"gap": round(d, 5), "candidates": alts}
                                for (d, _h, _top), alts in zip(p["gaps"], p["alternatives"])]}
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
                         tolerance=None, doubles=False):
    """Every peak one residue below the precursor, under each reading of what the precursor is."""
    if not peaks:
        raise AnnotateError("there are no peaks")
    a = alphabet_for(class_name, include, exclude, custom)
    pre = precursor_point(precursor_mz, precursor_charge)
    limit = error_limit(tolerance)
    fit = _Fit(a, peaks, charge, limit, doubles)
    readings = list(_READINGS)
    if topology == "cyclic":
        readings = [readings[0], readings[2], readings[1]]
    elif topology == "linear":
        readings = [readings[1], readings[0], readings[2]]
    elif topology is not None:
        raise AnnotateError("topology must be cyclic, linear or left out")
    # the precursor is the heavier end of every one of these distances
    out = []
    for i, p in enumerate(peaks):
        mz = float(p[0])
        raw = (pre["mh1"] - mz) * charge
        for name, off in readings:
            d = raw - off
            if d < MIN_RES:
                continue
            cands = fit.fits(d, pre["mh1"], mz, ppm_digits=2)
            if cands:
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
    limit = error_limit(tolerance)
    # a step against a residue of the structure: the same limit, with ppm of the residue's mass
    tol = lambda mass: limit.window(mass) / 2
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


# --- a sequence the user expects ------------------------------------------------------------------

SEQ_MAX = 60
SHUFFLES = 200
# every chain is returned, up to a bound that keeps the answer small enough for the page
RUNS_SHOWN = 500
ONE_LETTER = {"A": "Ala", "R": "Arg", "N": "Asn", "D": "Asp", "C": "Cys", "Q": "Gln", "E": "Glu",
              "G": "Gly", "H": "His", "I": "Leu/Ile", "L": "Leu/Ile", "K": "Lys", "M": "Met",
              "F": "Phe", "P": "Pro", "S": "Ser", "T": "Thr", "W": "Trp", "Y": "Tyr", "V": "Val"}
ALIASES = {"leu": "Leu/Ile", "ile": "Leu/Ile", "xle": "Leu/Ile"}


def _known_labels(class_name, include, exclude, custom):
    """Every residue a sequence may name: the chosen residues, every residue a set or modification
    can make, and the user's own."""
    known = {**VOCAB, **STANDARD}
    for offered in OFFERED.values():
        for labels in offered.values():
            known.update(labels)
    for s in SETS.values():
        known.update(s)
    known.update(alphabet_for(class_name, include, exclude, custom))
    return known


# a residue with a modification in square brackets: Ser[phospho], S[phospho], Ser[-18.0106]
MODIFIED = re.compile(r"^(.+?)\[([^\[\]]+)\]$")
SHIFT = re.compile(r"^[+-]\d+(\.\d+)?$")


def parse_sequence(text, known):
    """'GVPVWA', 'Gly Val Pro', 'Gly-Val-Dha' or a mix -> [(label, mass)].

    Words are split on spaces and commas. A word that is a residue name is that residue; one joined
    by hyphens is split into the longest names that exist (so 'Ala-Thz' stays whole where it is a
    residue); a word of capital letters is read one letter per residue. Leu and Ile are one residue
    here, Leu/Ile, because their masses are the same.

    A modification goes in square brackets after its residue, by name where the page offers it on
    that residue (Ser[phospho], S[dehydration]) or as a mass shift in Da (Ser[-18.0106], M[+15.9949]).
    """
    if not isinstance(text, str) or not text.strip():
        raise AnnotateError("type the sequence you expect")
    lower = {k.lower(): k for k in known}
    lower.update({a: v for a, v in ALIASES.items() if v in known})
    shifted = {}

    def mass_of(lab):
        return shifted[lab] if lab in shifted else known.get(lab)

    def modified(base, mod):
        hit = lower.get(f"{base}[{mod}]".lower())
        if hit:
            return hit
        if base not in STANDARD and known.get(base) is None:
            raise AnnotateError(f"no mass for {base!r}")
        if SHIFT.fullmatch(mod.strip()):
            shift = float(mod)
            label = f"{base}[{shift:+g}]"
            mass = float(known[base]) + shift
            if mass <= 0:
                raise AnnotateError(f"{label} would weigh {mass:.4f} Da; a residue must weigh more "
                                    f"than nothing")
            shifted[label] = mass
            return label
        offered = sorted({k[len(base) + 1:-1] for k in known if k.startswith(base + "[")})
        on = f"; on {base}: {', '.join(offered)}" if offered else ""
        raise AnnotateError(f"{mod!r} is not a modification this page knows on {base}{on}. Or give "
                            f"its mass shift in Da, e.g. {base}[+15.9949]")

    def name(word):
        hit = lower.get(word.lower())
        if hit:
            return hit
        m = MODIFIED.fullmatch(word)
        if m:
            base = lower.get(m.group(1).lower()) or (
                ONE_LETTER.get(m.group(1)) if len(m.group(1)) == 1 else None)
            if base:
                return modified(base, m.group(2))
        return None

    # names as they are written (Val, Dha), longest first, for words that run residues together
    spelled = {k: k for k in known if len(k) > 1 and "[" not in k}
    spelled.update({a.capitalize(): v for a, v in ALIASES.items() if v in known})
    by_length = sorted(spelled, key=len, reverse=True)

    def letters(word):
        """A word of residues run together, each a one-letter code or a name written as named, each
        with an optional modification: GVPV, GVPVal[methyl], GS[phospho]Dha. Inside such a word a
        name is matched as written, so a run of capitals stays one-letter codes (GVAL is
        Gly-Val-Ala-Leu/Ile)."""
        found, i = [], 0
        while i < len(word):
            hit = next((n for n in by_length if word.startswith(n, i)), None)
            if hit:
                lab, i = spelled[hit], i + len(hit)
            elif word[i] in ONE_LETTER:
                lab, i = ONE_LETTER[word[i]], i + 1
            else:
                raise unknown(word, word[i:])
            if i < len(word) and word[i] == "[":
                close = word.find("]", i)
                if close < 0:
                    raise AnnotateError(f"{word!r}: a '[' is not closed")
                lab, i = modified(lab, word[i + 1:close]), close + 1
            found.append(lab)
        return found

    def unknown(word, rest=None):
        where = f" (could not read {rest!r})" if rest and rest != word else ""
        return AnnotateError(f"{word!r} is not a residue this page knows{where}; use three-letter "
                             f"names or one-letter codes, or add it under Your own residues")

    out = []
    for word in re.split(r"[\s,;]+", text.strip()):
        if not word:
            continue
        whole = name(word)
        if whole:
            out.append(whole)
            continue
        # hyphens join residues, except one inside brackets: Ser[-18.0106]
        parts = [p for p in re.split(r"-(?![^\[]*\])", word) if p]
        if len(parts) > 1:
            k = 0
            while k < len(parts):
                for end in range(len(parts), k, -1):
                    hit = name("-".join(parts[k:end]))
                    if hit:
                        out.append(hit)
                        k = end
                        break
                else:
                    out.extend(letters(parts[k]))
                    k += 1
            continue
        out.extend(letters(word))
    if len(out) < 2:
        raise AnnotateError("the sequence needs at least two residues")
    if len(out) > SEQ_MAX:
        raise AnnotateError(f"{len(out)} residues; at most {SEQ_MAX}")
    missing = [lab for lab in out if lab not in STANDARD and mass_of(lab) is None]
    if missing:
        raise AnnotateError(f"no mass for {missing[0]!r}")
    return [(lab, float(mass_of(lab))) for lab in out]


def sequence_residues(class_name="standard", include=None, exclude=None, custom=None):
    """The modified and own residues a sequence may name, for the page's picker: name and mass."""
    known = _known_labels(class_name, include, exclude, custom)
    return [{"label": lab, "mass": round(float(m), 5)} for lab, m in sorted(known.items())
            if lab not in STANDARD and m is not None]


def _seq_edges(peaks, nodes, labels, z, limit, doubles, pre_node, pre_offsets, pre_mh1):
    """Steps between peaks that one residue of the sequence (or two, across a missing fragment)
    fits. Only the residues in the sequence are tried, so its order does not change these steps,
    and the reorderings of the control are scored on the same steps.

    -> {to_node: [(from_node, kind, key, offset, candidate)]}, kind "one" (key: a label) or "two"
    (key: a sorted pair of labels) or "pre" (to the precursor; key: a label)."""
    masses = sorted({lab: m for lab, m in labels}.items(), key=lambda kv: kv[1])
    fit = _Fit(dict(masses), peaks, z, limit, doubles)
    pairs = []
    if doubles:
        for x in range(len(masses)):
            for y in range(x, len(masses)):
                (l1, m1), (l2, m2) = masses[x], masses[y]
                pairs.append((m1 + m2, tuple(sorted((l1, l2))), ((l1, m1), (l2, m2))))
    edges = {}
    lowest = masses[0][1]
    highest = max([m for _l, m in masses] + [m for m, _k, _p in pairs])
    for a_pos, a in enumerate(nodes):
        mz_a = peaks[a][0]
        for b in nodes[a_pos + 1:]:
            mz_b = peaks[b][0]
            d = (mz_b - mz_a) * z
            t = limit.window(mz_b, z)
            if d < lowest - t:
                continue
            if d > highest + t:
                break
            for lab, m in masses:
                if abs(d - m) <= t:
                    edges.setdefault(b, []).append(
                        (a, "one", lab, 0.0, _candidate(lab, m, d, mz_b, z)))
            for m, key, parts in pairs:
                if abs(d - m) <= t and fit.middle_missing(mz_a, parts, mz_b):
                    edges.setdefault(b, []).append(
                        (a, "two", key, 0.0, _double("+".join(key), m, parts, d, mz_b, z)))
        if pre_node is not None and pre_mh1 > mz_a:
            raw = (pre_mh1 - mz_a) * z
            t = limit.window(pre_mh1, z)
            for off in pre_offsets:
                for lab, m in masses:
                    if abs(raw - off - m) <= t:
                        c = _candidate(lab, m, raw - off, pre_mh1, z, ppm_digits=2)
                        edges.setdefault(pre_node, []).append((a, "pre", lab, off, c))
    return edges


def _runs(order, edges, nodes, cyclic, pre_node):
    """The runs of steps that spell the sequence in its order, read either way along it.

    A run is a chain of peaks whose steps are the residues of a stretch of the sequence one after
    another, in the order of the sequence going up in m/z (as b-ions grow) or against it (as
    y-ions grow). In a cyclic sequence the stretch may run on past the last residue to the first.
    For a linear sequence a step to the precursor must end the stretch where that ion type ends:
    with the C-terminal residue plus water going forward, with the N-terminal residue going back.

    -> best[node][(pos, dir)] = (residues, -jumps, previous state, edge), the longest run ending at
    that peak with its last step covering sequence position pos."""
    n = len(order)
    where = {}
    for p, lab in enumerate(order):
        where.setdefault(lab, []).append(p)

    def step(p, d):
        q = p + d
        if cyclic:
            return q % n
        return q if 0 <= q < n else None

    best = {}
    for b in nodes + ([pre_node] if pre_node is not None else []):
        row = {}
        for a, kind, key, off, cand in edges.get(b, ()):
            prev_row = best.get(a, {})
            for d in (1, -1):
                if kind in ("one", "pre"):
                    for p in where.get(key, ()):
                        if kind == "pre" and not cyclic:
                            if d == 1 and not (p == n - 1 and off == H2O):
                                continue
                            if d == -1 and not (p == 0 and off == 0.0):
                                continue
                        elif kind == "pre" and off != 0.0:
                            continue
                        q = step(p, -d)
                        before = prev_row.get((q, d)) if q is not None else None
                        length = 1 + (before[0] if before else 0)
                        jumps = -(before[1] if before else 0)
                        if length > n:
                            continue
                        val = (length, -jumps, (a, (q, d)) if before else None, (a, kind, key, off, cand), p)
                        if (p, d) not in row or val[:2] > row[(p, d)][:2]:
                            row[(p, d)] = val
                else:
                    for p in range(n):
                        q = step(p, -d)
                        if q is None or tuple(sorted((order[p], order[q]))) != key:
                            continue
                        r = step(q, -d)
                        before = prev_row.get((r, d)) if r is not None else None
                        length = 2 + (before[0] if before else 0)
                        jumps = 1 - (before[1] if before else 0)
                        if length > n:
                            continue
                        val = (length, -jumps, (a, (r, d)) if before else None, (a, kind, key, off, cand), p)
                        if (p, d) not in row or val[:2] > row[(p, d)][:2]:
                            row[(p, d)] = val
        if row:
            best[b] = row
    return best


def _longest(best):
    return max((v[0] for row in best.values() for v in row.values()), default=0)


def _fragment_ions(order, mass, cyclic, z):
    """The ions a sequence gives when it breaks once (linear) or twice (cyclic), each with the
    stretch of the sequence it holds: b-ions of every stretch of a ring, or the b- and y-ions of a
    chain. -> [(m/z, name, [positions])]. Unlike a step, a fragment's mass depends on the order."""
    n = len(order)
    out = []
    if cyclic:
        for s in range(n):
            tot = 0.0
            for length in range(1, n):
                p = (s + length - 1) % n
                tot += mass[order[p]]
                out.append(((tot + z * PROTON) / z, "b",
                            [(s + k) % n for k in range(length)]))
    else:
        for k in range(1, n):
            b = sum(mass[lab] for lab in order[:k])
            y = sum(mass[lab] for lab in order[k:])
            out.append(((b + z * PROTON) / z, f"b{k}", list(range(k))))
            out.append(((y + H2O + z * PROTON) / z, f"y{n - k}", list(range(k, n))))
    return out


def _fragments_seen(mzs, ions, limit):
    """-> {ion index: (peak position in mzs, error in Da)}: every ion with a peak within the limit
    (the closest peak)."""
    seen = {}
    for x, (mz, _name, _pos) in enumerate(ions):
        w = limit.window(mz)
        k = bisect.bisect_left(mzs, mz - w)
        best = None
        while k < len(mzs) and mzs[k] <= mz + w:
            e = mzs[k] - mz
            if best is None or abs(e) < abs(best[1]):
                best = (k, e)
            k += 1
        if best:
            seen[x] = best
    return seen


def _fragment_score(mzs, ions, limit):
    """How many distinct fragment masses of the sequence have a peak (a mass two stretches share
    counts once)."""
    seen = _fragments_seen(mzs, ions, limit)
    return len({round(ions[x][0], 4) for x in seen})


def _distinct_orders(order, cyclic, rng, k, reverse_same=False):
    """Up to k reorderings of the same residues, each counted once and none of them the sequence
    itself. A ring started elsewhere or read the other way round is the same ring here: its pieces
    have the same masses. A linear sequence reversed is a different one (its b- and y-ions differ),
    unless only steps are compared (reverse_same), which read a stretch either way."""
    n = len(order)

    def forms(seq):
        seq = tuple(seq)
        out = {seq, seq[::-1]} if reverse_same else {seq}
        if cyclic:
            for s in range(n):
                rot = seq[s:] + seq[:s]
                out.update({rot, rot[::-1]})
        return out

    same = forms(order)
    seen, found = set(), []
    counts = Counter(order)
    total = math.factorial(n)
    for c in counts.values():
        total //= math.factorial(c)
    if total <= 4 * k:
        # every distinct order, without generating the n! orders of repeated residues
        pool, cur = [], []

        def build():
            if len(cur) == n:
                pool.append(tuple(cur))
                return
            for lab in sorted(counts):
                if counts[lab]:
                    counts[lab] -= 1
                    cur.append(lab)
                    build()
                    cur.pop()
                    counts[lab] += 1

        build()
        rng.shuffle(pool)
    else:
        pool = None
    tries = 0
    while len(found) < k and tries < 50 * k:
        tries += 1
        if pool is not None:
            if not pool:
                break
            cand = pool.pop()
        else:
            cand = list(order)
            rng.shuffle(cand)
            cand = tuple(cand)
        if cand in same:
            continue
        key = min(forms(cand))
        if key in seen:
            continue
        seen.add(key)
        found.append(list(cand))
    return found


def expected_sequence(peaks, sequence, topology="linear", precursor_index=None, precursor_mz=None,
                      precursor_charge=1, class_name="standard", charge=1, include=None,
                      exclude=None, custom=None, tolerance=None, doubles=False, shuffles=SHUFFLES):
    """A sequence the user expects -> the runs of steps in the spectrum that spell it in order.

    Each step is a gap between two peaks that a residue of the sequence fits within the error
    limit. A run is a chain of such steps that follow one another in the sequence. The control asks
    the same of the same residues in other orders: if they make runs as long, the order is not
    what made the run.

    topology "stretch": the sequence is a part of the molecule, of any length, so nothing is
    compared with the precursor and no piece's mass can be worked out (what flanks the stretch is
    unknown); only the steps are searched. "linear" or "cyclic": it is the whole molecule, so its
    mass is checked against the precursor and the peaks that are its pieces test its order.
    """
    if topology not in ("stretch", "linear", "cyclic"):
        raise AnnotateError("say whether the sequence is a stretch, or the whole molecule, "
                            "linear or cyclic")
    whole = topology != "stretch"
    cyclic = topology == "cyclic"
    if not peaks:
        raise AnnotateError("there are no peaks")
    if precursor_index is not None:
        _check_index(peaks, precursor_index)
    limit = error_limit(tolerance)
    known = _known_labels(class_name, include, exclude, custom)
    seq = parse_sequence(sequence, known)
    order = [lab for lab, _m in seq]
    n = len(seq)
    total = sum(m for _l, m in seq)
    expect_neutral = total + (0.0 if cyclic else H2O)

    nodes = [i for i in range(len(peaks)) if i != precursor_index]
    pre = None
    if precursor_mz is not None:
        pre = precursor_point(precursor_mz, precursor_charge)
    # a stretch has no known way to the precursor, so its runs stay among the peaks
    pre_node = (precursor_index if (whole and pre is not None and precursor_index is not None)
                else None)
    pre_offsets = (0.0,) if cyclic else (0.0, H2O)
    edges = _seq_edges(peaks, nodes, seq, charge, limit, doubles, pre_node, pre_offsets,
                       pre["mh1"] if pre else 0.0)
    best = _runs(order, edges, nodes, cyclic, pre_node)

    # every run of two steps or more that no longer run continues, longest first; a single step
    # says nothing about order, so it is not listed (it still counts in the control's scores)
    extended = {v[2] for row in best.values() for v in row.values() if v[2]}
    runs = []
    for b, row in best.items():
        for (p, d), val in row.items():
            if (b, (p, d)) in extended or val[2] is None:
                continue
            chain, state = [], (b, (p, d))
            while state:
                node, key = state
                v = best[node][key]
                chain.append((node, v))
                state = v[2]
            chain.reverse()
            steps = []
            for node, v in chain:
                a, kind, key, off, cand = v[3]
                cover = [v[4]] if kind != "two" else [(v[4] - d) % n if cyclic else v[4] - d, v[4]]
                steps.append({"from": a, "to": node, "kind": kind, "offset": round(off, 5),
                              "positions": cover, "candidate": cand})
            runs.append({"residues": val[0], "jumps": -val[1], "direction": "forward" if d == 1
                         else "backward", "nodes": [steps[0]["from"]] + [s["to"] for s in steps],
                         "steps": steps})
    runs.sort(key=lambda r: (-r["residues"], r["jumps"], r["nodes"]))
    # the same peaks read as another stretch of the sequence (a repeated residue) are one run
    kept, covered = [], []
    for r in runs:
        ns = frozenset(r["nodes"])
        if any(ns <= c for c in covered[:500]):
            continue
        covered.append(ns)
        kept.append(r)
    for r in kept:
        pos = [p for s in r["steps"] for p in s["positions"]]
        r["positions"] = pos
        r["labels"] = [order[p] for p in pos]
        r["to_precursor"] = r["steps"][-1]["kind"] == "pre"
        r["intensity"] = round(sum(peaks[i][1] for i in r["nodes"] if i != precursor_index), 3)
    # the score the control compares: the most residues in one run, a single step included
    longest = _longest(best)

    # bonds between neighbouring residues that a run of two or more residues steps across
    bonds = set()
    for r in kept:
        pos = r["positions"]
        for x, y in zip(pos, pos[1:]):
            bonds.add(tuple(sorted((x, y))) if not (cyclic and {x, y} == {0, n - 1})
                      else (n - 1, 0))
    n_bonds = n if cyclic else n - 1

    # peaks at the mass of a piece of the sequence: these depend on the order, steps do not
    mass = {lab: m for lab, m in seq}
    frag_nodes = sorted(nodes, key=lambda i: peaks[i][0])
    mzs = [peaks[i][0] for i in frag_nodes]
    ions = _fragment_ions(order, mass, cyclic, charge) if whole else []
    seen = _fragments_seen(mzs, ions, limit)
    by_peak = {}
    for x, (k, e) in seen.items():
        mz, name, pos = ions[x]
        i = frag_nodes[k]
        by_peak.setdefault(i, []).append({
            "ion": name, "positions": pos, "labels": [order[p] for p in pos],
            "mz": round(mz, 5), "error_mda": round(e * 1000, 2),
            "error_ppm": round(ppm_of(e, mz), 1)})
    fragments = []
    for i, fits in sorted(by_peak.items(), key=lambda kv: peaks[kv[0]][0]):
        fits.sort(key=lambda f: (len(f["positions"]), abs(f["error_mda"])))
        fragments.append({"peak": i, "mz": peaks[i][0], "intensity": peaks[i][1],
                          "fits": fits})
    frag_score = len({round(ions[x][0], 4) for x in seen})
    frag_peaks = set(by_peak)
    for r in kept:
        r["fragment_nodes"] = [i for i in r["nodes"] if i in frag_peaks]

    seed = sum(ord(ch) * (k + 1) for k, ch in enumerate("|".join(order) + topology))
    rng = random.Random(seed)
    # a stretch is read either way along it, so read backwards it is the same stretch
    others = _distinct_orders(order, cyclic, rng, max(0, int(shuffles)),
                              reverse_same=not whole)
    run_scores = [_longest(_runs(o, edges, nodes, cyclic, pre_node)) for o in others]
    frag_scores = ([_fragment_score(mzs, _fragment_ions(o, mass, cyclic, charge), limit)
                    for o in others] if whole else [])

    def summary(mine, scores):
        if not scores:
            return {"n_orders": 0, "as_high": 0, "higher": 0, "fraction": None, "median": None,
                    "max": None, "yours": mine, "better": []}
        as_high = sum(1 for s in scores if s >= mine)
        # the orders that do better than yours, best first: worth a look, not an answer
        better = sorted(((s, o) for s, o in zip(scores, others) if s > mine),
                        key=lambda so: (-so[0], so[1]))[:3]
        return {"n_orders": len(scores), "as_high": as_high,
                "higher": sum(1 for s in scores if s > mine),
                "fraction": round(as_high / len(scores), 3),
                "median": sorted(scores)[len(scores) // 2], "max": max(scores), "yours": mine,
                "better": [{"order": o, "score": s} for s, o in better]}

    out = {"sequence": [{"label": lab, "mass": round(m, 5)} for lab, m in seq],
           "topology": topology, "n_residues": n, "residue_sum": round(total, 5),
           "neutral_mass": round(expect_neutral, 5) if whole else None, "charge": charge,
           "limit": limit.describe(), "longest": longest,
           # places where the steps spell the whole stretch, every residue in order
           "n_full": sum(1 for r in kept if r["residues"] == n),
           "n_runs": len(kept), "runs": kept[:RUNS_SHOWN],
           "bonds_covered": [list(b) for b in sorted(bonds)], "n_bonds": n_bonds,
           "n_fragment_masses": len({round(mz, 4) for mz, _n, _p in ions}),
           "fragments_seen": frag_score, "fragments": fragments,
           "control": {"fragments": summary(frag_score, frag_scores) if whole else None,
                       "runs": summary(longest, run_scores)},
           "precursor": None, "rest_of_molecule": None}
    if pre is not None and not whole:
        # what the precursor leaves for the rest of the molecule: information, not a check
        out["rest_of_molecule"] = round(pre["neutral"] - total, 5)
    if pre is not None and whole:
        err = pre["neutral"] - expect_neutral
        ref = pre["mh1"]
        w = limit.window(ref)
        hint = None
        if abs(err) > w:
            # a difference the page can name: one water is the other topology
            for off, why in ((-H2O, "one water less than a linear peptide: is it cyclic?"),
                             (H2O, "one water more than a ring: is it linear?"),
                             (PROTON, "one proton: is the precursor stored as the neutral "
                                      "mass?")):
                if abs(err - off) <= w:
                    hint = why
                    break
        out["precursor"] = {"measured_neutral": pre["neutral"], "error_mda": round(err * 1000, 2),
                            "error_ppm": round(ppm_of(err, ref), 2),
                            "within": abs(err) <= w, "hint": hint,
                            "in_runs": pre_node is not None}
    return out


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

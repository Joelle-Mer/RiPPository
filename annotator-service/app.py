"""HTTP service behind the RiPP annotator page.

This file checks what comes in and shapes what goes out; the mass arithmetic is in annotate_core.py.

Nothing is stored. An upload is parsed in memory and never written to disk, and peaks travel with
each request, so the service holds no state between calls.
"""
import json
import os
import re
import urllib.request
from typing import Annotated

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

import annotate_core as core

MAX_UPLOAD_BYTES = 64 * 1024 * 1024
MAX_PEAKS = 2000
MAX_CHARGE = 3
RIPPOSITORY_API = os.environ.get("RIPPOSITORY_API",
                                 "https://rippository.bioinformatics.nl/api").rstrip("/")
ACCESSION = re.compile(r"[A-Z0-9-]{3,40}")
# the site's own spectral search (similarity-service), which scores every record by modified cosine
SIMILARITY_URL = os.environ.get("SIMILARITY_SERVICE_URL",
                                "https://rippository.bioinformatics.nl/similarity").rstrip("/")
SIMILAR_SHOWN = 10        # records returned with their peaks, for the mirror plot
PAIR_TOLERANCE = 0.1      # Da, the search's own matching tolerance

app = FastAPI(title="RiPP annotator service", root_path=os.environ.get("ROOT_PATH", ""))


@app.exception_handler(core.AnnotateError)
def bad_request(_request, err):
    return JSONResponse(status_code=422, content={"detail": str(err)})


Peak = tuple[
    Annotated[float, Field(gt=0, allow_inf_nan=False)],
    Annotated[float, Field(ge=0, allow_inf_nan=False)],
]

# one class or group, or several at once; the API unions their residues and refuses past its limit
ClassName = (Annotated[str, Field(max_length=64)]
             | Annotated[list[Annotated[str, Field(max_length=64)]], Field(min_length=1, max_length=12)])


class Query(BaseModel):
    """What every call shares: the spectrum, in the order it was read, and the residue choice."""

    # one more than a spectrum can hold, because the page adds the precursor as a point
    peaks: list[Peak] = Field(min_length=1, max_length=MAX_PEAKS + 1)
    class_name: ClassName = "standard"
    charge: int = Field(default=1, ge=1, le=MAX_CHARGE)
    include: list[str] = Field(default_factory=list, max_length=200)
    exclude: list[str] = Field(default_factory=list, max_length=200)
    custom: list[dict] = Field(default_factory=list, max_length=50)
    tolerance: dict | None = None
    # also read a gap as two residues where the fragment between them is missing
    doubles: bool = False

    @field_validator("peaks")
    @classmethod
    def keep_api_order(cls, peaks):
        # every index in the API refers to this order, so a reordered list would silently misread
        if any(a[0] > b[0] for a, b in zip(peaks, peaks[1:])):
            raise ValueError("peaks must stay in the m/z order they were read in")
        return peaks

    def alphabet_args(self):
        # unknown classes and `include` labels are refused by alphabet_for; an unknown `exclude` here
        have = core.alphabet_for(self.class_name, self.include, custom=self.custom)
        unknown = [lab for lab in self.exclude if lab not in have]
        if unknown:
            raise HTTPException(422, f"unknown residue labels: {unknown}")
        return {"class_name": self.class_name, "charge": self.charge, "include": self.include,
                "exclude": self.exclude, "custom": self.custom, "tolerance": self.tolerance,
                "doubles": self.doubles}


class Pair(Query):
    i: int
    j: int


class One(Query):
    i: int


class Picks(Query):
    picks: list[int] = Field(max_length=MAX_PEAKS + 1)


class PrecursorQuery(Query):
    precursor_index: int
    precursor_mz: float = Field(gt=0, allow_inf_nan=False)
    precursor_charge: int = Field(default=1, ge=1, le=MAX_CHARGE)


class KnownComparison(BaseModel):
    steps: list[dict] = Field(min_length=1, max_length=200)
    known: dict
    class_name: ClassName = "standard"
    include: list[str] = Field(default_factory=list, max_length=200)
    exclude: list[str] = Field(default_factory=list, max_length=200)
    custom: list[dict] = Field(default_factory=list, max_length=50)
    tolerance: dict | None = None


class CustomPreview(BaseModel):
    custom: list[dict] = Field(max_length=50)
    class_name: ClassName = "standard"
    include: list[str] = Field(default_factory=list, max_length=200)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/meta")
def meta():
    return {"classes": core.CLASSES, "tolerance": core.TOLERANCE, "max_peaks": MAX_PEAKS,
            "max_upload_bytes": MAX_UPLOAD_BYTES}


@app.get("/alphabet")
def alphabet(class_name: str = "standard"):
    return core.alphabet_for(class_name)


@app.post("/custom-residues")
def custom_residues(q: CustomPreview):
    """What a custom entry will create, so a bad one is refused before it reaches a query."""
    return core.custom_residues(q.custom, q.class_name, q.include)


def spectra_from_mgf(body):
    """The upload is read in memory; nothing is written to disk."""
    try:
        found = core.read_spectra(body.decode("utf-8", errors="replace"), max_peaks=MAX_PEAKS)
    except (ValueError, KeyError, IndexError) as err:
        raise HTTPException(422, f"could not read this mgf: {err}") from err
    return {"spectra": found}


@app.post("/spectra")
async def spectra(request: Request):
    """The request body is the mgf itself. The client's file name is never used."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file is larger than this service accepts")
    body = await request.body()
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file is larger than this service accepts")
    return spectra_from_mgf(body)



class PeakText(BaseModel):
    text: str = Field(min_length=1, max_length=400_000)
    precursor_mz: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    charge: int = Field(default=1, ge=1, le=MAX_CHARGE)


PEAK_LINE = re.compile(r"^\s*([0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)[\s,;:]+"
                       r"([0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*$")


@app.post("/peak-list")
def peak_list(q: PeakText):
    """A pasted peak list, one 'm/z intensity' pair per line, read the way an upload is.

    The text becomes a one-spectrum mgf and takes the upload's path; this only checks that each
    line holds two numbers. Blank lines and lines starting with # are skipped.
    """
    peaks, bad = [], []
    for n, line in enumerate(q.text.splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = PEAK_LINE.match(line)
        if not match:
            bad.append(n)
            continue
        peaks.append((match.group(1), match.group(2)))
    if bad:
        shown = ", ".join(str(n) for n in bad[:5]) + (" and more" if len(bad) > 5 else "")
        raise HTTPException(422, f"line {shown} is not an m/z and an intensity")
    if not peaks:
        raise HTTPException(422, "no peaks found; write one m/z and one intensity per line")
    if len(peaks) > MAX_PEAKS:
        raise HTTPException(422, f"{len(peaks)} peaks; at most {MAX_PEAKS}")
    lines = ["BEGIN IONS", "NAME=Pasted peak list"]
    if q.precursor_mz:
        lines += [f"PEPMASS={q.precursor_mz}", f"CHARGE={q.charge}+"]
    lines += [f"{mz} {intensity}" for mz, intensity in peaks] + ["END IONS"]
    return spectra_from_mgf("\n".join(lines).encode("utf-8"))

def from_rippository(path):
    try:
        with urllib.request.urlopen(RIPPOSITORY_API + path, timeout=20) as reply:
            return json.load(reply)
    except (OSError, ValueError) as err:
        raise HTTPException(502, "RiPPository could not be reached") from err


def record_precursor(record):
    """The precursor of a database record, from its neutral mass and precursor type.

    Records store no m/z, so it is worked out from the mass and checked against the formula. If
    the check fails, the example loads without a precursor and the page says why.
    """
    compound = record.get("compound") or {}
    ions = (record.get("mass_spectrometry") or {}).get("focused_ion") or []
    kind = next((i["value"] for i in ions if i.get("subtag") == "PRECURSOR_TYPE"), "")
    if not compound.get("mass") or not kind:
        return None, "the record gives no precursor type or mass"
    try:
        return core.precursor_from_mass(compound["mass"], kind, compound.get("formula")), None
    except core.AnnotateError as err:
        return None, str(err)


def record_to_mgf(record, precursor):
    """A database record as the mgf the rest of the page reads, so it takes the upload's path."""
    compound = record.get("compound") or {}
    names = compound.get("names") or [record.get("accession", "")]
    classes = compound.get("classes") or [""]
    lines = ["BEGIN IONS", f"NAME={names[0]}", f"COMPOUND_CLASS={classes[0]}",
             f"SMILES={compound.get('smiles') or ''}", f"FORMULA={compound.get('formula') or ''}"]
    if precursor:
        lines.append(f"PEPMASS={precursor['precursor_mz']}")
        lines.append(f"CHARGE={precursor['charge']}+")
    for peak in record["peak"]["peak"]["values"]:
        lines.append(f"{peak['mz']} {peak['intensity']}")
    lines.append("END IONS")
    return "\n".join(lines).encode("utf-8")


@app.get("/examples")
def examples():
    """What the online database holds, for the page's example list."""
    hits = from_rippository("/records/search").get("data") or []
    found = []
    for hit in hits:
        record = from_rippository(f"/records/{hit['accession']}/simple")
        found.append({"accession": hit["accession"], "title": record.get("title") or ""})
    return found


@app.post("/examples/{accession}")
def example(accession: str):
    if not ACCESSION.fullmatch(accession):
        raise HTTPException(422, "that is not a RiPPository accession")
    record = from_rippository(f"/records/{accession}")
    precursor, problem = record_precursor(record)
    found = spectra_from_mgf(record_to_mgf(record, precursor))
    for spectrum in found["spectra"]:
        spectrum["precursor_source"] = {"derived": precursor, "problem": problem}
        # the structure cut into residues ahead of time, for the comparison with saved chains
        spectrum["known"] = core.known_structure(accession)
    return found


class SimilarQuery(BaseModel):
    peaks: list[Peak] = Field(min_length=1, max_length=MAX_PEAKS)
    precursor_mz: float | None = Field(default=None, gt=0, allow_inf_nan=False)


def stored_precursor(record):
    """The precursor m/z a record states, if it states one (MS$FOCUSED_ION: PRECURSOR_M/Z)."""
    ions = (record.get("mass_spectrometry") or {}).get("focused_ion") or []
    value = next((i["value"] for i in ions if i.get("subtag") in ("PRECURSOR_M/Z", "PRECURSOR_MZ")),
                 None)
    try:
        return float(str(value).split()[0]) if value else None
    except ValueError:
        return None


def matched_pairs(query, ref, shift):
    """Peaks paired for the mirror plot: directly, or shifted by the precursor difference, within
    the search's tolerance; strongest pairs first, each peak used once."""
    options = []
    for qi, (qmz, qint) in enumerate(query):
        for ri, (rmz, rint) in enumerate(ref):
            if abs(qmz - rmz) <= PAIR_TOLERANCE:
                options.append((qint * rint, qi, ri, False))
            elif shift is not None and abs(qmz - rmz - shift) <= PAIR_TOLERANCE:
                options.append((qint * rint, qi, ri, True))
    used_q, used_r, pairs = set(), set(), []
    for _w, qi, ri, shifted in sorted(options, reverse=True):
        if qi not in used_q and ri not in used_r:
            used_q.add(qi)
            used_r.add(ri)
            pairs.append({"query_index": qi, "ref_index": ri, "shifted": shifted})
    return pairs


def similarity_search(peaks, precursor_mz):
    body = {"peak_list": [{"mz": m, "intensity": i} for m, i in peaks]}
    if precursor_mz:
        body["precursor_mz"] = precursor_mz
    request = urllib.request.Request(SIMILARITY_URL + "/similarity", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=60) as reply:
            return json.load(reply).get("similarity_score_list") or []
    except (OSError, ValueError) as err:
        raise HTTPException(502, "the spectral search could not be reached") from err


@app.post("/similar")
def similar(q: SimilarQuery):
    """The closest records in the database, from the site's own spectral search, best first, each
    with its peaks and the peaks the two spectra share, for a mirror plot. A rank, not an identity."""
    scores = similarity_search(q.peaks, q.precursor_mz)
    results = []
    for hit in scores[:SIMILAR_SHOWN]:
        record = from_rippository(f"/records/{hit['accession']}")
        names = (record.get("compound") or {}).get("names") or [hit["accession"]]
        ref_peaks = [[p["mz"], p["intensity"]] for p in record["peak"]["peak"]["values"]]
        ref_pre = stored_precursor(record)
        if ref_pre is None:
            derived, _problem = record_precursor(record)
            ref_pre = derived["precursor_mz"] if derived else None
        shift = (q.precursor_mz - ref_pre) if (q.precursor_mz and ref_pre) else None
        pairs = matched_pairs(q.peaks, ref_peaks, shift)
        results.append({"accession": hit["accession"], "name": names[0],
                        "score": round(float(hit["similarity_score"]), 4),
                        "ref_precursor": ref_pre, "ref_peaks": ref_peaks,
                        "matched_pairs": pairs, "n_matched": len(pairs),
                        "n_matched_shifted": sum(1 for x in pairs if x["shifted"]),
                        "n_query_peaks": len(q.peaks),
                        "precursor_shift": round(shift, 4) if shift is not None else None,
                        "tolerance": PAIR_TOLERANCE})
    return {"results": results, "n_scored": len(scores),
            "method": "modified cosine" if q.precursor_mz else "cosine"}


@app.post("/gap")
def gap(q: Pair):
    return core.gap(q.peaks, q.i, q.j, **q.alphabet_args())


@app.post("/connect")
def connect(q: Pair):
    return core.connect(q.peaks, q.i, q.j, **q.alphabet_args())


@app.post("/neighbours")
def neighbours(q: One):
    """Every peak one residue from peak i, closest fit first rather than in order of gap."""
    res = core.neighbours(q.peaks, q.i, **q.alphabet_args())
    res["neighbours"].sort(key=lambda n: abs(n["candidates"][0]["error_mda"]))
    return res


@app.post("/precursor-gaps")
def precursor_gaps(q: PrecursorQuery):
    """Every peak that reaches the precursor by one residue, under each named ion-type reading.

    The precursor is listed among the peaks only so the page can select it. A distance to it is not
    a gap between two peaks, so it is measured under each reading, never as a plain gap.
    """
    res = core.precursor_neighbours(q.peaks, q.precursor_mz, q.precursor_charge,
                                   **q.alphabet_args())
    grouped = {}
    for match in res["matches"]:
        if match["peak"] != q.precursor_index:
            grouped.setdefault(match["peak"], []).append(match)
    return {"precursor": res["precursor"],
            "matches": [{"peak": peak, "hypotheses": readings}
                        for peak, readings in grouped.items()]}


@app.post("/compare-known")
def compare_known(q: KnownComparison):
    """A saved chain against the known compound, matched by mass."""
    return core.compare_to_known(q.steps, q.known, tolerance=q.tolerance, class_name=q.class_name,
                                include=q.include, exclude=q.exclude, custom=q.custom)


@app.post("/links")
def links(q: Picks):
    """Every pair of picked peaks one residue apart, neighbouring in m/z or not."""
    args = q.alphabet_args()
    chosen = set(q.picks)
    found = []
    for i in sorted(chosen):
        for n in core.neighbours(q.peaks, i, direction="up", **args)["neighbours"]:
            if n["peak"] in chosen:
                found.append({"from": i, "to": n["peak"], "gap": n["gap"],
                              "candidates": n["candidates"]})
    return found

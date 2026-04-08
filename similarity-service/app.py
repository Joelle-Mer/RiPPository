import logging
import os
import pathlib
from contextlib import asynccontextmanager
from typing import List, Optional

import numpy as np
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from matchms import Spectrum, calculate_scores
from matchms.importing import load_from_massbank
from matchms.similarity import ModifiedCosine
from pydantic import BaseModel

VERSION = "modified-cosine-similarity-api 0.1"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

spectra_dict: dict[str, Spectrum] = {}


def load_all_spectra() -> None:
    data_dir = os.getenv("DATA_DIR", "/MassBank-data")
    count = 0
    for txt_file in pathlib.Path(data_dir).rglob("*.txt"):
        try:
            for spec in load_from_massbank(str(txt_file)):
                accession = spec.metadata.get("accession")
                if accession:
                    spectra_dict[accession] = spec
                    count += 1
        except Exception as e:
            logger.warning(f"Failed to load {txt_file}: {e}")
    logger.info(f"Loaded {count} spectra from {data_dir}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_all_spectra()
    yield


context_path = os.getenv("CONTEXT_PATH", "")
app = FastAPI(lifespan=lifespan)


class Peak(BaseModel):
    mz: float
    intensity: float


class SimilarityRequest(BaseModel):
    peak_list: List[Peak]
    precursor_mz: Optional[float] = None
    reference_spectra_list: Optional[List[str]] = []


@app.post(f"{context_path}/similarity")
def compute_similarity(request: SimilarityRequest):
    mzs = np.array([p.mz for p in request.peak_list], dtype=float)
    intensities = np.array([p.intensity for p in request.peak_list], dtype=float)

    metadata = {}
    if request.precursor_mz is not None and request.precursor_mz > 0:
        metadata["precursor_mz"] = request.precursor_mz

    query = Spectrum(mz=mzs, intensities=intensities, metadata=metadata)

    if request.reference_spectra_list:
        refs = [spectra_dict[a] for a in request.reference_spectra_list if a in spectra_dict]
    else:
        refs = list(spectra_dict.values())

    if not refs:
        return {"similarity_score_list": []}

    scores = calculate_scores(refs, [query], ModifiedCosine(tolerance=0.1))
    matches = scores.scores_by_query(query, "ModifiedCosine_score", sort=True)

    result = []
    for ref, score, _ in matches:
        accession = ref.metadata.get("accession")
        if accession and float(score) > 0:
            result.append({"accession": accession, "similarity_score": float(score)})

    return {"similarity_score_list": result}


@app.get(f"{context_path}/version", response_class=PlainTextResponse)
def get_version():
    return VERSION

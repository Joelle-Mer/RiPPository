# Annotator service

The HTTP service behind the RiPP annotator page (`/annotate`). Nothing is stored: an upload is
parsed in memory, and peaks travel with each request.

- `annotate_core.py`: the mass arithmetic. Which residues fit the gap between two peaks, the peaks
  one residue away, the chains between two peaks, the distance to the precursor, and a saved chain
  against a database record's structure.
- `data/residues.json`: the residue tables (the standard residues, and what each RiPP class or kind
  of modification adds) and the default tolerance.
- `data/known_structures.json`: each database record's structure cut into residues, for the
  comparison with saved chains. A record that is not in it loads without that comparison.

## Build

`docker compose build annotator-service`. The build stops if a table is missing.

The page reaches the service at `/annotate-api/`; both nginx configs in `compose/` route that path
here and strip the prefix. If the site runs under a base URL, the path is `<base>/annotate-api/`.

## Tests

    pip install -r requirements-test.txt
    python -m pytest test_app.py

Tests that need a real mgf read the file named in `ANNOTATOR_TEST_MGF`, and skip without it.

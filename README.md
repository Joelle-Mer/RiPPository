# RiPPository

RiPPository is an open-source spectral library dedicated to the identification of ribosomally synthesized and post-translationally modified peptides (RiPPs). It provides a curated collection of high-resolution mass spectrometry data for RiPP natural products, enabling systematic dereplication and discovery of novel bioactive peptides.

RiPPository is developed and maintained at Leiden University and Wageningen University & Research.

**GitHub:** https://github.com/Joelle-Mer/RiPPository

## Contact

**Joelle Mergola Greef**
Leiden University / Wageningen University & Research
- mergolagreefj@vuw.leidenuniv.nl
- joelle.mergolagreef@wur.nl

For bug reports and data issues, please use the [GitHub issue tracker](https://github.com/Joelle-Mer/RiPPository/issues).

## Origin

RiPPository is built on the [MassBank](https://massbank.eu) platform and derived from the [MassBank-web](https://github.com/MassBank/MassBank-web) open-source project (GNU GPL v2). It extends the MassBank infrastructure with RiPP-specific features including biosynthetic gene cluster (BGC) metadata and MiBIG integration.

## Citation

If you use RiPPository in your research, please cite:

> Mergola Greef, J. RiPPository: an open-access spectral library for ribosomally synthesized and post-translationally modified peptides (RiPPs). Leiden University & Wageningen University & Research. https://github.com/Joelle-Mer/RiPPository

## Development Setup

> **Note:** A production-ready Docker deployment with a public data release is not yet available. The instructions below are for local development.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js](https://nodejs.org/) (v18 or later) for frontend development
- [Go](https://go.dev/) (v1.23 or later) for backend development

### Running locally

Clone the repository:

    git clone https://github.com/Joelle-Mer/RiPPository.git
    cd RiPPository

Copy the environment template:

    cd compose && cp env.dist .env

Edit `.env` to set `MB_DATA_DIRECTORY` to a local folder containing your RiPP record `.txt` files, and set `MB_DB_INIT=true` on first run.

Start the backend services:

    docker compose up -d

The API will be available at `http://localhost:8081/RiPPository-api`.

#### Frontend (development mode)

    cd web-frontend
    cp .env.local.example .env.local  # or edit .env.local manually
    npm install
    npm run dev

The frontend will be available at `http://localhost:3000/RiPPository`.

#### Frontend (production build)

    cd web-frontend
    npm run build
    npm run start

## Frontend

The frontend is accessible at `http://localhost:8080/RiPPository` by default when running via Docker Compose.

## License

Spectral records are released under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) unless otherwise stated. Source code is licensed under the GNU General Public License v2, inherited from MassBank-web.

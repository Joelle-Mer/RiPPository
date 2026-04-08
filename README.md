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

## Installation

There are currently two ways to run RiPPository:

1. Docker Compose
2. Kubernetes/Helm Charts

### Docker Compose

Make sure that Docker and Docker Compose are installed and ready to use.

Clone the repository:

    git clone https://github.com/Joelle-Mer/RiPPository.git

The directory _compose_ contains the _env.dist_ file which serves as a template for environment variables. Copy it to _.env_:

    cd RiPPository/compose && cp env.dist .env

Download the latest RiPPository data release and place it in the data directory:

    mkdir ../data && wget https://github.com/Joelle-Mer/RiPPository/releases/latest/download/data.tar.gz && tar -xf data.tar.gz -C ../data/ && rm data.tar.gz

Start the system:

    docker compose up -d

> **Note:** On first start, the property _MB_DB_INIT_ is set to _true_. Change it to _false_ after the database has been populated.

Stop the system:

    docker compose down

### Kubernetes/Helm Charts

A description is available at https://github.com/MassBank/MassBank-charts.

## Frontend

The frontend is accessible at http://localhost:8080/RiPPository by default.

## License

Spectral records are released under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) unless otherwise stated. Source code is licensed under the GNU General Public License v2, inherited from MassBank-web.

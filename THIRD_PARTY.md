# Third-party boundaries

The original code in this repository orchestrates separately obtained components. It does not relicense them.

- OpenMRS deployments use upstream container images and retain OpenMRS licensing and notices.
- OpenCR, HAPI FHIR, OpenSearch, PostgreSQL and other container components retain their upstream licensing and notices.
- npm dependencies are identified in package.json and package-lock.json and retain their respective licenses.
- Meta API access and model usage remain subject to Meta's applicable terms. Model weights are not distributed here.
- ComEMR 3.0.0 is an external private dependency for optional local integration; its source, images and database are not supplied or licensed by this repository.

Before a formal release, pin and inventory third-party image/package versions and review their distribution obligations. A license selected for the project's original code does not override upstream terms or establish rights to private supplier code.

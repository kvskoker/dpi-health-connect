# DPI Health Connect

Hackathon workspace created 26 October 2026. Status: the first connector backend is implemented and tested. OpenMRS deployments are being initialized; real EMR delivery and live Meta inference must be verified separately before being claimed complete.

Kenneth confirmed the direction on 26 October: build on existing open-source technologies to make health interoperability easier to set up and deploy, with AI-assisted integration maintenance as the distinguishing feature.

ComEMR 3.0.0 remains private and external to this repository. The public judging setup will use an independently implemented community API simulator. A configurable connector will also target Kenneth's local Docker deployment of ComEMR. Compatibility claims will be limited to the endpoints and behaviors verified by shared contract tests; no private ComEMR source or container image is included.

Build a working interoperability proof for Sierra Leone: a community assessment follows Aminata through a PHU and hospital, using shared identity and a longitudinal record. A Meta-powered mapping assistant helps onboard changing application formats through reviewed, validated mappings.

## Project documents

- [Run the implementation](docs/RUNNING.md): local API, Docker services, tests, repeatable scenario and current limitations.

- [Build plan](docs/BUILD-PLAN.md): scope, architecture, implementation sequence, acceptance tests and demonstration.
- [Rules and submission checklist](docs/RULES-AND-SUBMISSION.md): verified requirements, unresolved participant rules, evidence and submission tasks.
- [Delivery backlog](docs/BACKLOG.md): ordered work with measurable completion criteria.

The DPI-H workshop established an architectural blueprint and patient journey through a concept demo in `../dpi-h-journey-demo`. It captured no real patient data in ComEMR and implemented no exchange with another application. It provides problem context and design reference for the hackathon. The new contribution is the functioning interoperability implementation and its evaluation. Record any reused presentation assets or code separately from new development, in accordance with organizer rules.

## Implemented first increment

The `src/` backend provides an independent synthetic assessment endpoint, constrained mappings, content-hash approvals tied to passing validation, PostgreSQL event/resource persistence, an outbox with retry, audit records and replay. Tests cover schema drift, invalid units, approval bypass, concurrent duplicate submission, payload conflicts, restart persistence and receiver failure. A real Meta proposal endpoint is implemented but requires a configured API key; it never substitutes a fake model response. The current repeatable repair demonstration uses a manually authored mapping and is labeled accordingly.

This increment is a blood-pressure exchange slice. It is not yet the full registry, referral, longitudinal record or national dashboard stack. The first OpenMRS adapter is restricted to synthetic patient and BP observations; field compatibility with ComEMR is not yet established.

## Planned repository structure

```text
apps/console/                 live journey, integration workbench and dashboards
services/core/               HIE routing, registries, referral state and audit APIs
services/worker/             reliable delivery, retries and aggregation
packages/contracts/         event schemas, FHIR profiles and API contracts
packages/connectors/        ComEMR, OpenMRS and DHIS2 adapters
packages/meta/              model gateway and mapping assistant
infra/                     containers and local configuration
fixtures/                  synthetic patients, schemas and code systems
evals/                     held-out mapping cases and scoring
tests/                     integration, failure and browser tests
evidence/                  measured runs and submission evidence
docs/                      build plan and decisions
```

Use synthetic patient data only. Configure credentials locally in ignored environment files; never place credentials in browser code, fixtures or model prompts.

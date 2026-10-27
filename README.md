# DPI Health Connect

An interoperability proof of concept for Sierra Leone: connect community and facility systems through an HIE, link patient identity, preserve a longitudinal record, and use Meta models to propose repairs when message formats change.

## Implemented

- Independent synthetic community assessment API and constrained blood-pressure mappings.
- Separate PHU and hospital OpenMRS deployments, verified API delivery and referral feedback.
- OpenCR Client Registry and a separate HAPI FHIR Shared Health Record.
- Optional connector to a locally available ComEMR deployment: follow-up delivery and completion readback.
- Muse Spark mapping proposals, deterministic validation, explicit reviewer approval, audit records and duplicate-safe replay.
- Local workbench with assessment repair, connections, exchange monitoring, referrals, shared records and interactive completion repair.

The completion-repair rehearsal deliberately changes a test message envelope; it does not modify ComEMR's actual API. Model proposals do not make clinical decisions. The six-week appointment and the completed integration-rehearsal visit are separate records.

## Run and test

Node.js 22 or later, Docker Compose and PowerShell are used by the local setup. Copy `.env.example` to `.env` and configure fresh local credentials. Never commit `.env`.

```powershell
npm ci
npm run typecheck
npm test
```

Follow [the running guide](docs/RUNNING.md) for services and metadata setup. Once the stack is running, `./Open-Workbench.ps1` opens the workbench at http://127.0.0.1:4310/.

- [Registry and shared-record architecture](docs/REGISTRY-AND-SHR.md)
- [ComEMR follow-up and interactive completion repair](docs/COMEMR-FOLLOWUP.md)
- [Build plan](docs/BUILD-PLAN.md)
- [Rules and submission checklist](docs/RULES-AND-SUBMISSION.md)
- [Backlog](docs/BACKLOG.md)

## Public project boundary

This repository contains independently written hackathon code, test fixtures, deployment configuration and documentation. ComEMR 3.0.0 source, images and local databases are not included. The optional ComEMR connector requires separately authorized access. Its contract coverage is limited to the interfaces tested locally.

The public synthetic assessment simulator is available without ComEMR. A full public simulator for ComEMR follow-up creation/completion has not yet been implemented, so that portion of the demonstration currently requires the private local installation. Local journey scripts also have ordered prerequisites and some reference recorded demo IDs; they are not yet a clean-clone, one-command judging setup.

All demonstrations use synthetic data. Local credentials, certificates, linkage files, receiver evidence and screenshots are excluded from Git. Run `npm run check:public` before publishing; inspect the staged diff as well.

The earlier DPI-H workshop was a concept demonstration and architectural blueprint. This repository is the functioning interoperability implementation begun in October 2026. It is a development proof of concept, not a production national health platform.

## Licensing

The original project code is offered under the [MIT License](LICENSE). Third-party systems and packages retain their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md). ComEMR is excluded from this grant.

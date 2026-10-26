# Running the connector foundation

This first implementation is an authenticated local API, not the finished visual application. The community assessment endpoint is an independently designed simulator contract. It has not been certified as ComEMR-compatible. Mapping approval, event capture, local resource persistence and outgoing delivery state use PostgreSQL. The local resource table is a development projection, not the planned full Shared Health Record or a general FHIR server.

## Local configuration

Install Node.js 22 or later and Docker Desktop with Linux containers. Run commands from the hackathon project folder. Copy `.env.example` to `.env` only on a fresh setup; preserve an existing `.env`. Generate a random database password and API token, update DATABASE_URL consistently, then run:

```powershell
npm.cmd ci
docker compose up -d postgres
npm.cmd run dev
```

The native API listens at `http://127.0.0.1:4300`. `GET /health` is public and reports readiness configuration only. All other endpoints require `Authorization: Bearer <API_TOKEN>`. Keep the token local. The current local pilot uses one operator token; facility-scoped users and approval roles are later work.

For a containerized API, use `docker compose up -d --build`. Its host port is 4310, with PostgreSQL isolated in the hackathon Compose network. Existing ComEMR services and databases are not part of this project.

## Checks and repeatable scenario

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:integration
npm.cmd run demo
```

The integration check creates and removes only a uniquely named test schema. It uses a labeled HTTP test double for delivery failures and readback; passing it does not prove OpenMRS compatibility. The demo script exercises the running API with new synthetic event IDs. It submits an assessment, proves duplicate handling, introduces schema drift, approves a manually authored correction and replays the rejected event. It does not pretend the scripted correction came from Meta.

## API workflow

1. `GET /fixtures` retrieves the public synthetic example and initial mapping.
2. `POST /mappings` saves an immutable mapping identified by its content hash.
3. `POST /mappings/{id}/validate` accepts independent input/expected-output cases and returns a validation ID.
4. `POST /mappings/{id}/approve` requires a passing validation for the same mapping and an operator name.
5. `POST /simulator/assessments` accepts sourceEventId, sourceVersion, mappingId and payload.
6. `GET /events`, `/records` and `/audit` inspect persisted results and trace entries.
7. `POST /events/{id}/replay` uses an approved mapping to retry a quarantined event.

Supported transformations are deliberately limited: copy, strict numeric conversion and explicit systolic/diastolic splitting. Missing units, missing fields and unsupported transforms are rejected. The current identity key is namespaced per source, not yet a cross-system matching registry.

## Meta proposals

Set MODEL_API_KEY locally and restart the API. `POST /meta/propose-mapping` accepts sourceSystem (`community-simulator` for this pilot), sourceVersion, sourceSchema, syntheticExample and syntheticDataConfirmed=true. Only send synthetic data. The endpoint makes a real Meta call and returns a proposal or questions plus model/usage metadata. It never approves or activates a mapping. The endpoint reports a configuration error when the key is absent.

The first implementation is one bounded proposal request with constrained parsing. The planned tool-driven inspect/validate/revise loop, cumulative spend cap and comparative evaluation are not implemented yet. Limit calls manually until the spend budget is enforced. Credentials are never returned by the API.

## OpenMRS deployments

```powershell
docker compose -p dpi-h-phu --env-file .env -f infra/openmrs.compose.yaml up -d
$env:EMR_PORT='18082'
docker compose -p dpi-h-hospital --env-file .env -f infra/openmrs.compose.yaml up -d
Remove-Item Env:EMR_PORT
```

The PHU is at `http://127.0.0.1:18081/openmrs/spa` and the hospital at `http://127.0.0.1:18082/openmrs/spa`. They share image layers but use different networks, databases and volumes. Initial database and terminology migrations can take several minutes. The release is pinned to OpenMRS reference distribution 3.8.0. The service layout derives from the upstream OpenMRS distribution; this project does not claim authorship of OpenMRS.

Configure OPENMRS_BASE_URL, OPENMRS_USERNAME and OPENMRS_PASSWORD for a local synthetic-only instance. Run `node --env-file=.env --import tsx scripts/openmrs-setup.ts` to create a dedicated synthetic identifier type and resolve numeric BP concepts. Then restart the API. The setup requires exact concept matches and verifies units when supplied. Its first seeded location is a pilot default; deliberate facility configuration is required for the full journey.

For the Docker API, use DOCKER_OPENMRS_BASE_URL with `host.docker.internal` instead of 127.0.0.1. The adapter writes a synthetic patient and two numeric observations using deterministic UUIDs and verifies all records by readback. Missing metadata or differing values fail delivery rather than marking success. The synthetic patient's display name is currently Synthetic Patient; the source identifier remains linked. Full demographics, encounters and referral workflows are not yet implemented.

Only one receiver is active per API process in this milestone. Do not change the configured destination while there are pending events. Multi-destination routing and per-destination receipts are planned. OpenMRS takes precedence over the optional generic FHIR receiver when its settings are supplied. The generic receiver requires transaction support and deterministic PUT identities; this is not a claim of universal FHIR compatibility.

## Prior work and private boundaries

All simulator and connector code in this folder is newly written for the hackathon. The previous workshop animation supplies architectural context only. ComEMR remains outside the public repository, with no copied source, containers, patient data or credentials. Pin and credit third-party dependencies through the package lock and deployment documentation before publication.

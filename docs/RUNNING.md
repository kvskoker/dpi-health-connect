# Running the connector foundation

This implementation includes an authenticated local API and a browser integration workbench. The community assessment endpoint is an independently designed simulator contract. It has not been certified as ComEMR-compatible. Mapping approval, event capture, local resource persistence and outgoing delivery state use PostgreSQL. The local resource table is a development projection, not the planned full Shared Health Record or a general FHIR server.

## Browser workbench

Run `./Open-Workbench.ps1` after starting the Docker stack. It opens `http://127.0.0.1:4310/` using a one-time sign-in link valid for one minute. The browser receives an HttpOnly, SameSite session cookie valid for eight hours; API and Meta keys are not placed in browser storage. Restarting the API expires sessions. Alternatively enter the local API_TOKEN on the sign-in screen (never MODEL_API_KEY). This is a single-operator local pilot, not production role-based authentication.

1. **Mapping & repair:** prepare the known reference mapping, send the changed synthetic assessment, and request one real Meta proposal. Inspect or edit it, validate against two independent expected outputs, enter a reviewer name, approve, then replay. Loading a saved mapping makes no model call. Editing inputs or the mapping invalidates the UI approval gate until revalidation.
2. **Connections:** register an application and its JSON schema, then test a configured local adapter. Tests distinguish reachability from write verification. The currently supported targets are the independent simulator and the two configured OpenMRS deployments. Catalog-only registrations do not activate routes or generate arbitrary connectors; the mapping demonstration currently supports the synthetic BP contract only.
3. **Exchange monitor:** refreshes every five seconds while visible and shows up to 100 recent records, delivery attempts, receiver errors/receipts and audit entries. Inspect a record for its source and canonical values. A held record can be selected for repair after reloading the page. Saved locally is distinct from delivered with readback.

`node --env-file=.env --import tsx scripts/workbench-check.ts` checks access protection, single-use sign-in, cookie flags, write-request protection, registration, configured-target restrictions and logout. It creates a clearly named QA connection; it makes no paid Meta request. Browser verification also exercised real Muse proposal → validation → approval under reviewer `Workbench QA` → replay. This test approval is not a claim that Kenneth personally reviewed it.

## Local configuration

For the complete Docker deployment once `.env` is configured, run `./Start-Stack.ps1`. Use `./Get-StackStatus.ps1` to distinguish a ready JSON API from an OpenMRS initialization screen. `./Start-Stack.ps1 -CoreOnly` starts the HIE, registry and SHR services without starting the separate OpenMRS projects. These scripts do not start, stop or modify the separate ComEMR project.

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

Two scripts exercise the real provider (each makes one paid request): `node --env-file=.env --import tsx scripts/meta-smoke.ts` validates a proposal without activating it; `node --env-file=.env --import tsx scripts/meta-repair-demo.ts` exercises quarantine, proposal, independent validation, an explicitly labeled automated development-test approval and local replay against the Docker API. They save evidence under `evidence/`. Neither script alone proves receiver delivery or human review. The recorded October 26 run used Muse Spark 1.3 and passed; do not rerun merely to inspect existing evidence.

## OpenMRS deployments

```powershell
docker compose -p dpi-h-phu --env-file .env -f infra/openmrs.compose.yaml up -d
$env:EMR_PORT='18082'
docker compose -p dpi-h-hospital --env-file .env -f infra/openmrs.compose.yaml up -d
Remove-Item Env:EMR_PORT
```

The PHU is at `http://127.0.0.1:18081/openmrs/spa` and the hospital at `http://127.0.0.1:18082/openmrs/spa`. They share image layers but use different networks, databases and volumes. Initial database and terminology migrations can take several minutes. The release is pinned to OpenMRS reference distribution 3.8.0. The service layout derives from the upstream OpenMRS distribution; this project does not claim authorship of OpenMRS.

Configure OPENMRS_BASE_URL, OPENMRS_USERNAME and OPENMRS_PASSWORD for a local synthetic-only instance. Once its JSON session endpoint is ready, run `node --env-file=.env --import tsx scripts/openmrs-setup.ts` to create a dedicated synthetic identifier type and resolve numeric BP concepts. It finds or creates the facility specified by OPENMRS_FACILITY_NAME (default Binkolo CHC). Then restart the Docker API with `docker compose up -d core`. The setup requires exact concept matches and verifies units when supplied. Run `node --env-file=.env --import tsx scripts/verify-openmrs.ts` to check the recorded Meta repair event against the real receiver; this makes no Meta call.

For the Docker API, use DOCKER_OPENMRS_BASE_URL with `host.docker.internal` instead of 127.0.0.1. The adapter writes a synthetic patient and two numeric observations using deterministic UUIDs and verifies all records by readback. Missing metadata or differing values fail delivery rather than marking success. The synthetic patient's display name is currently Synthetic Patient; the source identifier remains linked. Full demographics, encounters and referral workflows are not yet implemented.

The assessment outbox targets the PHU; a separate referral queue targets the hospital and stores its own delivery receipt. Do not change either configured destination while records are pending. General dynamic multi-destination routing is not implemented. OpenMRS takes precedence over the optional generic FHIR receiver when its settings are supplied. The generic receiver requires transaction support and deterministic PUT identities; this is not a claim of universal FHIR compatibility.

## Prior work and private boundaries

All simulator and connector code in this folder is newly written for the hackathon. The previous workshop animation supplies architectural context only. ComEMR remains outside the public repository, with no copied source, containers, patient data or credentials. Pin and credit third-party dependencies through the package lock and deployment documentation before publication.

## Verified PHU delivery — October 26

The Meta-repaired event reached the real PHU OpenMRS instance. Independent readback checked its linked patient identifier, BP 160/106 mmHg, observation timestamp and Binkolo CHC location. Repeating delivery reused the same patient and observation UUIDs. Evidence is in `evidence/openmrs-readback.json`; the verification script performs readback plus this repeat-delivery check without a Meta call.

OpenMRS requires its own local patient ID in addition to our cross-system identifier. The adapter discovers required identifier types and their unambiguous generators, and requests an ID using the official [OpenMRS idgen REST interface](https://rest.openmrs.org/#export-patientidentifiers-from-source). It retains both identifiers. A failed creation may consume an unused generated ID; retries do not reuse that number for a different patient. Hospital referral delivery is described below. Full demographics, clinical encounters beyond the incoming referral note, and automatic hospital status callbacks remain future work.

## Hospital referral workflow

Configure the separate HOSPITAL_OPENMRS variables in `.env`, then run `node --env-file=.env --import tsx scripts/openmrs-setup.ts --hospital`. This resolves hospital-specific identity and BP metadata, creates the Makeni Government Hospital location, and creates a dedicated synthetic referral encounter type and text note concept. Recreate the core service to load settings. PHU metadata is not overwritten.

The **04 · Referrals** tab accepts an assessment already verified in PHU OpenMRS, an operator-authored referral reason and urgency. `POST /referrals` requires requestId, eventId, reason, urgency and actor. Identical request IDs return the original referral; conflicting reuse is rejected. The stored assessment snapshot and referral are queued durably for the fixed Makeni destination. The worker writes the linked patient, BP observations and an incoming referral encounter/note to the separate hospital instance, then reads them back before setting delivered. Outages and lost responses leave the record queued for retry; deterministic receiver IDs prevent duplicate resources.

`POST /referrals/{id}/status` records ordered transitions: delivered → accepted → completed, with an operator name and note. Delivery is technical receipt, not patient arrival or care completion. Acceptance/completion are explicitly operator-reported in the workbench and audited; they are not EMR callbacks and do not update clinical status in OpenMRS. This local single-operator pilot does not yet enforce facility-specific roles. No NEMS call, ambulance dispatch, clinical AI recommendation or automatic surgical decision occurs.

Checks:
- `node --env-file=.env --import tsx scripts/hospital-demo.ts`: real hospital write/readback, identifier/BP/referral note verification, repeat delivery, duplicate/conflict handling and explicitly labeled QA acceptance/completion. Saves `evidence/hospital-referral-readback.json`. Uses a stable test request ID and makes no Meta call.
- `node --env-file=.env --import tsx scripts/referral-check.ts`: isolated PostgreSQL test schema with a labeled test adapter; checks prerequisites, concurrent duplicate requests, outage and response-loss recovery, worker locking and transition guards. It does not replace real OpenMRS evidence.

The copied BP remains the original source assessment. Referral notes carry provenance and are a dedicated synthetic integration representation, not a claim of a standardized FHIR ServiceRequest implementation. Referral entry currently happens in the workbench; direct initiation from the PHU OpenMRS UI and return callbacks are later work.

## Client Registry and Shared Health Record

OpenCR and the clinical HAPI FHIR server now run as separate services with separate persistent databases. See [Registry and SHR architecture](REGISTRY-AND-SHR.md) for setup, verification, Ministry ownership boundaries and known production requirements. The **05 · Shared record** tab reads the longitudinal timeline from HAPI. OpenCR supplies the shared patient identity; the local records table is no longer the shared-record source for this view.

## Closed referral loop (synthetic pilot)

Hospital OpenMRS outcomes are polled every 10 seconds from the existing referral encounter. The HIE verifies patient, encounter, concept and referral identity before recording completion. It returns the exact outcome to PHU OpenMRS in a dedicated encounter, confirms readback, and synchronizes the hospital outcome, source provenance and linked community follow-up Task to the separate SHR. Repeated polling is idempotent. Failed PHU writes retry; altered or voided hospital outcomes are flagged for manual reconciliation, not silently overwritten. This pilot does not automatically retract already distributed records.

Configure metadata with `node --env-file=.env --import tsx scripts/feedback-setup.ts`, then rebuild the core. Run `node --env-file=.env --import tsx scripts/feedback-demo.ts` to seed a synthetic outcome directly in hospital OpenMRS and verify the full round trip. Evidence is written to `evidence/hospital-feedback-readback.json`.

The test uses real local OpenMRS APIs, not real patient data. Native hospital discharge-form capture is not yet configured. Community follow-up is persisted in HIE/SHR; it is not yet delivered to ComEMR. The six-week due date is authored in the synthetic discharge fixture, not generated by AI. Workbench tabs Referrals and Shared record show the results. SHR reads bypass search caching so newly synchronized outcomes are visible immediately.

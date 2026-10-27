# ComEMR community follow-up connector

Status: live local mobile-client authentication, existing synthetic patient linkage, API creation and independent read-only database persistence verification completed on 27 October 2026. Private ComEMR source is not copied into this project.

## Local setup

In the ignored `.env`, set COMEMR_USERNAME and COMEMR_PASSWORD to an existing authorized local account. COMEMR_BASE_URL defaults to http://127.0.0.1:3000. The default password transport HMAC key is spice_uat, matching the local web configuration; override COMEMR_PASSWORD_HASH_KEY if different. Sessions stay in memory. No credentials are logged.

Identify a synthetic household member, its patient, household and village IDs. Create ignored `secrets/comemr-link.json` containing sourcePatientId (DEMO-AMINATA-001), patientId, memberId, householdId, villageId and syntheticConfirmed (true). Set COMEMR_LINK_FILE to that path. Do not use fabricated receiver IDs or match by name. The connector verifies the complete relationship through the household-member list before submission. The caller must be authorized for the village; this connector does not alter CHW catchment assignments.

Run `node --env-file=.env --import tsx scripts/community-deliver.ts <task UUID>`.

## Delivery semantics

The hospital instruction becomes an HH_VISIT follow-up with nextVisitDate preserving the authored calendar date. The task UUID is included in reason for correlation. The creator comes from the authenticated ComEMR profile. ComEMR community tasks are village-scoped; this endpoint does not assign an individual CHW.

A durable HIE claim precedes the create call. ComEMR's current create endpoint has no external-id uniqueness guarantee. Therefore an uncertain response or crash leaves the task held for review rather than automatically re-posting it. Reruns return the existing delivery state. An acknowledged response is distinct from independently verified readback and from a completed patient visit.

The current list API excludes household visits more than seven days away. A six-week appointment can be acknowledged but cannot immediately be independently read back through that list. Do not change its date or classify it as a referral to bypass the filter. Before unattended production delivery, add an authenticated exact follow-up lookup plus a unique external task identifier to ComEMR (or an equivalent supported integration endpoint). Those private application changes have not been made.

## Verification

`npm test` checks mapping and identity guards. `node --env-file=.env --import tsx scripts/community-check.ts` uses an explicit test transport and an isolated disposable PostgreSQL schema to verify concurrent requests, lost responses and future-date acknowledgement. These are connector tests, not evidence of delivery to real ComEMR. Live delivery used the user-confirmed existing Isatu Conteh account and Aminata Kamara in the Moses Kamara household, Kamanka. Evidence: evidence/comemr-followup-readback.json. Receiver follow-up 32834 is due 8 December 2026 and remains incomplete. A second delivery call reused the receipt.


CHW accounts require COMEMR_CLIENT=mob and the mobile authorization response header rather than a web cookie. The connector supports both. Run scripts/community-readback.ts with the task UUID for explicitly labelled, read-only local database verification of an acknowledged task. This is a pilot diagnostic, not an authenticated exact-record API or proof of visibility in the mobile due list. No ComEMR database writes are used. The source simulator identity is linked to the existing ComEMR patient identifier in OpenCR and the SHR.

## Community completion and Meta repair (27 October 2026)

A separate integration-rehearsal follow-up (ComEMR 32835, HIE task da117e07-214e-5d19-a330-5c973ce85453) was created due today and completed through the local ComEMR update API using Isatu Conteh's authorized account. This was API-based synthetic test entry, not a verified mobile UI interaction or actual clinical visit. The original postnatal appointment 32834, due 8 December 2026, remains pending.

The HIE polls the authenticated ComEMR follow-up list with a sync timestamp, so completed rows are included. It verifies the exact receiver, patient, member, household, village, instructions and date, requires completion plus at least one visit, and persists one outcome per task. Changed completed records are held for reconciliation. Background polling runs every 30 seconds when local credentials are configured. No automatic creation or completion of visits occurs in that worker.

The Shared Health Record contains the completed rehearsal Task and a source-labelled completion Observation. The response confirms visit status/count; ComEMR's list did not supply detailed notes, and no clinical findings are inferred. Tests cover wrong identity, wrong receiver, changed outcomes, repeat polling and preservation of the original appointment. Evidence: evidence/comemr-completion.json.

Run scripts/community-completion-demo.ts for the idempotent synthetic rehearsal; scripts/community-completion-check.ts verifies receiver/SHR guards without creating a visit.

scripts/meta-completion-repair.ts calls real Muse Spark with an independently synthetic example, then validates and tests a mapping against a deliberately changed test envelope around the actual completed record. The installed ComEMR API is not changed. The first proposal used a wrapper prefix and was rejected; clarification produced the passing mapping. The successful proposal, model usage, mapping hash and replay checks are in evidence/meta-completion-repair.json. Approval is explicitly an automated development test; no model-generated production connector is activated. The clinical outcome is read from ComEMR, never decided by Meta. The scripted repair experiment is retained; interactive operator review is now available in workbench tab 06, as described below.

## Interactive completion repair

Open workbench tab **06 · Completion repair**. Choose a verified completion and prepare a rehearsal, request a real Meta mapping, review/edit its paths, validate, enter the reviewer name, approve, and replay. Each Meta request sends only a fixed synthetic contract example, not the selected patient's identifiers. A null proposal displays clarification questions.

Held inputs, independently verified expected values, proposal evidence, exact mapping hashes, validation IDs, approvals and replay receipts persist in PostgreSQL. Resume saved repairs after refresh. Revalidation clears approval; failed/stale validation and changed mappings are rejected by the server. Replayed jobs are immutable. Replay reads the live ComEMR record again and fails if it has changed; repeat/concurrent requests return the existing receipt and preserve a single outcome. Rehearsals do not alter ComEMR's API or activate a general-purpose production mapping.

`scripts/completion-workbench-check.ts` exercises these API gates using the existing synthetic completion and a saved real Meta proposal, with a clearly labelled automated QA reviewer. It creates rehearsal records but does not complete additional visits. Results: `evidence/completion-workbench-check.json`.

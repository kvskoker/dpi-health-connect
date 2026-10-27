# DPI Health Connect delivery backlog

Kenneth owns product decisions, application access and final submission. Implementation work proceeds in this order; optional work cannot displace core acceptance tests.

## First implementation progress on October 26

- Implemented and verified: constrained BP mappings, validation-bound approval, independent simulator assessment endpoint, PostgreSQL persistence, audit, quarantine and replay.
- Verified with a labeled HTTP test receiver: concurrent duplicate handling, payload conflicts, persisted restart, receiver outage and response-loss retries. These are engineering tests, not OpenMRS integration evidence.
- Verified with the real Meta API: Muse Spark 1.3 proposed a mapping for schema drift, passed two expected-output cases and missing-unit rejection, then replayed the quarantined event through a labeled automated approval test. Model evidence is saved in `evidence/meta-repair-run.json`. Review UI is implemented; broader evaluation and cumulative spend enforcement remain pending.
- Running: isolated core/PostgreSQL Docker services; separate OpenMRS PHU/hospital projects are ready. Real PHU patient/BP write and readback passed, including linked identifier, values, units, time, facility and repeat delivery.
- Implemented: local integration workbench with connection/schema registration, configured endpoint checks, real Meta proposal review, saved mapping reuse, explicit validation and reviewer approval, quarantine replay, delivery monitor and audit view. Browser verification passed the complete repair flow; real PHU receiver delivery is now verified.
- Verified hospital increment: separate hospital patient/BP delivery and referral encounter/note readback; durable queue, idempotency, retry, audited operator acceptance/completion and Referrals workbench tab. Evidence: `evidence/hospital-referral-readback.json`.
- Implemented registry/SHR increment: independent OpenCR identity service and HAPI FHIR clinical repository with separate databases, certificate-authenticated registry access, verified identifier links, FHIR resource synchronization and a shared-timeline tab. National deployment qualifications are in `REGISTRY-AND-SHR.md`.
- Not yet implemented: national client matching/adjudication policy, health registries, full demographics, EMR referral initiation/status callbacks, general multi-destination routing, general connector generation and national indicators.

| ID | Priority | Work | Done when |
| --- | --- | --- | --- |
| P01 | P0 | Participant rules reviewed | Complete: signed-in guide confirms reuse, rubric, public source and three-minute video; actual submission terms remain to inspect |
| P02 | P0 | Verify Meta access | Real synthetic request succeeds; server-only credential and usage limit configured |
| P03 | P0 | Establish public simulator and private ComEMR boundary | Independently written simulator runs publicly; publishable contract scope confirmed; local ComEMR stays external |
| P04 | P0 | Pin runtime foundations | Two isolated OpenMRS instances, FHIR store and core database restart successfully |
| P05 | P0 | Define contracts and seed fixtures | Synthetic patients, providers, facilities, concepts and referral events validate |
| P06 | P0 | Implement Client Registry | Identifier reuse, new provisional registration and conflict tests pass |
| P07 | P0 | Implement HIE and receiver persistence | A source assessment becomes a persisted receiver record through the adapter |
| P08 | P0 | Implement reliable delivery | Outbox, idempotency, response-loss recovery and quarantine tests pass |
| P09 | P0 | Build mapping assistant | Meta produces a constrained mapping with evidence and uncertainty |
| P10 | P0 | Add approval and validation | Only reviewed mapping versions passing semantic tests can be activated |
| P11 | P0 | Complete PHU and hospital workflow | Referral, delivery and return update persist across independent instances |
| P12 | P0 | Add mother and baby timeline | Separate patients, relationship and six-week follow-up survive restart |
| P13 | P0 | Build live trace console | UI reflects backend events and persisted IDs, including failed states |
| P14 | P0 | Demonstrate schema repair | Incompatible input is rejected, reviewed repair passes and replay succeeds |
| P15 | P0 | Run evaluation | Held-out results and manual comparison saved with measured cost and latency |
| P16 | P0 | Record and package submission | Clean setup, video and claims checked against authenticated rules |
| P17 | P1 | Add national aggregates | Dashboard reconciles with committed events and inventory sandbox |
| P18 | P1 | Integrate DHIS2 sandbox | Aggregate import and readback verified |
| P19 | P1 | Add NIN and NEMS sandboxes | Clearly labeled verification/linkage and dispatch/ETA contracts work |
| P20 | P2 | Add voice assessment draft | Muse transcription and extraction show source text and require CHW confirmation |
| P21 | P2 | Add map presentation | Actual trace events drive the map; readability and controls pass review |
| P22 | P2 | Add insurance sandbox | Sample response is displayed without implying real eligibility determination |

## Decisions needed at implementation kickoff

1. Confirm the accepted track and team details; participant guide review is complete. Record actual implementation timestamps and the schedule discrepancy described in the rules checklist.
2. Identify the local ComEMR 3.0.0 Docker setup and permitted API contract details. Build the public simulator for the supported journey, then run the same connector contract tests against simulator and local ComEMR.
3. Put the Meta API credential in a local ignored environment file; do not paste it into chat.
4. Verify Docker availability, RAM and disk capacity before choosing how to host two OpenMRS instances.
5. Confirm credit availability and a spending ceiling before paid inference or cloud deployment.

## First executable milestone

Start with one synthetic patient and one observation. Persist them in the source, pass through an approved mapping and the HIE, write them into the PHU OpenMRS API, then read back the receiver IDs and values. Complete this before building a larger visualization. Introduce a genuine Meta-generated mapping as soon as the validation harness exists.

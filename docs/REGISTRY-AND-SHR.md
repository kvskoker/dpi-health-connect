# Client Registry and Shared Health Record

## Decision

Use established open-source foundations rather than implement a new MPI or FHIR database. OpenCR is the Client Registry; a separate HAPI FHIR R4 server is the Shared Health Record. Both are independent Docker services with separate PostgreSQL databases and named volumes. OpenCR also uses a private OpenSearch index and its own HAPI identity store. Sharing a HAPI container image does not share a database or clinical records.

Candidates reviewed:

| Component | Option | Decision |
| --- | --- | --- |
| Client Registry | [OpenCR](https://github.com/intrahealth/client-registry), root MIT license | Selected for the pilot: FHIR patient identity, golden records, source identifiers and configurable matching. |
| Client Registry | [SanteMPI](https://help.santesuite.org/user-guides-and-training/santempi) | Credible alternative for a formal national MPI assessment; not deployed in this increment. |
| Shared Health Record | [HAPI FHIR JPA](https://github.com/hapifhir/hapi-fhir-jpaserver-starter), Apache-2.0 | Selected as the clinical persistence foundation; the Ministry-specific SHR workflow is implemented around it. |

[OpenHIE defines the SHR](https://ohie.org/practice-area/shared-health-record/) as a longitudinal person-centric repository. A FHIR server alone does not implement all national SHR requirements.

## Running architecture

- `opencr`: upstream `intrahealth/opencr:bb06e1a`, client registration and identity resolution.
- `registry-fhir`: upstream `hapiproject/hapi:v8.12.0-2`, identity-only storage, PostgreSQL `registry-db`.
- `registry-search`: upstream `intrahealth/opensearch:6b4c779`, private index for OpenCR.
- `shr-fhir`: upstream `hapiproject/hapi:v8.12.0-2`, clinical resources, separate PostgreSQL `shr-db`.
- `core`: our HIE, workbench, connectors, synchronization and Meta-assisted mapping repair.

The registry and SHR networks are separate Docker internal networks. Only core joins both. Neither database nor FHIR server has a published host port. OpenSearch security is disabled only within this isolated pilot network. Core authenticates to OpenCR using a locally generated client certificate and verifies its server certificate. HAPI access currently relies on network isolation; national deployment needs service authorization as well. Private keys and runtime registry configuration are ignored by Git and Docker build context.

## Identity behavior

The HIE registers the existing community source identifier with OpenCR and reads back its golden-record identity. Verified PHU and hospital patient UUIDs are added as explicitly namespaced identifiers based on receiver receipts; they are not guessed from demographics. The shared record uses the OpenCR identity as its Patient ID and references it from clinical resources.

The configured matching rule cannot auto-merge on names: its auto-match threshold exceeds the available one-field score. Existing source identifiers update their record. Potential name matches are not automatically accepted. Multiple source-identifier matches or a changed golden identity stop synchronization for review. This increment does not provide a full adjudication UI, cross-source demographic matching evaluation, NIN verification, identity merge/unmerge, or national patient-ID policy. The displayed UUID is a pilot health identity, not a national NIN.

## Shared record behavior

Synchronization reads existing persisted assessments and referrals, registers identity, then writes a FHIR transaction to the separate SHR. It creates Patient, Observation, Provenance, ServiceRequest and Task resources. Original assessment values and timestamps remain unchanged. Source provenance distinguishes community observations and operator-entered referrals. Handover status distinguishes hospital API readback from operator-reported acceptance/completion. These are integration resources, not automatic clinical decisions or a complete implementation guide.

Deterministic resource IDs, transaction writes and a synchronization hash make repeat runs stable. A database advisory lock prevents overlapping identity registrations from this integration. Every resource is read back before the synchronization is marked successful. Failures are visible and retried; previously delivered EMR records remain intact. Registry clinical Observation count is verified as zero. A patient identity reference is retained in the SHR to support FHIR references; OpenCR remains the identity authority.

The workbench **05 · Shared record** reads its timeline from HAPI, not from the old local records projection. It retrieves up to 100 records of each supported timeline type and flags truncation. The full FHIR resource history remains in the repository. Receipt and status changes synchronize on the next worker cycle (10 seconds).

## Setup and verification

1. Run `./Initialize-Registry.ps1` once (PowerShell 7 and OpenSSL, including the Git for Windows copy). It preserves existing certificates and configuration. Local certificates expire after one year; they are a pilot trust setup, not a national PKI.
2. Run `./Start-Stack.ps1` or `docker compose up -d --build`. Existing OpenMRS and ComEMR volumes are not replaced. No third-party runtime sources are copied into our repository.
3. Open the workbench with `./Open-Workbench.ps1` and select **05 · Shared record**.
4. Run `Get-Content scripts/shared-record-check.mjs -Raw | docker exec -i dpi-h-hackathon-core-1 node --import tsx --input-type=module` for real registry/SHR verification. It checks identifier links, values, times, referral resources, separation of identity/clinical data, and repeat synchronization. It makes no Meta call.

## Ministry ownership and deployment readiness

The deployment can run on Ministry-controlled infrastructure, with Ministry-controlled databases, credentials, backups and configuration. Custom connector/workbench code stays in this project and can be handed over; upstream code remains governed by its own open-source license and attribution obligations. Open source provides a customization path, not automatic production readiness.

The selected OpenCR upstream image is based on Node 16. Its runtime/dependency maintenance, security posture, matching accuracy and support arrangements must be assessed and modernized before national production adoption. This is a material qualification of the selected pilot, not a claim that OpenCR is already approved for Sierra Leone. National rollout also requires Ministry-owned matching/identity policies, profiles and terminology, consent/access enforcement, facility roles, audit retention, encryption and key lifecycle, backup/restore and disaster-recovery tests, performance evaluation, operational monitoring and governance. Our current workbench remains single-operator and synthetic-data only.

Custom value is in the Sierra Leone workflows, adapters, deployment automation, observable exchanges and Meta-assisted integration maintenance—not rebuilding upstream identity/FHIR storage. Keep these boundaries so either backend can be replaced through its adapter without rewriting the entire demo.

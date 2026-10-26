# Local environment readiness

Checked 26 October 2026 at approximately 23:04–23:06 GMT. This is preparation, not submitted implementation.

## Verified tools and capacity

- Node.js 22.22.3 and npm 10.9.8 are installed.
- Git 2.46.1 is installed.
- Docker Desktop's Linux engine is running; Docker Engine 29.6.2 and Compose 5.3.1 respond successfully.
- Docker reports approximately 46.9 GiB of memory and 32 CPUs.
- Windows reports approximately 95.6 GiB total memory and 68.7 GiB available at the check.
- Drive C has approximately 21.5 GiB free. Check image and volume requirements before downloading the EMR stack. No image pruning or deletion is authorized or performed.
- A ComEMR web container is present. Its Compose metadata points to a local development checkout outside this project. Only metadata was inspected; private source and credentials were not read or copied.

## Isolation and dependency preparation

Run the hackathon under a separate Compose project name, with dedicated volumes, networks and loopback-bound ports. Do not reuse ComEMR databases or change its existing containers. PHU and hospital instances can share immutable OpenMRS images but must have distinct databases and application data volumes.

The upstream OpenMRS reference application's Compose file uses gateway, frontend, backend and MariaDB services. Its default tag is `qa`; choose and verify a fixed release or digest before the hackathon deployment rather than silently taking a moving QA build. [Upstream Compose reference](https://github.com/openmrs/openmrs-distro-referenceapplication/blob/main/docker-compose.yml)

Meta's quickstart supports server-side API calls with a configurable model and API key. Do not put credentials into source control or the browser. Model access and credits have not yet been tested. [Meta quickstart](https://dev.meta.ai/docs/quickstart)

## Remaining prerequisites

1. Timing review corrected: the guide's October 27–November 4 label conflicts with the October 26 event start. No explicit prohibition on coding after kickoff was found. Proceed under Kenneth's build instruction and record actual timestamps. No application implementation was created during this readiness check.
2. Confirm the intended ComEMR backend/Compose folder and which interface details can be published. The web container's path alone does not identify the backend contract.
3. Confirm Meta credits and local credential configuration without exposing the key.
4. Check storage requirements for the selected OpenMRS and shared-store images; start with one receiver before bringing up both EMRs.

## First implementation checkpoint

Create a synthetic community assessment in the independent public simulator, apply a reviewed mapping, route through the HIE and save it in OpenMRS. Read the receiver record back and compare identifiers, values and units. Persist delivery state and prove that replay does not duplicate the observation. Add Muse proposal generation and approval after the deterministic contract harness is in place.

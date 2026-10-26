# Hackathon rules and submission checklist

Verified on 26 October 2026 from the signed-in [Participant Guide](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details) and [event announcements](https://cerebralvalley.ai/e/meta-ai-developer-hackathon#blast-267cb24d-c15f-41e2-90c3-18a59e9de836). These notes replace the earlier access-related uncertainties.

## Confirmed requirements

- The project must fit Build for Your World or Push the Frontier and meaningfully use Meta Model API and/or Meta open-weight models. The viability screen is pass/fail. The guide does not require every listed model.
- Repositories must be public. Solo participation is allowed; teams have at most four participants.
- Startups may build on existing products or codebases. The submitted demo must highlight only features, code and functionality built during the hackathon, with original contributions clearly identified. Failure to distinguish them can disqualify an entry.
- Do not use assets, code or data without the required rights.
- The anti-project list includes AI-generated medical advice, basic RAG applications and simple image analyzers. Keep our AI strictly in engineering workflows: schema inspection, mapping, validation and integration repair. No clinical recommendations, diagnosis, triage decisions or treatment advice.
- Submit one project per team/startup, through an appointed representative, and list everyone who worked on it.
- A three-minute demo video is required. The video and public code must be accessible; judges also consider the live product. Prepare a stable judge-accessible sandbox. The guide does not specify a hosting provider or video format.
- Submission is due November 4 at 21:00 Eastern: November 5 at 02:00 GMT in Freetown. Internal target remains November 4 at 18:00 GMT. Late submissions are not considered.

## Judging and our evidence

| Criterion | Weight | Evidence to prioritize |
| --- | --- | --- |
| Impact | 30% | Real integration maintenance problem, clear beneficiaries, measured time to a valid mapping and credible pilot path |
| Meta AI tooling | 25% | Model inspects schemas, proposes transformations, calls validators and revises errors; human controls activation |
| Technical depth and execution | 20% | Persisted cross-application writes, identity consistency, idempotency, reliable delivery and semantic tests |
| Demo | 25% | Three-minute working demonstration with visible schema break, tested repair and successful replay |

Stage two scores each criterion from 0 to 10. Five projects per track advance to finals using the same rubric. The Best Agentic Use-Case bonus is a secondary fit; do not add unnecessary autonomy to chase it. An open-weight bonus requires actual use of an eligible Meta open-weight model and partner verification where applicable.

## Build window and schedule

The guide labels the building period October 27 through November 4, while the event overview says the hackathon begins October 26 and the announcements confirm the October 26 kickoff. The new-work rule requires work during the event; it does not explicitly prohibit coding after kickoff on October 26. These statements are inconsistent. Our earlier instruction to wait was a conservative interpretation, not an explicit organizer prohibition. Proceed after the published kickoff under Kenneth's instruction to begin, preserve actual timestamps and retain the discrepancy in this record.

The guide gives judging as November 5–8 and finals November 9 at noon Eastern (17:00 Freetown). October 27 and 28 agent workshops run 16:00–17:00 Freetown; the October 28 verifiable-agents session is especially relevant. Weekday office hours are 14:00–15:00 Freetown through October 30, then 15:00–16:00 November 2–4 because US daylight saving ends November 1. Use the Discord questions channel for rule clarifications. No message has been sent on Kenneth's behalf.

## Credits and announcements

The signed-in event announcements confirm the welcome instructions, Discord route, kickoff livestream and Meta credit offer. Accepted participants can individually apply for $150 in Meta Model API credits through the [credit claim form](https://docs.google.com/forms/d/e/1FAIpQLScam78z7tHsNYibiFyJQVFzEgr0coyBTiY568SxxNbsPa3jiw/viewform). Claims are due at the submission deadline and distributed in batches. Kenneth must claim his own credits; the guide prohibits claims on another person's behalf.

The guide requires a credit card on the API account to use credits, mentions a temporary authorization charge and a billing spend-limit notification. A notification is not established as a hard usage cap. Confirm the balance in Billing and enforce an application-side usage budget before inference. No credits, payment method or subscription have been activated by this review.

Optional partner offers: Baseten $100 per selected individual, up to 2,000 participants; Modal $100 for the first 1,000 participants; Fireworks $25 per selected team. These offers are not guaranteed. If using Baseten for this hackathon, the guide specifies `meta-models/muse-spark-open-1026`, rather than the generic name in its docs.

[Discord connection](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/discord) · [Livestream](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/live) · [Submission page](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit)

## Prior work and new contribution

The workshop provided an architectural blueprint and a concept visualization. It captured no real patient data in ComEMR and exchanged no records with another application. Describe that as design context, not a hackathon-built feature. Do not include the old animated teaser as the submission demonstration.

OpenMRS, HAPI FHIR and other dependencies remain attributed third-party foundations. New work includes adapters, shared-infrastructure configuration, deployment tooling, Meta-assisted mapping and validation, delivery recovery, the live trace UI and evaluation. Inventory any reused code or assets with origin, date and license. Public source requirements do not authorize publishing a supplier's private code or recordings; keep restricted systems external and use permitted interfaces or an explicitly labeled reference client.

## Submission checklist

ComEMR 3.0.0 is an optional private external target, not submitted source. Judges must be able to reproduce the complete submitted workflow using the public simulator. Publish only permitted interface details and independently written implementation. Identify simulator and real ComEMR evidence separately. If organizers require source for every demonstrated dependency, use the simulator in the judging demo and describe private-target validation only as supporting evidence, subject to their guidance.

- [x] Read signed-in guide and announcements; confirm rubric, reuse policy, team limit, video duration and public repository requirement.
- [ ] Confirm registered track, project name, team members and representative.
- [ ] Record actual implementation timestamps and the schedule discrepancy; never backdate work.
- [ ] Kenneth claims credits and verifies billing; configure server-side credentials and usage budget.
- [ ] Inventory prior work and third-party licenses; identify new contributions in README and video.
- [ ] Prove actual Meta calls and save model ID, prompt version, validation results, latency and cost.
- [ ] Demonstrate persistence in independent applications and the shared record using synthetic records.
- [ ] Test schema repair, outage recovery, replay, access controls and secret exclusion.
- [ ] Publish evaluation results with denominators, failures and baseline comparison.
- [ ] Publish the clean public repository and test fresh setup and judge access.
- [ ] Record a three-minute video featuring new working functionality only.
- [ ] Verify the live product, video URL and submission fields; list all contributors.
- [ ] Review any additional terms presented at submission; Kenneth handles acceptance.
- [ ] Submit by the internal target and retain the platform confirmation.

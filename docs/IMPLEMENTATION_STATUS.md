# Implementation status

Source of truth: [MASTER_PLAN.md](./MASTER_PLAN.md) and the linked GitHub issues.

| PR | Work item | Status | Branch | Dependencies | External gate |
|---:|---|---|---|---|---|
| 01 | Secure and reproducible baseline | NOT STARTED | `feat/01-secure-baseline` | — | None |
| 02 | Production-grade Meta read client | NOT STARTED | `feat/02-meta-read-client` | PR01 | Real Meta credentials for final validation only |
| 03 | Durable sync and historical data model | NOT STARTED | `feat/03-sync-data-model` | PR02 | Meta credentials for end-to-end validation |
| 04 | Convert product to UK Trade Leads | NOT STARTED | `feat/04-uktl-domain-model` | PR03 | Targets optional |
| 05 | Operator dashboard v2 | NOT STARTED | `feat/05-operator-dashboard` | PR04 | None |
| 06 | Evidence-based recommendation engine | NOT STARTED | `feat/06-recommendation-engine` | PR05 | Targets improve recommendations but may be unknown |
| 07 | Trustworthy AI analyst | NOT STARTED | `feat/07-ai-analyst` | PR06 | Anthropic key for live validation |
| 08 | HighLevel CRM attribution | NOT STARTED | `feat/08-highlevel-attribution` | PR07 | HighLevel access and stage mapping |
| 09 | Approval-gated Meta actions | NOT STARTED | `feat/09-approved-meta-actions` | PR01, PR02, PR06, explicit approval | Meta write permission; disabled by default |
| 10 | Production hardening and docs | NOT STARTED | `feat/10-production-ready` | PR01–PR09 (PR08 may be explicitly deferred) | Deployment/database access |

Allowed statuses: `NOT STARTED`, `ACTIVE`, `BLOCKED`, `IN REVIEW`, `COMPLETE`.

## Update rules

- Only one sequential core work item should be `ACTIVE` at a time.
- Change status to `IN REVIEW` when its PR is open and all locally runnable gates pass.
- Change status to `COMPLETE` only after merge.
- Record external blockers in the relevant GitHub issue and PR.
- Missing credentials do not justify skipping mock/fixture-backed implementation.
- PR09 remains disabled until the explicit safety gate is met.

# Contributing to Shawtie pls

Thank you for contributing.

Shawtie pls has a frozen architecture baseline and explicit product and security rules.

Before making a structural change, read:

- `docs/product/PRD.md`
- `docs/architecture/ARCHITECTURE_BASELINE.md`
- `docs/architecture/ARCHITECTURE_GOVERNANCE.md`
- `docs/contributing/DEVELOPMENT_WORKFLOW.md`
- `docs/security/THREAT_MODEL.md`
- `docs/security/DATA_CLASSIFICATION.md`

## Change classification

Classify work before implementation:

- Class A: implementation detail
- Class B: architecture-compatible extension
- Class C: architecture change
- Class D: product rule change

Class C changes require an accepted ADR before implementation, except for emergency security mitigation.

Class D changes require a PRD update first.

## Public repository rules

Use synthetic data only.

Never commit:

- production credentials
- real private messages
- real relationship data
- private media
- recovery secrets
- private cryptographic keys
- production database exports
- provider secrets

## Pull requests

Use the pull-request template.

Keep changes focused and include the relevant tests and documentation.

PROJECT_STATE must describe only verified implementation, not planned behavior.

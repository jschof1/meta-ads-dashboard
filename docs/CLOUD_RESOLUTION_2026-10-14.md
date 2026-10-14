# Cloud resolution — 14 October 2026

PR26 remains draft, unmerged and unreleased. Source validation ran in hosted
Linux with Node 24.19.0. Laptop and Mac mini repository workers remain stopped;
the private recovery store was not accessed or changed.

## Completed compatible repairs

| Dependency | Before | Checked lock version |
| --- | --- | --- |
| Wrangler | 4.147.0 | 4.151.0 |
| Miniflare | 5.20261001.0-alpha | 5.20261012.0-beta |
| sharp | 0.35.4 | 0.35.5 |
| proxy-addr | 2.0.7 | 2.0.8 |
| MCP SDK | 1.29.0 | 1.32.1 |
| source-map-js | 1.2.1 | 1.2.2 |

Declared dependency/peer ranges permit these changes. Wrangler selects the
listed Miniflare/sharp path; its platform artifacts updated together. Existing
same-version esbuild entries were deduplicated. Next.js and its ESLint package
remain 16.3.8; no forced major downgrade, advisory suppression, audit threshold
change or omission of development dependencies was made.

Cloud fixtures required two portability repairs: retain the runner proxy only
for the pinned public binary download, and extract its verified archive without
restoring foreign ownership. Application/database children still exclude
production credentials. A regression verifies that transport settings are
retained for downloading while provider tokens, password and Node options are
excluded. The browser fixture also accepts an explicit installed Chromium path
when the default download is unavailable. Its assertions, application build,
TLS verification and default CI browser behavior remain intact.

## Actual checks

- Clean `npm ci` passed, including Prisma Client generation.
- Lint and typecheck passed; **340 tests passed**, with no skipped tests.
- Next.js 16.3.8 production build, OpenNext Cloudflare build and Wrangler
  deployment dry run passed. A dry run did not deploy anything.
- Isolated HTTPS/libSQL smoke passed using the checksum-pinned official sqld
  0.24.32 binary: 3,000 synthetic contacts, 1,000 opportunities and 2,000
  recommendations, identity preservation, incomplete-read preservation,
  rollback and expired-lease rejection. No production database or provider
  records were used.
- **12 production browser fixture checks passed** at desktop and 390px mobile
  using installed Chromium 153.0.8010.0. They covered login/cookie protection,
  saved enquiry distinctions, failed-refresh preservation, disabled execution,
  diagnostics, logout and missing-database failure. There were no browser errors
  or external browser requests. The default Playwright archive download was
  truncated in this cloud runtime; the explicit installed-browser route above
  was used, rather than claiming the installer passed.
- PR27's separate portable reader passed its **seven standalone mocked tests**.
  No live authentication, quota probe or provider refresh was performed.

The unchanged `npm audit --audit-level=high` still fails. Audit improved from
**one critical / 14 high** to **zero critical / nine high**. All remaining
dependency paths trace to `braces` 3.0.3. The primary
[GHSA-vfj7-8cjw-p6xm advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
checked on 14 October, affects versions through 3.0.3 and lists no patched
release. Independent fixture passes do not waive this release gate or certify
hosted CI as green.

## Migration and production boundaries

PR26 contains **nine committed migrations**. The ninth,
`20261004123000_lead_register_sync_lease`, creates `LeadRegisterSyncLease`; its
SHA-256 matches the manifest:
`1f30dc239ee0f52b43b2d09b13c3d89e39cba4958fe6eefe25d3a5ecf32a2ed4`.
The fixture tests applied disposable local migrations. The current production
ledger was not read or changed, and the ninth migration was not applied there.

Current cloud has no authorized dashboard password/config or Cloudflare/Turso
operator handover. The private Mac mini handover and historical operator session
are preserved but inaccessible here. PR27's portable reader supplies code,
not credentials. Existing Worker/database resources and credentials should be
reused through protected cloud access; values must not be posted in chat/GitHub.

No merge, deployment, production migration, Meta write, live provider refresh,
client notification, payment or booking occurred. Production authentication,
saved-source freshness, provider parity, scheduled sync outcomes and actual
enquiry receipt remain separate, unverified claims in this cloud pass.

| Remaining gate | Owner | Next action | Follow-up |
| --- | --- | --- | --- |
| Unpatched braces / audit | Jack / technical maintainer | Obtain a supported upstream patch or compatible path, rerun the unchanged audit and all required checks; keep PR26 draft/unmerged. | 21 October 2026 or upstream patch |
| Protected cloud access | Jack | Make the existing authorized credential/session available securely, then verify saved authentication, diagnostics and freshness without refreshes. | 21 October 2026 or access available |
| Migration and release acceptance | Jack | After audit/CI/access pass: recoverable backup, actual ledger/checksum inspection, ninth-migration runbook, existing Worker release and separate version/auth/read/sync proof. | 21 October 2026 or prerequisites pass |

Meta writes remain disabled. This is an internal unreleased repair, so no
client notification draft or send is warranted.

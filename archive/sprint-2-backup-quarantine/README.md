# Sprint 2 backup quarantine

**Origin:** BLOCK_30 / Sprint 2 / Phase 2.1 (2026-05-06)

15 `*-backup` files moved out of `src/` to keep deployment artifact clean. Files
themselves remain `.gitignore`d (`*-backup`) — this README is the only tracked
artifact and exists so the quarantine event has a git-anchored breadcrumb.

## Files moved

| Source | Origin tag |
|---|---|
| src/app.ts.module-d-backup | premium-01/module-d |
| src/app.ts.module-d-p3-backup | premium-01/module-d phase3 |
| src/app.ts.premium-01-backup | premium-01 baseline |
| src/routes/write.ts.premium-01-backup | premium-01 baseline |
| src/types/writer.ts.premium-01-backup | premium-01 baseline |
| src/services/arm-templates.ts.fix-a-backup | task4 fix-a |
| src/services/arm-templates.ts.fix-e-backup | task4 fix-e |
| src/services/arm-templates.ts.pw3-backup | pw3 |
| src/services/llm.service.ts.fix-b-backup | task4 fix-b |
| src/services/llm.service.ts.full-rewrite-backup | full-rewrite drop |
| src/services/llm.service.ts.module-a-backup | premium-01/module-a |
| src/services/llm.service.ts.premium-01-backup | premium-01 baseline |
| src/services/llm.service.ts.pw2-backup | pw2 |
| src/services/llm.service.ts.pw2-c5-backup | pw2/c5 |
| src/knowledge/WRITER_BRAIN.md.phase4-backup | knowledge phase4 |

## Status

`forensic-preserve` — historical reference; not deletion candidates this sprint.
Possible delete in later block once active surface is settled and we have
confirmed nothing references these as documentation anchors.

## tsconfig

`tsconfig.json` `include: ["src/**/*"]` already restricts the compiler to `src/`
so the archive sits outside the typecheck/build path. Defensive `exclude:
archive` not added because the `include` glob is already root-anchored.

## Dockerfile

`COPY src ./src/` only copies `src/`, not `archive/` — Docker build artifact is
unaffected. Verified post-quarantine: `npm run typecheck` + `npm run build`
both clean.

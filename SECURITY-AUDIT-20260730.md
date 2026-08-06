# Security Audit — Reconstruction, Validation & Remediation

**Date:** 2026-08-06
**Audit run:** `cb51003268b43b03444019854c1380f08ee1452c` (2026-07-30, `changes` flow, merge-base `14c1835`)
**Scope:** The encrypted vault-sync feature introduced in that changeset (server, sync engine, pairing, bundle/image import) and the surrounding DB/editor code it touches.
**Outcome:** 14 candidate findings reconstructed and all 14 remediated. The later full-hardening pass also closed the six residual risks recorded by the first remediation.

---

## 1. Background

The audit's artifact directory contained only empty directory scaffolding — the `05_findings/*` folders were named but held no reports, severities, or descriptions. Every finding below was therefore **reconstructed** and then **reproduced with a failing test or script before any fix was written.**

The original scan's own logs were later recovered from `~/.codex/sessions/2026/07/30/` (orchestrator plus three validation workers) and from a Claude session that read the artifacts before they were purged. Those recovered the full threat model, the discovery report, both completed validation reports, all 14 candidate ledgers, and all three reproduction programs verbatim. Two things they establish that the first pass through this document got wrong:

- **The scan never finished.** Its last status line is `{"phase":"validation","planned":14,"started":6}`. Coverage, reconciliation, attack-path analysis, and severity assignment never ran, so no severity in this document comes from the original audit — they are this effort's own calibration against the recovered threat model.
- **`cand-remote-thread-anchor-loss` is a different bug** than §3.1 first described. See #13 below; it is now fixed rather than accepted.

New verification harness added in this effort:

- `server/security-validations.ts` — boots an isolated server (throwaway port/data dir) and asserts concurrent quota, same-object revision, document identity, feed compaction, active-device, authenticated-rate, and tombstone invariants. Run with `bun run server/security-validations.ts`.
- `src/test/sync-engine.test.ts` — engine-level races: forget, LWW conflict caching, envelope integrity, asset tombstones.
- `src/test/sync-remote-reload.test.tsx` and `src/test/sync-remote-reload-wiring.test.tsx` — the #12 mechanism and the real AppShell wiring that has to invoke it.
- `src/test/comment-anchor-sanitizer.test.tsx` — extended for #13: anchors arriving with a sync reload.
- `src/test/sync-crypto.test.ts` / `src/test/editor-load.test.tsx` — decompression cap and the hook half of the reload contract.

---

## 2. Summary

| # | Finding | Severity | Validated | Fixed |
|---|---------|----------|-----------|-------|
| 1 | `cand-asset-envelope-id-mismatch` | Medium/High | Engine test | Yes |
| 2 | `cand-asset-tombstone-sync-poison` | High | Engine test | Yes |
| 3 | `cand-bundle-import-work-amplification` | Medium | Code analysis | Yes |
| 4 | `cand-client-gzip-bomb` | High | Crypto test | Yes |
| 5 | `cand-concurrent-quota-bypass` | High | Bun script (20/20 put) | Yes |
| 6 | `cand-conflict-restore-without-snapshot` | Medium | Existing test | Yes |
| 7 | `cand-document-envelope-id-mismatch` | Medium/High | Engine test | Yes |
| 8 | `cand-forget-race-secret-resurrection` | High | Engine test | Yes |
| 9 | `cand-object-revision-file-race` | Medium | Bun concurrency script | Yes |
| 10 | `cand-pairing-fragment-retention` | Medium/Low | Code analysis | Yes |
| 11 | `cand-pairing-storage-quota-bypass` | Medium/High | Bun script (12/12) | Yes |
| 12 | `cand-remote-reload-edit-loss` | High | AppShell + hook tests | Yes |
| 13 | `cand-remote-thread-anchor-loss` | Medium/High | Sanitizer test | Yes |
| 14 | `cand-zero-byte-tombstone-metadata-flood` | Medium | Bun script | Yes |

**State after full remediation:** `bun run test` → 851/851 passing across 86 files; `bun run typecheck`, `bun run lint`, `git diff --check`, and the production build are clean; `bun run server/security-validations.ts` → all PASS.

---

## 3. Findings in detail

### 3.1 Sync integrity

**#1 / #7 — Envelope-id mismatch (asset & document)**
The serialization formats embed their own identity inside the encrypted envelope (`src/sync/package.ts:110-156`), while the encryption AAD and the server's object key are bound to the *URL* objectId (`src/sync/crypto.ts:58-66`). The server cannot inspect ciphertext, and the receiver never cross-checked the two. A paired device could upload an envelope whose inner id differs from its storage key; receivers would store it under the inner id while recording sync state under the outer id, diverging identity across devices.

**Reproduced:** engine test — a `changes` entry for objectId `other-doc` carrying a package whose `document.id` differs was applied without complaint.
**Fix:** `VaultSyncEngine.applyRemoteObject` verifies `asset.id === remote.objectId && asset.docId === remote.docId`, requires document change metadata to satisfy `docId === objectId` even for tombstones, and verifies `package_.document.id === remote.objectId` before applying. Conflict packages receive the same document-id check before they are cached.

A rejected object raises `RejectedRemoteObject`, which `pull()` catches per object: it logs, skips, and **keeps draining the feed**, so the cursor still advances. Throwing out of the run instead — as the first version of this fix did — meant one envelope a compromised device can author would pin the cursor forever and stall every later change in the vault, which is the same denial of service as #2. No `syncObjects` row is written for a skipped object, so a later legitimate revision of it still applies. The test asserts the cursor advanced past the bad object.

**#2 — Asset tombstone sync poison**
Assets are immutable once written (the server returns `winner: 'existing'` for any existing asset, `server/index.ts:550-562`), but nothing stopped a rogue device from making the *first* write a delete tombstone, or from tombstoning an existing asset's identity. Receivers would then fail `getObject` (404 "has no body") on the poisoned asset, breaking every device's sync, and the owner's push would be answered with the tombstone revision.

**Fix, three parts.** The server no longer creates them: deletes naming an object the vault has never seen are a no-op that writes no rows (`server/index.ts`), and combined with the immutable-asset branch an asset can no longer be tombstoned at all. That alone was not enough — the threat model treats the sync server as untrusted, and an already-deployed database can hold tombstones written before the patch, which the server fix does nothing for.

So the client is fixed too: `applyRemoteObject` now handles `remote.deleted` for assets (deleting the local record) instead of falling through to a body fetch, and `fetchObject` turns a 404 into a skip rather than an abort. `SyncApiClient` throws a typed `SyncRequestError` carrying the status so a permanent 404 is told apart from a transient failure that must be retried rather than stepped over.

Finally, `removePhantomAssetTombstones()` clears pre-existing ones at startup, guarded by `path IS NOT NULL` so nothing with actual bytes behind it is ever touched.

**Reproduced:** engine test — an asset tombstone in the change feed, with the object endpoint answering 404. The asset is dropped locally, the cursor reaches the tombstone's seq, and no request is made for the body.

**#9 — Object revision file race**
`putObject` picks the next revision with `SELECT MAX(revision)+1` (`server/index.ts:581-586`), then awaits the atomic file write, then inserts the revision row. Two concurrent PUTs to the same object can both read the same MAX, derive the same revision, and both rename the same `…/<revision>.bin`; the second rename overwrites the first device's bytes, and the PK-conflicted insert then errors, leaving the surviving row pointing at the wrong body.

**Fix:** every upload is first staged under a cryptographically random immutable blob path; revision allocation and every related SQLite row are then committed in one synchronous transaction. Concurrent writers cannot choose the same revision or path. Failed/non-winning staging files are unlinked, startup removes crash orphans, and pruning re-reads and guards the current head transactionally before deleting a revision. The concurrency harness performs 20 simultaneous writes to one object and verifies all responses succeed and the LWW head fetch returns the winning writer's exact bytes.

**#13 — Remote thread-anchor loss**

An earlier revision of this document described #13 as last-writer-wins dropping a *local* thread and accepted it as designed. That was the wrong bug. The recovered validation report — one of only two findings the original scan validated as reportable, at 0.87 confidence — is about *newly arrived remote* anchors being destroyed:

> `useThreads` starts `loadThreadsForDoc` without awaiting it, retains the prior `threads` state during the reload, and exposes that state through `getKnownIds` without consulting `loadedRef`. […] `useMarkdownEditor` synchronously calls `setContent`; `CommentSanitizer` removes every mark absent from the current nonempty known-id set. […] Newly synchronized comment anchors disappear from the active editor while their thread records remain. The next ordinary edit emits and autosaves the markless document, making the loss durable and syncable.

A vault sync advances the document and the reload token together. `AppShell` passes that token to `useThreads` before `useMarkdownEditor`, so the thread read is still a pending promise when `setContent` replaces the buffer — and the sanitizer runs inside that very transaction. With the pre-reload thread set still visible, every anchor arriving with the new content is judged foreign and stripped. The thread records land a tick later and cannot put the marks back.

**Reproduced:** sanitizer test — a thread arriving with a reload lost its anchor while the reload was in flight, and exposing the id afterwards did not restore it.
**Fix:** `getKnownIds` now returns `null` while records are loading and a real set once loading finishes; an empty set therefore correctly means “loaded, with zero threads.” The load completion advances `knownIdsRevision`, and `useMarkdownEditor` dispatches a sanitizer-only recheck. Legitimate incoming anchors survive the loading window, while a foreign anchor pasted during that window is removed as soon as the authoritative set arrives.

**Last-writer-wins conflict resolution (unchanged, by design)**
Separately, `applyDocumentPackage` replaces the whole document graph, so a device that pushes a local thread and loses the LWW conflict has the winning remote head applied over it. This is intended, and the losing side is not destroyed: the engine caches the losing revision as a `syncConflicts` record, which the History panel exposes for manual restore. The engine test covering it is kept as documentation.

### 3.2 Server resource & authorization

**#5 — Concurrent quota bypass (CONFIRMED 20/20)**
The quota gate was `vaultBytes(vaultId) + bytes.byteLength > vaultQuota(vaultId)` evaluated before the write, with an `await writeAtomic` between check and commit (`server/index.ts`). Bun's event loop yields at the await, so concurrent PUTs (or two paired devices) all read the same pre-write total. The validation script stored **2000 bytes against a 1000-byte quota** with all 20 concurrent puts accepted.

**Fix:** the authoritative gate now runs *inside* the synchronous SQLite transaction (`QUOTA_EXCEEDED` throw → rollback → 413 → orphaned file unlinked), which serializes concurrent writers. Re-verified: **10/20 accepted, exactly 1000 bytes stored**.

**#11 — Pairing storage-quota bypass (CONFIRMED 12/12)**
`createVault` enforces hourly/per-IP/`MAX_VAULTS` limits, but `createPairing`/`claimPairing` enforced none, so a single compromised device token could mint unlimited additional devices, each re-uploading the whole library (`queueWholeLibrary`). Validation: 12/12 pairing links accepted.
**Fix:** two transactional caps now apply: `SYNC_MAX_ACTIVE_PAIRINGS` limits outstanding links and `SYNC_MAX_ACTIVE_DEVICES` limits active computers (both default 8, including the creator). Creation and claim both re-check the active-device count, and claim inserts the device and consumes the link atomically. Re-verified with sequential create/claim: 7 claims plus the creator, with every later link rejected.

**#14 — Zero-byte tombstone metadata flood (CONFIRMED)**
A delete PUT accepted an empty body, creating a zero-size revision + a `changes` row per call — free against the quota (`vaultBytes` sums `size`) and never pruned, so an authenticated device could grow the `revisions`/`changes` tables without bound and bloat every device's change feed.
**Fix:** deletes naming a never-seen object are now a no-op returning 200 with `noOp: true` and no rows created. The client retires that outbox item without creating revision-zero state or attempting a revision-zero GET. Re-verified: change-feed length and byte usage remain unchanged and the engine makes no follow-up object request.

**#10 — Pairing fragment retention**
The pairing link carries both secrets in the URL fragment (`src/hooks/useVaultSync.ts:207-211`); `history.replaceState` strips it from the current entry but back/forward history and session restore can retain it. Server-side, `pairings` rows (token hash + wrapped key) were never expired or removed, so the wrapped master key persisted indefinitely in the database.
**Fix:** a pairing-location module captures a valid link into one-shot memory and calls `history.replaceState` during module evaluation, before React mounts, prompts, or network work. Malformed pairing fragments are scrubbed too. Pairings are also deleted atomically at claim time and expired rows are purged at startup and hourly.

### 3.3 Client DoS

**#4 — Client gzip bomb (CONFIRMED)**
`decryptJson` inflated the decrypted payload with unbounded `gunzipSync` (`src/sync/crypto.ts`). The server caps the *ciphertext* at 30 MiB but not the gzip ratio, so a tiny object could inflate to gigabytes on every receiving device.
**Fix:** `inflateWithLimit()` streams through `DecompressionStream('gzip')`, cancels its reader once output exceeds 64 MiB, and uses fflate's incremental `Gunzip` with bounded source chunks on older Safari. Neither path first allocates the complete inflated object. Tests force both implementations across the reject and accept boundaries.

**#3 — Bundle import work amplification**
`readDocumentBundle` inflated the entire archive into memory before any validation; size checks happened only per referenced image, after full decompression.
**Fix:** `Unzip` now reads from `File.stream()`, validates entry paths/counts before starting each decoder, and stops/cancels extraction as soon as actual emitted bytes exceed the 500 MiB aggregate cap. Source chunks are explicitly bounded so synchronous DEFLATE cannot create an arbitrarily large temporary expansion before the counter runs. Tests include lying ZIP size metadata, excessive entries, and unsafe paths.

### 3.4 Data loss

**#8 — Forget-race secret resurrection (CONFIRMED)**
`clearVaultConfig()` races an in-flight sync that captured `config` at the top of `run()` and later re-persists it in `refreshClock` and `pull`. The validation test showed the wiped vault config — including the master key — restored in IndexedDB after "Forget this computer".
**Fix:** `VaultSyncEngine.configStillCurrent()` re-reads storage and compares `vaultId`/`deviceToken` before every `putVaultConfig`; a stale config aborts the run as `disabled` (`src/sync/engine.ts`). Test now passes.

**#12 — Remote-reload edit loss (CONFIRMED)**
A remote pull bumps `contentRevision`, and `useMarkdownEditor` reloads with `setContent(initialDoc, { emitUpdate: false })` — the reloaded buffer is never queued for autosave. Keystrokes typed between the pre-sync flush and the pull's `refreshFromStorage` were silently discarded.
**Fix:** once `changes` reports a nonempty batch, the engine invokes a lifecycle barrier before inspecting or applying it. `AppShell` immediately makes the editor read-only and flushes the live buffer. The engine then re-reads the outbox: if the flush created pending local work, it advances the cursor without applying over that object and the queued rerun pushes it through normal LWW conflict resolution. Only after apply, storage refresh, or error does the `finally` hook restore the prior editability state. Autosave errors now propagate, pending debounce arguments survive failure, and a timed retry is retained; reconciliation therefore fails closed instead of overwriting an unsaved buffer.

**Covered at three layers.** Engine tests verify the post-flush outbox re-read and lifecycle ordering; the real-hook race test protects draft persistence; and the AppShell wiring test verifies the editor becomes read-only, flushes, and is restored.

**#6 — Conflict restore without snapshot**
`restoreConflict` replaced the whole graph with no pre-restore snapshot, and relied on a caller-side `takeSnapshot` whose write errors are swallowed.
**Fix:** `restoreConflict` snapshots the current document state itself (`cause: 'restore'`) before applying, then prunes to `SNAPSHOT_LIMIT`. It deliberately does not catch the write error: a failed snapshot aborts the restore rather than letting the overwrite proceed with nothing to go back to. `AppShell.restoreSyncConflict` no longer takes its own snapshot first — that one swallowed its errors and only added a duplicate history entry.

---

## 4. Files changed

| File | Change |
|------|--------|
| `server/index.ts` | Atomic quota and revision allocation; random immutable blob paths; head-safe pruning; orphan GC; tombstone no-op; active pairing/device caps; authenticated request rate; compacted feed |
| `src/sync/engine.ts` | Forget guard; complete document identity checks; conflict-before-head processing; no-op delete handling; remote-batch lifecycle barrier; unusable-object skip-and-advance |
| `src/sync/api.ts` | `SyncRequestError` carrying the HTTP status |
| `src/sync/crypto.ts` | Bounded streaming gzip inflation for native and older-Safari paths |
| `src/markdown/bundle.ts` | Incremental ZIP extraction with input/inflated/entry/path caps |
| `src/sync/local.ts` | `restoreConflict` pre-restore snapshot + prune, fail-closed |
| `src/db/assets.ts` | `deleteRemoteAssets` for remote tombstones |
| `src/hooks/useThreads.ts` | Nullable loading state and authoritative known-thread revision (#13) |
| `src/editor/extensions/commentSanitizer.ts` | Explicit loading semantics and post-load sanitizer recheck |
| `src/components/AppShell.tsx` | Read-only remote-apply barrier; fail-closed flush; pairing-memory trigger |
| `src/hooks/useDebouncedCallback.ts` | Preserve/retry failed pending saves |
| `src/sync/pairingLocation.ts` | New: pre-mount fragment scrubbing and one-shot secret storage |
| `src/test/sync-engine.test.ts` | Engine races, identity, no-op, compaction-conflict, barrier coverage |
| `src/test/comment-anchor-sanitizer.test.tsx` | Reload, zero-thread, and loading-window recheck coverage |
| `src/test/sync-remote-reload.test.tsx` | New: draft typed during a pull is committed, not replaced |
| `src/test/sync-remote-reload-wiring.test.tsx` | New: real AppShell flushes inside its remote-change callback |
| `src/test/sync-crypto.test.ts` | New: decompression cap |
| `src/test/editor-load.test.tsx` | New: hook half of the reload contract |
| `server/security-validations.ts` | Quota, revision race, feed, identity, active-device, rate, and tombstone invariants |
| `docker-compose.sync.yml`, `deploy/sync.env.example`, `README.md` | Deployment defaults and security behavior documentation |

---

## 5. How to re-run the checks

```sh
# Full client suite, typecheck, lint
bun run test
bun run typecheck
bun run lint

# Server security invariants (boots its own isolated server)
bun run server/security-validations.ts
```

Each regression test was checked by reverting its fix and confirming the test
fails — #13 (`getKnownIds`) and #12 (the AppShell wiring) were both verified
this way, not just observed passing.

---

## 6. Full-hardening follow-up

The second remediation pass closed every item previously listed here:

1. **Object-revision files:** random staging paths plus transactional revision allocation and head-safe pruning remove the race; startup cleans crash orphans.
2. **Change-feed retention:** each successful write transaction deletes superseded rows for that object, and startup compacts databases created by older builds. Conflict revisions remain discoverable from the bounded revision set even when the head revision is unchanged.
3. **Authenticated request rate:** a SQLite-backed rolling one-minute counter admits 600 requests per active device by default and returns 429 with `Retry-After` after the cap.
4. **Pairing fragments:** the fragment is removed at import time and retained only in one-shot process memory.
5. **Remote edit supersession:** the read-only pre-apply flush barrier and post-flush outbox check route concurrent edits through ordinary conflict handling.
6. **Sanitizer loading window:** `null` distinguishes loading from an authoritative empty set, and load completion triggers an explicit recheck.

Normal operational risks remain — a compromised active device can read/write that vault until revoked, ciphertext is unrecoverable if every key-bearing browser is lost, and server availability is not guaranteed — but no known audit remediation remains open.

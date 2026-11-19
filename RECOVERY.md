# Stagebound backup and recovery

## Production resources

- Application Worker: `stagebound` at `stagebound.clearteck.org`
- Live database: `stagebound-db` (Cloudflare D1)
- Live photo bucket: `stagebound-photos` (private R2)
- Backup bucket: `stagebound-backups` (private R2; **same Cloudflare account**)
- Scheduled backup: `0 8 * * *` (08:00 **UTC** daily)
- Daily snapshots: retained for approximately 30 days
- Manual snapshots: retained until manually removed
- Archived original photos: retained until manually removed

Both R2 buckets have no public domain; the Worker verifies Cloudflare Access JWTs before serving data.

## How backups work

A scheduled Worker inventories owner emails present in six Stagebound tables. For each owner:

1. Fetches all owner-scoped database records (check-ins, competitions, tasks, preferences, measurements, photo metadata).
2. Ensures original photo objects are independently copied to the backup bucket; fails the snapshot if a referenced photo cannot be copied.
3. Saves a JSON snapshot under `users/<sha256-of-email>/snapshots/daily/<UTC-date>.json` with its SHA-256 digest in object metadata.
4. Prunes daily snapshot files older than 30 days. Manual snapshots and photo archives are not automatically pruned.

When a new photo is uploaded, Stagebound also archives a copy **before confirming success**. When a photo is deleted, the archive is checked and refreshed **before deletion**; if archiving fails, deletion is blocked.

**Caution:** Archived photos can approximately double your R2 storage usage. Check total usage as the library grows. Keeping a photo backup indefinitely may not match future deletion/privacy policies; implement an explicit permanent-purge function before offering this service to others.

## In-app operations

In **Settings > Backups and recovery**:

- **Back up now:** creates a manual snapshot from current D1 data and ensures all current photos have archived copies.
- **Verify backup:** checks the stored snapshot's SHA-256 checksum and the presence of every referenced archived photo.
- **Test recovery (no changes):** computes the number of live records missing relative to the chosen snapshot. This is a dry run and never writes.
- **Restore missing records only:** first takes a pre-recovery checkpoint, then inserts missing database records and restores their original photo objects from the archive. It does **not** overwrite or roll back existing records.
- **Download complete ZIP:** collects current D1 records plus the original photos over authenticated requests and saves them as a ZIP in the browser. The ZIP is a **separate export**, not an automatic off-account backup.

The older **Export JSON backup** button exports only the main dashboard state, not measurements or photo files. Use the complete ZIP for comprehensive exports.

## Recovery drills

1. Take a manual snapshot.
2. Verify its checksum and archived photos.
3. Run **Test recovery** and confirm zero missing records for unchanged data.
4. Download a complete ZIP, inspect that `stagebound-data.json` and all expected image files are present.
5. To test actual restoration, create a disposable measurement, back it up, delete only that test measurement, run recovery preview and restore the missing record. Verify the test measurement reappears. Never delete real photos as a test.

Do **not** use Cloudflare D1 point-in-time restore casually. That action can roll back the **entire** D1 database, including changes by other login emails. Cloudflare's Time Travel retention is currently 7 days on Workers Free and 30 days on Workers Paid; this is separate from Stagebound's 30-day R2 snapshots.

## Limitations and disaster recovery

- A failure of the Cloudflare account or compromise of its credentials could affect both live and backup buckets. Periodically store full ZIP exports outside Cloudflare.
- Daily backups have a potential gap of up to one day for edits/deletions of database records. Take a manual backup before high-impact changes.
- Verification is a checksum/availability check, not a full restore into an isolated environment. The in-app dry-run simulates what can be restored.
- Restore-missing mode does not overwrite modified existing records; a deliberate historical rollback would require additional recovery tooling.
- Large photo libraries and complete ZIP exports may exceed Worker/browser memory or execution limits. Test at realistic sizes.
- For recurring external disaster-recovery copies, consider a separate provider/account and an explicit retention policy.

## Deployment

The Worker and all R2 bindings are declared in `wrangler.jsonc`. GitHub Actions builds and deploys every push to `main`.

To test Cron events locally, use a Wrangler version supporting scheduled handlers; Cloudflare's Cron Triggers execute in UTC. Runtime schedule changes can take a few minutes to propagate.

# Hevy Pro → Stagebound (read-only)

Stagebound imports completed Hevy workouts via the official `GET https://api.hevyapp.com/v1/workouts` API. No changes are written back to Hevy.

## Connect the secret safely

1. Open the [Cloudflare Dashboard](https://dash.cloudflare.com/), then **Workers & Pages**.
2. Select Worker **stagebound** (not **clearteck**) > **Settings** > **Variables and Secrets**.
3. Add a **Secret** named `HEVY_API_KEY`. Paste the key generated in Hevy Developer Settings as the secret value. **Do not use Plaintext.**
4. Save/deploy the secret and open [Stagebound](https://stagebound.clearteck.org).
5. Under **Prep > Training > Hevy workout sync**, refresh the page and select **Connect Hevy**. This verifies access to the Hevy API.
6. Select **Sync latest** to import the newest 50 workouts. If you want more history, select **Import older history** repeatedly, five pages per click, until completed.

The Hevy key is never committed to GitHub, shown to visitors, or returned from Stagebound's API.

## How imports work

- The API is read-only. Users continue to log/edit workouts in Hevy.
- Hevy workouts are stored in a separate D1 table, indexed by stable Hevy workout UUID; retries and repeated syncs upsert instead of making duplicates.
- Manual Stagebound sessions are not deleted or modified.
- Synced Hevy sessions contribute to the weekly training review and exercise progression graphs. Hevy loads in kilograms are converted to pounds for display.
- The import counts warmup sets separately from work sets and excludes warmups from working-set volume; other logged working sets include normal, failure, and drop sets.
- The importer fetches up to five pages (50 workouts) per call, starting at the newest workouts for scheduled/normal sync. An explicit older-history request advances the history cursor.
- Newest workouts are automatically checked at minute 17 every six hours (UTC).
- Previous workout history and connection status are included in D1 backups. The secret itself is **not** backed up.
- If Hevy reports a 429 or API error, Stagebound records a sanitized sync error and retains the existing history.
- Hevy deletions aren't detected yet; this first iteration updates records already in the import but does not purge remotely deleted workouts.

## Security

- Cloudflare Access protects `stagebound.clearteck.org`; Stagebound also verifies Access JWTs server-side.
- `workers.dev` and preview URLs must remain disabled. `wrangler.jsonc` explicitly has `workers_dev: false` and `preview_urls: false`.
- The API key is scoped to the Worker as a Cloudflare secret. All Stagebound accounts allowed by its Access policy should be trusted to use the configured Hevy account; this integration supports one Hevy key per Worker, not multi-tenant OAuth.
- The Hevy secret must be rotated from Cloudflare if compromised or revoked.
- Avoid placing the key in Issues, commits, chat messages, public frontend code, URLs, or browser localStorage.

## Known limitations

- Historical import is paginated (maximum five pages per action) to avoid request size and rate spikes.
- Changes to very old imported workouts may require a manual older-page import.
- The API is experimental, so future Hevy changes may require adapter updates.
- Live account verification, initial import, and cross-device read must be tested **after** the user provisions the Worker secret.

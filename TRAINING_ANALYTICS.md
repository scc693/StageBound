# Stagebound Training Intelligence: calculation contract

## Sources

**Hevy is the source of truth.** All calculations use the original `exercises[].sets[]` in the imported `hevy_workouts.json` payloads. The older `hevySets` list in the Preparation view is a simplified presentation only; it must not drive muscle-group volume.

Imported Hevy workouts are read-only, keyed by stable Hevy workout ID and stored separately from manual Stagebound sessions. A repeated import updates the record rather than creating an additional workout.

## Set-level counting

- **Included:** `normal`, `failure`, and `dropset` entries with a positive numeric repetition count.
- **Excluded:** `warmup`, rows with no reps or zero reps, and duration-only/distance-only activities.
- **One Hevy set equals one counted working set**, regardless of load. Drop sets are counted as separate sets where Hevy logs them separately.
- This is a descriptive **working-set** count, not an evidence-based estimate of effective hypertrophy stimulus: proximity to failure, workload, range of motion, and technique all matter. In particular, RPE may be missing.
- Each user-confirmed exercise maps to **one primary muscle group**; secondary muscles are not double-counted. Compound exercises make this an approximation, not a physiological partition.

## Exercise classification

Classification keys use the stable `exercise_template_id` where available. Otherwise, a normalized title is used. A suggested primary group (simple keywords) appears for convenience, but **does not become an assignment or count toward muscle-group volume until the user saves it**. Unknown or unmapped exercises remain in a separate unmapped set count.

Assignments are persisted in owner-scoped D1 table `exercise_muscle_map`, included in backups, and are accessed only through the authenticated `/api/muscles` API.

## Week and trend calculations

Weeks begin **Monday** and end Sunday. Calendar dates use the date portion supplied by each Hevy workout start timestamp. The app shows current calendar week and the directly preceding one, plus an eight-week series of all working sets.

For exercise progression, the table shows the strongest representative set per exercise per day, selected by rough Epley estimated 1RM where the set is 1–10 reps:

`e1RM = external_kg × (1 + reps / 30)`

For sets outside that range, it shows load and reps without an e1RM estimate. A generated e1RM is not a test of true maximum strength. Comparing different exercises, machine stacks, assisted lifts, and bodyweight movements by external kilograms is not valid. Stagebound does **not** yet estimate volume-based plateaus or prescribe hypertrophy set targets.

## Verification

`npm run test:analytics` runs contract checks for warmups, drop sets, no-rep cardio, duplicate Hevy workout IDs, Monday boundaries, mapping logic, unit conversions, and e1RM. The GitHub deployment job runs these tests after the app build and before Wrangler deploy.

To validate real data, open **Prep → Training**, confirm exercise classifications (particularly custom movements), and compare a week's session count / working sets against Hevy. Do not treat the bars as accurate muscle-group metrics until your most common exercises have been assigned.

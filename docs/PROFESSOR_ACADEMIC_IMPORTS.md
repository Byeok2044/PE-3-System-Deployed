# Professor-managed academic records

Students can edit educational support needs, tuition-fee status, and scholarship
status. Grades, grading scale, enrolled/approved units, and day/night schedule
come exclusively from a designated professor's CSV. Day/night is study schedule,
not an attendance percentage. No training dataset or model artifacts are changed.

## First use

1. The student connects with a professor at the same institution. The professor
   accepts the connection request.
2. In the student's Data Workspace, choose the source academic year, semester,
   and connected academic-record provider. Use the semester represented by the
   grade and both unit counts. The most recent designated source semester is
   the active one for forecasting, including while awaiting its first upload.
3. The professor opens **Data Workspace**, downloads the CSV template, fills it
   in, and chooses **Validate and preview**.
4. Review all changes, then select **Confirm import** within 15 minutes.
5. The student reviews the read-only record and saves personal information.
   Forecasting uses stored records; browser-supplied inputs are rejected.

Student matching uses the exact normalized verified account email, never name
matching. No CSV row creates an account or accepts a connection automatically.

## CSV contract

```csv
studentEmail,academicYear,semester,previousSemesterGrade,gradeMaximum,previousSemesterUnitsEnrolled,previousSemesterUnitsApproved,attendance
student@example.com,2025-2026,2,2.25,5,24,21,day
```

The downloaded template contains headers only. Limits: UTF-8, 1 MB, 500 rows,
one source period per batch. Semesters 1 and 2 are supported initially. Grade
scales: 4, 5, 20, 100. On scale 5, 1 is highest and 5 lowest. The existing ML
conversion is preserved. Enrolled units are whole numbers 1–100; approved units
are whole numbers 0–100 and cannot exceed enrolled units. These bounds preserve
the existing model input contract; they do not establish local equivalence to
the historical dataset's curricular-unit counts.

Every row must pass validation before a batch can be confirmed. Duplicate
student/period rows, additional or missing headers, empty numeric values,
unknown accounts, cross-institution records, missing connections, and a different
designated provider reject the batch. Values are never defaulted to zero.

Replacing published values requires a correction reason. Identical reuploads
are unchanged and do not increment academic versions. Confirmations are
idempotent. Changed versions, provider changes, revoked connections, and expired
previews require a new preview. Academic records, correction audits, and batch
completion commit together in a MongoDB transaction. Both preview and commit
enforce authorization; commit takes write guards on users and connections to
conflict with concurrent institution changes or connection deletion.

## Ownership, corrections, and history

Only the designated professor can upload a particular period. In the professor's
student record card, the current provider can offer a transfer to another
accepted professor. The recipient must accept it. Students cannot change the
provider of a published period. Transfers retain all prior upload provenance.
An unavailable former provider requires a verified maintenance procedure;
there is no automatic takeover and no new administrator role.

AcademicRecordRevision is a separate append-only application audit with no
student mutation/deletion route. Students can review it in History. Deleting a
personal history entry does not delete academic audits or the academic record.

Disconnecting or changing institutions revokes professor access and blocks new
forecasts until an authorized provider is connected. Students retain historical
viewing of records from their current institution. Switching institutions does
not make an old institution's records current in the new institution.

Forecasts contain academic/profile versions and a fingerprint of the source
record and active authorization. Corrections, profile saves, provider transfers,
or revocation make prior forecasts historical. Dashboards only use current
forecasts; Gemini rejects stale forecasts. Alerts reference the forecast that
triggered them and check freshness before delivery. Already delivered email
cannot be withdrawn. Visible workspaces refresh about every 15 seconds and on
focus; students' unsaved personal edits are preserved.

Professor ownership improves provenance, not guaranteed accuracy or freedom
from model bias. Review uploaded source records and use forecasts for support.

## Developer setup and migration

No new npm or Python dependencies, ML artifacts, or retraining are required.
Restart the backend and frontend together after pulling. Keep the ML service
bound to localhost/private networking; browsers should reach predictions through
the authenticated Express API. Importing uses a route-specific `text/csv` file
body with a 1 MB limit, leaving the ordinary 10 KB JSON limit unchanged.

MongoDB must be a replica set or a sharded deployment supporting transactions.
Do not weaken atomic imports to accommodate standalone MongoDB; configure a
replica set instead. Existing institution changes already require transactions.

From `backend`:

```powershell
npm run academics:migrate
npm run academics:migrate -- --apply
npm test
```

The first command reports counts without writing. Apply creates a JSONL backup
under the git-ignored `tmp/academic-migration/` directory, creates academic
indexes, and labels existing self-reported profile/history data. Original
academic values are retained, not promoted to professor CSV. Unknown historical
periods and professors are not fabricated. The migration can be rerun safely.
Store the backup securely; it contains student information.

If migration fails, the console now reports its phase and the driver's diagnostic
with connection credentials redacted. Both the backend and migration use the same
DNS resolvers. To use your operating system's DNS instead, add
`MONGODB_DNS_SERVERS=system` to `backend/.env`. For explicit resolvers, supply a
comma-separated list in that variable. Do not share your MongoDB URI or password
when reporting an error; share only the redacted diagnostic.

The runtime already treats all old profile academic fields and forecasts without
version references as legacy, including before migration. Legacy data can be
viewed but cannot produce a new forecast. Both interfaces must be deployed with
the backend so old clients do not keep submitting protected fields.

The migration deliberately does not create authoritative academic records.
Professors must import the real source records after provider designation.

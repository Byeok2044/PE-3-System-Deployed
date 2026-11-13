# Retainify email setup

Retainify sends registration verification, resend verification, password reset,
and student/professor risk alerts through the Mailjet Send API v3.1 over HTTPS.
Each message explicitly sets `TrackClicks` and `TrackOpens` to `disabled`, so
verification/reset buttons retain their original Retainify URLs.

## Mailjet account

1. Create a Mailjet account and select the Free plan.
2. In **Account settings → Senders & Domains**, add and verify the sender address.
3. Get the API key and secret key from **Account settings → API Key Management**.
4. Add the three values below to `backend/.env` locally and to the Render
   **PE-3-System-Deployed** backend service's Environment settings.

| Variable | Value |
| --- | --- |
| `MAILJET_API_KEY` | Mailjet API key |
| `MAILJET_SECRET_KEY` | Mailjet secret key |
| `MAILJET_SENDER_EMAIL` | The exact verified sender email address |
| `PUBLIC_APP_URL` | `https://pe-3-system-deployed-1.onrender.com` in production |
| `CLIENT_ORIGIN` | Your permitted frontend origin(s), comma-separated |

Credentials belong only in the backend environment. Do not put them in a
frontend `VITE_` variable or commit the populated `.env` file. The sender name
is always Retainify. A sender address on a domain you control gives more reliable
delivery than a Gmail/Yahoo sender.

## Validate before enabling production

Run from the backend directory:

```powershell
npm run email:check
```

This calls Mailjet with `SandboxMode: true`: credentials and the message payload
are validated without delivering an email. It does not prove inbox delivery.
Use the production `PUBLIC_APP_URL` and `NODE_ENV=production` when checking a
production configuration. A missing or rejected configuration exits nonzero.

Once the check passes, deploy the updated backend with the Mailjet values set.
Existing database, ML, JWT and frontend settings stay in place. Older provider
credentials are no longer read by the application and can be removed from the
backend environment after migration. Do not rotate `JWT_SECRET` for this change.

For a real delivery check, request a new password-reset email for your own
Retainify account, inspect that the button's link starts with the production
frontend URL, and complete the reset yourself. Then test registration verification
or resend verification with an unverified test account. Emails already delivered
keep their original links and tokens. Reset links last one hour; verification
links last 24 hours.

## Risk graphs and failures

Risk emails embed `academic-trajectory.png` as an inline CID attachment and also
include a downloadable copy. The graph is shown directly, with no student
"Review my forecast" control. The old image endpoint remains available for
messages sent before this migration.

Mailjet must return a per-message `success` status before an alert is recorded
as sent. Rejected messages, invalid credentials, timeouts and quota errors are
treated as delivery failures; a failed recipient does not block other recipients
or a completed forecast. No automatic retry is made during a send to avoid
duplicate messages. Failed alerts remain eligible on a later forecast under
the existing cooldown rules.

## References

- https://dev.mailjet.com/docs/email-api/send-api-v31/send-api-json-properties
- https://dev.mailjet.com/docs/email-api/send-api-v31/send-attached-files
- https://dev.mailjet.com/docs/email-api/send-api-v31/send-api-errors
- https://documentation.mailjet.com/hc/en-us/articles/360042759253-How-to-add-a-sender-address

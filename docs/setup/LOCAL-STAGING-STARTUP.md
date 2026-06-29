# Local Staging Startup

## First-Time Setup

Install dependencies and build the workspace:

```powershell
npm install
npm run build
npm run lint
npm test
```

Link the InsForge staging project:

```powershell
npx @insforge/cli login
npx @insforge/cli link
npx @insforge/cli current
```

Apply raw SQL migrations in filename order:

```powershell
Get-ChildItem "db\migrations\*.sql" |
  Sort-Object Name |
  ForEach-Object {
    Write-Host "Applying $($_.Name)"
    npx @insforge/cli db import $_.FullName
    if ($LASTEXITCODE -ne 0) {
      throw "Migration failed: $($_.Name)"
    }
  }
```

Verify InsForge:

```powershell
npm run verify:db
npx @insforge/cli db tables
```

## Required Local Environment

Create `.env.local` and provide real values for at least:

```env
NODE_ENV=staging
PORT=3000
WORKSPACE_ID=ws_staging
DATABASE_URL=postgresql://...
RABBITMQ_URL=amqps://...
AIRTABLE_API_KEY=...
AIRTABLE_BASE_ID=...
SLACK_COMMANDS_ENABLED=true
SLACK_SIGNING_SECRET=...
SLACK_BOT_TOKEN=xoxb-...
FACEBOOK_PAGE_CONFIG_ENABLED=true
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
FACEBOOK_REDIRECT_URI=https://YOUR_NGROK_DOMAIN/api/v1/admin/facebook/auth/callback
SECRET_STORE_PROVIDER=database
SECRET_ENCRYPTION_KEY=...
COMMENT_SYNC_SCHEDULER_ENABLED=false
DM_INBOX_ENABLED=false
DM_SLA_HOURS=2
```

Generate the encryption key once:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

## Start Every Development Session

Terminal 1, start the orchestrator:

```powershell
npm run start:orchestrator
```

Wait for:

```text
Orchestrator listening
```

Terminal 2, start the HTTPS tunnel:

```powershell
npm run start:ngrok
```

Keep both terminals running.

Verify locally:

```powershell
curl.exe http://localhost:3000/health
```

Verify through ngrok:

```powershell
curl.exe -H "ngrok-skip-browser-warning: true" https://YOUR_NGROK_DOMAIN/health
```

Both commands must return:

```json
{"status":"ok"}
```

## Update External Callback URLs

When the free ngrok domain changes, update all of these:

1. `.env.local`:

```env
FACEBOOK_REDIRECT_URI=https://YOUR_NGROK_DOMAIN/api/v1/admin/facebook/auth/callback
```

2. Meta Valid OAuth Redirect URI:

```text
https://YOUR_NGROK_DOMAIN/api/v1/admin/facebook/auth/callback
```

3. Request URL for every Slack slash command:

```text
https://YOUR_NGROK_DOMAIN/api/v1/slack/commands
```

Supported Slack commands:

```text
/approve_post
/reject_post
/reply_comment
/escalate
/reply_dm
```

Restart the orchestrator after changing `.env.local`.

## Seed a Slack Administrator

Copy the Slack Member ID, then run:

```powershell
npm run seed:slack-admin -- UXXXXXXXXXX admin
```

## Staging Safety

Keep these disabled until their external integrations are ready:

```env
AUTO_PUBLISH_ENABLED=false
US006_EXECUTION_ENABLED=false
COMMENT_SYNC_SCHEDULER_ENABLED=false
DM_INBOX_ENABLED=false
```

Enable `DM_INBOX_ENABLED=true` only after:

- Facebook Page connection succeeds.
- `channel_accounts.secret_ref` is populated.
- DM ingest smoke testing succeeds.

## Troubleshooting

Reset conflicting staging Slack queues:

```powershell
npm run rabbitmq:reset-slack
```

Inspect ngrok requests:

```text
http://127.0.0.1:4040
```

Check InsForge availability:

```powershell
npm run verify:db
```

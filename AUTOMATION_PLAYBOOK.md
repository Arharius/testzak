# Automation Playbook (TZ Generator)

## 1. Safe release pipeline

Run one command before every deploy:

```bash
make release-guard
```

It does:
1. project backup
2. JS tests
3. backend syntax check
4. backend smoke checks
5. React build

## 2. Backup and restore

Create backup:

```bash
make backup
```

Artifacts are stored in `backups/`:
- `tz_generator_backup_YYYYMMDD_HHMMSS.tar.gz`
- `*.sha256`

## 3. Backend integration connector

Backend now provides queue/flush API:

- `POST /api/v1/integration/event`
- `POST /api/v1/integration/draft`
- `GET /api/v1/integration/queue`
- `POST /api/v1/integration/flush`

Health:
- `GET /health`

### Optional relay to external system

Set env variable for relay:

```bash
export INTEGRATION_TARGET_WEBHOOK_URL="https://hooks.example.com/target"
```

Then call flush endpoint to replay queue to target.

## 4. Frontend automation tab

Recommended flow:
1. Set webhook URL + secret
2. Enable autopilot + auto pick top candidate
3. Save settings
4. Train on current rows regularly
5. Retry queue after network failures
6. Export learning map weekly

## 5. React migration track

New modular app is in `frontend-react/`.
Use it for phased migration while current `index.html` stays stable in production.

Build:

```bash
cd frontend-react
npm install
npm run build
```

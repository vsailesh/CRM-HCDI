# Production deployment checklist

The app code can be hardened by us; the items below are the part only you can complete: the contract, the
host, the keys and the evidence. Work top to bottom. Nothing here is legal advice; have your compliance
officer sign off.

## 0. Decide the host (before anything else)

PHI may only live on infrastructure covered by a signed **Business Associate Agreement (BAA)**.

- [ ] Hosting provider chosen and **BAA signed** (AWS, Azure and GCP all offer one; many PaaS plans do not, or only on enterprise tiers).
- [ ] The specific services you use are on the provider's **HIPAA-eligible services** list (compute, volume, load balancer, secret store, backup storage, log storage).
- [ ] Region chosen; data does not leave it (including backups and logs).
- [ ] **Single instance only.** The database is SQLite on a local volume, so run exactly one replica. Do not scale horizontally and do not put the volume on a network share without SQLite-safe locking (NFS/SMB are not safe). If you need HA or multiple instances, that is a database migration (managed PostgreSQL), not a setting.

## 1. Build the image

```
docker build -t vfv-crm .
```

- [ ] Build needs **no secrets** (the build uses a throwaway in-memory database). If a build asks for a key, stop and tell us.
- [ ] Scan the image (Trivy, Docker Scout, ECR/ACR scanning) and fix HIGH/CRITICAL findings; rebuild on a schedule to pick up base-image patches.
- [ ] Pin and record the image digest you deploy. Keep the previous digest for rollback.

## 2. Secrets

Generate each with `openssl rand -base64 48`. Store them in the provider's secret store (Key Vault, Secrets Manager,
Secret Manager); inject at run time. Never in the repo, the image, a `.env` committed anywhere, or chat.

| Variable | Required | Notes |
|---|---|---|
| `VFV_DB_KEY` | yes | Encrypts the database file. 32+ chars. **Losing it loses all data.** Keep an offline copy under dual control. |
| `VFV_DATA_KEY` | yes | Encrypts MFA seeds, signs form tokens. A different value from `VFV_DB_KEY`. |
| `VFV_WEBHOOK_SECRET` | yes if the lead webhook is used | HMAC secret shared with the website's server. |
| `VFV_WEBHOOK_ORIGINS` | if a browser form posts leads | Comma-separated exact origins. |
| `VFV_TRUST_PROXY` | `1` (set in the image) | Only valid when a proxy you control sets `X-Forwarded-For`. If the app is reachable directly, unset it, or attackers can spoof IPs and dodge rate limits. |
| `VFV_REQUIRE_MFA` | leave unset | MFA is mandatory by default. Do not set `false` in production. |
| `VFV_DB_ENCRYPT_EXISTING` | one time only | Only when migrating an old plaintext database; remove afterwards. |

- [ ] Secrets in a secret store, access limited to the deploy identity and named admins, access logged.
- [ ] Rotation owner and schedule written down (see section 8).

## 3. Network and TLS

- [ ] TLS terminates at a load balancer or reverse proxy you control. **TLS 1.2+ only**, modern ciphers, valid certificate with auto-renewal.
- [ ] Port 80 redirects to 443. HSTS is already sent by the app.
- [ ] The container port is **not** exposed to the internet; only the proxy reaches it (compose binds it to `127.0.0.1`).
- [ ] The proxy overwrites (does not append to) `X-Forwarded-For`.
- [ ] Security group / firewall: inbound 443 only; no SSH from the internet (use SSM/Bastion/VPN); outbound restricted to what you need.
- [ ] Optional but recommended: a WAF in front, and IP allow-listing for `/setup` and admin paths.
- [ ] Rate limits are per process. The proxy should add its own coarse limit too.
- [ ] `/api/health` is the only unauthenticated, non-form endpoint. Point the load balancer at it. It reveals nothing.

## 4. Run it

```
docker compose up -d        # needs VFV_DB_KEY, VFV_DATA_KEY, VFV_WEBHOOK_SECRET in the environment
```

The compose file runs as a non-root user with a read-only root filesystem, no extra Linux capabilities, and a
persistent volume for `/app/data`.

- [ ] The data volume is **encrypted at the volume level** too (EBS/managed disk encryption). This is in addition to the encrypted database file, not instead of it.
- [ ] `docker compose ps` shows `healthy`.
- [ ] `docker compose exec crm node scripts/db-tool.mjs check` reports encrypted, opens, integrity ok.
- [ ] `curl -I https://your-host/login` shows the security headers (HSTS, `X-Frame-Options`, `nosniff`, `no-store`).

## 5. First admin

A fresh production database creates the staff rows with **random passwords nobody knows** and **no demo data**.
Activate your real administrator:

```
docker compose exec -e VFV_ADMIN_EMAIL=you@yourorg.com -e VFV_ADMIN_PASSWORD='<12+ chars, 3 of 4 classes>' crm node scripts/bootstrap-admin.mjs
```

- [ ] Sign in, enroll MFA, **save the recovery codes** in your password manager.
- [ ] Then replace or deactivate the three seeded accounts in Staff (they carry placeholder names/emails). Create each real user with their own account; no shared logins.
- [ ] Clear the shell history / CI log of the bootstrap password.

## 6. Configure the application

- [ ] Sharing & Access: confirm PHI objects are **Private**, review field visibility (DOB, eligibility case number).
- [ ] Case Automation: set assignment rules and SLA policies for your real teams.
- [ ] Remove or disable any web-to-lead integration you are not using; for the ones you use, test a signed request and a rejected unsigned request.
- [ ] Confirm new users must complete MFA before they reach any data.

## 7. Backups and recovery

- [ ] Scheduled `node scripts/db-tool.mjs backup` (daily at least; hourly if you cannot lose a day). Example host cron: `docker compose exec -T crm node scripts/db-tool.mjs backup`.
- [ ] Backups are **copied off the host** to separate, encrypted, access-controlled storage in the same BAA-covered region, with versioning/object-lock.
- [ ] **Retention**: audit-log data must be kept for **6 years**. Do not let the 14-snapshot local pruning be your only copy.
- [ ] **Restore drill**: restore a backup to a scratch environment with the key and sign in. Do it before go-live and at least twice a year. A backup you have never restored is not a backup.
- [ ] The backup key custody is documented (the key that was current at backup time is needed to restore).

## 8. Operations

- [ ] **Logs**: ship container logs to a central, access-controlled, retained store. The app does not log PHI; do not add logging that does. Retain per policy.
- [ ] **Audit log**: it is hash-chained inside the database. Periodically export it with the backups and verify the chain.
- [ ] **Monitoring/alerts**: health check failing, restarts, disk > 80%, repeated 401/429 spikes, backup job not run in 26 h.
- [ ] **Patching**: monthly rebuild for base-image and `npm audit` fixes; emergency path for critical CVEs.
- [ ] **Key rotation**: `VFV_DB_KEY` yearly or on staff change with key access (`db:rekey`, stop the app first, back up first). `VFV_DATA_KEY` rotation re-encrypts MFA seeds and is not automated yet: ask before rotating (users would need to re-enroll MFA).
- [ ] **Access reviews**: quarterly review of staff, admins, and Sharing settings; offboarding deactivates the account the same day.
- [ ] **Incident response**: written plan with contacts; HIPAA breach notification clock is 60 days. Know who decides, who calls the covered entity, and where the audit log is.
- [ ] **Capacity**: SQLite on one instance suits a small team. Revisit if concurrent users exceed a few dozen or write latency grows.

## 9. Evidence to keep (HIPAA / HITRUST)

Keep these in a compliance folder; auditors ask for them.

- [ ] Signed BAA(s) and the HIPAA-eligible services list for your provider.
- [ ] Risk analysis (HIPAA Security Rule requirement), with this checklist's gaps as inputs; review annually.
- [ ] Network diagram and data-flow diagram showing where PHI is and how it is encrypted (at rest: file + volume; in transit: TLS).
- [ ] Policies: access control, MFA, password, backup/DR, incident response, retention, workforce sanctions, security training records.
- [ ] Restore-drill records, key-rotation records, access-review records, vulnerability scans, patch records.
- [ ] Audit-log samples demonstrating PHI access logging.

## Known limits (be honest with your auditor)

- Single node, SQLite: no automatic failover; recovery is restore-from-backup. Define your RTO/RPO accordingly.
- Older CRM screens (customers, inbox, follow-ups, pipeline) predate the per-record access model; audit-log coverage for them is partial.
- No Content-Security-Policy header yet (other security headers are present).
- No outbound email/SMS: alerts appear in the app only.
- Encryption protects lost or copied disks, not an attacker who can run the app with its keys.

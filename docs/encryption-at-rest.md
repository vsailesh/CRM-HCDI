# Database encryption at rest

The SQLite file (`data/vfv.db`, plus its `-wal` / `-shm` companions) is encrypted with SQLCipher-compatible
AES-256 via `better-sqlite3-multiple-ciphers`. Every page carries an authentication tag, so tampering is
detected as well as hidden. This is what protects PHI if a disk, laptop, snapshot or backup is lost or copied.

It does **not** protect against someone who can run the app with its key (they can read everything the app
can), which is why access control, MFA and the audit log still matter. TLS in transit is separate and must
be provided by the host.

## Keys

| Variable | Purpose |
|---|---|
| `VFV_DB_KEY` | Encrypts the database file. **Required in production, at least 32 characters.** Generate with `openssl rand -base64 48`. |
| `VFV_DATA_KEY` | Encrypts individual secrets inside the database (MFA seeds) and signs form tokens. Required in production. |

Use two different values. Keep them in your platform's secret store (Key Vault, Secrets Manager, etc.), never in
the repository, and keep an offline copy under dual control. **Losing `VFV_DB_KEY` means losing the data; there is no recovery.**
In development a fixed, publicly known key is used so the encrypted path is exercised; it provides no secrecy.

## First start on an existing plaintext database

Production refuses to open a plaintext file by accident. Take a backup, then start once with
`VFV_DB_ENCRYPT_EXISTING=1`. The file is encrypted in place, verified, and the temporary plaintext copy is
overwritten and deleted; if verification fails the original is restored untouched. Remove the variable afterwards.
Development does this automatically.

## Day-to-day commands

```
npm run db:check                 # encrypted? opens with the key? integrity ok?
npm run db:backup                # encrypted snapshot into data/backups, newest 14 kept (VFV_BACKUP_KEEP)
VFV_DB_NEW_KEY=... npm run db:rekey   # rotate the key (stop the app first, back up first)
```

Backups are encrypted with the same key, so restoring one needs the key that was current when it was taken.
After a rotation, old backups still need the old key; keep it until those backups age out. The backup command
verifies its own output is encrypted and restorable. Copy backups off the host (to storage that is also encrypted
and access-controlled) and retain the audit log for six years.

## Verifying it yourself

`db:check` reports the header; you can also open the file in any SQLite tool without the key and it will report
"file is not a database". The wrong key does the same and never modifies the file.

## Limits

* Page-level encryption: file size and write timing are visible to someone with disk access.
* Keys live in process memory while the app runs.
* Application logs and `.next` caches are not part of the database; do not log PHI.

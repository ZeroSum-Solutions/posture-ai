# Privacy lifecycle and retention matrix

Status: engineering-complete fixture contract; production durations are frozen pending HG-02. Provider backup/storage proof is frozen pending HG-07 and the restore drill pending HG-08.

The application must never invent a legal retention period. `privacy_retention_policies` is therefore empty after migration. The daily maintenance route is active code but safely deletes nothing until an approved source-controlled migration inserts a policy with an approval reference. Runtime roles cannot activate or edit a policy.

| Store or surface | Data and purpose | Lifecycle start | Current action | Production duration | Approval / provider dependency |
|---|---|---|---|---|---|
| `clients` | Client profile and minimized erasure tombstone | Client enrollment | Transactional redaction on erasure; inactive `client_records` policy path uses the same operation; tombstone retained | Pending HG-02 | `client_records` policy row; backup propagation HG-07/HG-08 |
| `consent_records` | Append-only grant/withdrawal evidence and exact legal provenance | Signed or withdrawn time | Signer and notes redacted on client erasure; inactive history cleanup is typed | Pending HG-02 | `consent_history` policy row and re-consent disposition |
| `consent_tokens` | Hashed, single-use remote-consent credentials | Expiry or consumption | Immediate deletion on withdrawal/erasure; scheduled deletion supported only after policy approval | Pending HG-02 | `consent_tokens` policy row |
| `assessments`, findings, captures, recommendations | Screening measurements and minimized pose landmarks | Assessment creation | Deleted inside the client-erasure transaction | Pending HG-02 | Counsel/product disposition; backups HG-07/HG-08 |
| `reports` | Database metadata for generated PDF | Report generation | Row deleted transactionally; object path copied to durable deletion outbox first | Pending HG-02 | Storage inventory and backup coverage HG-07 |
| `posture-reports` objects | Generated PDF bytes | Object upload | Idempotent outbox deletion with lease, retry, controlled error code, and visible receipt | Pending HG-02 | Hosted bucket/orphan inventory HG-07 |
| Legacy `posture-captures` objects | Historical image capability; new captures cannot persist bytes | Historical only | No current writer; provider inventory and orphan reconciliation required | Pending inventory | HG-07 release evidence; never infer bucket is empty from code |
| Practitioner assets | Logo/media objects | Upload | Not part of client erasure; practitioner-account lifecycle is separate | Pending HG-02 | Provider inventory HG-07 |
| `workout_sessions`, runs, ratings | Guided-session content and feedback | Session creation | Cascades during client erasure; inactive independent history cleanup is typed | Pending HG-02 | `workout_history` policy row |
| `workout_share_events` | Controlled mint/rotate/revoke/access audit | Event time | No raw actor text; inactive audit cleanup is typed | Pending HG-02 | `workout_share_events` policy row |
| `client_deletion_log` | Minimized erasure receipt and external-cleanup completion | Erasure commit | Only complete receipts are eligible for inactive cleanup | Pending HG-02 | `client_deletion_receipts` policy row |
| `privacy_storage_deletion_outbox` | Protected provider object path during deletion retries | Erasure commit | Retried until complete; completed-job cleanup supported only after approval | Pending HG-02 | `completed_storage_deletion_jobs` policy row |
| `api_rate_limits` | Operational abuse counters | Fixed-window start | Cleanup supported only after approval; no client content | Pending owner approval | `api_rate_limits` policy row |
| Vercel runtime logs | Pseudonymous structured operational events | Request time | Raw IDs and arbitrary error text are hashed at the logger boundary | Provider-configured | Retention/access proof HG-07 |
| Supabase database backups / PITR | Provider copy of database state | Provider snapshot/WAL time | Application erasure cannot synchronously rewrite backups | Provider-configured | RPO/RTO, expiry, restore and erasure propagation HG-07/HG-08 |

## Enforced transitions

- Grant → use → withdraw: withdrawal appends one revocation event, clears pending consent tokens, blocks new capture through the existing consent status gate, and revokes every active workout bearer credential in the same transaction.
- Mint → open → rotate/revoke: share creation includes its run row and mint audit in one transaction. Rotation replaces the stored hash atomically; revocation clears it. The public resolver immediately returns the same generic unavailable response for the old token.
- Create client → erase: the database transaction creates a minimized receipt, queues every known report path, deletes relational screening data, redacts client and signer PII, and commits together. Provider deletion follows from the retryable outbox; a 202 response means database erasure committed while external cleanup remains visible as pending.

## Activation rule

An approved retention duration is added only by a reviewed migration that names the store, duration, approval reference, legal-hold disposition, backup behavior, and owner in the HG-02 receipt. Application/service roles have SELECT-only access to the policy table and cannot activate a period at runtime. Legal hold always wins over the cutoff. Exact cutoff semantics are `row_time <= now - retention_days`.

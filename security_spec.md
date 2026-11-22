# Taibah Net — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Default Deny**: All unmatched paths are explicitly denied (`allow read, write: if false;`).
2. **RBAC Anti-Escalation**: Users can never self-assign `role: "super_admin"` or `status: "active"` during creation, nor modify their own `role`, `status`, `discountRate`, or `balance`. Only a verified Super Admin can approve, upgrade, demote, or adjust balances.
3. **PII Isolation**: `/users/{uid}` contains `email` and `phone`. Reads (`get`/`list`) are strictly restricted to the document owner (`uid == request.auth.uid`), their direct parent agent (`resource.data.parentAgentId == request.auth.uid`), or `isSuperAdmin()`. No blanket `isSignedIn()` read exists.
4. **Email Spoofing Guard**: Bootstrapped admin email checks strictly mandate `request.auth.token.email_verified == true`.
5. **Path Variable Hardening**: Every single-document `get`, `create`, `update`, and `delete` enforces `isValidId(docId)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
6. **Temporal Integrity**: All `createdAt` fields must equal `request.time` on create and remain immutable on update; `updatedAt` must equal `request.time` on update.
7. **Terminal State Locking**: Approved/rejected `registrationRequests`, `passwordResetRequests`, and `topupRequests` cannot be altered by non-admins once resolved.
8. **Secure List Queries**: Every `allow list` validates `resource.data` against `request.auth.uid` or `isSuperAdmin()` without client delegation.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Privilege Escalation on Create**: Client creates `/users/{uid}` with `role: "super_admin"` and `status: "active"`.
2. **Self-Role Upgrade on Update**: Client updates `/users/{uid}` changing `role` from `"client"` to `"agent"` or `balance` to `999999`.
3. **Shadow Field Injection**: Client updates `/users/{uid}` adding ghost key `isVerified: true`.
4. **Admin Email Spoofing**: Unauthenticated or unverified token (`email_verified: false`) with `email: "nabil77444@gmail.com"` attempts to read `/users`.
5. **Cross-User PII Scraping**: Client A attempts `get` on `/users/clientB`.
6. **Unfiltered List Query**: Client A attempts `list` on `/sales` without filtering `sellerId == uid`.
7. **ID Poisoning**: Creating `/customers/` with a 200-character invalid ID containing spaces/symbols.
8. **Timestamp Forgery**: Creating `/sales/{id}` with backdated client `createdAt` instead of `request.time`.
9. **Immutable Field Tampering**: Updating `/sales/{id}` to change `sellerId` or `createdAt`.
10. **Terminal State Bypass**: Re-opening an already `"rejected"` `/topupRequests/{id}` back to `"pending"`.
11. **Oversized String DoW**: Writing a 10KB string into `notifications/{id}.body`.
12. **Audit Log Deletion/Tampering**: Any non-admin attempting to update or delete `/auditLogs/{id}`.

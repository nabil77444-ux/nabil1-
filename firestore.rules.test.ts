/**
 * Phase 0 TDD Security Test Matrix for Taibah Net Firestore Rules.
 * Verifies all 12 Dirty Dozen payloads against firestore.rules constraints.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED';
  payload?: Record<string, unknown>;
  reason: string;
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Privilege Escalation on Create',
    collection: '/users/attacker_uid',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { uid: 'attacker_uid', role: 'super_admin', status: 'active', balance: 0 },
    reason: 'Non-admin cannot create profile with super_admin role or active status.',
  },
  {
    id: 2,
    name: 'Self-Role & Balance Escalation on Update',
    collection: '/users/client_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { role: 'agent', balance: 500000, discountRate: 70 },
    reason: 'Affected keys for self-update only permit name, phone, fcmTokens, updatedAt.',
  },
  {
    id: 3,
    name: 'Shadow Field Injection',
    collection: '/users/client_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { name: 'Valid Name', isVerified: true },
    reason: 'Schema validation rejects unknown shadow fields via hasOnly.',
  },
  {
    id: 4,
    name: 'Admin Email Spoofing (Unverified Email)',
    collection: '/users',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    reason: 'isSuperAdmin() strictly requires request.auth.token.email_verified == true when checking email.',
  },
  {
    id: 5,
    name: 'Cross-User PII Scraping',
    collection: '/users/other_client_uid',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    reason: 'Users can only read own profile, direct sub-clients, or via Super Admin.',
  },
  {
    id: 6,
    name: 'Unfiltered Sales List Scraping',
    collection: '/sales',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    reason: 'allow list requires resource.data.sellerId == request.auth.uid or isSuperAdmin().',
  },
  {
    id: 7,
    name: 'Document ID Poisoning',
    collection: '/customers/invalid id $$$ ' + 'a'.repeat(150),
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidId() blocks IDs exceeding 128 chars or containing illegal characters.',
  },
  {
    id: 8,
    name: 'Client Timestamp Forgery',
    collection: '/sales/sale_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    reason: 'createdAt must strictly equal request.time.',
  },
  {
    id: 9,
    name: 'Immutable Owner Tampering',
    collection: '/sales/sale_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { sellerId: 'hijacked_uid' },
    reason: 'sellerId and createdAt are immutable after creation.',
  },
  {
    id: 10,
    name: 'Terminal State Re-opening',
    collection: '/topupRequests/req_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { status: 'pending' },
    reason: 'Resolved requests (approved/rejected) are terminal-locked for non-admins.',
  },
  {
    id: 11,
    name: 'Oversized String Resource Exhaustion',
    collection: '/notifications/notif_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { body: 'x'.repeat(5000) },
    reason: 'Notification body size strictly capped at 500 characters.',
  },
  {
    id: 12,
    name: 'Audit Log Tampering',
    collection: '/auditLogs/log_1',
    operation: 'delete',
    expected: 'PERMISSION_DENIED',
    reason: 'Audit logs are append-only and immutable.',
  },
];

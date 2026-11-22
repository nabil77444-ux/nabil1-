const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

/**
 * Resolve target FCM tokens for a recipientId ('super_admin' or user UID).
 */
async function getRecipientTokens(recipientId) {
  const tokens = new Set();

  if (recipientId === 'super_admin') {
    const adminsSnap = await db.collection('users').where('role', '==', 'super_admin').get();
    adminsSnap.forEach((docSnap) => {
      const list = docSnap.data()?.fcmTokens || [];
      list.forEach((t) => t && tokens.add(t));
    });
  } else if (recipientId) {
    const userSnap = await db.collection('users').doc(recipientId).get();
    if (userSnap.exists) {
      const list = userSnap.data()?.fcmTokens || [];
      list.forEach((t) => t && tokens.add(t));
    }
  }

  return Array.from(tokens);
}

/**
 * Send high-priority FCM push notification with Arabic RTL sound & vibration even when app is closed.
 */
async function dispatchHighPriorityPush({ recipientId, title, body, targetRoute, category }) {
  const tokens = await getRecipientTokens(recipientId);
  if (tokens.length === 0) return;

  const message = {
    tokens,
    notification: {
      title: title || 'كروت طيبة نت — TAIBAH NET',
      body: body || 'لديك إشعار جديد في شبكة طيبة نت',
    },
    data: {
      targetRoute: String(targetRoute || 'home'),
      category: String(category || 'system'),
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    },
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'taibah_net_high_priority',
        priority: 'max',
        defaultVibrateTimings: true,
        color: '#1A365D',
      },
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
          'content-available': 1,
        },
      },
    },
    webpush: {
      headers: { Urgency: 'high' },
      notification: {
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        dir: 'rtl',
        lang: 'ar',
        vibrate: [150, 75, 150],
        requireInteraction: true,
      },
    },
  };

  await admin.messaging().sendEachForMulticast(message);
}

// 1. Dispatch push whenever any notification document is created in Firestore
exports.onNotificationCreated = onDocumentCreated('notifications/{notificationId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  await dispatchHighPriorityPush({
    recipientId: data.recipientId,
    title: data.title,
    body: data.body,
    targetRoute: data.targetRoute,
    category: data.category,
  });
});

// 2. Real-time push on new Registration Request
exports.onRegistrationRequestCreated = onDocumentCreated('registrationRequests/{requestId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  await dispatchHighPriorityPush({
    recipientId: data.parentAgentId || 'super_admin',
    title: 'طلب انضمام جديد — طيبة نت',
    body: `تقدّم ${data.name} (${data.phone}) بطلب فتح حساب ${data.requestedRole === 'agent' ? 'وكيل' : 'عميل'}.`,
    targetRoute: 'agents_management',
    category: 'registration',
  });
});

// 3. Real-time push on new Topup / Feed Request
exports.onTopupRequestCreated = onDocumentCreated('topupRequests/{requestId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  await dispatchHighPriorityPush({
    recipientId: data.targetId || 'super_admin',
    title: 'طلب تغذية جديد — طيبة نت',
    body: `طلب ${data.requesterName} تغذية ${data.totalCards} كرت بإجمالي ${data.totalAmount} ر.ي.`,
    targetRoute: 'topup_requests',
    category: 'topup',
  });
});

// 4. Real-time push on Password Reset Request
exports.onPasswordResetCreated = onDocumentCreated('passwordResetRequests/{requestId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  await dispatchHighPriorityPush({
    recipientId: 'super_admin',
    title: 'طلب استعادة كلمة المرور',
    body: `طلب استعادة الحساب للمستخدم: ${data.name || data.identifier}`,
    targetRoute: 'agents_management',
    category: 'password_reset',
  });
});

// 5. Low inventory threshold monitor
exports.onPackageInventoryUpdated = onDocumentUpdated('packages/{packageId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;

  const settingsSnap = await db.collection('settings').doc('global').get();
  const threshold = settingsSnap.exists ? Number(settingsSnap.data()?.lowStockThreshold ?? 20) : 20;

  if (before.availableCount > threshold && after.availableCount <= threshold) {
    await dispatchHighPriorityPush({
      recipientId: 'super_admin',
      title: `تحذير انخفاض المخزون — فئة ${after.price} ر.ي`,
      body: `المتبقي من باقة ${after.price} ر.ي (${after.dataLabel}) هو ${after.availableCount} كرت فقط.`,
      targetRoute: 'packages',
      category: 'inventory',
    });
  }
});

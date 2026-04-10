const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { RtcTokenBuilder, RtcRole } = require('agora-token');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp, getApps } = require('firebase-admin/app');

if (!getApps().length) initializeApp();

// ── Secrets from environment (functions/.env — never committed) ───────────────
const AGORA_APP_ID          = process.env.AGORA_APP_ID;
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

// ── In-memory rate limiter ────────────────────────────────────────────────────
// Tracks call timestamps per uid. Resets on cold start (acceptable trade-off).
const rateLimitStore = new Map();

/**
 * Returns true if the caller is within their rate limit.
 * @param {string} uid
 * @param {string} key       - unique key per function (e.g. 'agora', 'push')
 * @param {number} maxCalls  - max calls allowed in the window
 * @param {number} windowMs  - rolling window in milliseconds
 */
function checkRateLimit(uid, key, maxCalls, windowMs) {
  const storeKey = `${key}:${uid}`;
  const now = Date.now();
  const timestamps = (rateLimitStore.get(storeKey) || []).filter(t => now - t < windowMs);
  if (timestamps.length >= maxCalls) return false;
  rateLimitStore.set(storeKey, [...timestamps, now]);
  return true;
}

// Periodically purge stale entries so the Map doesn't grow indefinitely.
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, timestamps] of rateLimitStore.entries()) {
    const fresh = timestamps.filter(t => t > cutoff);
    if (fresh.length === 0) rateLimitStore.delete(key);
    else rateLimitStore.set(key, fresh);
  }
}, 60 * 1000);

// ── getAgoraToken ─────────────────────────────────────────────────────────────

exports.getAgoraToken = onCall({ enforceAppCheck: false }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const uid = request.auth.uid;

  // Rate limit: 10 token requests per minute per user
  if (!checkRateLimit(uid, 'agora', 10, 60_000)) {
    throw new HttpsError('resource-exhausted', 'Too many requests — try again shortly');
  }

  const { channelName } = request.data;

  // Validate input
  if (!channelName || typeof channelName !== 'string' || channelName.length > 128) {
    throw new HttpsError('invalid-argument', 'channelName must be a non-empty string');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(channelName)) {
    throw new HttpsError('invalid-argument', 'channelName contains invalid characters');
  }

  // Verify the caller is actually a member of this crew
  const crewDoc = await getFirestore().collection('crews').doc(channelName).get();
  if (!crewDoc.exists) {
    throw new HttpsError('not-found', 'Crew not found');
  }
  const members = crewDoc.data().members || [];
  if (!members.includes(uid)) {
    throw new HttpsError('permission-denied', 'You are not a member of this crew');
  }

  if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
    throw new HttpsError('internal', 'Agora credentials not configured');
  }

  const expirationTime = Math.floor(Date.now() / 1000) + 3600;
  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    0,
    RtcRole.PUBLISHER,
    expirationTime,
    expirationTime
  );

  return { token };
});

// ── sendPushNotification ──────────────────────────────────────────────────────

exports.sendPushNotification = onCall({ enforceAppCheck: false }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const uid = request.auth.uid;

  // Rate limit: 60 notifications per minute per user (generous but bounded)
  if (!checkRateLimit(uid, 'push', 60, 60_000)) {
    throw new HttpsError('resource-exhausted', 'Too many requests — try again shortly');
  }

  const { toUid, title, body, data } = request.data;

  // Validate required fields
  if (!toUid  || typeof toUid  !== 'string') throw new HttpsError('invalid-argument', 'toUid is required');
  if (!title  || typeof title  !== 'string') throw new HttpsError('invalid-argument', 'title is required');
  if (!body   || typeof body   !== 'string') throw new HttpsError('invalid-argument', 'body is required');

  // Clamp lengths to avoid oversized payloads
  const safeTitle = title.slice(0, 100);
  const safeBody  = body.slice(0, 500);

  // Verify sender and recipient have a mutual connection (prevents cold spamming)
  const db = getFirestore();
  const [sentSnap, receivedSnap] = await Promise.all([
    db.collection('invites')
      .where('fromUid', '==', uid)
      .where('toUid',   '==', toUid)
      .where('status',  '==', 'accepted')
      .limit(1).get(),
    db.collection('invites')
      .where('fromUid', '==', toUid)
      .where('toUid',   '==', uid)
      .where('status',  '==', 'accepted')
      .limit(1).get(),
  ]);

  // Also allow if they share a crew (crew notifications)
  let connected = !sentSnap.empty || !receivedSnap.empty;
  if (!connected) {
    const crewsSnap = await db.collection('crews')
      .where('members', 'array-contains', uid)
      .get();
    connected = crewsSnap.docs.some(d => (d.data().members || []).includes(toUid));
  }

  if (!connected) {
    throw new HttpsError('permission-denied', 'Cannot send notifications to this user');
  }

  const userDoc = await db.collection('users').doc(toUid).get();
  const token = userDoc.data()?.expoPushToken;
  if (!token) return { success: false, reason: 'no token' };

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      to: token,
      title: safeTitle,
      body: safeBody,
      data: data ?? {},
      sound: 'default',
      priority: 'high',
    }),
  });

  const result = await response.json();
  return { success: true, result };
});

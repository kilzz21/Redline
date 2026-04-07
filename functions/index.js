const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { RtcTokenBuilder, RtcRole } = require('agora-token');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeApp, getApps } = require('firebase-admin/app');

if (!getApps().length) initializeApp();

const APP_ID = '16fcf0f9c28c48c2a2ab334f1734919d';
const APP_CERTIFICATE = '274063688bcd479da4b92f1d4884f670';

exports.getAgoraToken = onCall({ enforceAppCheck: false }, (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }
  const { channelName, uid } = request.data;
  const expirationTime = Math.floor(Date.now() / 1000) + 3600;
  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID,
    APP_CERTIFICATE,
    channelName,
    uid || 0,
    RtcRole.PUBLISHER,
    expirationTime,
    expirationTime
  );
  return { token };
});

exports.sendPushNotification = onCall({ enforceAppCheck: false }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const { toUid, title, body, data } = request.data;
  if (!toUid || !title || !body) {
    throw new HttpsError('invalid-argument', 'toUid, title, and body are required');
  }

  const userDoc = await getFirestore().collection('users').doc(toUid).get();
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
      title,
      body,
      data: data ?? {},
      sound: 'default',
      priority: 'high',
    }),
  });

  const result = await response.json();
  return { success: true, result };
});

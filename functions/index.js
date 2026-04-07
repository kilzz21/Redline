const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { RtcTokenBuilder, RtcRole } = require('agora-token');

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

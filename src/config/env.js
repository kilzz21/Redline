import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? {};

/** Google Places / Maps API key */
export const GOOGLE_PLACES_KEY = extra.googlePlacesKey ?? '';

/** Agora RTC App ID (public — certificate stays server-side in Cloud Functions) */
export const AGORA_APP_ID = extra.agoraAppId ?? '';

/** Firebase API key (client-safe — protected by Firebase Security Rules) */
export const FIREBASE_API_KEY = extra.firebaseApiKey ?? '';

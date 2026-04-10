import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

// Firebase client config is intentionally public — it's a project identifier,
// not a secret. Security is enforced by Firestore Security Rules, not by
// keeping these values hidden. See: firebase.google.com/docs/projects/api-keys
const firebaseConfig = {
  apiKey: "AIzaSyCL-42Fsg_bBb_RoxdD6naloclt25vW9V0",
  authDomain: "redline-191fa.firebaseapp.com",
  projectId: "redline-191fa",
  storageBucket: "redline-191fa.firebasestorage.app",
  messagingSenderId: "757555216302",
  appId: "1:757555216302:web:1419694ab19426e411923f"
};

const app = initializeApp(firebaseConfig);

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage),
});

export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

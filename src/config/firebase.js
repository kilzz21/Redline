import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCL-42Fsg_bBb_RoxdD6naloclt25vW9V0",
  authDomain: "redline-191fa.firebaseapp.com",
  projectId: "redline-191fa",
  storageBucket: "redline-191fa.firebasestorage.app",
  messagingSenderId: "757555216302",
  appId: "1:757555216302:web:1419694ab19426e411923f"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

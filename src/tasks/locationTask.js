import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

export const LOCATION_TASK = 'background-location-task';

function toMph(mps) {
  return mps != null && mps > 0 ? mps * 2.23694 : 0;
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const uid = auth.currentUser?.uid;
  if (!uid || !data?.locations?.length) return;
  const coords = data.locations[data.locations.length - 1].coords;
  try {
    await setDoc(
      doc(db, 'users', uid),
      {
        latitude: coords.latitude,
        longitude: coords.longitude,
        speed: Math.round(toMph(coords.speed ?? 0)),
        lastSeen: serverTimestamp(),
      },
      { merge: true }
    );
  } catch {}
});

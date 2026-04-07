import { useEffect, useRef, useState } from 'react';
import {
  collection, query, where, onSnapshot, documentId,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';

/**
 * Returns an array of Firestore user profile objects for all accepted crew members.
 * Listens to both directions of the invites collection in real time.
 *
 * Note: Firestore requires composite indexes for the invite queries.
 * If you see an index error, follow the link in the console to create them.
 */
export function useAcceptedCrew() {
  const [crewProfiles, setCrewProfiles] = useState([]);
  const uid = auth.currentUser?.uid;
  const profileUnsubsRef = useRef([]);

  // Mutable refs for crew UIDs from each direction
  const uidsFromMeRef = useRef([]);
  const uidsToMeRef = useRef([]);

  useEffect(() => {
    if (!uid) return;

    function subscribeToProfiles() {
      // Tear down old profile listeners
      profileUnsubsRef.current.forEach((u) => u());
      profileUnsubsRef.current = [];

      const allUids = [
        ...new Set([...uidsFromMeRef.current, ...uidsToMeRef.current]),
      ];

      if (allUids.length === 0) {
        setCrewProfiles([]);
        return;
      }

      // Batch into chunks of 30 (Firestore 'in' limit)
      const chunks = [];
      for (let i = 0; i < allUids.length; i += 30) {
        chunks.push(allUids.slice(i, i + 30));
      }

      const profileMap = {};

      chunks.forEach((chunk) => {
        const q = query(
          collection(db, 'users'),
          where(documentId(), 'in', chunk)
        );
        const unsub = onSnapshot(q, (snap) => {
          snap.docs.forEach((d) => {
            profileMap[d.id] = { id: d.id, ...d.data() };
          });
          setCrewProfiles(Object.values(profileMap));
        });
        profileUnsubsRef.current.push(unsub);
      });
    }

    // Invites I sent that were accepted
    const q1 = query(
      collection(db, 'invites'),
      where('fromUid', '==', uid),
      where('status', '==', 'accepted')
    );
    const unsub1 = onSnapshot(q1, (snap) => {
      uidsFromMeRef.current = snap.docs.map((d) => d.data().toUid);
      subscribeToProfiles();
    });

    // Invites I received that I accepted
    const q2 = query(
      collection(db, 'invites'),
      where('toUid', '==', uid),
      where('status', '==', 'accepted')
    );
    const unsub2 = onSnapshot(q2, (snap) => {
      uidsToMeRef.current = snap.docs.map((d) => d.data().fromUid);
      subscribeToProfiles();
    });

    return () => {
      unsub1();
      unsub2();
      profileUnsubsRef.current.forEach((u) => u());
    };
  }, [uid]);

  return crewProfiles;
}

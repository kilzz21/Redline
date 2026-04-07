import { useEffect, useRef, useState } from 'react';
import {
  collection, query, where, onSnapshot, documentId,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../config/firebase';

/**
 * Subscribes to all crews where the current user is a member.
 * Returns an array of crew documents enriched with a `memberProfiles` array.
 *
 * Uses onAuthStateChanged so the query fires correctly even if auth hasn't
 * resolved at hook-call time (cold-start race condition).
 */
export function useCrews() {
  const [crews, setCrews] = useState([]);

  const crewDocsRef = useRef([]);
  const profileMapRef = useRef({});
  const profileUnsubsRef = useRef([]);

  useEffect(() => {
    let unsubCrews = null;

    function rebuildCrews() {
      setCrews(
        crewDocsRef.current.map((crew) => ({
          ...crew,
          memberProfiles: (crew.members || []).map(
            (id) => profileMapRef.current[id] || { id }
          ),
        }))
      );
    }

    function teardown() {
      if (unsubCrews) { unsubCrews(); unsubCrews = null; }
      profileUnsubsRef.current.forEach((u) => u());
      profileUnsubsRef.current = [];
      crewDocsRef.current = [];
      profileMapRef.current = {};
    }

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      teardown();

      if (!user) {
        setCrews([]);
        return;
      }

      const uid = user.uid;
      const crewQuery = query(
        collection(db, 'crews'),
        where('members', 'array-contains', uid)
      );

      unsubCrews = onSnapshot(crewQuery, (snap) => {
        crewDocsRef.current = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const allUids = [
          ...new Set(crewDocsRef.current.flatMap((c) => c.members || [])),
        ];

        // Tear down stale profile listeners
        profileUnsubsRef.current.forEach((u) => u());
        profileUnsubsRef.current = [];

        if (allUids.length === 0) {
          rebuildCrews();
          return;
        }

        // Subscribe to member profiles in chunks of 30 (Firestore `in` limit)
        for (let i = 0; i < allUids.length; i += 30) {
          const chunk = allUids.slice(i, i + 30);
          const profileQuery = query(
            collection(db, 'users'),
            where(documentId(), 'in', chunk)
          );
          const unsub = onSnapshot(profileQuery, (pSnap) => {
            pSnap.docs.forEach((d) => {
              profileMapRef.current[d.id] = { id: d.id, ...d.data() };
            });
            rebuildCrews();
          });
          profileUnsubsRef.current.push(unsub);
        }

        rebuildCrews();
      });
    });

    return () => {
      unsubAuth();
      teardown();
    };
  }, []);

  return crews;
}

import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Linking, Animated, Easing,
} from 'react-native';
import MapView, { Marker, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';
import {
  doc, setDoc, addDoc, collection,
  onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';

// ─── Constants ────────────────────────────────────────────────────────────────

const ORANGE = '#f97316';
const SPEED_THRESHOLD_MPH = 5;   // below this = stopped
const PRE_DRIVE_MS = 2 * 60 * 1000; // 2 min above threshold → start drive
const STOP_DELAY_MS = 30 * 1000;    // 30 s below threshold → end drive

const MEMBER_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#f59e0b', '#06b6d4'];

// ─── Pure utilities ───────────────────────────────────────────────────────────

/** Haversine distance in miles between two lat/lng points */
function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Deterministic color from uid */
function getMemberColor(uid) {
  const n = uid.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return MEMBER_COLORS[n % MEMBER_COLORS.length];
}

/** First letter of each name part, max 2 chars */
function getInitials(name) {
  if (!name) return '??';
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** m/s → mph, clamp negatives to 0 */
function toMph(ms) {
  return ms > 0 ? ms * 2.237 : 0;
}

// ─── Pulsing dot ──────────────────────────────────────────────────────────────

function PulsingDot() {
  const scale = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 2.2, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(ringOpacity, { toValue: 0, duration: 900, useNativeDriver: true }),
          Animated.timing(ringOpacity, { toValue: 0.7, duration: 0, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, [scale, ringOpacity]);

  return (
    <View style={styles.dotWrap}>
      <Animated.View style={[styles.dotRing, { transform: [{ scale }], opacity: ringOpacity }]} />
      <View style={styles.dotCore} />
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function MapScreen() {
  const [location, setLocation] = useState(null);
  const [permDenied, setPermDenied] = useState(false);
  const [crewMembers, setCrewMembers] = useState([]);
  const [talking, setTalking] = useState(false);

  // Refs shared across effects and callbacks
  const locationRef = useRef(null);
  const watchRef = useRef(null);

  // Drive state machine refs
  const driveStateRef = useRef('IDLE'); // IDLE | PRE_DRIVE | DRIVING | STOPPING
  const driveDataRef = useRef(null);
  const preDriveTimerRef = useRef(null);
  const stopTimerRef = useRef(null);

  // ── Effect 1: GPS + Firestore location push + drive detection ───────────────
  useEffect(() => {
    let firestoreInterval;

    // Push current location to user's Firestore doc
    async function pushLocation() {
      const loc = locationRef.current;
      const uid = auth.currentUser?.uid;
      if (!loc || !uid) return;
      try {
        await setDoc(
          doc(db, 'users', uid),
          {
            latitude: loc.latitude,
            longitude: loc.longitude,
            speed: Math.round(toMph(loc.speed)),
            lastSeen: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (e) {
        console.warn('Location push failed:', e.message);
      }
    }

    // Persist completed drive to Firestore
    async function saveDrive() {
      driveStateRef.current = 'IDLE';
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;

      const drive = driveDataRef.current;
      driveDataRef.current = null;
      const uid = auth.currentUser?.uid;
      if (!drive || !uid || drive.coords.length < 2) return;

      const endTime = new Date();
      const { startTime, coords, speeds, topSpeed } = drive;

      // Haversine distance over each consecutive GPS point
      let distanceMiles = 0;
      for (let i = 1; i < coords.length; i++) {
        distanceMiles += haversineMiles(
          coords[i - 1].lat, coords[i - 1].lng,
          coords[i].lat, coords[i].lng
        );
      }

      const avgSpeed = speeds.length
        ? speeds.reduce((a, b) => a + b, 0) / speeds.length
        : 0;

      try {
        await addDoc(collection(db, 'users', uid, 'drives'), {
          startTime,
          endTime,
          topSpeed: Math.round(topSpeed * 10) / 10,
          avgSpeed: Math.round(avgSpeed * 10) / 10,
          distance: Math.round(distanceMiles * 100) / 100,
          coordinates: coords,
        });
        console.log(`Drive saved: ${distanceMiles.toFixed(2)} mi, top ${topSpeed.toFixed(0)} mph`);
      } catch (e) {
        console.warn('Drive save failed:', e.message);
      }
    }

    // Drive state machine — called on every GPS update
    function processDrive(coords, speedMph) {
      const state = driveStateRef.current;

      if (state === 'IDLE') {
        if (speedMph >= SPEED_THRESHOLD_MPH) {
          driveStateRef.current = 'PRE_DRIVE';
          driveDataRef.current = {
            startTime: new Date(),
            coords: [{ lat: coords.latitude, lng: coords.longitude, t: Date.now() }],
            speeds: [speedMph],
            topSpeed: speedMph,
          };
          preDriveTimerRef.current = setTimeout(() => {
            if (driveStateRef.current === 'PRE_DRIVE') {
              driveStateRef.current = 'DRIVING';
              console.log('Drive started');
            }
          }, PRE_DRIVE_MS);
        }
      } else if (state === 'PRE_DRIVE') {
        if (speedMph >= SPEED_THRESHOLD_MPH) {
          driveDataRef.current.coords.push({ lat: coords.latitude, lng: coords.longitude, t: Date.now() });
          driveDataRef.current.speeds.push(speedMph);
          if (speedMph > driveDataRef.current.topSpeed) driveDataRef.current.topSpeed = speedMph;
        } else {
          // Stopped before 2 min — cancel
          clearTimeout(preDriveTimerRef.current);
          driveStateRef.current = 'IDLE';
          driveDataRef.current = null;
        }
      } else if (state === 'DRIVING') {
        if (speedMph >= SPEED_THRESHOLD_MPH) {
          driveDataRef.current.coords.push({ lat: coords.latitude, lng: coords.longitude, t: Date.now() });
          driveDataRef.current.speeds.push(speedMph);
          if (speedMph > driveDataRef.current.topSpeed) driveDataRef.current.topSpeed = speedMph;
          // Resume from a brief slowdown
          if (stopTimerRef.current) {
            clearTimeout(stopTimerRef.current);
            stopTimerRef.current = null;
          }
        } else if (!stopTimerRef.current) {
          // Speed dropped — start stop window
          driveStateRef.current = 'STOPPING';
          stopTimerRef.current = setTimeout(() => saveDrive(), STOP_DELAY_MS);
        }
      } else if (state === 'STOPPING') {
        if (speedMph >= SPEED_THRESHOLD_MPH) {
          // Resumed — cancel stop
          clearTimeout(stopTimerRef.current);
          stopTimerRef.current = null;
          driveStateRef.current = 'DRIVING';
          driveDataRef.current.coords.push({ lat: coords.latitude, lng: coords.longitude, t: Date.now() });
          driveDataRef.current.speeds.push(speedMph);
          if (speedMph > driveDataRef.current.topSpeed) driveDataRef.current.topSpeed = speedMph;
        }
      }
    }

    async function start() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setPermDenied(true); return; }

      const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation(initial.coords);
      locationRef.current = initial.coords;

      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10 },
        (loc) => {
          setLocation(loc.coords);
          locationRef.current = loc.coords;
          processDrive(loc.coords, toMph(loc.coords.speed));
        }
      );

      firestoreInterval = setInterval(pushLocation, 10000);
      pushLocation(); // push immediately on mount too
    }

    start();

    return () => {
      watchRef.current?.remove();
      clearInterval(firestoreInterval);
      clearTimeout(preDriveTimerRef.current);
      // Save in-progress drive on unmount
      if (driveStateRef.current === 'DRIVING' || driveStateRef.current === 'STOPPING') {
        clearTimeout(stopTimerRef.current);
        saveDrive();
      }
    };
  }, []);

  // ── Effect 2: real-time crew locations from Firestore ───────────────────────
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const members = [];
      snapshot.forEach((snap) => {
        if (snap.id === uid) return; // skip self
        const d = snap.data();
        if (d.latitude == null || d.longitude == null) return;
        members.push({
          id: snap.id,
          name: d.name || 'Unknown',
          latitude: d.latitude,
          longitude: d.longitude,
          speed: d.speed ?? 0,
          color: getMemberColor(snap.id),
        });
      });
      setCrewMembers(members);
    });

    return unsubscribe;
  }, []);

  // ── Derived values ───────────────────────────────────────────────────────────

  const region = location
    ? { latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 }
    : { latitude: 34.0522, longitude: -118.2437, latitudeDelta: 0.015, longitudeDelta: 0.015 };

  const sessionLabel = crewMembers.length > 0
    ? `${crewMembers.length + 1} in convoy`
    : 'just you · start a convoy';

  const openWaze = () => Linking.openURL('waze://');

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* ── Map (60%) ──────────────────────────────────────── */}
      <View style={styles.mapWrap}>
        <MapView
          style={styles.map}
          region={region}
          mapType="none"
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          rotateEnabled={false}
        >
          <UrlTile
            urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maximumZ={19}
            flipY={false}
            tileSize={256}
          />

          {/* User marker */}
          {location && (
            <Marker
              coordinate={{ latitude: location.latitude, longitude: location.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <PulsingDot />
            </Marker>
          )}

          {/* Live crew markers from Firestore */}
          {crewMembers.map((m) => (
            <Marker
              key={m.id}
              coordinate={{ latitude: m.latitude, longitude: m.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View style={styles.crewMarker}>
                <View style={[styles.crewMarkerDot, { backgroundColor: m.color }]} />
                <Text style={styles.crewMarkerLabel}>
                  {getInitials(m.name)} · {m.speed}mph
                </Text>
              </View>
            </Marker>
          ))}
        </MapView>

        {permDenied && (
          <View style={styles.permBanner}>
            <Text style={styles.permText}>Location permission denied — enable in Settings</Text>
          </View>
        )}
      </View>

      {/* ── Bottom sheet (40%) ─────────────────────────────── */}
      <View style={styles.sheet}>

        <Text style={styles.sessionLabel}>{sessionLabel}</Text>

        {/* Live crew rows */}
        {crewMembers.map((m) => {
          const distMiles = location
            ? haversineMiles(location.latitude, location.longitude, m.latitude, m.longitude)
            : null;
          const distLabel = distMiles != null
            ? distMiles < 0.1 ? 'nearby' : `${distMiles.toFixed(1)}mi away`
            : '';

          return (
            <View key={m.id} style={styles.crewRow}>
              <View style={[styles.avatar, { backgroundColor: m.color }]}>
                <Text style={styles.avatarText}>{getInitials(m.name)}</Text>
              </View>
              <View style={styles.crewMeta}>
                <View style={styles.crewNameRow}>
                  <View style={styles.onlineDot} />
                  <Text style={styles.crewName}>{m.name}</Text>
                </View>
                <Text style={styles.crewSpeed}>{m.speed} mph</Text>
              </View>
              <Text style={styles.crewDistance}>{distLabel}</Text>
            </View>
          );
        })}

        {crewMembers.length === 0 && (
          <Text style={styles.emptyCrewText}>no crew online · invite friends to start a convoy</Text>
        )}

        <View style={styles.divider} />

        {/* Waze */}
        <TouchableOpacity style={styles.wazeRow} onPress={openWaze} activeOpacity={0.7}>
          <View style={styles.wazeIcon}>
            <Text style={styles.wazeIconText}>W</Text>
          </View>
          <View style={styles.wazeTextWrap}>
            <Text style={styles.wazeTitle}>navigate with Waze</Text>
            <Text style={styles.wazeSub}>speed cams · police · Redline keeps logging</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        {/* Hold to talk */}
        <TouchableOpacity
          style={[styles.holdBtn, talking && styles.holdBtnActive]}
          onPressIn={() => setTalking(true)}
          onPressOut={() => setTalking(false)}
          activeOpacity={1}
        >
          <Text style={[styles.holdBtnText, talking && styles.holdBtnTextActive]}>
            {talking ? 'talking…' : 'hold to talk'}
          </Text>
        </TouchableOpacity>

      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },

  // Map
  mapWrap: { flex: 6 },
  map: { flex: 1 },
  permBanner: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#1a1a1a', padding: 10, alignItems: 'center',
  },
  permText: { color: '#888', fontSize: 12 },

  // User dot
  dotWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  dotRing: {
    position: 'absolute', width: 24, height: 24,
    borderRadius: 12, backgroundColor: ORANGE,
  },
  dotCore: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: ORANGE, borderWidth: 2, borderColor: '#fff',
  },

  // Crew markers
  crewMarker: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(17,17,17,0.8)',
    borderRadius: 10, paddingHorizontal: 6, paddingVertical: 3,
  },
  crewMarkerDot: { width: 8, height: 8, borderRadius: 4, marginRight: 5 },
  crewMarkerLabel: { color: '#fff', fontSize: 11, fontWeight: '600' },

  // Sheet
  sheet: {
    flex: 4, backgroundColor: '#111',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: '#2a2a2a',
  },
  sessionLabel: {
    color: '#555', fontSize: 11, fontWeight: '500',
    marginBottom: 10, letterSpacing: 0.3,
  },
  emptyCrewText: {
    color: '#333', fontSize: 11, marginBottom: 10, fontStyle: 'italic',
  },

  // Crew rows
  crewRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  avatar: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  avatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  crewMeta: { flex: 1 },
  crewNameRow: { flexDirection: 'row', alignItems: 'center' },
  onlineDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#22c55e', marginRight: 5,
  },
  crewName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  crewSpeed: { color: '#888', fontSize: 12, marginTop: 1 },
  crewDistance: { color: '#555', fontSize: 12 },

  divider: { height: 1, backgroundColor: '#2a2a2a', marginBottom: 10 },

  // Waze
  wazeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  wazeIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#1a6efc', alignItems: 'center',
    justifyContent: 'center', marginRight: 10,
  },
  wazeIconText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  wazeTextWrap: { flex: 1 },
  wazeTitle: { color: '#fff', fontSize: 13, fontWeight: '600' },
  wazeSub: { color: '#555', fontSize: 11, marginTop: 1 },
  chevron: { color: '#555', fontSize: 20, marginLeft: 6 },

  // Hold to talk
  holdBtn: {
    backgroundColor: '#1a1a1a', borderRadius: 14,
    borderWidth: 1, borderColor: '#2a2a2a',
    paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
  },
  holdBtnActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  holdBtnText: { color: '#888', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  holdBtnTextActive: { color: '#fff' },
});

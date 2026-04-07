import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Linking, Animated, Easing, Image, ScrollView, Alert, TextInput,
  Modal, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import {
  doc, setDoc, addDoc, collection, serverTimestamp, onSnapshot, updateDoc, deleteField, increment,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../config/firebase';
import { GOOGLE_PLACES_KEY } from '../config/keys';
import { useCrews } from '../hooks/useCrews';
import { useMic } from '../context/MicContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const ORANGE = '#f97316';
const SPEED_THRESHOLD_MPH = 5;
const PRE_DRIVE_MS = 2 * 60 * 1000;
const STOP_DELAY_MS = 30 * 1000;
const TRAIL_MAX_AGE_MS = 5 * 60 * 1000;
const TRAIL_MAX_POINTS = 30;
const ARRIVED_THRESHOLD_MILES = 0.124; // ~200 meters
const MEMBER_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#f59e0b', '#06b6d4'];

// ─── Utilities ────────────────────────────────────────────────────────────────

function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

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

function getMemberColor(uid) {
  const n = (uid || 'x').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return MEMBER_COLORS[n % MEMBER_COLORS.length];
}

function getInitials(name) {
  if (!name) return '??';
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function toMph(ms) {
  return ms != null && ms > 0 ? ms * 2.237 : 0;
}

function etaLabel(distMiles, speedMph) {
  if (!speedMph || speedMph < 2) return null;
  const mins = Math.round((distMiles / speedMph) * 60);
  if (mins < 1) return '< 1 min';
  return `~${mins} min`;
}

function pushNotify(toUid, title, body, data = {}) {
  httpsCallable(functions, 'sendPushNotification')({ toUid, title, body, data })
    .catch((e) => console.warn('[push]', e.message));
}

// ─── Pulsing dot (self) ───────────────────────────────────────────────────────

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

// ─── Destination pin (pulsing orange) ────────────────────────────────────────

function DestinationPin({ name }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 2.8, duration: 1300, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0, duration: 1300, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.6, duration: 0, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, [scale, opacity]);

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{
          position: 'absolute', width: 36, height: 36, borderRadius: 18,
          backgroundColor: ORANGE, transform: [{ scale }], opacity,
        }} />
        <View style={{
          width: 16, height: 16, borderRadius: 8,
          backgroundColor: ORANGE, borderWidth: 2.5, borderColor: '#fff',
        }} />
      </View>
      {name ? (
        <View style={styles.destLabel}>
          <Ionicons name="location" size={10} color={ORANGE} />
          <Text style={styles.destLabelText} numberOfLines={1}>{name}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Set Meetup Modal ─────────────────────────────────────────────────────────

async function searchPlaces(query, userLat, userLng) {
  const headers = { 'X-Ios-Bundle-Identifier': 'com.kilzz21.redline' };

  const locationParam = (userLat != null && userLng != null)
    ? `&location=${userLat},${userLng}&radius=50000`
    : '';
  const autocompleteUrl =
    `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
    `?input=${encodeURIComponent(query)}${locationParam}&key=${GOOGLE_PLACES_KEY}`;

  const acRes = await fetch(autocompleteUrl, { headers });
  const acData = await acRes.json();
  console.log('[Places autocomplete] status:', acData.status, acData.error_message ?? '');
  if (!acData.predictions?.length) return [];

  const results = await Promise.all(
    acData.predictions.slice(0, 6).map(async (p) => {
      const detailUrl =
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${p.place_id}&fields=name,geometry,formatted_address&key=${GOOGLE_PLACES_KEY}`;
      const detailRes = await fetch(detailUrl, { headers });
      const detail = await detailRes.json();
      console.log('[Places details] status:', detail.status, detail.error_message ?? '');
      const loc = detail.result?.geometry?.location;
      if (!loc) return null;
      return {
        name: p.structured_formatting.main_text,
        fullAddress: p.structured_formatting.secondary_text ?? detail.result.formatted_address ?? '',
        latitude: loc.lat,
        longitude: loc.lng,
        distance: (userLat != null && userLng != null)
          ? haversineMiles(userLat, userLng, loc.lat, loc.lng)
          : null,
      };
    })
  );

  return results
    .filter(Boolean)
    .sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999));
}

function SetMeetupModal({ visible, onClose, onSet, mapCenterRef }) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [gpsLocation, setGpsLocation] = useState(null);
  const [gpsLocating, setGpsLocating] = useState(false);
  const debounceRef = useRef(null);

  // Get a fresh GPS fix when the modal opens
  useEffect(() => {
    if (!visible) return;
    setGpsLocating(true);
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then((loc) => setGpsLocation(loc.coords))
      .catch(() => {}) // silently fall back to no location bias
      .finally(() => setGpsLocating(false));
  }, [visible]);

  const runSearch = useCallback(async (text) => {
    if (!text.trim() || text.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    setError('');
    try {
      const hits = await searchPlaces(text, gpsLocation?.latitude, gpsLocation?.longitude);
      setResults(hits);
      if (!hits.length) setError('no results found');
    } catch {
      setError('search failed — check your connection');
    } finally {
      setSearching(false);
    }
  }, [gpsLocation]);

  const onChangeText = (text) => {
    setQuery(text);
    setSelected(null);
    setError('');
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), 300);
  };

  const pickResult = (r) => {
    setSelected(r);
    setResults([]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const dropPin = () => {
    const center = mapCenterRef?.current;
    if (!center) return;
    pickResult({
      name: 'Dropped pin',
      fullAddress: `${center.latitude.toFixed(5)}, ${center.longitude.toFixed(5)}`,
      latitude: center.latitude,
      longitude: center.longitude,
      distance: 0,
    });
  };

  const confirm = () => {
    if (!selected) return;
    onSet(selected);
    setQuery(''); setSelected(null); setResults([]); setError('');
    onClose();
  };

  const reset = () => {
    setQuery(''); setSelected(null); setResults([]); setError('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={reset}>
      <KeyboardAvoidingView
        style={[styles.modalRoot, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={reset} style={styles.modalHeaderBtn}>
            <Text style={styles.modalCancel}>cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>set meetup</Text>
          <TouchableOpacity onPress={confirm} disabled={!selected} style={styles.modalHeaderBtn}>
            <Text style={[styles.modalSave, !selected && { opacity: 0.3 }]}>set</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.modalBody}>
          {/* Search bar */}
          <View style={[styles.searchRow, selected && { borderColor: '#22c55e55' }]}>
            <TextInput
              style={styles.searchInput}
              placeholder="search restaurants, addresses, places..."
              placeholderTextColor="#444"
              value={query}
              onChangeText={onChangeText}
              returnKeyType="search"
              onSubmitEditing={() => runSearch(query)}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searching
              ? <ActivityIndicator size="small" color={ORANGE} style={{ marginRight: 4 }} />
              : <Ionicons name="search" size={18} color="#444" />
            }
          </View>

          {/* GPS status + drop pin */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            {searching
              ? <Text style={styles.dropPinText}>searching nearby...</Text>
              : gpsLocating
                ? <Text style={styles.dropPinText}>locating you...</Text>
                : gpsLocation
                  ? <Text style={styles.dropPinText}>📍 results sorted by distance from you</Text>
                  : <Text style={styles.dropPinText}>results may not be sorted by distance</Text>
            }
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} onPress={dropPin} activeOpacity={0.7}>
              <Ionicons name="pin-outline" size={14} color="#888" />
              <Text style={styles.dropPinText}>drop pin</Text>
            </TouchableOpacity>
          </View>

          {/* Selected result */}
          {selected && (
            <View style={styles.selectedCard}>
              <View style={styles.selectedDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.resultName}>{selected.name}</Text>
                <Text style={styles.resultAddr} numberOfLines={1}>{selected.fullAddress}</Text>
              </View>
              <TouchableOpacity onPress={() => { setSelected(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={18} color="#555" />
              </TouchableOpacity>
            </View>
          )}

          {/* Error */}
          {error && !selected ? <Text style={styles.searchError}>{error}</Text> : null}

          {/* Results list */}
          {!selected && results.length > 0 && (
            <ScrollView
              style={styles.resultsList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {results.map((r, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.resultRow}
                  onPress={() => pickResult(r)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="location-outline" size={16} color="#555" style={{ marginRight: 10, marginTop: 1 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultName} numberOfLines={1}>{r.name}</Text>
                    {r.fullAddress ? <Text style={styles.resultAddr} numberOfLines={1}>{r.fullAddress}</Text> : null}
                  </View>
                  {r.distance != null && (
                    <Text style={[styles.resultDist, { color: ORANGE }]}>
                      {r.distance < 0.1 ? 'nearby' : `${r.distance.toFixed(1)} mi`}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function MapScreen({ navigation }) {
  const uid = auth.currentUser?.uid;
  const crews = useCrews();
  const { channelName } = useMic();

  const [location, setLocation] = useState(null);
  const [locating, setLocating] = useState(true);
  const [permDenied, setPermDenied] = useState(false);
  const [selectedCrewId, setSelectedCrewId] = useState(null);
  const [currentSpeedMph, setCurrentSpeedMph] = useState(0);
  const [autoZoomed, setAutoZoomed] = useState(false);
  const [myProfile, setMyProfile] = useState(null);
  const [destination, setDestination] = useState(null); // { name, latitude, longitude, setBy, setByName }
  const [showMeetupModal, setShowMeetupModal] = useState(false);
  const [otw, setOtw] = useState(false);
  const [smoothedPositions, setSmoothedPositions] = useState({});

  const crewsRef = useRef([]);
  crewsRef.current = crews;
  const locationRef = useRef(null);
  const watchRef = useRef(null);
  const mapRef = useRef(null);
  const mapCenterRef = useRef(null);
  const trailsRef = useRef({});
  const driveStateRef = useRef('IDLE');
  const driveDataRef = useRef(null);
  const preDriveTimerRef = useRef(null);
  const stopTimerRef = useRef(null);
  const arrivedRef = useRef(false);
  const destinationRef = useRef(null);
  const selectedCrewIdRef = useRef(null);
  const myProfileRef = useRef(null);
  const targetPositionsRef = useRef({});
  const smoothedPositionsRef = useRef({});

  destinationRef.current = destination;
  selectedCrewIdRef.current = selectedCrewId;
  myProfileRef.current = myProfile;

  // ── My profile subscription ───────────────────────────────────────────────

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'users', uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setMyProfile({ id: uid, ...data });
        setOtw(data.otwToDestination ?? false);
      }
    });
  }, [uid]);

  // ── Destination subscription (selected crew or first crew if only one) ─────

  useEffect(() => {
    const crewId = selectedCrewId ?? (crews.length === 1 ? crews[0]?.id : null);
    if (!crewId) {
      setDestination(null);
      arrivedRef.current = false;
      return;
    }
    return onSnapshot(doc(db, 'crews', crewId), (snap) => {
      if (snap.exists()) {
        const dest = snap.data().destination ?? null;
        setDestination(dest);
        destinationRef.current = dest;
        if (!dest) arrivedRef.current = false; // reset when destination cleared
      }
    });
  }, [selectedCrewId, crews.length]);

  // ── Smooth position interpolation (20fps) ────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      const targets = targetPositionsRef.current;
      const smoothed = smoothedPositionsRef.current;
      const updates = {};
      let changed = false;
      for (const [id, target] of Object.entries(targets)) {
        const cur = smoothed[id];
        if (!cur) {
          updates[id] = target;
          changed = true;
          continue;
        }
        const ALPHA = 0.22;
        const newLat = cur.latitude + (target.latitude - cur.latitude) * ALPHA;
        const newLng = cur.longitude + (target.longitude - cur.longitude) * ALPHA;
        if (Math.abs(newLat - cur.latitude) > 1e-7 || Math.abs(newLng - cur.longitude) > 1e-7) {
          updates[id] = { latitude: newLat, longitude: newLng };
          changed = true;
        }
      }
      if (changed) {
        Object.assign(smoothedPositionsRef.current, updates);
        setSmoothedPositions((prev) => ({ ...prev, ...updates }));
      }
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // ── GPS + Firestore + drive detection ─────────────────────────────────────

  useEffect(() => {
    async function pushLocation(coords) {
      const currentUid = auth.currentUser?.uid;
      if (!coords || !currentUid) return;
      try {
        await setDoc(
          doc(db, 'users', currentUid),
          {
            latitude: coords.latitude,
            longitude: coords.longitude,
            speed: Math.round(toMph(coords.speed ?? 0)),
            lastSeen: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (e) {
        console.warn('Location push failed:', e.message);
      }
    }

    function checkGeofence(coords) {
      const dest = destinationRef.current;
      if (!dest || arrivedRef.current) return;
      const dist = haversineMiles(coords.latitude, coords.longitude, dest.latitude, dest.longitude);
      if (dist < ARRIVED_THRESHOLD_MILES) {
        arrivedRef.current = true;
        handleArrived(coords, dest);
      }
    }

    async function handleArrived(coords, dest) {
      const currentUid = auth.currentUser?.uid;
      if (!currentUid) return;
      try {
        await setDoc(doc(db, 'users', currentUid), {
          arrivedAtDestination: true,
          otwToDestination: false,
        }, { merge: true });

        const crewId = selectedCrewIdRef.current ?? (crewsRef.current.length === 1 ? crewsRef.current[0]?.id : null);
        const crew = crewsRef.current.find((c) => c.id === crewId);
        if (crew) {
          const myName = myProfileRef.current?.name || auth.currentUser?.email || 'Someone';
          crew.members.forEach((memberId) => {
            if (memberId !== currentUid) {
              pushNotify(memberId, '📍 arrived!', `${myName} arrived at ${dest.name}`, { type: 'crewInvite' });
            }
          });
        }
      } catch (e) {
        console.warn('Arrived update failed:', e.message);
      }
    }

    function computeBearing(a, b) {
      const lat1 = (a.lat * Math.PI) / 180;
      const lat2 = (b.lat * Math.PI) / 180;
      const dLng = ((b.lng - a.lng) * Math.PI) / 180;
      const y = Math.sin(dLng) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
      return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    function computeTurnCount(coords) {
      if (coords.length < 3) return 0;
      let turns = 0;
      for (let i = 1; i < coords.length - 1; i++) {
        const h1 = computeBearing(coords[i - 1], coords[i]);
        const h2 = computeBearing(coords[i], coords[i + 1]);
        const diff = Math.abs(((h2 - h1 + 540) % 360) - 180);
        if (diff > 25) turns++;
      }
      return turns;
    }

    async function saveDrive() {
      driveStateRef.current = 'IDLE';
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
      const drive = driveDataRef.current;
      driveDataRef.current = null;
      const currentUid = auth.currentUser?.uid;
      if (!drive || !currentUid || drive.coords.length < 2) return;
      const endTime = new Date();
      const { startTime, coords, speeds, topSpeed } = drive;
      let distanceMiles = 0;
      for (let i = 1; i < coords.length; i++) {
        distanceMiles += haversineMiles(coords[i - 1].lat, coords[i - 1].lng, coords[i].lat, coords[i].lng);
      }
      const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
      const startHour = toDate(startTime)?.getHours() ?? 0;
      const startDay = toDate(startTime)?.getDay() ?? 0;
      const isWeekend = startDay === 0 || startDay === 6;
      const turnCount = computeTurnCount(coords);
      try {
        await addDoc(collection(db, 'users', currentUid, 'drives'), {
          startTime, endTime,
          topSpeed: Math.round(topSpeed * 10) / 10,
          avgSpeed: Math.round(avgSpeed * 10) / 10,
          distance: Math.round(distanceMiles * 100) / 100,
          coordinates: coords,
          withCrew: crewsRef.current.length > 0,
          startHour,
          isWeekend,
          turnCount,
        });
        // Update user profile stats for badge computation
        const profileUpdates = {};
        if (startHour >= 0 && startHour < 5) profileUpdates.hasNightDrive = true;
        if (startHour < 6) profileUpdates.hasEarlyDrive = true;
        if (isWeekend) profileUpdates.weekendDrives = increment(1);
        if (turnCount >= 20) profileUpdates.hasCanyonDrive = true;
        if (Object.keys(profileUpdates).length > 0) {
          updateDoc(doc(db, 'users', currentUid), profileUpdates).catch(() => {});
        }
      } catch (e) {
        console.warn('Drive save failed:', e.message);
      }
    }

    function processDrive(coords, speedMph) {
      const state = driveStateRef.current;
      if (state === 'IDLE') {
        if (speedMph >= SPEED_THRESHOLD_MPH) {
          driveStateRef.current = 'PRE_DRIVE';
          driveDataRef.current = {
            startTime: new Date(),
            coords: [{ lat: coords.latitude, lng: coords.longitude, t: Date.now() }],
            speeds: [speedMph], topSpeed: speedMph,
          };
          preDriveTimerRef.current = setTimeout(() => {
            if (driveStateRef.current === 'PRE_DRIVE') driveStateRef.current = 'DRIVING';
          }, PRE_DRIVE_MS);
        }
      } else if (state === 'PRE_DRIVE') {
        if (speedMph >= SPEED_THRESHOLD_MPH) {
          driveDataRef.current.coords.push({ lat: coords.latitude, lng: coords.longitude, t: Date.now() });
          driveDataRef.current.speeds.push(speedMph);
          if (speedMph > driveDataRef.current.topSpeed) driveDataRef.current.topSpeed = speedMph;
        } else {
          clearTimeout(preDriveTimerRef.current);
          driveStateRef.current = 'IDLE';
          driveDataRef.current = null;
        }
      } else if (state === 'DRIVING') {
        if (speedMph >= SPEED_THRESHOLD_MPH) {
          driveDataRef.current.coords.push({ lat: coords.latitude, lng: coords.longitude, t: Date.now() });
          driveDataRef.current.speeds.push(speedMph);
          if (speedMph > driveDataRef.current.topSpeed) driveDataRef.current.topSpeed = speedMph;
          if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
        } else if (!stopTimerRef.current) {
          driveStateRef.current = 'STOPPING';
          stopTimerRef.current = setTimeout(() => saveDrive(), STOP_DELAY_MS);
        }
      } else if (state === 'STOPPING') {
        if (speedMph >= SPEED_THRESHOLD_MPH) {
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
      if (status !== 'granted') {
        setPermDenied(true);
        setLocating(false);
        Alert.alert(
          'Location needed',
          'Redline uses your location to show your position on the map and log drives.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }

      const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation(initial.coords);
      setLocating(false);
      locationRef.current = initial.coords;
      pushLocation(initial.coords);

      // 2s updates when driving, 5m distance threshold — fires frequently when moving
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000,
          distanceInterval: 5,
        },
        (loc) => {
          setLocation(loc.coords);
          locationRef.current = loc.coords;
          const mph = toMph(loc.coords.speed ?? 0);
          setCurrentSpeedMph(Math.round(mph));
          processDrive(loc.coords, mph);
          pushLocation(loc.coords); // push every update (2s when driving, less when still)
          checkGeofence(loc.coords);
        }
      );
    }

    start();

    return () => {
      watchRef.current?.remove();
      clearTimeout(preDriveTimerRef.current);
      if (driveStateRef.current === 'DRIVING' || driveStateRef.current === 'STOPPING') {
        clearTimeout(stopTimerRef.current);
        saveDrive();
      }
    };
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────

  const visibleMemberIds = selectedCrewId
    ? new Set(crews.find((c) => c.id === selectedCrewId)?.members || [])
    : new Set(crews.flatMap((c) => c.members || []));

  const seenIds = new Set([uid]);
  const crewMembers = [];
  crews.forEach((crew) => {
    (crew.memberProfiles || []).forEach((p) => {
      if (!seenIds.has(p.id) && visibleMemberIds.has(p.id) && p.latitude != null && p.longitude != null) {
        seenIds.add(p.id);
        crewMembers.push({
          id: p.id,
          name: p.name || 'Unknown',
          latitude: p.latitude,
          longitude: p.longitude,
          speed: p.speed ?? 0,
          color: getMemberColor(p.id),
          photoURL: p.photoURL ?? null,
          arrivedAtDestination: p.arrivedAtDestination ?? false,
          otwToDestination: p.otwToDestination ?? false,
        });
      }
    });
  });

  // Update smooth position targets when crew members change
  crewMembers.forEach((m) => {
    targetPositionsRef.current[m.id] = { latitude: m.latitude, longitude: m.longitude };
  });

  // Update trail history
  const now = Date.now();
  crewMembers.forEach((m) => {
    if (!trailsRef.current[m.id]) trailsRef.current[m.id] = [];
    const trail = trailsRef.current[m.id];
    const last = trail[trail.length - 1];
    if (!last || last.latitude !== m.latitude || last.longitude !== m.longitude) {
      trailsRef.current[m.id] = [
        ...trail.filter((p) => now - p.t < TRAIL_MAX_AGE_MS).slice(-(TRAIL_MAX_POINTS - 1)),
        { latitude: m.latitude, longitude: m.longitude, t: now },
      ];
    }
  });

  // Caravan mode: sort by distance to destination when one is set
  const displayMembers = destination
    ? [...crewMembers].sort((a, b) => {
        const da = haversineMiles(a.latitude, a.longitude, destination.latitude, destination.longitude);
        const db2 = haversineMiles(b.latitude, b.longitude, destination.latitude, destination.longitude);
        return da - db2;
      })
    : crewMembers;

  // My distance to destination (for caravan position)
  const myDistToDest = destination && location
    ? haversineMiles(location.latitude, location.longitude, destination.latitude, destination.longitude)
    : null;

  // Auto-zoom to fit all crew on first load
  useEffect(() => {
    if (autoZoomed || crewMembers.length === 0 || !location || !mapRef.current) return;
    const coords = [
      { latitude: location.latitude, longitude: location.longitude },
      ...crewMembers.map((m) => ({ latitude: m.latitude, longitude: m.longitude })),
    ];
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 60, right: 40, bottom: 60, left: 40 },
      animated: true,
    });
    setAutoZoomed(true);
  }, [crewMembers.length, location, autoZoomed]);

  // Active crew for meetup features
  const activeCrewId = selectedCrewId ?? (crews.length === 1 ? crews[0]?.id : null);
  const activeCrew = crews.find((c) => c.id === activeCrewId);
  const isCrewCreator = activeCrew?.createdBy === uid;

  const allOffline = crews.length > 0 && crewMembers.length === 0 && !locating;
  const filterLabel = selectedCrewId
    ? (crews.find((c) => c.id === selectedCrewId)?.name ?? 'crew')
    : 'all crews';
  const sessionLabel = crewMembers.length > 0
    ? `${crewMembers.length + 1} driving · ${filterLabel}`
    : crews.length === 0
    ? 'create a crew to see members here'
    : `just you · ${filterLabel}`;

  const region = location
    ? { latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 }
    : { latitude: 34.0522, longitude: -118.2437, latitudeDelta: 0.015, longitudeDelta: 0.015 };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const openWaze = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL('waze://');
  };

  const handleSetMeetup = useCallback(async (result) => {
    if (!activeCrewId || !uid) return;
    try {
      const myName = myProfileRef.current?.name || auth.currentUser?.email || 'Someone';
      const destData = {
        name: result.name,
        latitude: result.latitude,
        longitude: result.longitude,
        setBy: uid,
        setByName: myName,
        setAt: serverTimestamp(),
      };
      await updateDoc(doc(db, 'crews', activeCrewId), { destination: destData });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      arrivedRef.current = false; // reset arrived flag when new destination set

      // Notify all crew members
      const crew = crewsRef.current.find((c) => c.id === activeCrewId);
      if (crew) {
        crew.members.forEach((memberId) => {
          if (memberId !== uid) {
            pushNotify(memberId, '📍 meetup set', `${myName} set a meetup at ${result.name}`, { type: 'crewInvite' });
          }
        });
      }
    } catch (e) {
      Alert.alert('Failed to set meetup', e.message);
    }
  }, [activeCrewId, uid]);

  const handleClearDestination = useCallback(async () => {
    if (!activeCrewId) return;
    Alert.alert('Cancel meetup?', 'Remove the destination for everyone in this crew.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel meetup',
        style: 'destructive',
        onPress: async () => {
          try {
            const destName = destinationRef.current?.name ?? 'the meetup';
            const myName = myProfileRef.current?.name || auth.currentUser?.email || 'Someone';
            const crew = crewsRef.current.find((c) => c.id === activeCrewId);

            // Remove destination field from crew doc (any member is allowed via Firestore rules)
            await updateDoc(doc(db, 'crews', activeCrewId), { destination: deleteField() });

            // Only reset OTW/arrived for the current user (can't write other users' docs)
            await updateDoc(doc(db, 'users', uid), {
              arrivedAtDestination: false,
              otwToDestination: false,
              otwCrewId: null,
            });

            arrivedRef.current = false;
            setOtw(false);

            // Notify crew
            if (crew?.members) {
              crew.members.forEach((memberId) => {
                if (memberId !== uid) {
                  pushNotify(memberId, '❌ meetup cancelled', `${myName} cancelled ${destName}`, { type: 'crewInvite' });
                }
              });
            }
          } catch (e) {
            Alert.alert('Failed', e.message);
          }
        },
      },
    ]);
  }, [activeCrewId, uid, setOtw]);

  const toggleOtw = useCallback(async () => {
    const newOtw = !otw;
    setOtw(newOtw);
    try {
      await setDoc(doc(db, 'users', uid), {
        otwToDestination: newOtw,
        otwCrewId: newOtw ? activeCrewId : null,
      }, { merge: true });

      if (newOtw) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const crew = crewsRef.current.find((c) => c.id === activeCrewId);
        if (crew && destination) {
          const myName = myProfileRef.current?.name || auth.currentUser?.email || 'Someone';
          crew.members.forEach((memberId) => {
            if (memberId !== uid) {
              pushNotify(memberId, '🚗 on the way', `${myName} is heading to ${destination.name}`, { type: 'crewInvite' });
            }
          });
        }
      }
    } catch (e) {
      console.warn('OTW update failed:', e.message);
    }
  }, [otw, activeCrewId, destination, uid]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* ── Map ─────────────────────────────────────────── */}
      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={styles.map}
          region={region}
          mapType="none"
          customMapStyle={[]}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          rotateEnabled={false}
          minZoomLevel={3}
          maxZoomLevel={18}
          onRegionChange={(r) => { mapCenterRef.current = { latitude: r.latitude, longitude: r.longitude }; }}
        >
          <UrlTile
            urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maximumZ={18}
            minimumZ={3}
            shouldReplaceMapContent={true}
            tileSize={256}
            opacity={1}
          />

          {/* Self dot */}
          {location && (
            <Marker
              coordinate={{ latitude: location.latitude, longitude: location.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <PulsingDot />
            </Marker>
          )}

          {/* Destination pin */}
          {destination && (
            <Marker
              coordinate={{ latitude: destination.latitude, longitude: destination.longitude }}
              anchor={{ x: 0.5, y: 0.85 }}
              tracksViewChanges
            >
              <DestinationPin name={destination.name} />
            </Marker>
          )}

          {/* Crew trails */}
          {crewMembers.map((m) => {
            const trail = trailsRef.current[m.id] || [];
            if (trail.length < 2) return null;
            return (
              <Polyline
                key={`trail-${m.id}`}
                coordinates={trail}
                strokeColor={m.color}
                strokeWidth={2}
                lineDashPattern={[4, 4]}
                opacity={0.45}
              />
            );
          })}

          {/* Crew markers (with smooth interpolation) */}
          {crewMembers.map((m) => {
            const pos = smoothedPositions[m.id] ?? { latitude: m.latitude, longitude: m.longitude };
            return (
              <Marker
                key={m.id}
                coordinate={pos}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
              >
                <View style={styles.crewMarker}>
                  {m.photoURL ? (
                    <Image source={{ uri: m.photoURL }} style={styles.crewMarkerPhoto} />
                  ) : (
                    <View style={[styles.crewMarkerDot, { backgroundColor: m.color }]} />
                  )}
                  <Text style={styles.crewMarkerLabel}>{m.speed}mph</Text>
                  {m.arrivedAtDestination && (
                    <View style={styles.arrivedBadge}>
                      <Text style={styles.arrivedBadgeText}>✓</Text>
                    </View>
                  )}
                  {!m.arrivedAtDestination && m.otwToDestination && (
                    <View style={styles.otwBadge}>
                      <Text style={styles.otwBadgeText}>OTW</Text>
                    </View>
                  )}
                </View>
              </Marker>
            );
          })}
        </MapView>

        {locating && (
          <View style={styles.locatingBanner}>
            <Text style={styles.locatingText}>locating you...</Text>
          </View>
        )}

        {/* Crew filter pills */}
        {crews.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pillsContainer}
            contentContainerStyle={styles.pillsContent}
          >
            <TouchableOpacity
              style={[styles.pill, selectedCrewId === null && styles.pillActive]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedCrewId(null); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.pillText, selectedCrewId === null && styles.pillTextActive]}>all crews</Text>
            </TouchableOpacity>
            {crews.map((crew) => (
              <TouchableOpacity
                key={crew.id}
                style={[styles.pill, selectedCrewId === crew.id && styles.pillActive]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedCrewId(crew.id); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.pillText, selectedCrewId === crew.id && styles.pillTextActive]} numberOfLines={1}>
                  {crew.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Speed pill */}
        {currentSpeedMph >= SPEED_THRESHOLD_MPH && (
          <View style={styles.speedPill}>
            <Text style={styles.speedPillText}>{currentSpeedMph}</Text>
            <Text style={styles.speedPillUnit}>mph</Text>
          </View>
        )}

        {/* Radio pill */}
        <TouchableOpacity
          style={styles.radioPill}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('Radio'); }}
          activeOpacity={0.7}
        >
          <Ionicons name={channelName ? 'mic' : 'mic-outline'} size={13} color={channelName ? '#fff' : '#555'} />
          <Text style={[styles.radioPillText, !channelName && styles.radioPillTextOff]} numberOfLines={1}>
            {channelName ?? 'join radio'}
          </Text>
        </TouchableOpacity>

        {permDenied && (
          <TouchableOpacity style={styles.permBanner} onPress={() => Linking.openSettings()}>
            <Text style={styles.permText}>location denied — tap to open settings</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Bottom sheet ─────────────────────────────────── */}
      <View style={styles.sheet}>

        <Text style={styles.sessionLabel} numberOfLines={1}>{sessionLabel}</Text>

        {/* Destination card */}
        {destination && (
          <View style={styles.destCard}>
            <View style={styles.destCardLeft}>
              <View style={styles.destDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.destCardName} numberOfLines={1}>{destination.name}</Text>
                <Text style={styles.destCardSub}>
                  set by {destination.setByName}
                  {myDistToDest != null ? ` · ${myDistToDest.toFixed(1)}mi away` : ''}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {/* OTW toggle */}
              {!myProfile?.arrivedAtDestination && (
                <TouchableOpacity
                  style={[styles.otwBtn, otw && styles.otwBtnActive]}
                  onPress={toggleOtw}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.otwBtnText, otw && styles.otwBtnTextActive]}>
                    {otw ? 'OTW ✓' : 'on my way'}
                  </Text>
                </TouchableOpacity>
              )}
              {myProfile?.arrivedAtDestination && (
                <View style={styles.arrivedChip}>
                  <Text style={styles.arrivedChipText}>arrived ✓</Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.cancelMeetupBtn}
                onPress={handleClearDestination}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelMeetupText}>cancel meetup</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {allOffline && (
          <View style={styles.offlinePill}>
            <Text style={styles.offlinePillText}>none of your crew is online</Text>
          </View>
        )}

        {/* Crew member rows */}
        {displayMembers.map((m, index) => {
          const distFromMe = location
            ? haversineMiles(location.latitude, location.longitude, m.latitude, m.longitude)
            : null;

          let distLabel = '';
          if (distFromMe != null) {
            distLabel = distFromMe < 0.1 ? 'nearby' : `${distFromMe.toFixed(1)}mi away`;
          }

          let etaText = null;
          if (destination && !m.arrivedAtDestination) {
            const distToDest = haversineMiles(m.latitude, m.longitude, destination.latitude, destination.longitude);
            etaText = etaLabel(distToDest, m.speed);
          }

          // Caravan mode: gap between consecutive sorted members
          let gapLabel = null;
          if (destination && displayMembers.length > 1) {
            const myDist = myDistToDest ?? 0;
            const mDist = haversineMiles(m.latitude, m.longitude, destination.latitude, destination.longitude);
            const gap = Math.abs(mDist - myDist);
            if (mDist < myDist) {
              gapLabel = `${gap.toFixed(1)}mi ahead`;
            } else if (gap > 0.05) {
              gapLabel = `${gap.toFixed(1)}mi behind`;
            }
          }

          return (
            <View key={m.id} style={styles.crewRow}>
              {/* Position badge in caravan mode */}
              {destination && (
                <View style={styles.positionBadge}>
                  <Text style={styles.positionBadgeText}>{index + 1}</Text>
                </View>
              )}

              <View style={[styles.avatar, { backgroundColor: m.color }]}>
                {m.photoURL
                  ? <Image source={{ uri: m.photoURL }} style={styles.avatarPhoto} />
                  : <Text style={styles.avatarText}>{getInitials(m.name)}</Text>
                }
                {m.arrivedAtDestination && (
                  <View style={styles.arrivedOverlay}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>✓</Text>
                  </View>
                )}
              </View>

              <View style={styles.crewMeta}>
                <View style={styles.crewNameRow}>
                  <View style={styles.onlineDot} />
                  <Text style={styles.crewName} numberOfLines={1}>{m.name}</Text>
                  {m.otwToDestination && !m.arrivedAtDestination && (
                    <View style={styles.otwBadgeRow}>
                      <Text style={styles.otwBadgeRowText}>OTW</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.crewSpeed}>
                  {m.speed} mph
                  {etaText ? ` · ETA ${etaText}` : ''}
                  {gapLabel ? ` · ${gapLabel}` : ''}
                </Text>
              </View>

              <Text style={styles.crewDistance} numberOfLines={1}>{distLabel}</Text>
            </View>
          );
        })}

        {crewMembers.length === 0 && !allOffline && (
          <Text style={styles.emptyCrewText}>no crew online · invite friends to start a convoy</Text>
        )}

        <View style={styles.divider} />

        {/* Set meetup button — only when a crew is active */}
        {activeCrewId && !destination && (
          <TouchableOpacity
            style={styles.meetupBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowMeetupModal(true);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="location-outline" size={14} color={ORANGE} />
            <Text style={styles.meetupBtnText}>set meetup destination</Text>
          </TouchableOpacity>
        )}

        {/* Waze */}
        <TouchableOpacity style={styles.wazeRow} onPress={openWaze} activeOpacity={0.7}>
          <View style={styles.wazeIcon}>
            <Text style={styles.wazeIconText}>W</Text>
          </View>
          <View style={styles.wazeTextWrap}>
            <Text style={styles.wazeTitle} numberOfLines={1}>navigate with Waze</Text>
            <Text style={styles.wazeSub} numberOfLines={1}>speed cams · police · Redline keeps logging</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

      </View>

      {/* ── Set Meetup Modal ──────────────────────────────── */}
      <SetMeetupModal
        visible={showMeetupModal}
        onClose={() => setShowMeetupModal(false)}
        onSet={handleSetMeetup}
        mapCenterRef={mapCenterRef}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  mapWrap: { flex: 6 },
  map: { flex: 1 },

  locatingBanner: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'none',
  },
  locatingText: {
    color: '#888', fontSize: 13, fontWeight: '500',
    backgroundColor: 'rgba(17,17,17,0.75)',
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },

  permBanner: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#1a1a1a', padding: 10, alignItems: 'center',
  },
  permText: { color: '#888', fontSize: 12 },

  // Self dot
  dotWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  dotRing: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: ORANGE },
  dotCore: { width: 12, height: 12, borderRadius: 6, backgroundColor: ORANGE, borderWidth: 2, borderColor: '#fff' },

  // Destination label
  destLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.8)', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2, maxWidth: 120,
  },
  destLabelText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  // Crew markers
  crewMarker: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(17,17,17,0.85)',
    borderRadius: 10, paddingHorizontal: 6, paddingVertical: 3,
    borderWidth: 0.5, borderColor: '#2a2a2a',
  },
  crewMarkerPhoto: { width: 22, height: 22, borderRadius: 11, marginRight: 5 },
  crewMarkerDot: { width: 8, height: 8, borderRadius: 4, marginRight: 5 },
  crewMarkerLabel: { color: '#fff', fontSize: 11, fontWeight: '600' },

  arrivedBadge: {
    marginLeft: 4, width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center',
  },
  arrivedBadgeText: { color: '#fff', fontSize: 8, fontWeight: '800' },

  otwBadge: {
    marginLeft: 4, backgroundColor: '#1d4ed8', borderRadius: 4,
    paddingHorizontal: 4, paddingVertical: 1,
  },
  otwBadgeText: { color: '#fff', fontSize: 8, fontWeight: '800' },

  // Filter pills
  pillsContainer: { position: 'absolute', top: 10, left: 0, right: 0 },
  pillsContent: { paddingHorizontal: 12, gap: 8 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    backgroundColor: 'rgba(17,17,17,0.85)', borderWidth: 1, borderColor: '#2a2a2a',
    maxWidth: 140,
  },
  pillActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  pillText: { color: '#aaa', fontSize: 12, fontWeight: '600' },
  pillTextActive: { color: '#fff' },

  // Speed pill
  speedPill: {
    position: 'absolute', bottom: 52, left: 14,
    flexDirection: 'row', alignItems: 'baseline', gap: 3,
    backgroundColor: 'rgba(17,17,17,0.88)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  speedPillText: { color: ORANGE, fontSize: 18, fontWeight: '700' },
  speedPillUnit: { color: '#888', fontSize: 11, fontWeight: '500' },

  // Radio pill
  radioPill: {
    position: 'absolute', bottom: 12, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(17,17,17,0.88)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  radioPillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  radioPillTextOff: { color: '#555' },

  // Sheet
  sheet: {
    flex: 4, backgroundColor: '#111',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: '#2a2a2a',
  },
  sessionLabel: { color: '#555', fontSize: 11, fontWeight: '500', marginBottom: 8, letterSpacing: 0.3 },

  offlinePill: {
    alignSelf: 'flex-start', backgroundColor: '#1a1a1a',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 0.5, borderColor: '#2a2a2a', marginBottom: 10,
  },
  offlinePillText: { color: '#444', fontSize: 11 },
  emptyCrewText: { color: '#333', fontSize: 11, marginBottom: 10, fontStyle: 'italic' },

  // Destination card in sheet
  destCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1,
    borderColor: ORANGE + '55', padding: 10, marginBottom: 10,
    justifyContent: 'space-between',
  },
  destCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  destDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE, marginRight: 8 },
  destCardName: { color: '#fff', fontSize: 13, fontWeight: '600' },
  destCardSub: { color: '#555', fontSize: 11, marginTop: 1 },

  otwBtn: {
    backgroundColor: '#1a1a1a', borderRadius: 8, borderWidth: 1,
    borderColor: '#333', paddingHorizontal: 10, paddingVertical: 5,
  },
  otwBtnActive: { backgroundColor: '#1d3a6e', borderColor: '#3b82f6' },
  otwBtnText: { color: '#888', fontSize: 11, fontWeight: '700' },
  otwBtnTextActive: { color: '#60a5fa' },
  cancelMeetupBtn: {
    backgroundColor: '#2a1a1a', borderRadius: 8, borderWidth: 1,
    borderColor: '#ef444455', paddingHorizontal: 10, paddingVertical: 5,
  },
  cancelMeetupText: { color: '#ef4444', fontSize: 11, fontWeight: '700' },

  arrivedChip: {
    backgroundColor: '#14532d', borderRadius: 8, borderWidth: 1,
    borderColor: '#22c55e55', paddingHorizontal: 10, paddingVertical: 5,
  },
  arrivedChipText: { color: '#22c55e', fontSize: 11, fontWeight: '700' },

  // Crew rows
  crewRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  positionBadge: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: '#2a2a2a',
    alignItems: 'center', justifyContent: 'center', marginRight: 6,
  },
  positionBadgeText: { color: '#888', fontSize: 10, fontWeight: '800' },
  avatar: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
    overflow: 'hidden',
  },
  avatarPhoto: { width: 34, height: 34, borderRadius: 17 },
  avatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  arrivedOverlay: {
    position: 'absolute', bottom: 0, right: 0,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center',
  },
  crewMeta: { flex: 1 },
  crewNameRow: { flexDirection: 'row', alignItems: 'center' },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e', marginRight: 5 },
  crewName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  otwBadgeRow: {
    marginLeft: 6, backgroundColor: '#1d4ed8', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  otwBadgeRowText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  crewSpeed: { color: '#888', fontSize: 12, marginTop: 1 },
  crewDistance: { color: '#555', fontSize: 12 },

  divider: { height: 1, backgroundColor: '#2a2a2a', marginBottom: 10 },

  // Set meetup button
  meetupBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, marginBottom: 8,
  },
  meetupBtnText: { color: ORANGE, fontSize: 13, fontWeight: '600' },

  // Waze
  wazeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  wazeIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#1a6efc', alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  wazeIconText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  wazeTextWrap: { flex: 1 },
  wazeTitle: { color: '#fff', fontSize: 13, fontWeight: '600' },
  wazeSub: { color: '#555', fontSize: 11, marginTop: 1 },
  chevron: { color: '#555', fontSize: 20, marginLeft: 6 },

  // Meetup modal
  modalRoot: { flex: 1, backgroundColor: '#111' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#2a2a2a',
  },
  modalHeaderBtn: { minWidth: 60 },
  modalTitle: { color: '#fff', fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'center' },
  modalCancel: { color: '#888', fontSize: 14 },
  modalSave: { color: ORANGE, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  modalBody: { padding: 16 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 10, paddingHorizontal: 14, marginBottom: 10,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 14, paddingVertical: 12 },
  searchBtn: { padding: 4 },
  searchError: { color: '#ef4444', fontSize: 12, marginBottom: 10 },
  resultCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1,
    borderColor: '#22c55e44', padding: 14, marginBottom: 12,
  },
  resultName: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 2 },
  resultCoords: { color: '#555', fontSize: 11 },
  dropPinBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, marginBottom: 8,
  },
  dropPinText: { color: '#888', fontSize: 12 },

  selectedCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1,
    borderColor: '#22c55e44', padding: 12, marginBottom: 8,
  },
  selectedDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: ORANGE, marginRight: 10,
  },

  resultsList: { maxHeight: 320 },
  resultRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e',
  },
  resultDist: { color: ORANGE, fontSize: 12, fontWeight: '600', marginLeft: 8, marginTop: 2 },
  resultAddr: { color: '#555', fontSize: 11, marginTop: 2 },
});

import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Linking, Animated, Easing, Image, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import {
  doc, setDoc, addDoc, collection, serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { useCrews } from '../hooks/useCrews';
import { useMic } from '../context/MicContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const ORANGE = '#f97316';
const SPEED_THRESHOLD_MPH = 5;
const PRE_DRIVE_MS = 2 * 60 * 1000;
const STOP_DELAY_MS = 30 * 1000;
const TRAIL_MAX_AGE_MS = 5 * 60 * 1000; // 5-minute trail
const TRAIL_MAX_POINTS = 30;

const MEMBER_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#f59e0b', '#06b6d4'];

// ─── Pure utilities ───────────────────────────────────────────────────────────

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
  const n = uid.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return MEMBER_COLORS[n % MEMBER_COLORS.length];
}

function getInitials(name) {
  if (!name) return '??';
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

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

export default function MapScreen({ navigation }) {
  const [location, setLocation] = useState(null);
  const [locating, setLocating] = useState(true); // true until first GPS fix
  const [permDenied, setPermDenied] = useState(false);
  const [selectedCrewId, setSelectedCrewId] = useState(null);
  const [currentSpeedMph, setCurrentSpeedMph] = useState(0);
  const [autoZoomed, setAutoZoomed] = useState(false);

  const uid = auth.currentUser?.uid;
  const crews = useCrews();
  const { channelName } = useMic();

  const crewsRef = useRef([]);
  crewsRef.current = crews;

  const locationRef = useRef(null);
  const watchRef = useRef(null);
  const mapRef = useRef(null);

  // Trail history: uid → [{ latitude, longitude, t }]
  const trailsRef = useRef({});

  const driveStateRef = useRef('IDLE');
  const driveDataRef = useRef(null);
  const preDriveTimerRef = useRef(null);
  const stopTimerRef = useRef(null);

  // ── GPS + Firestore + drive detection ─────────────────────────────────────

  useEffect(() => {
    let firestoreInterval;

    async function pushLocation() {
      const loc = locationRef.current;
      const currentUid = auth.currentUser?.uid;
      if (!loc || !currentUid) return;
      try {
        await setDoc(
          doc(db, 'users', currentUid),
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
      const withCrew = crewsRef.current.length > 0;
      try {
        await addDoc(collection(db, 'users', currentUid, 'drives'), {
          startTime, endTime,
          topSpeed: Math.round(topSpeed * 10) / 10,
          avgSpeed: Math.round(avgSpeed * 10) / 10,
          distance: Math.round(distanceMiles * 100) / 100,
          coordinates: coords,
          withCrew,
        });
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
          'Redline uses your location to show your position on the map and log drives. Enable it in Settings.',
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

      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10 },
        (loc) => {
          setLocation(loc.coords);
          locationRef.current = loc.coords;
          const mph = toMph(loc.coords.speed);
          setCurrentSpeedMph(Math.round(mph));
          processDrive(loc.coords, mph);
        }
      );

      firestoreInterval = setInterval(pushLocation, 10000);
      pushLocation();
    }

    start();

    return () => {
      watchRef.current?.remove();
      clearInterval(firestoreInterval);
      clearTimeout(preDriveTimerRef.current);
      if (driveStateRef.current === 'DRIVING' || driveStateRef.current === 'STOPPING') {
        clearTimeout(stopTimerRef.current);
        saveDrive();
      }
    };
  }, []);

  // ── Derived values ───────────────────────────────────────────────────────────

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
        });
      }
    });
  });

  // Update trail history during render (ref mutation is safe here)
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

  // Auto-zoom to fit all crew members on first load
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

  const filterLabel = selectedCrewId
    ? (crews.find((c) => c.id === selectedCrewId)?.name ?? 'crew')
    : 'all crews';

  const region = location
    ? { latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 }
    : { latitude: 34.0522, longitude: -118.2437, latitudeDelta: 0.015, longitudeDelta: 0.015 };

  const sessionLabel = crewMembers.length > 0
    ? `${crewMembers.length + 1} driving · ${filterLabel}`
    : crews.length === 0
    ? 'create a crew to see members here'
    : `just you · ${filterLabel}`;

  const allOffline = crews.length > 0 && crewMembers.length === 0 && !locating;

  const openWaze = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL('waze://');
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* ── Map (60%) ────────────────────────────────────── */}
      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
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

          {location && (
            <Marker
              coordinate={{ latitude: location.latitude, longitude: location.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <PulsingDot />
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

          {/* Crew markers */}
          {crewMembers.map((m) => (
            <Marker
              key={m.id}
              coordinate={{ latitude: m.latitude, longitude: m.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={!!m.photoURL}
            >
              <View style={styles.crewMarker}>
                {m.photoURL ? (
                  <Image source={{ uri: m.photoURL }} style={styles.crewMarkerPhoto} />
                ) : (
                  <View style={[styles.crewMarkerDot, { backgroundColor: m.color }]} />
                )}
                <Text style={styles.crewMarkerLabel}>{m.speed}mph</Text>
              </View>
            </Marker>
          ))}
        </MapView>

        {/* "locating you..." overlay */}
        {locating && (
          <View style={styles.locatingBanner}>
            <Text style={styles.locatingText}>locating you...</Text>
          </View>
        )}

        {/* Crew filter pills */}
        {crews.length > 0 && (
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
              <Text style={[styles.pillText, selectedCrewId === null && styles.pillTextActive]}>all</Text>
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

        {/* Speed pill — shows when moving above threshold */}
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
          <View style={styles.permBanner}>
            <Text style={styles.permText}>Location denied — tap to open Settings</Text>
          </View>
        )}
      </View>

      {/* ── Bottom sheet (40%) ──────────────────────────── */}
      <View style={styles.sheet}>

        <Text style={styles.sessionLabel} numberOfLines={1}>{sessionLabel}</Text>

        {/* "none of your crew is online" pill */}
        {allOffline && (
          <View style={styles.offlinePill}>
            <Text style={styles.offlinePillText}>none of your crew is online</Text>
          </View>
        )}

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
                  <Text style={styles.crewName} numberOfLines={1}>{m.name}</Text>
                </View>
                <Text style={styles.crewSpeed}>{m.speed} mph</Text>
              </View>
              <Text style={styles.crewDistance} numberOfLines={1}>{distLabel}</Text>
            </View>
          );
        })}

        {crewMembers.length === 0 && !allOffline && (
          <Text style={styles.emptyCrewText}>no crew online · invite friends to start a convoy</Text>
        )}

        <View style={styles.divider} />

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
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },

  mapWrap: { flex: 6 },
  map: { flex: 1 },

  // "locating you" overlay
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

  // User dot
  dotWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  dotRing: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: ORANGE },
  dotCore: { width: 12, height: 12, borderRadius: 6, backgroundColor: ORANGE, borderWidth: 2, borderColor: '#fff' },

  // Crew markers
  crewMarker: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(17,17,17,0.8)',
    borderRadius: 10, paddingHorizontal: 6, paddingVertical: 3,
  },
  crewMarkerPhoto: { width: 22, height: 22, borderRadius: 11, marginRight: 5 },
  crewMarkerDot: { width: 8, height: 8, borderRadius: 4, marginRight: 5 },
  crewMarkerLabel: { color: '#fff', fontSize: 11, fontWeight: '600' },

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
  sessionLabel: { color: '#555', fontSize: 11, fontWeight: '500', marginBottom: 10, letterSpacing: 0.3 },

  // "none online" pill
  offlinePill: {
    alignSelf: 'flex-start', backgroundColor: '#1a1a1a',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 0.5, borderColor: '#2a2a2a', marginBottom: 10,
  },
  offlinePillText: { color: '#444', fontSize: 11 },

  emptyCrewText: { color: '#333', fontSize: 11, marginBottom: 10, fontStyle: 'italic' },

  // Crew rows
  crewRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  crewMeta: { flex: 1 },
  crewNameRow: { flexDirection: 'row', alignItems: 'center' },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e', marginRight: 5 },
  crewName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  crewSpeed: { color: '#888', fontSize: 12, marginTop: 1 },
  crewDistance: { color: '#555', fontSize: 12 },

  divider: { height: 1, backgroundColor: '#2a2a2a', marginBottom: 10 },

  // Waze
  wazeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  wazeIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1a6efc', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  wazeIconText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  wazeTextWrap: { flex: 1 },
  wazeTitle: { color: '#fff', fontSize: 13, fontWeight: '600' },
  wazeSub: { color: '#555', fontSize: 11, marginTop: 1 },
  chevron: { color: '#555', fontSize: 20, marginLeft: 6 },
});

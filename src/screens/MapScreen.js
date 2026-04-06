import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Linking, Animated, Easing,
} from 'react-native';
import MapView, { Marker, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';

const ORANGE = '#f97316';

const CREW = [
  {
    id: 'jd',
    initials: 'JD',
    color: '#3b82f6',
    name: 'Jake D.',
    speed: 68,
    distance: '0.4mi back',
    latOffset: 0.003,
    lngOffset: -0.002,
  },
  {
    id: 'mr',
    initials: 'MR',
    color: '#22c55e',
    name: 'Marco R.',
    speed: 65,
    distance: '1.1mi back',
    latOffset: 0.007,
    lngOffset: 0.004,
  },
];

// Pulsing orange dot for the user's position on the map
function PulsingDot() {
  const scale = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 2.2,
            duration: 900,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(ringOpacity, {
            toValue: 0,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(ringOpacity, {
            toValue: 0.7,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ])
    ).start();
  }, [scale, ringOpacity]);

  return (
    <View style={styles.dotWrap}>
      <Animated.View
        style={[styles.dotRing, { transform: [{ scale }], opacity: ringOpacity }]}
      />
      <View style={styles.dotCore} />
    </View>
  );
}

export default function MapScreen() {
  const [location, setLocation] = useState(null);
  const [permDenied, setPermDenied] = useState(false);
  const watchRef = useRef(null);
  const [talking, setTalking] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermDenied(true);
        return;
      }
      const initial = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLocation(initial.coords);

      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 5 },
        (loc) => setLocation(loc.coords)
      );
    })();

    return () => { watchRef.current?.remove(); };
  }, []);

  const region = location
    ? {
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      }
    : {
        latitude: 34.0522,
        longitude: -118.2437,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      };

  const openWaze = () => Linking.openURL('waze://');

  return (
    <View style={styles.container}>

      {/* ── MAP (60%) ─────────────────────────────────── */}
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

          {/* Crew markers */}
          {location && CREW.map((m) => (
            <Marker
              key={m.id}
              coordinate={{
                latitude: location.latitude + m.latOffset,
                longitude: location.longitude + m.lngOffset,
              }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View style={styles.crewMarker}>
                <View style={[styles.crewMarkerDot, { backgroundColor: m.color }]} />
                <Text style={styles.crewMarkerLabel}>{m.initials} · {m.speed}mph</Text>
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

      {/* ── BOTTOM SHEET (40%) ────────────────────────── */}
      <View style={styles.sheet}>

        {/* Session label */}
        <Text style={styles.sessionLabel}>sunday cruise · 3 in convoy</Text>

        {/* Crew rows */}
        {CREW.map((m) => (
          <View key={m.id} style={styles.crewRow}>
            <View style={[styles.avatar, { backgroundColor: m.color }]}>
              <Text style={styles.avatarText}>{m.initials}</Text>
            </View>
            <View style={styles.crewMeta}>
              <View style={styles.crewNameRow}>
                <View style={styles.onlineDot} />
                <Text style={styles.crewName}>{m.name}</Text>
              </View>
              <Text style={styles.crewSpeed}>{m.speed} mph</Text>
            </View>
            <Text style={styles.crewDistance}>{m.distance}</Text>
          </View>
        ))}

        <View style={styles.divider} />

        {/* Waze row */}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },

  // ── Map ──────────────────────────────────────────────
  mapWrap: {
    flex: 6,
  },
  map: {
    flex: 1,
  },
  permBanner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1a1a1a',
    padding: 10,
    alignItems: 'center',
  },
  permText: {
    color: '#888',
    fontSize: 12,
  },

  // ── User dot ─────────────────────────────────────────
  dotWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotRing: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: ORANGE,
  },
  dotCore: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: ORANGE,
    borderWidth: 2,
    borderColor: '#fff',
  },

  // ── Crew markers ─────────────────────────────────────
  crewMarker: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(17,17,17,0.75)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  crewMarkerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
  },
  crewMarkerLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },

  // ── Bottom sheet ─────────────────────────────────────
  sheet: {
    flex: 4,
    backgroundColor: '#111',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  sessionLabel: {
    color: '#555',
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 10,
    textTransform: 'lowercase',
    letterSpacing: 0.3,
  },

  // Crew rows
  crewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  crewMeta: {
    flex: 1,
  },
  crewNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
    marginRight: 5,
  },
  crewName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  crewSpeed: {
    color: '#888',
    fontSize: 12,
    marginTop: 1,
  },
  crewDistance: {
    color: '#555',
    fontSize: 12,
  },

  divider: {
    height: 1,
    backgroundColor: '#2a2a2a',
    marginBottom: 10,
  },

  // Waze row
  wazeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  wazeIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1a6efc',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  wazeIconText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  wazeTextWrap: {
    flex: 1,
  },
  wazeTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  wazeSub: {
    color: '#555',
    fontSize: 11,
    marginTop: 1,
  },
  chevron: {
    color: '#555',
    fontSize: 20,
    marginLeft: 6,
  },

  // Hold to talk button
  holdBtn: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdBtnActive: {
    backgroundColor: ORANGE,
    borderColor: ORANGE,
  },
  holdBtnText: {
    color: '#888',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  holdBtnTextActive: {
    color: '#fff',
  },
});

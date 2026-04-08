import { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Share, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapView, { PROVIDER_GOOGLE, Polyline, Marker } from 'react-native-maps';

const ORANGE = '#f97316';

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#57606f' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c6675' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f4f5e' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#b0d5ce' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
];

function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

function formatDuration(startTs, endTs) {
  const s = toDate(startTs);
  const e = toDate(endTs);
  if (!s || !e) return '—';
  const mins = Math.round((e - s) / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatDate(ts) {
  const d = toDate(ts);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(ts) {
  const d = toDate(ts);
  if (!d) return '—';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function driveName(startTs) {
  const d = toDate(startTs);
  if (!d) return 'drive';
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning drive';
  if (h >= 12 && h < 17) return 'afternoon run';
  if (h >= 17 && h < 21) return 'evening cruise';
  return 'night drive';
}

export default function DriveDetailScreen({ route, navigation }) {
  const { drive } = route.params;
  const insets = useSafeAreaInsets();
  const mapRef = useRef(null);

  // Convert stored {lat, lng} coords to MapView format {latitude, longitude}
  const coords = (drive.coordinates || []).map((c) => ({
    latitude: c.lat,
    longitude: c.lng,
  }));

  const hasRoute = coords.length >= 2;
  const startCoord = coords[0];
  const endCoord = coords[coords.length - 1];

  // Fit map to route on load
  useEffect(() => {
    if (!hasRoute || !mapRef.current) return;
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 60, right: 40, bottom: 60, left: 40 },
        animated: true,
      });
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleShare = async () => {
    const name = driveName(drive.startTime);
    const date = formatDate(drive.startTime);
    const dur = formatDuration(drive.startTime, drive.endTime);
    await Share.share({
      message:
        `${name} — ${date}\n` +
        `🏎 ${Math.round(drive.topSpeed ?? 0)} mph top speed\n` +
        `📍 ${(drive.distance ?? 0).toFixed(1)} mi · ${dur}\n` +
        `logged with Redline`,
    });
  };

  // Initial region centered on route midpoint
  const region = hasRoute
    ? {
        latitude: (startCoord.latitude + endCoord.latitude) / 2,
        longitude: (startCoord.longitude + endCoord.longitude) / 2,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : { latitude: 34.0522, longitude: -118.2437, latitudeDelta: 0.05, longitudeDelta: 0.05 };

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={region}
        customMapStyle={darkMapStyle}
        showsUserLocation={false}
        showsCompass={false}
        showsTraffic={false}
        rotateEnabled={false}
      >
        {hasRoute && (
          <Polyline
            coordinates={coords}
            strokeColor={ORANGE}
            strokeWidth={3}
            lineDashPattern={[0]}
            opacity={0.9}
          />
        )}
        {hasRoute && (
          <Marker coordinate={startCoord} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.dotStart} />
          </Marker>
        )}
        {hasRoute && (
          <Marker coordinate={endCoord} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.dotEnd} />
          </Marker>
        )}
      </MapView>

      {/* Back button */}
      <TouchableOpacity
        style={[styles.backBtn, { top: insets.top + 12 }]}
        onPress={() => navigation.goBack()}
        activeOpacity={0.8}
      >
        <Ionicons name="chevron-back" size={22} color="#fff" />
      </TouchableOpacity>

      {/* Share button */}
      <TouchableOpacity
        style={[styles.shareBtn, { top: insets.top + 12 }]}
        onPress={handleShare}
        activeOpacity={0.8}
      >
        <Ionicons name="share-outline" size={20} color="#fff" />
      </TouchableOpacity>

      {/* Stats card */}
      <View style={[styles.card, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.cardHandle} />

        <Text style={styles.driveName}>{driveName(drive.startTime)}</Text>
        <Text style={styles.driveDate}>
          {formatDate(drive.startTime)} · {formatTime(drive.startTime)}
          {drive.withCrew ? ' · with crew' : ''}
        </Text>

        <View style={styles.statsGrid}>
          <StatBox label="top speed" value={`${Math.round(drive.topSpeed ?? 0)}`} unit="mph" orange />
          <StatBox label="avg speed" value={`${Math.round(drive.avgSpeed ?? 0)}`} unit="mph" />
          <StatBox label="distance" value={(drive.distance ?? 0).toFixed(1)} unit="mi" />
          <StatBox label="duration" value={formatDuration(drive.startTime, drive.endTime)} />
        </View>
      </View>
    </View>
  );
}

function StatBox({ label, value, unit, orange }) {
  return (
    <View style={styles.statBox}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
        <Text style={[styles.statValue, orange && { color: ORANGE }]}>{value}</Text>
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </View>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  map: { flex: 1 },

  backBtn: {
    position: 'absolute', left: 16,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  shareBtn: {
    position: 'absolute', right: 16,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },

  dotStart: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#555', borderWidth: 2, borderColor: '#fff',
  },
  dotEnd: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: ORANGE, borderWidth: 2.5, borderColor: '#fff',
  },

  card: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 0.5, borderColor: '#2a2a2a',
  },
  cardHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#2a2a2a', alignSelf: 'center', marginBottom: 16,
  },

  driveName: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 4 },
  driveDate: { color: '#555', fontSize: 12, marginBottom: 20 },

  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12,
  },
  statBox: {
    flex: 1, minWidth: '40%',
    backgroundColor: '#111', borderRadius: 10,
    padding: 12, borderWidth: 0.5, borderColor: '#2a2a2a',
  },
  statValue: { color: '#fff', fontSize: 22, fontWeight: '600' },
  statUnit: { color: '#555', fontSize: 12, fontWeight: '500' },
  statLabel: { color: '#555', fontSize: 11, marginTop: 4 },
});

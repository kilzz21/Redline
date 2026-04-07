import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { Svg, Polyline, Circle } from 'react-native-svg';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

const ORANGE = '#f97316';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

function relativeDay(ts) {
  const d = toDate(ts);
  if (!d) return '';
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) {
    return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][d.getDay()];
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDuration(startTs, endTs) {
  const s = toDate(startTs);
  const e = toDate(endTs);
  if (!s || !e) return '';
  const mins = Math.round((e - s) / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
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

function weekBounds(offsetWeeks = 0) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7) - offsetWeeks * 7);
  monday.setHours(0, 0, 0, 0);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return { start: monday, end: nextMonday };
}

const FILTER_LABELS = {
  all: 'all drives',
  solo: 'solo',
  crew: 'crew',
  'this-week': 'this week',
  'this-month': 'this month',
};

// ─── SVG Route Thumbnail ──────────────────────────────────────────────────────

const THUMB_W = 300;
const THUMB_H = 36;
const THUMB_PAD = 8;

function RouteThumbnail({ coordinates }) {
  // Fallback placeholder when no real coordinates
  if (!coordinates || coordinates.length < 2) {
    return (
      <View style={styles.thumbnail}>
        <View style={styles.dashRow}>
          {Array.from({ length: 14 }).map((_, i) => (
            <View key={i} style={[styles.dash, { opacity: i % 2 === 0 ? 1 : 0 }]} />
          ))}
        </View>
        <View style={styles.dotStart} />
        <View style={styles.dotEnd} />
      </View>
    );
  }

  const lats = coordinates.map((c) => c.lat);
  const lngs = coordinates.map((c) => c.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = maxLat - minLat || 1e-6;
  const lngRange = maxLng - minLng || 1e-6;

  const toX = (lng) => THUMB_PAD + ((lng - minLng) / lngRange) * (THUMB_W - 2 * THUMB_PAD);
  const toY = (lat) => (THUMB_H - THUMB_PAD) - ((lat - minLat) / latRange) * (THUMB_H - 2 * THUMB_PAD);

  const points = coordinates
    .map((c) => `${toX(c.lng).toFixed(1)},${toY(c.lat).toFixed(1)}`)
    .join(' ');

  const startX = toX(coordinates[0].lng);
  const startY = toY(coordinates[0].lat);
  const endX = toX(coordinates[coordinates.length - 1].lng);
  const endY = toY(coordinates[coordinates.length - 1].lat);

  return (
    <View style={styles.thumbnail}>
      <Svg
        width="100%"
        height={THUMB_H}
        viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}
        preserveAspectRatio="none"
      >
        <Polyline
          points={points}
          fill="none"
          stroke={ORANGE}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx={startX} cy={startY} r={4} fill="#555" />
        <Circle cx={endX} cy={endY} r={4} fill={ORANGE} />
      </Svg>
    </View>
  );
}

// ─── Drive Card ───────────────────────────────────────────────────────────────

function DriveCard({ drive }) {
  const day = relativeDay(drive.startTime);
  const dur = formatDuration(drive.startTime, drive.endTime);
  const name = driveName(drive.startTime);
  const dist = drive.distance ?? 0;

  return (
    <View style={styles.card}>
      <RouteThumbnail coordinates={drive.coordinates} />
      <View style={styles.driveNameRow}>
        <Text style={styles.driveName}>{name}</Text>
        {drive.withCrew && (
          <View style={styles.crewTag}>
            <Text style={styles.crewTagText}>crew</Text>
          </View>
        )}
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{day}{dur ? ` · ${dur}` : ''}</Text>
        <Text style={styles.metaText}>{dist.toFixed(1)} mi</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: ORANGE }]}>
            {Math.round(drive.topSpeed ?? 0)}
          </Text>
          <Text style={styles.statLabel}>top mph</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValueWhite}>
            {Math.round(drive.avgSpeed ?? 0)}
          </Text>
          <Text style={styles.statLabel}>avg mph</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValueWhite}>{dist.toFixed(1)}mi</Text>
          <Text style={styles.statLabel}>dist</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DrivesScreen() {
  const [drives, setDrives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }

    const q = query(
      collection(db, 'users', uid, 'drives'),
      orderBy('startTime', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      setDrives(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => {
      console.warn('Drives snapshot error:', err.message);
      setLoading(false);
    });

    return unsub;
  }, []);

  const filteredDrives = useMemo(() => {
    switch (filter) {
      case 'solo':
        return drives.filter((d) => !d.withCrew);
      case 'crew':
        return drives.filter((d) => d.withCrew === true);
      case 'this-week': {
        const { start, end } = weekBounds(0);
        return drives.filter((d) => {
          const t = toDate(d.startTime);
          return t && t >= start && t < end;
        });
      }
      case 'this-month': {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        return drives.filter((d) => {
          const t = toDate(d.startTime);
          return t && t >= monthStart;
        });
      }
      default:
        return drives;
    }
  }, [drives, filter]);

  const showFilterSheet = () => {
    Alert.alert('Filter Drives', null, [
      { text: 'All Drives', onPress: () => setFilter('all') },
      { text: 'This Week', onPress: () => setFilter('this-week') },
      { text: 'This Month', onPress: () => setFilter('this-month') },
      { text: 'Solo Drives', onPress: () => setFilter('solo') },
      { text: 'Crew Drives', onPress: () => setFilter('crew') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const isFiltered = filter !== 'all';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>drive history</Text>
        <TouchableOpacity onPress={showFilterSheet} activeOpacity={0.7}>
          <View style={[styles.filterBtn, isFiltered && styles.filterBtnActive]}>
            <Text style={[styles.filterText, isFiltered && styles.filterTextActive]}>
              {FILTER_LABELS[filter]}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Loading */}
      {loading && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={ORANGE} />
        </View>
      )}

      {/* Empty state */}
      {!loading && drives.length === 0 && (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>no drives yet</Text>
          <Text style={styles.emptySubtitle}>
            get moving — drives are logged automatically when you hit 5+ mph for 2 minutes
          </Text>
        </View>
      )}

      {/* No results for active filter */}
      {!loading && drives.length > 0 && filteredDrives.length === 0 && (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>no {FILTER_LABELS[filter]} drives</Text>
          <TouchableOpacity onPress={() => setFilter('all')} activeOpacity={0.7}>
            <Text style={styles.clearFilter}>clear filter</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Drive cards */}
      {filteredDrives.map((drive) => (
        <DriveCard key={drive.id} drive={drive} />
      ))}

      {/* Count */}
      {filteredDrives.length > 0 && (
        <TouchableOpacity
          style={styles.viewAllBtn}
          onPress={isFiltered ? () => setFilter('all') : undefined}
          activeOpacity={isFiltered ? 0.7 : 1}
        >
          <Text style={styles.viewAllText}>
            {filteredDrives.length === 1
              ? '1 drive'
              : `${filteredDrives.length} drives`}
            {isFiltered ? ' · clear filter' : ' logged'}
          </Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  content: { padding: 16, paddingBottom: 24 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 16,
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '500' },

  filterBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, backgroundColor: '#1a1a1a',
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  filterBtnActive: { backgroundColor: '#f9731618', borderColor: ORANGE },
  filterText: { color: '#555', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: ORANGE },

  loadingWrap: { paddingVertical: 40, alignItems: 'center' },

  emptyWrap: { paddingVertical: 40, alignItems: 'center', paddingHorizontal: 24 },
  emptyTitle: { color: '#555', fontSize: 15, fontWeight: '500', marginBottom: 8 },
  emptySubtitle: { color: '#333', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  clearFilter: { color: ORANGE, fontSize: 13, fontWeight: '600', marginTop: 4 },

  card: {
    backgroundColor: '#1a1a1a', borderRadius: 10,
    borderWidth: 0.5, borderColor: '#2a2a2a',
    padding: 12, marginBottom: 12,
  },

  // SVG / placeholder thumbnail
  thumbnail: {
    height: THUMB_H, backgroundColor: '#222', borderRadius: 6,
    marginBottom: 10, justifyContent: 'center', overflow: 'hidden',
  },
  dashRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  dash: { flex: 1, height: 1.5, backgroundColor: ORANGE, marginHorizontal: 1 },
  dotStart: {
    position: 'absolute', left: 8, width: 6, height: 6,
    borderRadius: 3, backgroundColor: '#666',
  },
  dotEnd: {
    position: 'absolute', right: 8, width: 6, height: 6,
    borderRadius: 3, backgroundColor: ORANGE,
  },

  driveNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  driveName: { color: '#fff', fontSize: 13, fontWeight: '500' },
  crewTag: {
    backgroundColor: '#f9731620', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  crewTagText: { color: ORANGE, fontSize: 9, fontWeight: '700' },

  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metaText: { color: '#555', fontSize: 11 },

  divider: { height: 0.5, backgroundColor: '#2a2a2a', marginVertical: 8 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-evenly' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 16, fontWeight: '500' },
  statValueWhite: { color: '#fff', fontSize: 16, fontWeight: '500' },
  statLabel: { color: '#555', fontSize: 9, marginTop: 2 },

  viewAllBtn: {
    backgroundColor: '#f9731626', borderRadius: 10,
    padding: 12, alignItems: 'center',
  },
  viewAllText: { color: ORANGE, fontSize: 13, fontWeight: '500' },
});

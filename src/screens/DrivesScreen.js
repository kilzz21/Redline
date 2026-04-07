import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

const ORANGE = '#f97316';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safely convert Firestore Timestamp, JS Date, or ms number → Date */
function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

/** "today", "yesterday", "monday", or short date */
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

/** "38 min" or "1h 12m" */
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

/** Drive name from start hour */
function driveName(startTs) {
  const d = toDate(startTs);
  if (!d) return 'drive';
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning drive';
  if (h >= 12 && h < 17) return 'afternoon run';
  if (h >= 17 && h < 21) return 'evening cruise';
  return 'night drive';
}

// ─── Components ───────────────────────────────────────────────────────────────

function RouteThumbnail() {
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

function DriveCard({ drive }) {
  const day = relativeDay(drive.startTime);
  const dur = formatDuration(drive.startTime, drive.endTime);
  const name = driveName(drive.startTime);
  const dist = drive.distance ?? 0;

  return (
    <View style={styles.card}>
      <RouteThumbnail />
      <Text style={styles.driveName}>{name}</Text>
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>drive history</Text>
        <TouchableOpacity activeOpacity={0.7}>
          <Text style={styles.filterText}>filter</Text>
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

      {/* Drive cards */}
      {drives.map((drive) => (
        <DriveCard key={drive.id} drive={drive} />
      ))}

      {/* View all */}
      {drives.length > 0 && (
        <TouchableOpacity style={styles.viewAllBtn} activeOpacity={0.7}>
          <Text style={styles.viewAllText}>
            {drives.length === 1
              ? '1 drive logged'
              : `view all ${drives.length} drives`}
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
  filterText: { color: ORANGE, fontSize: 14, fontWeight: '500' },

  loadingWrap: { paddingVertical: 40, alignItems: 'center' },

  emptyWrap: { paddingVertical: 40, alignItems: 'center', paddingHorizontal: 24 },
  emptyTitle: { color: '#555', fontSize: 15, fontWeight: '500', marginBottom: 8 },
  emptySubtitle: { color: '#333', fontSize: 12, textAlign: 'center', lineHeight: 18 },

  card: {
    backgroundColor: '#1a1a1a', borderRadius: 10,
    borderWidth: 0.5, borderColor: '#2a2a2a',
    padding: 12, marginBottom: 12,
  },

  thumbnail: {
    height: 36, backgroundColor: '#222', borderRadius: 6,
    marginBottom: 10, justifyContent: 'center',
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

  driveName: { color: '#fff', fontSize: 13, fontWeight: '500', marginBottom: 4 },

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

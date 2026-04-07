import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { doc, collection, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

const ORANGE = '#f97316';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

function getInitials(name) {
  if (!name) return '??';
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatCarString(car) {
  if (!car) return '';
  const { year, make, model, color } = car;
  const base = [year, make, model].filter(Boolean).join(' ');
  return color ? `${base} · ${color}` : base;
}

/** Week bounds: offsetWeeks=0 → this week, 1 → last week (Mon start) */
function weekBounds(offsetWeeks = 0) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7) - offsetWeeks * 7);
  monday.setHours(0, 0, 0, 0);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return { start: monday, end: nextMonday };
}

function sumMilesInRange(drives, start, end) {
  return drives
    .filter((d) => {
      const t = toDate(d.startTime);
      return t && t >= start && t < end;
    })
    .reduce((sum, d) => sum + (d.distance ?? 0), 0);
}

function computeStats(drives) {
  if (!drives.length) {
    return { topSpeed: 0, totalMiles: 0, driveCount: 0, timeLabel: '0h' };
  }
  const topSpeed = Math.max(...drives.map((d) => d.topSpeed ?? 0));
  const totalMiles = drives.reduce((s, d) => s + (d.distance ?? 0), 0);
  let totalMs = 0;
  drives.forEach((d) => {
    const s = toDate(d.startTime);
    const e = toDate(d.endTime);
    if (s && e) totalMs += e - s;
  });
  const totalHours = totalMs / 3600000;
  const timeLabel = totalHours < 1 ? '<1h' : `${Math.round(totalHours)}h`;
  return {
    topSpeed: Math.round(topSpeed),
    totalMiles: Math.round(totalMiles),
    driveCount: drives.length,
    timeLabel,
  };
}

function computeBadges(stats, drives) {
  const hasNightDrive = drives.some(() => {
    // Any drive that started between 9pm and 5am
    const h = toDate(drives[0]?.startTime)?.getHours();
    return h !== undefined && (h >= 21 || h < 5);
  });
  return [
    { label: 'canyon king', earned: stats.topSpeed >= 80 },
    { label: 'night owl', earned: hasNightDrive },
    { label: '100 miles', earned: stats.totalMiles >= 100 },
    { label: 'track day', earned: false },
    { label: '1000 miles', earned: stats.totalMiles >= 1000 },
  ];
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const [profile, setProfile] = useState(null);
  const [drives, setDrives] = useState([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingDrives, setLoadingDrives] = useState(true);

  const uid = auth.currentUser?.uid;

  // Subscribe to user profile document
  useEffect(() => {
    if (!uid) { setLoadingProfile(false); return; }
    const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
      setProfile(snap.exists() ? snap.data() : null);
      setLoadingProfile(false);
    });
    return unsub;
  }, [uid]);

  // Subscribe to drives subcollection
  useEffect(() => {
    if (!uid) { setLoadingDrives(false); return; }
    const unsub = onSnapshot(collection(db, 'users', uid, 'drives'), (snap) => {
      setDrives(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoadingDrives(false);
    });
    return unsub;
  }, [uid]);

  if (loadingProfile || loadingDrives) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={ORANGE} />
      </View>
    );
  }

  const stats = computeStats(drives);
  const badges = computeBadges(stats, drives);

  const thisWeek = weekBounds(0);
  const lastWeek = weekBounds(1);
  const thisWeekMi = sumMilesInRange(drives, thisWeek.start, thisWeek.end);
  const lastWeekMi = sumMilesInRange(drives, lastWeek.start, lastWeek.end);
  const maxMi = Math.max(thisWeekMi, lastWeekMi, 1); // avoid /0
  const delta =
    lastWeekMi > 0
      ? Math.round(((thisWeekMi - lastWeekMi) / lastWeekMi) * 100)
      : null;

  const STAT_CARDS = [
    { value: String(stats.topSpeed), label: 'top speed mph' },
    { value: String(Math.round(stats.totalMiles)), label: 'total miles' },
    { value: String(stats.driveCount), label: 'drives logged' },
    { value: stats.timeLabel, label: 'behind the wheel' },
  ];

  const name = profile?.name ?? auth.currentUser?.email ?? 'Driver';
  const carStr = formatCarString(profile?.car);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >

      {/* ── Top section ────────────────────────────────── */}
      <View style={styles.topSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(name)}</Text>
        </View>
        <Text style={styles.name}>{name}</Text>
        {carStr ? (
          <Text style={styles.car}>{carStr}</Text>
        ) : (
          <Text style={[styles.car, { color: '#333' }]}>no car added yet</Text>
        )}
      </View>

      {/* ── Stats grid ─────────────────────────────────── */}
      <View style={styles.statsGrid}>
        <View style={styles.statsRow}>
          {STAT_CARDS.slice(0, 2).map((s) => (
            <View key={s.label} style={styles.statCard}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.statsRow}>
          {STAT_CARDS.slice(2, 4).map((s) => (
            <View key={s.label} style={styles.statCard}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Week comparison ────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>this week vs last week</Text>
        <View style={styles.weekCard}>
          <View style={styles.barsWrap}>
            <View style={styles.barCol}>
              <View style={[styles.bar, { flex: thisWeekMi / maxMi, backgroundColor: ORANGE }]} />
            </View>
            <View style={styles.barCol}>
              <View style={[styles.bar, { flex: lastWeekMi / maxMi, backgroundColor: '#333' }]} />
            </View>
          </View>
          <View style={styles.weekLabelsRow}>
            <View style={styles.weekLabels}>
              <Text style={styles.weekLabelThis}>
                {thisWeekMi.toFixed(1)}mi this week
              </Text>
              <Text style={styles.weekLabelLast}>
                {lastWeekMi.toFixed(1)}mi last week
              </Text>
            </View>
            {delta !== null && (
              <Text style={[styles.weekDelta, { color: delta >= 0 ? '#22c55e' : '#ef4444' }]}>
                {delta >= 0 ? `+${delta}%` : `${delta}%`}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* ── Badges ─────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>badges</Text>
        <View style={styles.badgesWrap}>
          {badges.map((b) => (
            <View
              key={b.label}
              style={[styles.badge, b.earned ? styles.badgeEarned : styles.badgeUnearned]}
            >
              <Text style={[styles.badgeText, b.earned ? styles.badgeTextEarned : styles.badgeTextUnearned]}>
                {b.label}
              </Text>
            </View>
          ))}
        </View>
      </View>

    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  content: { paddingBottom: 24 },

  loadingWrap: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  topSection: {
    backgroundColor: '#141414', paddingVertical: 24,
    paddingHorizontal: 20, alignItems: 'center',
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '500' },
  name: { color: '#fff', fontSize: 16, fontWeight: '500', marginTop: 10 },
  car: { color: '#555', fontSize: 11, marginTop: 4 },

  statsGrid: { padding: 16, gap: 8 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: {
    flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10,
    borderWidth: 0.5, borderColor: '#2a2a2a', padding: 12,
  },
  statValue: { color: ORANGE, fontSize: 24, fontWeight: '500' },
  statLabel: { color: '#555', fontSize: 9, marginTop: 2 },

  section: { paddingHorizontal: 16, paddingBottom: 16 },
  sectionLabel: {
    color: '#555', fontSize: 10, marginBottom: 8,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  weekCard: {
    backgroundColor: '#1a1a1a', borderRadius: 10,
    borderWidth: 0.5, borderColor: '#2a2a2a', padding: 12,
  },
  barsWrap: { flexDirection: 'row', height: 28, gap: 6, marginBottom: 10 },
  barCol: {
    flex: 1, flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: '#222', borderRadius: 4, overflow: 'hidden',
  },
  bar: { borderRadius: 4 },
  weekLabelsRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
  },
  weekLabels: { gap: 2 },
  weekLabelThis: { color: '#fff', fontSize: 11 },
  weekLabelLast: { color: '#555', fontSize: 11 },
  weekDelta: { fontSize: 12, fontWeight: '500' },

  badgesWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  badge: {
    borderRadius: 20, borderWidth: 0.5,
    paddingVertical: 4, paddingHorizontal: 12, margin: 4,
  },
  badgeEarned: { backgroundColor: '#1a1a1a', borderColor: ORANGE },
  badgeUnearned: { backgroundColor: '#1a1a1a', borderColor: '#2a2a2a' },
  badgeText: { fontSize: 11 },
  badgeTextEarned: { color: ORANGE },
  badgeTextUnearned: { color: '#444' },
});

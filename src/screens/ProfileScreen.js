import { View, Text, StyleSheet, ScrollView } from 'react-native';

const ORANGE = '#f97316';

const STATS = [
  { value: '94', label: 'top speed mph' },
  { value: '847', label: 'total miles' },
  { value: '31', label: 'drives logged' },
  { value: '14h', label: 'behind the wheel' },
];

const BADGES = [
  { label: 'canyon king', earned: true },
  { label: 'night owl', earned: true },
  { label: '100 miles', earned: true },
  { label: 'track day', earned: false },
  { label: '1000 miles', earned: false },
];

const THIS_WEEK = 247;
const LAST_WEEK = 189;
const MAX = Math.max(THIS_WEEK, LAST_WEEK);

export default function ProfileScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >

      {/* ── Top section ───────────────────────────────── */}
      <View style={styles.topSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>AK</Text>
        </View>
        <Text style={styles.name}>Alex K.</Text>
        <Text style={styles.car}>2021 Toyota Supra GR · Nitro Yellow</Text>
      </View>

      {/* ── Stats grid ────────────────────────────────── */}
      <View style={styles.statsGrid}>
        <View style={styles.statsRow}>
          {STATS.slice(0, 2).map((s) => (
            <View key={s.label} style={styles.statCard}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.statsRow}>
          {STATS.slice(2, 4).map((s) => (
            <View key={s.label} style={styles.statCard}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Week comparison ───────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>this week vs last week</Text>
        <View style={styles.weekCard}>
          {/* Bar chart */}
          <View style={styles.barsWrap}>
            <View style={styles.barCol}>
              <View style={[styles.bar, { flex: THIS_WEEK / MAX, backgroundColor: ORANGE }]} />
            </View>
            <View style={styles.barCol}>
              <View style={[styles.bar, { flex: LAST_WEEK / MAX, backgroundColor: '#333' }]} />
            </View>
          </View>
          {/* Labels row */}
          <View style={styles.weekLabelsRow}>
            <View style={styles.weekLabels}>
              <Text style={styles.weekLabelThis}>247mi this week</Text>
              <Text style={styles.weekLabelLast}>189mi last week</Text>
            </View>
            <Text style={styles.weekDelta}>+31%</Text>
          </View>
        </View>
      </View>

      {/* ── Badges ────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>badges</Text>
        <View style={styles.badgesWrap}>
          {BADGES.map((b) => (
            <View key={b.label} style={[styles.badge, b.earned ? styles.badgeEarned : styles.badgeUnearned]}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  content: {
    paddingBottom: 24,
  },

  // Top section
  topSection: {
    backgroundColor: '#141414',
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '500',
  },
  name: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    marginTop: 10,
  },
  car: {
    color: '#555',
    fontSize: 11,
    marginTop: 4,
  },

  // Stats grid
  statsGrid: {
    padding: 16,
    gap: 8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    padding: 12,
  },
  statValue: {
    color: ORANGE,
    fontSize: 24,
    fontWeight: '500',
  },
  statLabel: {
    color: '#555',
    fontSize: 9,
    marginTop: 2,
  },

  // Week comparison
  section: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sectionLabel: {
    color: '#555',
    fontSize: 10,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  weekCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    padding: 12,
  },
  barsWrap: {
    flexDirection: 'row',
    height: 28,
    gap: 6,
    marginBottom: 10,
  },
  barCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#222',
    borderRadius: 4,
    overflow: 'hidden',
  },
  bar: {
    borderRadius: 4,
  },
  weekLabelsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  weekLabels: {
    gap: 2,
  },
  weekLabelThis: {
    color: '#fff',
    fontSize: 11,
  },
  weekLabelLast: {
    color: '#555',
    fontSize: 11,
  },
  weekDelta: {
    color: '#22c55e',
    fontSize: 12,
    fontWeight: '500',
  },

  // Badges
  badgesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  badge: {
    borderRadius: 20,
    borderWidth: 0.5,
    paddingVertical: 4,
    paddingHorizontal: 12,
    margin: 4,
  },
  badgeEarned: {
    backgroundColor: '#1a1a1a',
    borderColor: ORANGE,
  },
  badgeUnearned: {
    backgroundColor: '#1a1a1a',
    borderColor: '#2a2a2a',
  },
  badgeText: {
    fontSize: 11,
  },
  badgeTextEarned: {
    color: ORANGE,
  },
  badgeTextUnearned: {
    color: '#444',
  },
});

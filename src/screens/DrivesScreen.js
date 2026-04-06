import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';

const ORANGE = '#f97316';

const DRIVES = [
  {
    id: 1,
    name: 'mulholland drive',
    timestamp: 'today · 38 min',
    distance: '28 mi',
    topMph: 94,
    avgMph: 47,
    dist: '28mi',
    dimmed: false,
  },
  {
    id: 2,
    name: 'PCH cruise · crew of 3',
    timestamp: 'yesterday · 52 min',
    distance: '41 mi',
    topMph: 82,
    avgMph: 54,
    dist: '41mi',
    dimmed: false,
  },
  {
    id: 3,
    name: 'morning commute',
    timestamp: 'monday · 24 min',
    distance: '12 mi',
    topMph: 61,
    avgMph: 28,
    dist: '12mi',
    dimmed: true,
  },
];

function RouteThumbnail() {
  return (
    <View style={styles.thumbnail}>
      {/* Dashed line rendered as alternating segments */}
      <View style={styles.dashRow}>
        {Array.from({ length: 14 }).map((_, i) => (
          <View
            key={i}
            style={[styles.dash, { opacity: i % 2 === 0 ? 1 : 0 }]}
          />
        ))}
      </View>
      {/* Start dot (gray, left) */}
      <View style={styles.dotStart} />
      {/* End dot (orange, right) */}
      <View style={styles.dotEnd} />
    </View>
  );
}

function DriveCard({ drive }) {
  return (
    <View style={[styles.card, drive.dimmed && styles.cardDimmed]}>

      {/* Route thumbnail */}
      <RouteThumbnail />

      {/* Drive name */}
      <Text style={styles.driveName}>{drive.name}</Text>

      {/* Timestamp + distance row */}
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{drive.timestamp}</Text>
        <Text style={styles.metaText}>{drive.distance}</Text>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: ORANGE }]}>{drive.topMph}</Text>
          <Text style={styles.statLabel}>top mph</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValueWhite}>{drive.avgMph}</Text>
          <Text style={styles.statLabel}>avg mph</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValueWhite}>{drive.dist}</Text>
          <Text style={styles.statLabel}>dist</Text>
        </View>
      </View>

    </View>
  );
}

export default function DrivesScreen() {
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

      {/* Drive cards */}
      {DRIVES.map((drive) => (
        <DriveCard key={drive.id} drive={drive} />
      ))}

      {/* View all button */}
      <TouchableOpacity style={styles.viewAllBtn} activeOpacity={0.7}>
        <Text style={styles.viewAllText}>view all 31 drives</Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  content: {
    padding: 16,
    paddingBottom: 24,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '500',
  },
  filterText: {
    color: ORANGE,
    fontSize: 14,
    fontWeight: '500',
  },

  // Card
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    padding: 12,
    marginBottom: 12,
  },
  cardDimmed: {
    opacity: 0.5,
  },

  // Route thumbnail
  thumbnail: {
    height: 36,
    backgroundColor: '#222',
    borderRadius: 6,
    marginBottom: 10,
    justifyContent: 'center',
    overflow: 'visible',
  },
  dashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  dash: {
    flex: 1,
    height: 1.5,
    backgroundColor: ORANGE,
    marginHorizontal: 1,
  },
  dotStart: {
    position: 'absolute',
    left: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#666',
  },
  dotEnd: {
    position: 'absolute',
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ORANGE,
  },

  // Drive name
  driveName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 4,
  },

  // Meta row
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaText: {
    color: '#555',
    fontSize: 11,
  },

  // Divider
  divider: {
    height: 0.5,
    backgroundColor: '#2a2a2a',
    marginVertical: 8,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
  },
  stat: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '500',
  },
  statValueWhite: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  statLabel: {
    color: '#555',
    fontSize: 9,
    marginTop: 2,
  },

  // View all
  viewAllBtn: {
    backgroundColor: '#f9731626',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  viewAllText: {
    color: ORANGE,
    fontSize: 13,
    fontWeight: '500',
  },
});

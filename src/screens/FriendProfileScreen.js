import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Modal, Image, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { doc, collection, onSnapshot, updateDoc, arrayRemove } from 'firebase/firestore';
import * as Haptics from 'expo-haptics';
import { auth, db } from '../config/firebase';
import { useCrews } from '../hooks/useCrews';
import { BADGES, BADGE_CATEGORIES } from '../config/badges';
import { ORANGE, toDate, getInitials, formatCarString } from '../utils/helpers';

function computeStats(drives) {
  if (!drives.length) return { topSpeed: 0, totalMiles: 0, totalDrives: 0, timeLabel: '0h' };
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
  return { topSpeed: Math.round(topSpeed), totalMiles: Math.round(totalMiles), totalDrives: drives.length, timeLabel };
}

function computeBadgeStats(drives, profile) {
  const stats = computeStats(drives);
  return {
    ...stats,
    hasNightDrive: drives.some((d) => { const h = toDate(d.startTime)?.getHours(); return h !== undefined && h >= 0 && h < 5; }),
    hasEarlyDrive: drives.some((d) => { const h = toDate(d.startTime)?.getHours(); return h !== undefined && h < 6; }),
    weekendDrives: drives.filter((d) => { const day = toDate(d.startTime)?.getDay(); return day === 0 || day === 6; }).length,
    hasCanyonDrive: drives.some((d) => (d.turnCount ?? 0) >= 20),
    crewCount: 0,
    createdCrew: false,
    totalCrewMembers: 0,
    userNumber: profile?.userNumber ?? 9999,
  };
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ photoURL, name, size = 72 }) {
  if (photoURL) {
    return <Image source={{ uri: photoURL }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.3 }]}>{getInitials(name)}</Text>
    </View>
  );
}

// ─── Badge Detail Modal ───────────────────────────────────────────────────────

function BadgeModal({ badge, earned, onClose }) {
  if (!badge) return null;
  return (
    <Modal visible={!!badge} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.badgeModalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.badgeModalBox}>
          <Text style={styles.badgeModalIcon}>{badge.icon}</Text>
          <Text style={styles.badgeModalName}>{badge.name}</Text>
          <Text style={styles.badgeModalDesc}>{badge.description}</Text>
          {!earned && (
            <View style={styles.badgeModalLocked}>
              <Ionicons name="lock-closed" size={12} color="#555" />
              <Text style={styles.badgeModalLockedText}>not yet earned</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FriendProfileScreen({ route, navigation }) {
  const { uid: friendUid } = route.params ?? {};
  const myUid = auth.currentUser?.uid;

  if (!friendUid) {
    return (
      <View style={{ flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#888' }}>user not found</Text>
      </View>
    );
  }
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState(null);
  const [drives, setDrives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [selectedBadgeEarned, setSelectedBadgeEarned] = useState(false);
  const crews = useCrews();

  useEffect(() => {
    let profileLoaded = false;
    let drivesLoaded = false;
    const checkDone = () => { if (profileLoaded && drivesLoaded) setLoading(false); };

    const unsubProfile = onSnapshot(doc(db, 'users', friendUid), (snap) => {
      setProfile(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      profileLoaded = true;
      checkDone();
    });

    const unsubDrives = onSnapshot(collection(db, 'users', friendUid, 'drives'), (snap) => {
      setDrives(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      drivesLoaded = true;
      checkDone();
    });

    return () => { unsubProfile(); unsubDrives(); };
  }, [friendUid]);

  // Find shared crews to enable "remove" button
  const sharedCrews = crews.filter((c) => c.members?.includes(friendUid));
  const statsPublic = profile?.statsPublic !== false;

  const badgeStats = computeBadgeStats(drives, profile);
  const earnedBadgeIds = new Set(
    BADGES.filter((b) => b.condition(badgeStats)).map((b) => b.id)
  );

  const handleRemoveFromCrew = (crew) => {
    Alert.alert(
      `Remove from ${crew.name}?`,
      `${profile?.name || 'This person'} will be removed from the crew.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await updateDoc(doc(db, 'crews', crew.id), {
                members: arrayRemove(friendUid),
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e) {
              Alert.alert('Failed', e.message);
            }
          },
        },
      ]
    );
  };

  const openBadge = (badge, earned) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedBadge(badge);
    setSelectedBadgeEarned(earned);
  };

  if (loading) {
    return (
      <View style={[styles.loadingWrap, { paddingTop: insets.top }]}>
        <ActivityIndicator color={ORANGE} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={[styles.loadingWrap, { paddingTop: insets.top }]}>
        <Text style={{ color: '#555' }}>profile not found</Text>
      </View>
    );
  }

  const name = profile.name ?? 'Driver';
  const carStr = formatCarString(profile.car);
  const stats = computeStats(drives);
  const earnedCount = earnedBadgeIds.size;

  const STAT_CARDS = [
    { value: String(stats.topSpeed), label: 'top speed mph' },
    { value: String(stats.totalMiles), label: 'total miles' },
    { value: String(stats.totalDrives), label: 'drives logged' },
    { value: stats.timeLabel, label: 'behind the wheel' },
  ];

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Back button */}
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
          <Text style={styles.backText}>back</Text>
        </TouchableOpacity>

        {/* Top section */}
        <View style={styles.topSection}>
          <Avatar photoURL={profile.photoURL} name={name} size={72} />
          <Text style={styles.name}>{name}</Text>
          {profile.username ? <Text style={styles.username}>@{profile.username}</Text> : null}
          {carStr ? <Text style={styles.car}>{carStr}</Text> : null}
          {profile.location ? <Text style={styles.locationText}>{profile.location}</Text> : null}
        </View>

        {/* Stats */}
        {statsPublic ? (
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
        ) : (
          <View style={styles.privateNotice}>
            <Ionicons name="lock-closed-outline" size={14} color="#555" />
            <Text style={styles.privateText}>stats are private</Text>
          </View>
        )}

        {/* Badges */}
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>badges</Text>
            <Text style={styles.badgeCount}>{earnedCount}/{BADGES.length}</Text>
          </View>

          {BADGE_CATEGORIES.map((cat) => {
            const catBadges = BADGES.filter((b) => b.category === cat.key);
            return (
              <View key={cat.key} style={styles.categoryBlock}>
                <Text style={styles.categoryLabel}>{cat.label}</Text>
                <View style={styles.badgeRow}>
                  {catBadges.map((badge) => {
                    const earned = earnedBadgeIds.has(badge.id);
                    return (
                      <TouchableOpacity
                        key={badge.id}
                        style={[styles.badgeTile, earned ? styles.badgeTileEarned : styles.badgeTileUnearned]}
                        onPress={() => openBadge(badge, earned)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.badgeIcon, !earned && styles.badgeIconFaded]}>{badge.icon}</Text>
                        {!earned && (
                          <View style={styles.lockOverlay}>
                            <Ionicons name="lock-closed" size={10} color="#555" />
                          </View>
                        )}
                        <Text style={[styles.badgeName, earned ? styles.badgeNameEarned : styles.badgeNameUnearned]} numberOfLines={1}>
                          {badge.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>

        {/* Remove from crew buttons */}
        {sharedCrews.length > 0 && friendUid !== myUid && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>shared crews</Text>
            {sharedCrews.map((crew) => (
              <TouchableOpacity
                key={crew.id}
                style={styles.removeBtn}
                onPress={() => handleRemoveFromCrew(crew)}
                activeOpacity={0.8}
              >
                <Text style={styles.removeBtnText}>remove from {crew.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <BadgeModal
        badge={selectedBadge}
        earned={selectedBadgeEarned}
        onClose={() => setSelectedBadge(null)}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  content: { paddingBottom: 40 },
  loadingWrap: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  backBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 4 },
  backText: { color: '#fff', fontSize: 14 },

  topSection: {
    backgroundColor: '#141414', paddingVertical: 24,
    paddingHorizontal: 20, alignItems: 'center',
  },
  avatarFallback: { backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '500' },
  name: { color: '#fff', fontSize: 16, fontWeight: '500', marginTop: 10 },
  username: { color: '#555', fontSize: 12, marginTop: 2 },
  car: { color: '#555', fontSize: 11, marginTop: 4 },
  locationText: { color: '#444', fontSize: 11, marginTop: 3 },

  statsGrid: { padding: 16, gap: 8 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: {
    flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10,
    borderWidth: 0.5, borderColor: '#2a2a2a', padding: 12,
  },
  statValue: { color: ORANGE, fontSize: 24, fontWeight: '500' },
  statLabel: { color: '#555', fontSize: 9, marginTop: 2 },

  privateNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 20, paddingVertical: 16,
  },
  privateText: { color: '#555', fontSize: 12 },

  section: { paddingHorizontal: 16, paddingBottom: 16 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionLabel: { color: '#555', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  badgeCount: { color: ORANGE, fontSize: 10, fontWeight: '600' },

  categoryBlock: { marginBottom: 16 },
  categoryLabel: { color: '#333', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  badgeTile: {
    width: 70, alignItems: 'center', borderRadius: 10,
    borderWidth: 1, padding: 8, paddingBottom: 6,
  },
  badgeTileEarned: { backgroundColor: '#1a1a1a', borderColor: ORANGE },
  badgeTileUnearned: { backgroundColor: '#141414', borderColor: '#222' },
  badgeIcon: { fontSize: 22, marginBottom: 4 },
  badgeIconFaded: { opacity: 0.3 },
  lockOverlay: { position: 'absolute', top: 6, right: 6 },
  badgeName: { fontSize: 9, textAlign: 'center' },
  badgeNameEarned: { color: '#ccc' },
  badgeNameUnearned: { color: '#333' },

  removeBtn: {
    backgroundColor: '#1a1a1a', borderRadius: 10,
    borderWidth: 0.5, borderColor: '#ef444433',
    paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8,
    alignItems: 'center',
  },
  removeBtnText: { color: '#ef4444', fontSize: 14, fontWeight: '500' },

  // Badge modal
  badgeModalOverlay: {
    flex: 1, backgroundColor: '#000000cc',
    alignItems: 'center', justifyContent: 'center',
  },
  badgeModalBox: {
    backgroundColor: '#1a1a1a', borderRadius: 20,
    borderWidth: 1, borderColor: '#2a2a2a',
    padding: 28, alignItems: 'center', width: 260,
  },
  badgeModalIcon: { fontSize: 48, marginBottom: 12 },
  badgeModalName: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  badgeModalDesc: { color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 8 },
  badgeModalLocked: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  badgeModalLockedText: { color: '#555', fontSize: 11 },
});

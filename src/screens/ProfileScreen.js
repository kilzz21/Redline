import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Modal, TextInput, Image, Alert, KeyboardAvoidingView,
  Platform, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { doc, collection, onSnapshot, updateDoc } from 'firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { auth, db } from '../config/firebase';
import { uploadProfilePicture } from '../utils/uploadProfilePicture';
import SettingsScreen from './SettingsScreen';
import { useCrews } from '../hooks/useCrews';
import { BADGES, BADGE_CATEGORIES } from '../config/badges';
import { ORANGE, toDate, getInitials, formatCarString } from '../utils/helpers';

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

function sumMilesInRange(drives, start, end) {
  return drives
    .filter((d) => {
      const t = toDate(d.startTime);
      return t && t >= start && t < end;
    })
    .reduce((sum, d) => sum + (d.distance ?? 0), 0);
}

function computeStats(drives) {
  if (!drives.length) return { topSpeed: 0, totalMiles: 0, driveCount: 0, timeLabel: '0h' };
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
  return { topSpeed: Math.round(topSpeed), totalMiles: Math.round(totalMiles), driveCount: drives.length, timeLabel };
}

function computeBadgeStats(drives, crews, profile, uid) {
  const base = computeStats(drives);
  return {
    topSpeed: base.topSpeed,
    totalMiles: base.totalMiles,
    totalDrives: drives.length,
    hasNightDrive: drives.some((d) => { const h = toDate(d.startTime)?.getHours(); return h !== undefined && h >= 0 && h < 5; }),
    hasEarlyDrive: drives.some((d) => { const h = toDate(d.startTime)?.getHours(); return h !== undefined && h < 6; }),
    weekendDrives: drives.filter((d) => { const day = toDate(d.startTime)?.getDay(); return day === 0 || day === 6; }).length,
    hasCanyonDrive: drives.some((d) => (d.turnCount ?? 0) >= 20),
    crewCount: crews.length,
    createdCrew: crews.some((c) => c.createdBy === uid),
    totalCrewMembers: crews.reduce((max, c) => Math.max(max, c.members?.length ?? 0), 0),
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

// ─── Badge Unlock Celebration ─────────────────────────────────────────────────

function BadgeCelebration({ badge, onDismiss }) {
  const scaleAnim = useRef(new Animated.Value(0.5)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!badge) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [badge]);

  if (!badge) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onDismiss}>
      <TouchableOpacity style={styles.celebOverlay} activeOpacity={1} onPress={onDismiss}>
        <Animated.View style={[styles.celebBox, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
          <Text style={styles.celebLabel}>new badge unlocked!</Text>
          <Text style={styles.celebIcon}>{badge.icon}</Text>
          <Text style={styles.celebName}>{badge.name}</Text>
          <Text style={styles.celebDesc}>{badge.description}</Text>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Badge Detail Modal ───────────────────────────────────────────────────────

function BadgeModal({ badge, earned, earnedDate, onClose }) {
  if (!badge) return null;
  return (
    <Modal visible={!!badge} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.badgeModalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.badgeModalBox}>
          <Text style={styles.badgeModalIcon}>{badge.icon}</Text>
          <Text style={styles.badgeModalName}>{badge.name}</Text>
          <Text style={styles.badgeModalDesc}>{badge.description}</Text>
          {earned && earnedDate && (
            <Text style={styles.badgeModalDate}>
              earned {earnedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
          )}
          {!earned && (
            <View style={styles.badgeModalLocked}>
              <Ionicons name="lock-closed" size={12} color="#555" />
              <Text style={styles.badgeModalLockedText}>keep driving to unlock</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({ visible, profile, onClose }) {
  const [name, setName] = useState(profile?.name ?? '');
  const [location, setLocation] = useState(profile?.location ?? '');
  const [year, setYear] = useState(profile?.car?.year ?? '');
  const [make, setMake] = useState(profile?.car?.make ?? '');
  const [model, setModel] = useState(profile?.car?.model ?? '');
  const [color, setColor] = useState(profile?.car?.color ?? '');
  const [newPicUri, setNewPicUri] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(profile?.name ?? '');
      setLocation(profile?.location ?? '');
      setYear(profile?.car?.year ?? '');
      setMake(profile?.car?.make ?? '');
      setModel(profile?.car?.model ?? '');
      setColor(profile?.car?.color ?? '');
      setNewPicUri(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to change your profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 1,
    });
    if (!result.canceled) setNewPicUri(result.assets[0].uri);
  };

  const handleSave = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setSaving(true);
    try {
      const updates = {
        name: name.trim() || profile?.name,
        location: location.trim() || null,
        car: { year, make, model, color },
      };
      if (newPicUri) updates.photoURL = await uploadProfilePicture(uid, newPicUri);
      await updateDoc(doc(db, 'users', uid), updates);
      onClose();
    } catch (e) {
      Alert.alert('Save failed', e.message);
    } finally {
      setSaving(false);
    }
  };

  const previewPhotoURL = newPicUri || profile?.photoURL;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>edit profile</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving} style={styles.modalSave}>
              {saving ? <ActivityIndicator size="small" color={ORANGE} /> : <Text style={styles.modalSaveText}>save</Text>}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.modalAvatarWrap} onPress={pickImage} activeOpacity={0.8}>
            {previewPhotoURL ? (
              <Image source={{ uri: previewPhotoURL }} style={styles.modalAvatarImg} />
            ) : (
              <View style={styles.modalAvatarFallback}>
                <Text style={styles.modalAvatarInitials}>{getInitials(name)}</Text>
              </View>
            )}
            <View style={styles.modalAvatarBadge}>
              <Text style={styles.modalAvatarBadgeText}>+</Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.modalSectionLabel}>about you</Text>
          <TextInput style={styles.modalInput} value={name} onChangeText={setName} placeholder="full name" placeholderTextColor="#444" autoCorrect={false} />
          <TextInput style={styles.modalInput} value={location} onChangeText={setLocation} placeholder="city, state  (e.g. Los Angeles, CA)" placeholderTextColor="#444" autoCorrect={false} />

          <Text style={styles.modalSectionLabel}>your car</Text>
          <TextInput style={styles.modalInput} value={year} onChangeText={setYear} placeholder="year" placeholderTextColor="#444" keyboardType="number-pad" />
          <TextInput style={styles.modalInput} value={make} onChangeText={setMake} placeholder="make" placeholderTextColor="#444" autoCorrect={false} />
          <TextInput style={styles.modalInput} value={model} onChangeText={setModel} placeholder="model" placeholderTextColor="#444" autoCorrect={false} />
          <TextInput style={styles.modalInput} value={color} onChangeText={setColor} placeholder="color" placeholderTextColor="#444" autoCorrect={false} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const [profile, setProfile] = useState(null);
  const [drives, setDrives] = useState([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingDrives, setLoadingDrives] = useState(true);
  const [editVisible, setEditVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [selectedBadgeEarned, setSelectedBadgeEarned] = useState(false);
  const [celebrationBadge, setCelebrationBadge] = useState(null);

  const uid = auth.currentUser?.uid;
  const crews = useCrews();
  const prevEarnedIds = useRef(null);
  const hasMounted = useRef(false);

  useEffect(() => {
    if (!uid) { setLoadingProfile(false); return; }
    const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
      setProfile(snap.exists() ? snap.data() : null);
      setLoadingProfile(false);
    });
    return unsub;
  }, [uid]);

  useEffect(() => {
    if (!uid) { setLoadingDrives(false); return; }
    const unsub = onSnapshot(collection(db, 'users', uid, 'drives'), (snap) => {
      setDrives(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoadingDrives(false);
    });
    return unsub;
  }, [uid]);

  // Detect newly earned badges
  useEffect(() => {
    if (loadingDrives || loadingProfile) return;
    const badgeStats = computeBadgeStats(drives, crews, profile, uid);
    const currentEarned = BADGES.filter((b) => b.condition(badgeStats));
    const currentIds = new Set(currentEarned.map((b) => b.id));

    if (!hasMounted.current) {
      hasMounted.current = true;
      prevEarnedIds.current = currentIds;
      return;
    }

    const newlyEarned = currentEarned.filter((b) => !prevEarnedIds.current.has(b.id));
    if (newlyEarned.length > 0) {
      setCelebrationBadge(newlyEarned[0]);
    }
    prevEarnedIds.current = currentIds;
  }, [drives, crews, profile, loadingDrives, loadingProfile]);

  if (loadingProfile || loadingDrives) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={ORANGE} />
      </View>
    );
  }

  const stats = computeStats(drives);
  const badgeStats = computeBadgeStats(drives, crews, profile, uid);
  const earnedBadgeIds = new Set(BADGES.filter((b) => b.condition(badgeStats)).map((b) => b.id));
  const earnedCount = earnedBadgeIds.size;

  const thisWeek = weekBounds(0);
  const lastWeek = weekBounds(1);
  const thisWeekMi = sumMilesInRange(drives, thisWeek.start, thisWeek.end);
  const lastWeekMi = sumMilesInRange(drives, lastWeek.start, lastWeek.end);
  const maxMi = Math.max(thisWeekMi, lastWeekMi, 1);
  const delta = lastWeekMi > 0 ? Math.round(((thisWeekMi - lastWeekMi) / lastWeekMi) * 100) : null;

  const STAT_CARDS = [
    { value: String(stats.topSpeed), label: 'top speed mph' },
    { value: String(Math.round(stats.totalMiles)), label: 'total miles' },
    { value: String(stats.driveCount), label: 'drives logged' },
    { value: stats.timeLabel, label: 'behind the wheel' },
  ];

  const name = profile?.name ?? auth.currentUser?.email ?? 'Driver';
  const carStr = formatCarString(profile?.car);

  const openBadge = (badge, earned) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedBadge(badge);
    setSelectedBadgeEarned(earned);
  };

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Top section */}
        <View style={styles.topSection}>
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSettingsVisible(true); }}
            activeOpacity={0.7}
          >
            <Ionicons name="settings-outline" size={18} color="#555" />
          </TouchableOpacity>

          <Avatar photoURL={profile?.photoURL} name={name} size={72} />
          <Text style={styles.name}>{name}</Text>
          {profile?.username ? <Text style={styles.username}>@{profile.username}</Text> : null}
          {carStr ? <Text style={styles.car}>{carStr}</Text> : (
            <Text style={[styles.car, { color: '#333' }]}>no car added yet</Text>
          )}
          {profile?.location ? <Text style={styles.locationText}>{profile.location}</Text> : null}
        </View>

        {/* ── Stats grid */}
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

        {/* ── Week comparison */}
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
                <Text style={styles.weekLabelThis}>{thisWeekMi.toFixed(1)}mi this week</Text>
                <Text style={styles.weekLabelLast}>{lastWeekMi.toFixed(1)}mi last week</Text>
              </View>
              {delta !== null && (
                <Text style={[styles.weekDelta, { color: delta >= 0 ? '#22c55e' : '#ef4444' }]}>
                  {delta >= 0 ? `+${delta}%` : `${delta}%`}
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* ── Badges */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>badges</Text>
            <Text style={styles.badgeCountText}>{earnedCount}/{BADGES.length} earned</Text>
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

      </ScrollView>

      <EditModal visible={editVisible} profile={profile} onClose={() => setEditVisible(false)} />
      <SettingsScreen
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        onEditProfile={() => { setSettingsVisible(false); setEditVisible(true); }}
      />
      <BadgeModal
        badge={selectedBadge}
        earned={selectedBadgeEarned}
        onClose={() => setSelectedBadge(null)}
      />
      <BadgeCelebration badge={celebrationBadge} onDismiss={() => setCelebrationBadge(null)} />
    </>
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
  settingsBtn: {
    position: 'absolute', top: 16, right: 16,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#1a1a1a', borderWidth: 0.5, borderColor: '#2a2a2a',
    alignItems: 'center', justifyContent: 'center',
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

  section: { paddingHorizontal: 16, paddingBottom: 16 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionLabel: { color: '#555', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  badgeCountText: { color: ORANGE, fontSize: 10, fontWeight: '600' },

  weekCard: {
    backgroundColor: '#1a1a1a', borderRadius: 10,
    borderWidth: 0.5, borderColor: '#2a2a2a', padding: 12,
  },
  barsWrap: { flexDirection: 'row', height: 28, gap: 6, marginBottom: 10 },
  barCol: { flex: 1, flexDirection: 'row', alignItems: 'stretch', backgroundColor: '#222', borderRadius: 4, overflow: 'hidden' },
  bar: { borderRadius: 4 },
  weekLabelsRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  weekLabels: { gap: 2 },
  weekLabelThis: { color: '#fff', fontSize: 11 },
  weekLabelLast: { color: '#555', fontSize: 11 },
  weekDelta: { fontSize: 12, fontWeight: '500' },

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

  // Badge detail modal
  badgeModalOverlay: { flex: 1, backgroundColor: '#000000cc', alignItems: 'center', justifyContent: 'center' },
  badgeModalBox: {
    backgroundColor: '#1a1a1a', borderRadius: 20,
    borderWidth: 1, borderColor: '#2a2a2a',
    padding: 28, alignItems: 'center', width: 260,
  },
  badgeModalIcon: { fontSize: 48, marginBottom: 12 },
  badgeModalName: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  badgeModalDesc: { color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 8 },
  badgeModalDate: { color: '#555', fontSize: 11 },
  badgeModalLocked: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  badgeModalLockedText: { color: '#555', fontSize: 11 },

  // Badge celebration
  celebOverlay: { flex: 1, backgroundColor: '#000000bb', alignItems: 'center', justifyContent: 'center' },
  celebBox: {
    backgroundColor: '#1a1a1a', borderRadius: 24,
    borderWidth: 1.5, borderColor: ORANGE,
    padding: 32, alignItems: 'center', width: 280,
  },
  celebLabel: { color: ORANGE, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 },
  celebIcon: { fontSize: 60, marginBottom: 12 },
  celebName: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 6 },
  celebDesc: { color: '#888', fontSize: 13, textAlign: 'center' },

  // Edit modal
  modalRoot: { flex: 1, backgroundColor: '#111' },
  modalScroll: { paddingHorizontal: 20, paddingBottom: 40 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 20, paddingBottom: 20,
  },
  modalCancel: { paddingVertical: 4, paddingRight: 8 },
  modalCancelText: { color: '#888', fontSize: 14 },
  modalTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalSave: { paddingVertical: 4, paddingLeft: 8 },
  modalSaveText: { color: ORANGE, fontSize: 14, fontWeight: '700' },
  modalAvatarWrap: { alignSelf: 'center', marginBottom: 28 },
  modalAvatarImg: { width: 80, height: 80, borderRadius: 40 },
  modalAvatarFallback: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center',
  },
  modalAvatarInitials: { color: '#fff', fontSize: 24, fontWeight: '500' },
  modalAvatarBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center',
  },
  modalAvatarBadgeText: { color: '#fff', fontSize: 16, lineHeight: 20, fontWeight: '700' },
  modalSectionLabel: {
    color: '#444', fontSize: 11, fontWeight: '600', letterSpacing: 1.5,
    textTransform: 'uppercase', marginBottom: 12, marginTop: 4,
  },
  modalInput: {
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 10, color: '#fff', fontSize: 15,
    paddingHorizontal: 14, paddingVertical: 14, marginBottom: 10,
  },
});

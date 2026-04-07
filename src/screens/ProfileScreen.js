import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Modal, TextInput, Image, Alert, KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { doc, collection, onSnapshot, updateDoc } from 'firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { auth, db } from '../config/firebase';
import { uploadProfilePicture } from '../utils/uploadProfilePicture';
import SettingsScreen from './SettingsScreen';

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

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ photoURL, name, size = 72 }) {
  if (photoURL) {
    return (
      <Image
        source={{ uri: photoURL }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.3 }]}>{getInitials(name)}</Text>
    </View>
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

  // Reset fields when modal opens
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
  }, [visible, profile]);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to change your profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (!result.canceled) {
      setNewPicUri(result.assets[0].uri);
    }
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
      if (newPicUri) {
        updates.photoURL = await uploadProfilePicture(uid, newPicUri);
      }
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
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.modalScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>edit profile</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving} style={styles.modalSave}>
              {saving
                ? <ActivityIndicator size="small" color={ORANGE} />
                : <Text style={styles.modalSaveText}>save</Text>
              }
            </TouchableOpacity>
          </View>

          {/* Avatar picker */}
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
          <TextInput
            style={styles.modalInput}
            value={name}
            onChangeText={setName}
            placeholder="full name"
            placeholderTextColor="#444"
            autoCorrect={false}
          />
          <TextInput
            style={styles.modalInput}
            value={location}
            onChangeText={setLocation}
            placeholder="city, state  (e.g. Los Angeles, CA)"
            placeholderTextColor="#444"
            autoCorrect={false}
          />

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

  const uid = auth.currentUser?.uid;

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
  const maxMi = Math.max(thisWeekMi, lastWeekMi, 1);
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
  const locationStr = profile?.location;

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Top section ────────────────────────────────── */}
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
          {profile?.username ? (
            <Text style={styles.username}>@{profile.username}</Text>
          ) : null}
          {carStr ? (
            <Text style={styles.car}>{carStr}</Text>
          ) : (
            <Text style={[styles.car, { color: '#333' }]}>no car added yet</Text>
          )}
          {locationStr ? (
            <Text style={styles.locationText}>{locationStr}</Text>
          ) : null}
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

      <EditModal
        visible={editVisible}
        profile={profile}
        onClose={() => setEditVisible(false)}
      />

      <SettingsScreen
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        onEditProfile={() => { setSettingsVisible(false); setEditVisible(true); }}
      />
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

  avatarFallback: {
    backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center',
  },
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

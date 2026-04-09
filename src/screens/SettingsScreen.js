import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, Alert, ActivityIndicator, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  signOut, updatePassword, EmailAuthProvider, reauthenticateWithCredential,
  deleteUser,
} from 'firebase/auth';
import { doc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
import * as Haptics from 'expo-haptics';
import { auth, db } from '../config/firebase';

const ORANGE = '#f97316';

// ─── Re-auth Modal ────────────────────────────────────────────────────────────

function ReauthModal({ visible, onSuccess, onCancel, title, description }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleReauth = async () => {
    if (!password) return;
    const user = auth.currentUser;
    setLoading(true);
    try {
      const cred = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, cred);
      setPassword('');
      onSuccess();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Authentication failed', 'Incorrect password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.reauthOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.reauthBox}>
          <Text style={styles.reauthTitle}>{title}</Text>
          <Text style={styles.reauthDesc}>{description}</Text>
          <TextInput
            style={styles.reauthInput}
            placeholder="current password"
            placeholderTextColor="#444"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoFocus
          />
          <View style={styles.reauthBtns}>
            <TouchableOpacity onPress={onCancel} style={styles.reauthCancel} activeOpacity={0.7}>
              <Text style={styles.reauthCancelText}>cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleReauth}
              disabled={!password || loading}
              style={[styles.reauthConfirm, (!password || loading) && { opacity: 0.4 }]}
              activeOpacity={0.7}
            >
              {loading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.reauthConfirmText}>confirm</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Change Password Modal ────────────────────────────────────────────────────

function ChangePasswordModal({ visible, onClose }) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const reset = () => { setCurrent(''); setNext(''); setConfirm(''); };

  const handleSave = async () => {
    if (!current || !next || !confirm) {
      Alert.alert('Missing fields', 'Fill in all three fields.');
      return;
    }
    if (next !== confirm) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Passwords don\'t match', 'New password and confirmation must match.');
      return;
    }
    if (next.length < 6) {
      Alert.alert('Too short', 'Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      const user = auth.currentUser;
      const cred = EmailAuthProvider.credential(user.email, current);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Password changed', 'Your password has been updated.');
      reset();
      onClose();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Failed', e.code === 'auth/wrong-password'
        ? 'Current password is incorrect.'
        : e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.modalHeader, { paddingTop: insets.top + 16 }]}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.modalCancel}>cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>change password</Text>
          <TouchableOpacity onPress={handleSave} disabled={loading} activeOpacity={0.7}>
            {loading
              ? <ActivityIndicator size="small" color={ORANGE} />
              : <Text style={styles.modalSave}>save</Text>
            }
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
          <TextInput style={styles.input} placeholder="current password" placeholderTextColor="#444" value={current} onChangeText={setCurrent} secureTextEntry />
          <TextInput style={styles.input} placeholder="new password" placeholderTextColor="#444" value={next} onChangeText={setNext} secureTextEntry />
          <TextInput style={styles.input} placeholder="confirm new password" placeholderTextColor="#444" value={confirm} onChangeText={setConfirm} secureTextEntry />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Settings Row ─────────────────────────────────────────────────────────────

function Row({ label, sublabel, onPress, rightContent, destructive, disabled }) {
  return (
    <TouchableOpacity
      style={[styles.row, disabled && { opacity: 0.4 }]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
    >
      <View style={styles.rowLeft}>
        <Text style={[styles.rowLabel, destructive && styles.rowLabelDestructive]} numberOfLines={1}>
          {label}
        </Text>
        {sublabel ? <Text style={styles.rowSublabel} numberOfLines={1}>{sublabel}</Text> : null}
      </View>
      {rightContent ?? <Text style={styles.rowChevron}>›</Text>}
    </TouchableOpacity>
  );
}

function SectionHeader({ title }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function Divider() {
  return <View style={styles.divider} />;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SettingsScreen({ visible, onClose, onEditProfile }) {
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState({ newInvite: true, crewOnline: true, crewRadio: false });
  const [statsPublic, setStatsPublic] = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showReauth, setShowReauth] = useState(false);
  const [reauthAction, setReauthAction] = useState(null);
  const [logOutLoading, setLogOutLoading] = useState(false);

  // Load user prefs when modal opens
  useEffect(() => {
    if (!visible) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, 'users', uid)).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setStatsPublic(data.statsPublic !== false);
      if (data.notifications) {
        setNotifications((prev) => ({ ...prev, ...data.notifications }));
      }
    }).catch(() => {});
  }, [visible]);

  const triggerReauth = (action) => {
    setReauthAction(() => action);
    setShowReauth(true);
  };

  const handleLogOut = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          setLogOutLoading(true);
          try {
            await signOut(auth);
            onClose();
          } catch (e) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert('Error', e.message);
          } finally {
            setLogOutLoading(false);
          }
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Delete account',
      'This permanently deletes your account, profile, and all your data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete my account',
          style: 'destructive',
          onPress: () => {
            triggerReauth(async () => {
              const uid = auth.currentUser?.uid;
              try {
                if (uid) await deleteDoc(doc(db, 'users', uid));
                await deleteUser(auth.currentUser);
                onClose();
              } catch (e) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                Alert.alert('Failed', e.message);
              }
            });
          },
        },
      ]
    );
  };

  const toggleStatsPublic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !statsPublic;
    setStatsPublic(next);
    const uid = auth.currentUser?.uid;
    if (uid) updateDoc(doc(db, 'users', uid), { statsPublic: next }).catch(() => {});
  };

  const toggleNotification = (key) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNotifications((prev) => ({ ...prev, [key]: !prev[key] }));
    const uid = auth.currentUser?.uid;
    if (uid) {
      updateDoc(doc(db, 'users', uid), {
        [`notifications.${key}`]: !notifications[key],
      }).catch(() => {});
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.headerClose}>done</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>settings</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

          {/* Account */}
          <SectionHeader title="account" />
          <View style={styles.section}>
            <Row
              label="edit profile"
              sublabel="name, car, location, photo"
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onEditProfile(); }}
            />
            <Divider />
            <Row
              label="change password"
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowChangePassword(true); }}
            />
          </View>

          {/* Notifications */}
          <SectionHeader title="notifications" />
          <View style={styles.section}>
            <Row
              label="new connection request"
              rightContent={
                <Switch
                  value={notifications.newInvite}
                  onValueChange={() => toggleNotification('newInvite')}
                  trackColor={{ false: '#2a2a2a', true: ORANGE }}
                  thumbColor="#fff"
                />
              }
            />
            <Divider />
            <Row
              label="crew member comes online"
              rightContent={
                <Switch
                  value={notifications.crewOnline}
                  onValueChange={() => toggleNotification('crewOnline')}
                  trackColor={{ false: '#2a2a2a', true: ORANGE }}
                  thumbColor="#fff"
                />
              }
            />
            <Divider />
            <Row
              label="crew radio activity"
              rightContent={
                <Switch
                  value={notifications.crewRadio}
                  onValueChange={() => toggleNotification('crewRadio')}
                  trackColor={{ false: '#2a2a2a', true: ORANGE }}
                  thumbColor="#fff"
                />
              }
            />
          </View>

          {/* Privacy */}
          <SectionHeader title="privacy" />
          <View style={styles.section}>
            <Row
              label="show my stats to crew"
              sublabel="speed, miles, drives visible on your profile"
              rightContent={
                <Switch
                  value={statsPublic}
                  onValueChange={toggleStatsPublic}
                  trackColor={{ false: '#2a2a2a', true: ORANGE }}
                  thumbColor="#fff"
                />
              }
            />
          </View>

          {/* Danger zone */}
          <SectionHeader title="account actions" />
          <View style={styles.section}>
            <TouchableOpacity style={styles.logOutBtn} onPress={handleLogOut} activeOpacity={0.7}>
              {logOutLoading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.logOutText}>log out</Text>
              }
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteAccount} activeOpacity={0.7}>
            <Text style={styles.deleteText}>delete account</Text>
          </TouchableOpacity>
          <Text style={styles.deleteHint}>permanently removes all your data</Text>

        </ScrollView>
      </View>

      <ChangePasswordModal visible={showChangePassword} onClose={() => setShowChangePassword(false)} />
      <ReauthModal
        visible={showReauth}
        title="Confirm your identity"
        description="Enter your current password to continue."
        onCancel={() => setShowReauth(false)}
        onSuccess={() => {
          setShowReauth(false);
          reauthAction?.();
        }}
      />
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#2a2a2a',
  },
  headerClose: { color: ORANGE, fontSize: 14, fontWeight: '600', width: 40 },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },

  content: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 },

  sectionHeader: {
    color: '#444', fontSize: 10, fontWeight: '600',
    letterSpacing: 1.5, textTransform: 'uppercase',
    marginTop: 24, marginBottom: 8, marginLeft: 4,
  },

  section: {
    backgroundColor: '#1a1a1a', borderRadius: 12,
    borderWidth: 0.5, borderColor: '#2a2a2a', overflow: 'hidden',
  },

  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 14, minHeight: 50,
  },
  rowLeft: { flex: 1, marginRight: 8 },
  rowLabel: { color: '#fff', fontSize: 14, fontWeight: '500' },
  rowLabelDestructive: { color: '#ef4444' },
  rowSublabel: { color: '#555', fontSize: 11, marginTop: 2 },
  rowChevron: { color: '#444', fontSize: 18 },

  divider: { height: 0.5, backgroundColor: '#2a2a2a', marginLeft: 14 },

  logOutBtn: {
    backgroundColor: '#ef4444', borderRadius: 10,
    paddingVertical: 14, alignItems: 'center', margin: 12,
  },
  logOutText: { color: '#fff', fontSize: 15, fontWeight: '700' },


  deleteBtn: { marginTop: 8, paddingVertical: 12, alignItems: 'center' },
  deleteText: { color: '#444', fontSize: 13, fontWeight: '500' },
  deleteHint: { color: '#333', fontSize: 11, textAlign: 'center', marginTop: 4 },

  // Reauth modal
  reauthOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  reauthBox: {
    backgroundColor: '#1a1a1a', borderRadius: 16,
    padding: 24, width: '100%', borderWidth: 0.5, borderColor: '#2a2a2a',
  },
  reauthTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  reauthDesc: { color: '#555', fontSize: 13, marginBottom: 16, lineHeight: 18 },
  reauthInput: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 10, color: '#fff', fontSize: 15,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16,
  },
  reauthBtns: { flexDirection: 'row', gap: 10 },
  reauthCancel: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    backgroundColor: '#222', borderRadius: 10,
  },
  reauthCancelText: { color: '#888', fontSize: 14, fontWeight: '600' },
  reauthConfirm: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    backgroundColor: ORANGE, borderRadius: 10,
  },
  reauthConfirmText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Change password modal
  modalRoot: { flex: 1, backgroundColor: '#111' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#2a2a2a',
  },
  modalCancel: { color: '#888', fontSize: 14, width: 60 },
  modalTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalSave: { color: ORANGE, fontSize: 14, fontWeight: '700', textAlign: 'right', width: 60 },
  modalBody: { padding: 16 },
  input: {
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 10, color: '#fff', fontSize: 15,
    paddingHorizontal: 14, paddingVertical: 14, marginBottom: 10,
  },
});

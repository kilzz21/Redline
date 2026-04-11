import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  Alert, Share, Image, ActivityIndicator, Modal, KeyboardAvoidingView,
  Platform, Animated, RefreshControl, Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection, query, where, onSnapshot, addDoc, setDoc, getDoc, updateDoc, deleteDoc,
  doc, documentId, serverTimestamp, getDocs, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import * as Contacts from 'expo-contacts';
import * as Haptics from 'expo-haptics';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../config/firebase';
import { useCrews } from '../hooks/useCrews';
import { useAcceptedCrew } from '../hooks/useAcceptedCrew';
import { requestJoinChannel } from '../utils/radioJoinRequest';
import { SkeletonList } from '../components/SkeletonCard';
import { ORANGE, getAvatarColor, getInitials, formatCarString } from '../utils/helpers';

// ─── Contacts cache (module-level, 5-min TTL) ─────────────────────────────────
let _contactsCache = null;
let _contactsCacheTime = 0;
const CONTACTS_TTL = 5 * 60 * 1000;

function normalizePhone(raw) {
  if (!raw) return '';
  return raw.replace(/\D/g, '');
}

// Mark all pending crewInvites for a crew as expired (called when crew is deleted).
// Only returns docs where auth user is fromUid or toUid (rule-enforced).
async function expireCrewInvites(crewId) {
  try {
    const snap = await getDocs(
      query(collection(db, 'crewInvites'), where('crewId', '==', crewId), where('status', '==', 'pending'))
    );
    await Promise.all(snap.docs.map((d) => updateDoc(d.ref, { status: 'expired' })));
  } catch (e) {
    console.warn('[expireCrewInvites] failed:', e.message);
  }
}

// Fire-and-forget push notification — never throws, never blocks the caller.
function pushNotify(toUid, title, body, data = {}) {
  httpsCallable(functions, 'sendPushNotification')({ toUid, title, body, data })
    .catch((e) => console.warn('[push]', e.message));
}

// Deterministic invite doc ID — enforces one invite per person per crew.
function crewInviteDocId(crewId, toUid) {
  return `${crewId}_${toUid}`;
}

// Returns true if sent, false if a pending invite already exists.
async function sendCrewInviteDoc({ crewId, crewName, fromUid, fromName, toUid, memberCount }) {
  // Force-refresh token so Firestore security context is fresh.
  if (auth.currentUser) await auth.currentUser.getIdToken(true);

  const docId = crewInviteDocId(crewId, toUid);
  const ref = doc(db, 'crewInvites', docId);

  // Check for existing pending invite.
  let snap;
  try {
    snap = await getDoc(ref);
  } catch {
    // If we can't read (doc likely doesn't exist yet), proceed to write.
    snap = null;
  }

  if (snap?.exists() && snap.data().status === 'pending') {
    return false;
  }

  const payload = {
    crewId,
    crewName,
    fromUid,
    fromName,
    toUid,
    memberCount,
    status: 'pending',
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(ref, payload);
    pushNotify(toUid, 'crew invite', `${fromName} invited you to join ${crewName}`, { type: 'crewInvite', crewId });
    return true;
  } catch (writeErr) {
    throw writeErr;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOnline(profile) {
  const last = profile?.lastSeen?.toMillis?.() ?? 0;
  return Date.now() - last < 2 * 60 * 1000;
}

// ─── Pulsing Online Dot ───────────────────────────────────────────────────────

function PulsingOnlineDot() {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.5, duration: 300, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.View
      style={[
        { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
        { transform: [{ scale }] },
      ]}
    />
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Avatar({ photoURL, name, uid, size = 40, style }) {
  const color = getAvatarColor(uid);
  if (photoURL) {
    return (
      <Image
        source={{ uri: photoURL }}
        style={[{ width: size, height: size, borderRadius: size / 2 }, style]}
      />
    );
  }
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color,
          alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
    >
      <Text style={{ color: '#fff', fontSize: size * 0.33, fontWeight: '700' }}>
        {getInitials(name)}
      </Text>
    </View>
  );
}

function Checkbox({ checked, label, subLabel, onToggle }) {
  return (
    <TouchableOpacity style={styles.checkRow} onPress={onToggle} activeOpacity={0.7}>
      <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
        {checked && <Text style={styles.checkMark}>✓</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.checkLabel}>{label}</Text>
        {subLabel ? <Text style={styles.checkSubLabel}>{subLabel}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Crew card ────────────────────────────────────────────────────────────────

function CrewCard({ crew, uid, onPress, onLongPress, onOpenRadio, index }) {
  const profiles = crew.memberProfiles || [];
  const onlineCount = profiles.filter(isOnline).length;
  const visibleAvatars = profiles.slice(0, 5);
  const extra = profiles.length - visibleAvatars.length;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    const delay = (index || 0) * 80;
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, delay, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 300, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <TouchableOpacity
        style={styles.crewCard}
        onPress={onPress}
        onLongPress={onLongPress}
        activeOpacity={0.75}
        delayLongPress={400}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.crewCardName} numberOfLines={1}>{crew.name}</Text>

          {/* Member avatars row */}
          <View style={styles.avatarRow}>
            {visibleAvatars.map((p, i) => (
              <Avatar
                key={p.id}
                photoURL={p.photoURL}
                name={p.name}
                uid={p.id}
                size={26}
                style={{ marginLeft: i === 0 ? 0 : -8, borderWidth: 2, borderColor: '#1a1a1a' }}
              />
            ))}
            {extra > 0 && (
              <View style={styles.extraBubble}>
                <Text style={styles.extraBubbleText}>+{extra}</Text>
              </View>
            )}
            <Text style={styles.memberCountText} numberOfLines={1}>
              {profiles.length} member{profiles.length !== 1 ? 's' : ''}
            </Text>
          </View>

          {onlineCount > 0 && (
            <View style={styles.onlineRow}>
              <PulsingOnlineDot />
              <Text style={styles.onlineText}>{onlineCount} online</Text>
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.radioBtn} onPress={onOpenRadio} activeOpacity={0.8}>
          <Text style={styles.radioBtnText}>radio</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Create Crew Modal ────────────────────────────────────────────────────────

function CreateCrewModal({ visible, connections, uid, myProfile, onClose, onCreated }) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleCreate = async () => {
    if (!name.trim() || !uid) return;
    setLoading(true);
    try {
      const crewName = name.trim();
      const ref = await addDoc(collection(db, 'crews'), {
        name: crewName,
        createdBy: uid,
        members: [uid],
        createdAt: serverTimestamp(),
      });
      const fromName = myProfile?.name || auth.currentUser?.email || 'Unknown';
      await Promise.all([...selected].map((toUid) =>
        sendCrewInviteDoc({
          crewId: ref.id,
          crewName,
          fromUid: uid,
          fromName,
          toUid,
          memberCount: selected.size + 1,
        })
      ));
      onCreated(ref.id, selected.size);
      setName('');
      setSelected(new Set());
      onClose();
    } catch (e) {
      Alert.alert('Failed to create crew', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.modalRoot, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalHeaderBtn}>
            <Text style={styles.modalCancelText}>cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>new crew</Text>
          <TouchableOpacity
            onPress={handleCreate}
            disabled={!name.trim() || loading}
            style={styles.modalHeaderBtn}
          >
            {loading
              ? <ActivityIndicator size="small" color={ORANGE} />
              : <Text style={[styles.modalSaveText, !name.trim() && { opacity: 0.3 }]}>create</Text>
            }
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.modalScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TextInput
            style={styles.crewNameInput}
            placeholder="crew name..."
            placeholderTextColor="#444"
            value={name}
            onChangeText={setName}
            autoFocus
            autoCorrect={false}
          />

          {connections.length > 0 && (
            <>
              <Text style={styles.modalSectionLabel}>add members</Text>
              {connections.map((c) => (
                <Checkbox
                  key={c.id}
                  checked={selected.has(c.id)}
                  label={c.name || c.email || 'Unknown'}
                  subLabel={formatCarString(c.car) || c.location}
                  onToggle={() => toggle(c.id)}
                />
              ))}
            </>
          )}

          {connections.length === 0 && (
            <Text style={styles.modalEmpty}>
              add connections first — then you can invite them to crews
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Crew Detail Modal ────────────────────────────────────────────────────────

function CrewDetailModal({ crew, uid, myProfile, connections, sentCrewInviteMap, visible, onClose, onInvitesSent, navigation }) {
  const insets = useSafeAreaInsets();
  const [addingMembers, setAddingMembers] = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState(new Set());
  const [addLoading, setAddLoading] = useState(false);

  const isCreator = crew?.createdBy === uid;
  const profiles = crew?.memberProfiles || [];
  const currentMemberIds = new Set(crew?.members || []);
  // Connections not yet in the crew
  const eligibleToAdd = connections.filter((c) => !currentMemberIds.has(c.id));
  // Subset that already have a pending invite for this specific crew
  const alreadyInvitedForCrew = crew ? (sentCrewInviteMap?.get(crew.id) ?? new Set()) : new Set();

  const toggleAdd = useCallback((id) => {
    setSelectedToAdd((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleAddMembers = async () => {
    if (!crew || selectedToAdd.size === 0) return;
    setAddLoading(true);
    try {
      const fromName = myProfile?.name || auth.currentUser?.email || 'Unknown';
      let sent = 0;
      await Promise.all([...selectedToAdd].map(async (toUid) => {
        const ok = await sendCrewInviteDoc({
          crewId: crew.id,
          crewName: crew.name,
          fromUid: uid,
          fromName,
          toUid,
          memberCount: (crew.members?.length || 1) + 1,
        });
        if (ok) sent++;
      }));
      onInvitesSent?.(sent);
      setSelectedToAdd(new Set());
      setAddingMembers(false);
    } catch (e) {
      Alert.alert('Failed to invite members', e.message);
    } finally {
      setAddLoading(false);
    }
  };

  const handleOptions = () => {
    const buttons = [
      { text: 'Add Members', onPress: () => setAddingMembers(true) },
      {
        text: 'Leave Crew',
        style: 'destructive',
        onPress: () => {
          Alert.alert('Leave Crew', `Leave "${crew.name}"?`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Leave',
              style: 'destructive',
              onPress: async () => {
                try {
                  await updateDoc(doc(db, 'crews', crew.id), {
                    members: arrayRemove(uid),
                  });
                  onClose();
                } catch (e) {
                  Alert.alert('Failed', e.message);
                }
              },
            },
          ]);
        },
      },
    ];
    if (isCreator) {
      buttons.push({
        text: 'Delete Crew',
        style: 'destructive',
        onPress: () => {
          Alert.alert('Delete Crew', `Permanently delete "${crew.name}"?`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => {
                try {
                  await expireCrewInvites(crew.id);
                  await deleteDoc(doc(db, 'crews', crew.id));
                  onClose();
                } catch (e) {
                  Alert.alert('Failed', e.message);
                }
              },
            },
          ]);
        },
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(crew.name, null, buttons);
  };

  if (!crew) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modalRoot, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <TouchableOpacity
            onPress={() => addingMembers ? setAddingMembers(false) : onClose()}
            style={styles.modalHeaderBtn}
          >
            <Text style={styles.modalCancelText}>{addingMembers ? '← back' : 'done'}</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle} numberOfLines={1}>
            {addingMembers ? 'add members' : crew.name}
          </Text>
          {!addingMembers ? (
            <TouchableOpacity onPress={handleOptions} style={styles.modalHeaderBtn}>
              <Text style={styles.optionsBtn}>•••</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleAddMembers}
              disabled={selectedToAdd.size === 0 || addLoading}
              style={styles.modalHeaderBtn}
            >
              {addLoading
                ? <ActivityIndicator size="small" color={ORANGE} />
                : <Text style={[styles.modalSaveText, selectedToAdd.size === 0 && { opacity: 0.3 }]}>invite</Text>
              }
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          contentContainerStyle={styles.modalScroll}
          showsVerticalScrollIndicator={false}
        >
          {!addingMembers ? (
            <>
              <Text style={styles.modalSectionLabel}>
                {profiles.length} member{profiles.length !== 1 ? 's' : ''}
              </Text>
              {profiles.map((p) => {
                const online = isOnline(p);
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.memberRow}
                    onPress={() => { onClose(); setTimeout(() => navigation.navigate('FriendProfile', { uid: p.id }), 300); }}
                    activeOpacity={0.7}
                  >
                    <Avatar photoURL={p.photoURL} name={p.name} uid={p.id} size={40} />
                    <View style={[styles.cardBody, { marginLeft: 12 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.memberName} numberOfLines={1}>{p.name || 'Unknown'}</Text>
                        {p.id === uid && <Text style={styles.youLabel}>you</Text>}
                      </View>
                      {p.username ? <Text style={styles.subText} numberOfLines={1}>@{p.username}</Text> : null}
                      {formatCarString(p.car) ? <Text style={styles.subText} numberOfLines={1}>{formatCarString(p.car)}</Text> : null}
                    </View>
                    <View style={[styles.onlineDotGreen, { backgroundColor: online ? '#22c55e' : '#333' }]} />
                  </TouchableOpacity>
                );
              })}

              {eligibleToAdd.length > 0 && (
                <TouchableOpacity
                  style={styles.addMemberBtn}
                  onPress={() => setAddingMembers(true)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.addMemberBtnText}>+ invite member</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <>
              {eligibleToAdd.length === 0 ? (
                <Text style={styles.modalEmpty}>all your connections are already in this crew</Text>
              ) : (
                eligibleToAdd.map((c) => {
                  if (alreadyInvitedForCrew.has(c.id)) {
                    return (
                      <View key={c.id} style={styles.checkRow}>
                        <View style={[styles.checkBox, { opacity: 0.3 }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.checkLabel, { opacity: 0.4 }]}>{c.name || 'Unknown'}</Text>
                          {(formatCarString(c.car) || c.location)
                            ? <Text style={styles.checkSubLabel}>{formatCarString(c.car) || c.location}</Text>
                            : null}
                        </View>
                        <Text style={styles.alreadyInvitedLabel}>already invited</Text>
                      </View>
                    );
                  }
                  return (
                    <Checkbox
                      key={c.id}
                      checked={selectedToAdd.has(c.id)}
                      label={c.name || 'Unknown'}
                      subLabel={formatCarString(c.car) || c.location}
                      onToggle={() => toggleAdd(c.id)}
                    />
                  );
                })
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Add to Crew Modal ───────────────────────────────────────────────────────

function AddToCrewModal({ visible, onClose, contactUser, crews, uid, myProfile, sentCrewInviteMap, onInviteSent, onToast }) {
  const insets = useSafeAreaInsets();
  const [sending, setSending] = useState(null); // crewId being sent

  if (!contactUser) return null;
  const memberCrewIds = new Set(
    crews.filter((c) => c.members?.includes(contactUser.id)).map((c) => c.id)
  );
  const eligible = crews.filter((c) => !memberCrewIds.has(c.id));

  const handleSend = async (crew) => {
    // Client-side dedup: check map before attempting Firestore write
    if (sentCrewInviteMap?.get(crew.id)?.has(contactUser.id)) {
      onToast?.('invite already sent');
      return;
    }
    setSending(crew.id);
    try {
      const sent = await sendCrewInviteDoc({
        crewId: crew.id,
        crewName: crew.name,
        fromUid: uid,
        fromName: myProfile?.name || auth.currentUser?.email || 'Unknown',
        toUid: contactUser.id,
        memberCount: (crew.members?.length || 1) + 1,
      });
      if (!sent) {
        onToast?.('invite already sent');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onInviteSent?.(crew.name);
      onClose();
    } catch (e) {
      Alert.alert('Failed to invite', e.message);
    } finally {
      setSending(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modalRoot, { paddingTop: insets.top }]}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalHeaderBtn}>
            <Text style={styles.modalCancelText}>cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle} numberOfLines={1}>invite to crew</Text>
          <View style={styles.modalHeaderBtn} />
        </View>
        <ScrollView contentContainerStyle={styles.modalScroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.card, { marginBottom: 16 }]}>
            <Avatar photoURL={contactUser.photoURL} name={contactUser.name} uid={contactUser.id} size={40} />
            <View style={[styles.cardBody, { marginLeft: 12 }]}>
              <Text style={styles.memberName}>{contactUser.name}</Text>
              {formatCarString(contactUser.car)
                ? <Text style={styles.subText}>{formatCarString(contactUser.car)}</Text>
                : null}
            </View>
          </View>
          <Text style={styles.modalSectionLabel}>pick a crew</Text>
          {eligible.length === 0 ? (
            <Text style={styles.modalEmpty}>they're already in all your crews</Text>
          ) : (
            eligible.map((crew) => {
              const alreadyInvited = sentCrewInviteMap?.get(crew.id)?.has(contactUser.id);
              return (
                <TouchableOpacity
                  key={crew.id}
                  style={styles.crewPickRow}
                  onPress={() => !alreadyInvited && handleSend(crew)}
                  activeOpacity={alreadyInvited ? 1 : 0.75}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{crew.name}</Text>
                    <Text style={styles.subText}>{crew.members?.length || 1} member{crew.members?.length !== 1 ? 's' : ''}</Text>
                  </View>
                  {sending === crew.id
                    ? <ActivityIndicator size="small" color={ORANGE} />
                    : alreadyInvited
                      ? <Text style={styles.alreadyInvitedLabel}>invited</Text>
                      : <Text style={styles.modalSaveText}>invite →</Text>
                  }
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CrewScreen({ navigation, route }) {
  const uid = auth.currentUser?.uid;
  const crews = useCrews();
  const connections = useAcceptedCrew();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myProfile, setMyProfile] = useState(null);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [pendingCrewInvites, setPendingCrewInvites] = useState([]);
  const [expiredCrewInvites, setExpiredCrewInvites] = useState([]);
  const [sentUids, setSentUids] = useState(new Set());
  // sentCrewInviteUids: flat Set<toUid> (for CreateCrewModal "already invited" hint)
  // sentCrewInviteMap: Map<crewId, Set<toUid>> (for per-crew dedup in Detail + AddToCrew modals)
  const [sentCrewInviteUids, setSentCrewInviteUids] = useState(new Set());
  const [sentCrewInviteMap, setSentCrewInviteMap] = useState(new Map());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [detailCrew, setDetailCrew] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [deepLinkUser, setDeepLinkUser] = useState(null);
  const [toastMsg, setToastMsg] = useState('');
  const toastAnim = useRef(new Animated.Value(0)).current;
  const searchTimer = useRef(null);

  // Contacts state
  const [contactsPermission, setContactsPermission] = useState(null); // null | 'granted' | 'denied'
  const [contactsLoading, setContactsLoading] = useState(false);
  const [onRedline, setOnRedline] = useState([]);
  const [notOnRedline, setNotOnRedline] = useState([]);
  const [addToCrewTarget, setAddToCrewTarget] = useState(null);
  const [activeTab, setActiveTab] = useState('crews');

  // Loading skeleton — hide after first data arrives
  useEffect(() => {
    if (crews.length >= 0 || connections.length >= 0) {
      const t = setTimeout(() => setLoading(false), 300);
      return () => clearTimeout(t);
    }
  }, [crews, connections]);

  const handleRefresh = () => {
    setRefreshing(true);
    _contactsCache = null;
    _contactsCacheTime = 0;
    loadContacts(true).finally(() => setRefreshing(false));
  };

  // Handle redline://invite/USER_ID deep link — fetch and surface that user
  useEffect(() => {
    const inviteUserId = route?.params?.inviteUserId;
    if (!inviteUserId || !uid || inviteUserId === uid) return;

    getDocs(query(collection(db, 'users'), where(documentId(), 'in', [inviteUserId])))
      .then((snap) => {
        if (!snap.empty) {
          setDeepLinkUser({ id: snap.docs[0].id, ...snap.docs[0].data() });
        }
      })
      .catch(() => {});
  }, [route?.params?.inviteUserId, uid]);

  // My profile (for invite fromName)
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'users', uid), (snap) => {
      if (snap.exists()) setMyProfile({ id: snap.id, ...snap.data() });
    });
  }, [uid]);

  // Pending invites received
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, 'invites'), where('toUid', '==', uid), where('status', '==', 'pending')),
      (snap) => setPendingInvites(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, [uid]);

  // Pending crew invites received
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, 'crewInvites'), where('toUid', '==', uid), where('status', '==', 'pending')),
      (snap) => setPendingCrewInvites(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, [uid]);

  // Expired crew invites (crew was deleted after invite was sent)
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, 'crewInvites'), where('toUid', '==', uid), where('status', '==', 'expired')),
      (snap) => setExpiredCrewInvites(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, [uid]);

  // Invites I've sent (to track button state)
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, 'invites'), where('fromUid', '==', uid)),
      (snap) => setSentUids(new Set(snap.docs.map((d) => d.data().toUid)))
    );
  }, [uid]);

  // Crew invites I've sent — build flat set + per-crew map for dedup checks
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, 'crewInvites'), where('fromUid', '==', uid), where('status', '==', 'pending')),
      (snap) => {
        const flat = new Set();
        const byCrewId = new Map();
        snap.docs.forEach((d) => {
          const { toUid, crewId } = d.data();
          flat.add(toUid);
          if (!byCrewId.has(crewId)) byCrewId.set(crewId, new Set());
          byCrewId.get(crewId).add(toUid);
        });
        setSentCrewInviteUids(flat);
        setSentCrewInviteMap(byCrewId);
      }
    );
  }, [uid]);

  // Load phone contacts
  const loadContacts = useCallback(async (force = false) => {
    if (!uid) return;
    const now = Date.now();
    if (!force && _contactsCache && now - _contactsCacheTime < CONTACTS_TTL) {
      setOnRedline(_contactsCache.onRedline);
      setNotOnRedline(_contactsCache.notOnRedline);
      setContactsPermission('granted');
      return;
    }

    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      setContactsPermission('denied');
      return;
    }
    setContactsPermission('granted');
    setContactsLoading(true);

    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Emails, Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });

      const emailToContact = {};
      const phoneToContact = {};

      for (const c of data) {
        const name = c.name?.trim();
        if (!name) continue;
        const phone = c.phoneNumbers?.[0]?.number;
        for (const e of c.emails || []) {
          const em = e.email?.toLowerCase().trim();
          if (em) emailToContact[em] = { name, phone };
        }
        const digits = normalizePhone(phone);
        if (digits.length >= 7) phoneToContact[digits] = { name, phone };
      }

      const emails = Object.keys(emailToContact);
      const phones = Object.keys(phoneToContact);
      const matchedById = {};

      // Batch email queries (max 30 per Firestore `in`)
      for (let i = 0; i < emails.length; i += 30) {
        const snap = await getDocs(
          query(collection(db, 'users'), where('email', 'in', emails.slice(i, i + 30)))
        );
        snap.docs.forEach((d) => {
          if (d.id !== uid) matchedById[d.id] = { id: d.id, ...d.data() };
        });
      }
      // Batch phone queries
      for (let i = 0; i < phones.length; i += 30) {
        const snap = await getDocs(
          query(collection(db, 'users'), where('phoneNumberNormalized', 'in', phones.slice(i, i + 30)))
        );
        snap.docs.forEach((d) => {
          if (d.id !== uid) matchedById[d.id] = { id: d.id, ...d.data() };
        });
      }

      const matched = Object.values(matchedById);
      const matchedEmails = new Set(matched.map((u) => u.email?.toLowerCase()).filter(Boolean));
      const matchedPhones = new Set(matched.map((u) => u.phoneNumberNormalized).filter(Boolean));

      // Build not-on-Redline list from raw contacts
      const notMatched = [];
      const seenNames = new Set();
      for (const c of data) {
        const name = c.name?.trim();
        if (!name || seenNames.has(name)) continue;
        const em = c.emails?.[0]?.email?.toLowerCase().trim();
        const digits = normalizePhone(c.phoneNumbers?.[0]?.number);
        const isMatched =
          (em && matchedEmails.has(em)) || (digits.length >= 7 && matchedPhones.has(digits));
        if (!isMatched) {
          const phone = c.phoneNumbers?.[0]?.number;
          if (phone) { // only include if they have a phone number to SMS
            seenNames.add(name);
            notMatched.push({ name, phone });
          }
        }
      }

      const result = {
        onRedline: matched,
        notOnRedline: notMatched.slice(0, 50),
      };
      _contactsCache = result;
      _contactsCacheTime = now;
      setOnRedline(result.onRedline);
      setNotOnRedline(result.notOnRedline);
    } catch (e) {
      console.warn('Contacts load failed:', e.message);
    } finally {
      setContactsLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleSearchChange = (text) => {
    setSearchText(text);
    clearTimeout(searchTimer.current);
    if (!text.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      const clean = text.toLowerCase().trim();
      if (clean.length < 2) return;
      setSearchLoading(true);
      try {
        const snap = await getDocs(
          query(collection(db, 'users'), where('username', '==', clean))
        );
        setSearchResults(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.id !== uid)
        );
      } catch (e) {
        console.warn('Search failed:', e.message);
      } finally {
        setSearchLoading(false);
      }
    }, 400);
  };

  const sendInvite = async (toUser) => {
    if (!uid) return;
    try {
      const fromName = myProfile?.name || auth.currentUser?.email || 'Unknown';
      await addDoc(collection(db, 'invites'), {
        fromUid: uid,
        fromName,
        toUid: toUser.id,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      pushNotify(toUser.id, 'connection request', `${fromName} wants to connect on Redline`, { type: 'connectionRequest' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Failed to send invite', e.message);
    }
  };

  const respondToInvite = async (inviteId, status) => {
    try {
      await updateDoc(doc(db, 'invites', inviteId), { status });
      if (status === 'accepted') {
        // Find the invite to get fromUid so we can notify them
        const invite = pendingInvites.find((i) => i.id === inviteId);
        if (invite?.fromUid) {
          const responderName = myProfile?.name || auth.currentUser?.email || 'Someone';
          pushNotify(invite.fromUid, 'request accepted', `${responderName} accepted your connection request`, { type: 'connectionRequest' });
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e) {
      Alert.alert('Failed', e.message);
    }
  };

  const shareInviteLink = async () => {
    try {
      await Share.share({ message: `Join my crew on Redline! redline://invite/${uid}` });
    } catch (_) {}
  };

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2200),
      Animated.timing(toastAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [toastAnim]);

  const acceptCrewInvite = async (invite) => {
    try {
      if (auth.currentUser) await auth.currentUser.getIdToken(true);

      // Step 1: add self to crew members.
      // If the crew was deleted, updateDoc throws 'not-found' — handle gracefully.
      try {
        await updateDoc(doc(db, 'crews', invite.crewId), { members: arrayUnion(uid) });
      } catch (crewErr) {
        if (crewErr.code === 'not-found') {
          // Crew no longer exists — mark invite expired and surface a toast.
          await updateDoc(doc(db, 'crewInvites', invite.id), { status: 'expired' }).catch(() => {});
          showToast('this crew no longer exists');
          return;
        }
        throw crewErr;
      }

      // Step 2: mark invite as accepted.
      await updateDoc(doc(db, 'crewInvites', invite.id), { status: 'accepted' });
      // Notify the crew creator that someone joined.
      if (invite.fromUid && invite.fromUid !== uid) {
        const joinerName = myProfile?.name || auth.currentUser?.email || 'Someone';
        pushNotify(invite.fromUid, 'crew joined', `${joinerName} joined ${invite.crewName}`, { type: 'crewInvite', crewId: invite.crewId });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Failed', e.message);
    }
  };

  const declineCrewInvite = async (invite) => {
    try {
      await updateDoc(doc(db, 'crewInvites', invite.id), { status: 'declined' });
    } catch (e) {
      Alert.alert('Failed', e.message);
    }
  };

  const dismissExpiredInvite = async (invite) => {
    try {
      await deleteDoc(doc(db, 'crewInvites', invite.id));
    } catch (e) {
      Alert.alert('Failed', e.message);
    }
  };

  const openCrewDetail = (crew) => {
    setDetailCrew(crew);
    setShowDetail(true);
  };

  const openRadio = (crew) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    requestJoinChannel(crew.id);
    navigation.navigate('Radio');
  };

  const handleCrewLongPress = (crew) => {
    const isCreator = crew.createdBy === uid;
    Alert.alert(crew.name, null, [
      { text: 'View Members', onPress: () => openCrewDetail(crew) },
      {
        text: 'Leave Crew',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Leave Crew', `Leave "${crew.name}"?`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Leave',
              style: 'destructive',
              onPress: async () => {
                try {
                  await updateDoc(doc(db, 'crews', crew.id), { members: arrayRemove(uid) });
                } catch (e) {
                  Alert.alert('Failed', e.message);
                }
              },
            },
          ]),
      },
      ...(isCreator
        ? [{
          text: 'Delete Crew',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Delete Crew', `Permanently delete "${crew.name}"?`, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await expireCrewInvites(crew.id);
                    await deleteDoc(doc(db, 'crews', crew.id));
                  } catch (e) { Alert.alert('Failed', e.message); }
                },
              },
            ]),
        }]
        : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const connectionIds = new Set(connections.map((c) => c.id));
  const getConnectionButtonState = (userId) => {
    if (connectionIds.has(userId)) return 'connected';
    if (sentUids.has(userId)) return 'sent';
    return 'add';
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  // Deduplicate received crew invites: keep only the most recent per crewId
  const deduplicatedCrewInvites = (() => {
    const seen = new Map(); // crewId → invite (most recent)
    for (const inv of pendingCrewInvites) {
      const existing = seen.get(inv.crewId);
      const invTime = inv.createdAt?.toMillis?.() ?? 0;
      const exTime = existing?.createdAt?.toMillis?.() ?? 0;
      if (!existing || invTime > exTime) seen.set(inv.crewId, inv);
    }
    return [...seen.values()];
  })();

  const crewInviteBadge = deduplicatedCrewInvites.length + expiredCrewInvites.length;
  const connectionsBadge = pendingInvites.length;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* ── Header ─────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>crew</Text>
        {activeTab === 'crews' && (
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowCreateModal(true);
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.createBtnText}>+ create crew</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Tab Bar ────────────────────────────────── */}
      <View style={styles.tabBar}>
        {[
          { key: 'crews', label: 'crews', badge: crewInviteBadge },
          { key: 'connections', label: 'connections', badge: connectionsBadge },
          { key: 'discover', label: 'discover', badge: 0 },
        ].map(({ key, label, badge }) => (
          <TouchableOpacity
            key={key}
            style={[styles.tabItem, activeTab === key && styles.tabItemActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveTab(key);
            }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={[styles.tabText, activeTab === key && styles.tabTextActive]}>{label}</Text>
              {badge > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{badge}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#f97316"
            colors={['#f97316']}
          />
        }
      >
        {/* ══════════════ CREWS TAB ══════════════════ */}
        {activeTab === 'crews' && (
          <>
            {/* Crew Invites */}
            {(deduplicatedCrewInvites.length > 0 || expiredCrewInvites.length > 0) && (
              <>
                <Text style={styles.sectionLabel}>
                  crew invites{deduplicatedCrewInvites.length > 0 ? ` · ${deduplicatedCrewInvites.length}` : ''}
                </Text>

                {deduplicatedCrewInvites.map((invite) => (
                  <View key={invite.id} style={[styles.card, { borderColor: ORANGE + '55' }]}>
                    <View style={styles.crewInviteIcon}>
                      <Text style={{ fontSize: 18 }}>👥</Text>
                    </View>
                    <View style={[styles.cardBody, { marginLeft: 12 }]}>
                      <Text style={styles.memberName} numberOfLines={1}>{invite.crewName}</Text>
                      <Text style={styles.subText}>invited by {invite.fromName} · {invite.memberCount} member{invite.memberCount !== 1 ? 's' : ''}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        style={styles.addBtn}
                        onPress={() => acceptCrewInvite(invite)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.addBtnText}>join</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.declineBtn}
                        onPress={() => declineCrewInvite(invite)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.declineBtnText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}

                {expiredCrewInvites.map((invite) => (
                  <View key={invite.id} style={[styles.card, { borderColor: '#333', opacity: 0.7 }]}>
                    <View style={styles.crewInviteIcon}>
                      <Text style={{ fontSize: 18 }}>🚫</Text>
                    </View>
                    <View style={[styles.cardBody, { marginLeft: 12 }]}>
                      <Text style={[styles.memberName, { color: '#666' }]} numberOfLines={1}>{invite.crewName}</Text>
                      <Text style={styles.subText}>crew no longer available</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.declineBtn}
                      onPress={() => dismissExpiredInvite(invite)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.declineBtnText}>dismiss</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}

            {/* Your Crews */}
            <Text style={styles.sectionLabel}>
              your crews{crews.length > 0 ? ` · ${crews.length}` : ''}
            </Text>

            {loading ? (
              <SkeletonList count={3} height={72} />
            ) : crews.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>no crews yet</Text>
                <Text style={styles.emptySub}>create a crew to get started</Text>
                <TouchableOpacity
                  style={styles.emptyAction}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowCreateModal(true);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.emptyActionText}>create your first crew</Text>
                </TouchableOpacity>
              </View>
            ) : (
              crews.map((crew, i) => (
                <CrewCard
                  key={crew.id}
                  crew={crew}
                  uid={uid}
                  index={i}
                  onPress={() => openCrewDetail(crew)}
                  onLongPress={() => handleCrewLongPress(crew)}
                  onOpenRadio={() => openRadio(crew)}
                />
              ))
            )}
          </>
        )}

        {/* ══════════════ CONNECTIONS TAB ════════════ */}
        {activeTab === 'connections' && (
          <>
            {/* Pending connection requests */}
            {pendingInvites.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>requests · {pendingInvites.length}</Text>
                {pendingInvites.map((invite) => (
                  <View key={invite.id} style={styles.card}>
                    <Avatar name={invite.fromName} uid={invite.fromUid} size={40} />
                    <View style={[styles.cardBody, { marginLeft: 12 }]}>
                      <Text style={styles.memberName} numberOfLines={1}>{invite.fromName}</Text>
                      <Text style={styles.subText}>wants to connect</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        style={styles.addBtn}
                        onPress={() => respondToInvite(invite.id, 'accepted')}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.addBtnText}>accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.declineBtn}
                        onPress={() => respondToInvite(invite.id, 'declined')}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.declineBtnText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* Connections list */}
            <Text style={styles.sectionLabel}>
              connections{connections.length > 0 ? ` · ${connections.length}` : ''}
            </Text>

            {loading ? (
              <SkeletonList count={3} height={60} />
            ) : connections.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptySub}>
                  use the discover tab to find people to connect with
                </Text>
                <TouchableOpacity style={styles.emptyAction} onPress={shareInviteLink} activeOpacity={0.8}>
                  <Text style={styles.emptyActionText}>share invite link</Text>
                </TouchableOpacity>
              </View>
            ) : (
              connections.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.card}
                  onPress={() => navigation.navigate('FriendProfile', { uid: c.id })}
                  activeOpacity={0.7}
                >
                  <Avatar photoURL={c.photoURL} name={c.name} uid={c.id} size={40} />
                  <View style={[styles.cardBody, { marginLeft: 12 }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.memberName} numberOfLines={1}>{c.name}</Text>
                      {isOnline(c) && <View style={styles.onlineDotGreen} />}
                    </View>
                    {c.username ? <Text style={styles.subText} numberOfLines={1}>@{c.username}</Text> : null}
                    {formatCarString(c.car) ? <Text style={styles.subText} numberOfLines={1}>{formatCarString(c.car)}</Text> : null}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </>
        )}

        {/* ══════════════ DISCOVER TAB ═══════════════ */}
        {activeTab === 'discover' && (
          <>
            {/* Deep link invite banner */}
            {deepLinkUser && (() => {
              const state = getConnectionButtonState(deepLinkUser.id);
              return (
                <View style={styles.deepLinkBanner}>
                  <Avatar photoURL={deepLinkUser.photoURL} name={deepLinkUser.name} uid={deepLinkUser.id} size={40} />
                  <View style={[styles.cardBody, { marginLeft: 12 }]}>
                    <Text style={styles.memberName}>{deepLinkUser.name || 'Redline user'}</Text>
                    <Text style={styles.subText}>opened via invite link</Text>
                  </View>
                  {state === 'connected' ? (
                    <Text style={styles.connectedText}>connected</Text>
                  ) : state === 'sent' ? (
                    <Text style={styles.sentText}>sent</Text>
                  ) : (
                    <TouchableOpacity style={styles.addBtn} onPress={() => sendInvite(deepLinkUser)} activeOpacity={0.8}>
                      <Text style={styles.addBtnText}>add</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => setDeepLinkUser(null)}
                    style={{ padding: 8, marginLeft: 4 }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: '#444', fontSize: 16 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              );
            })()}

            {/* Search by username */}
            <Text style={styles.sectionLabel}>search</Text>
            <View style={styles.searchWrap}>
              <TextInput
                style={styles.searchInput}
                placeholder="find by username..."
                placeholderTextColor="#444"
                value={searchText}
                onChangeText={handleSearchChange}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchLoading && <ActivityIndicator size="small" color={ORANGE} style={{ marginLeft: 8 }} />}
            </View>

            {searchResults.length > 0 && searchResults.map((user) => {
              const state = getConnectionButtonState(user.id);
              return (
                <View key={user.id} style={styles.card}>
                  <Avatar photoURL={user.photoURL} name={user.name} uid={user.id} size={40} />
                  <View style={[styles.cardBody, { marginLeft: 12 }]}>
                    <Text style={styles.memberName} numberOfLines={1}>{user.name}</Text>
                    {user.username ? <Text style={styles.subText} numberOfLines={1}>@{user.username}</Text> : null}
                  </View>
                  {state === 'connected' ? (
                    <Text style={styles.connectedText}>connected</Text>
                  ) : state === 'sent' ? (
                    <Text style={styles.sentText}>sent</Text>
                  ) : (
                    <TouchableOpacity style={styles.addBtn} onPress={() => sendInvite(user)} activeOpacity={0.8}>
                      <Text style={styles.addBtnText}>add</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            {/* Contacts on Redline */}
            {contactsPermission === 'denied' ? (
              <>
                <Text style={styles.sectionLabel}>contacts on redline</Text>
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>contacts access needed</Text>
                  <Text style={styles.emptySub}>
                    allow contacts so you can see which friends are already on Redline
                  </Text>
                  <TouchableOpacity style={styles.emptyAction} onPress={() => Linking.openSettings()} activeOpacity={0.8}>
                    <Text style={styles.emptyActionText}>open settings</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : contactsPermission === 'granted' ? (
              <>
                {contactsLoading ? (
                  <>
                    <Text style={styles.sectionLabel}>contacts on redline</Text>
                    <SkeletonList count={3} height={64} />
                  </>
                ) : onRedline.length > 0 ? (
                  <>
                    <Text style={styles.sectionLabel}>contacts on redline · {onRedline.length}</Text>
                    {onRedline.map((user) => {
                      const inCrewTogether = crews.some((c) => c.members?.includes(user.id));
                      const alreadyInvited = sentCrewInviteUids.has(user.id);
                      return (
                        <View key={user.id} style={styles.card}>
                          <Avatar photoURL={user.photoURL} name={user.name} uid={user.id} size={40} />
                          <View style={[styles.cardBody, { marginLeft: 12 }]}>
                            <Text style={styles.memberName} numberOfLines={1}>{user.name || 'Unknown'}</Text>
                            {formatCarString(user.car)
                              ? <Text style={styles.subText} numberOfLines={1}>{formatCarString(user.car)}</Text>
                              : null}
                            {user.location
                              ? <Text style={styles.subText} numberOfLines={1}>{user.location}</Text>
                              : null}
                          </View>
                          {inCrewTogether ? (
                            <Text style={styles.sentText}>in crew</Text>
                          ) : alreadyInvited ? (
                            <Text style={styles.sentText}>invited</Text>
                          ) : crews.length > 0 ? (
                            <TouchableOpacity
                              style={styles.addBtn}
                              onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setAddToCrewTarget(user);
                              }}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.addBtnText}>add to crew</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      );
                    })}
                  </>
                ) : !contactsLoading && (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptySub}>none of your contacts are on Redline yet</Text>
                  </View>
                )}

                {/* Invite Friends via SMS */}
                {notOnRedline.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>invite friends · {notOnRedline.length}</Text>
                    {notOnRedline.map((c, i) => (
                      <View key={`${c.name}-${i}`} style={styles.card}>
                        <View style={styles.contactInitialCircle}>
                          <Text style={styles.contactInitialText}>{getInitials(c.name)}</Text>
                        </View>
                        <View style={[styles.cardBody, { marginLeft: 12 }]}>
                          <Text style={styles.memberName} numberOfLines={1}>{c.name}</Text>
                          <Text style={styles.subText}>{c.phone}</Text>
                        </View>
                        <TouchableOpacity
                          style={styles.smsBtn}
                          onPress={() => {
                            const digits = normalizePhone(c.phone);
                            const msg = encodeURIComponent(
                              "Hey I'm using Redline — a car app for our crew. Download it and join me!"
                            );
                            Linking.openURL(`sms:${digits}${Platform.OS === 'ios' ? '&' : '?'}body=${msg}`);
                          }}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.smsBtnText}>invite</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </>
                )}
              </>
            ) : null}
          </>
        )}

      </ScrollView>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      <CreateCrewModal
        visible={showCreateModal}
        connections={connections}
        uid={uid}
        myProfile={myProfile}
        onClose={() => setShowCreateModal(false)}
        onCreated={(_, inviteCount) => {
          if (inviteCount > 0) {
            showToast(`crew created — invite${inviteCount > 1 ? 's' : ''} sent to ${inviteCount} member${inviteCount > 1 ? 's' : ''}`);
          } else {
            showToast('crew created');
          }
        }}
      />

      <CrewDetailModal
        crew={detailCrew}
        uid={uid}
        myProfile={myProfile}
        connections={connections}
        sentCrewInviteMap={sentCrewInviteMap}
        visible={showDetail}
        navigation={navigation}
        onClose={() => setShowDetail(false)}
        onInvitesSent={(count) => {
          if (count > 0) showToast(`invite${count > 1 ? 's' : ''} sent to ${count} member${count > 1 ? 's' : ''}`);
          else showToast('everyone is already invited');
        }}
      />

      {/* ── Add to Crew Modal ──────────────────────────────────────────────── */}
      <AddToCrewModal
        visible={!!addToCrewTarget}
        onClose={() => setAddToCrewTarget(null)}
        contactUser={addToCrewTarget}
        crews={crews}
        uid={uid}
        myProfile={myProfile}
        sentCrewInviteMap={sentCrewInviteMap}
        onInviteSent={(crewName) => showToast(`invite sent to join ${crewName}`)}
        onToast={showToast}
      />

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={[styles.toast, { opacity: toastAnim, transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}
      >
        <Text style={styles.toastText}>{toastMsg}</Text>
      </Animated.View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
  },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '700' },

  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 0.5, borderBottomColor: '#2a2a2a',
    paddingHorizontal: 16,
  },
  tabItem: {
    paddingVertical: 10, paddingHorizontal: 2,
    marginRight: 20, borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabItemActive: { borderBottomColor: ORANGE },
  tabText: { color: '#555', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  tabBadge: {
    backgroundColor: ORANGE, borderRadius: 8,
    paddingHorizontal: 5, paddingVertical: 1, minWidth: 16, alignItems: 'center',
  },
  tabBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  createBtn: {
    backgroundColor: ORANGE, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  createBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  sectionLabel: {
    color: '#444', fontSize: 11, fontWeight: '600',
    letterSpacing: 1.5, textTransform: 'uppercase',
    marginTop: 16, marginBottom: 10,
  },

  // Deep link invite banner
  deepLinkBanner: {
    backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1,
    borderColor: ORANGE, flexDirection: 'row', alignItems: 'center',
    padding: 14, marginBottom: 4,
  },

  // Crew card
  crewCard: {
    backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1,
    borderColor: '#2a2a2a', padding: 14, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center',
  },
  crewCardName: { color: '#fff', fontSize: 15, fontWeight: '500', marginBottom: 8 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  extraBubble: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center',
    marginLeft: -8, borderWidth: 2, borderColor: '#1a1a1a',
  },
  extraBubbleText: { color: '#888', fontSize: 9, fontWeight: '700' },
  memberCountText: { color: '#555', fontSize: 11, marginLeft: 8 },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineDotGreen: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  onlineText: { color: '#22c55e', fontSize: 11 },
  radioBtn: {
    backgroundColor: ORANGE, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, marginLeft: 12,
  },
  radioBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Generic card
  card: {
    backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1,
    borderColor: '#2a2a2a', flexDirection: 'row', alignItems: 'center',
    padding: 14, marginBottom: 8,
  },
  cardBody: { flex: 1 },
  memberName: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 2 },
  subText: { color: '#555', fontSize: 12 },
  youLabel: {
    backgroundColor: '#2a2a2a', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
    color: '#888', fontSize: 10,
  },

  addBtn: {
    backgroundColor: ORANGE, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  addBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  declineBtn: {
    backgroundColor: '#2a2a2a', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  declineBtnText: { color: '#666', fontSize: 12, fontWeight: '700' },
  connectedText: { color: '#22c55e', fontSize: 12, fontWeight: '600' },
  sentText: { color: '#555', fontSize: 12 },
  alreadyInvitedLabel: { color: '#555', fontSize: 11, fontStyle: 'italic' },

  // Empty states
  emptyCard: {
    backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1,
    borderColor: '#2a2a2a', padding: 20, alignItems: 'center', marginBottom: 8,
  },
  emptyTitle: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 6 },
  emptySub: { color: '#555', fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 14 },
  emptyAction: {
    backgroundColor: '#222', borderRadius: 8, borderWidth: 0.5,
    borderColor: '#333', paddingHorizontal: 16, paddingVertical: 8,
  },
  emptyActionText: { color: ORANGE, fontSize: 13, fontWeight: '600' },

  // Search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 10, paddingHorizontal: 14, marginBottom: 10,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 14, paddingVertical: 11 },

  // Modals
  modalRoot: { flex: 1, backgroundColor: '#111' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#2a2a2a',
  },
  modalHeaderBtn: { minWidth: 60 },
  modalTitle: {
    color: '#fff', fontSize: 16, fontWeight: '600',
    flex: 1, textAlign: 'center',
  },
  modalCancelText: { color: '#888', fontSize: 14 },
  modalSaveText: { color: ORANGE, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  optionsBtn: { color: '#888', fontSize: 16, fontWeight: '700', textAlign: 'right' },
  modalScroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  modalSectionLabel: {
    color: '#444', fontSize: 11, fontWeight: '600', letterSpacing: 1.5,
    textTransform: 'uppercase', marginBottom: 10, marginTop: 8,
  },
  modalEmpty: { color: '#444', fontSize: 13, textAlign: 'center', marginTop: 20 },

  crewNameInput: {
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 10, color: '#fff', fontSize: 20, fontWeight: '500',
    paddingHorizontal: 14, paddingVertical: 14, marginBottom: 8,
  },

  // Checkbox
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e',
  },
  checkBox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
    borderColor: '#444', alignItems: 'center', justifyContent: 'center',
  },
  checkBoxOn: { backgroundColor: ORANGE, borderColor: ORANGE },
  checkMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  checkLabel: { color: '#fff', fontSize: 14, fontWeight: '500' },
  checkSubLabel: { color: '#555', fontSize: 12, marginTop: 1 },

  // Member row (in detail modal)
  memberRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e',
  },
  addMemberBtn: {
    marginTop: 16, backgroundColor: '#1a1a1a', borderRadius: 10,
    borderWidth: 1, borderColor: '#2a2a2a', padding: 14, alignItems: 'center',
  },
  addMemberBtnText: { color: ORANGE, fontSize: 14, fontWeight: '600' },

  crewInviteIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#2a2a2a',
    alignItems: 'center', justifyContent: 'center',
  },

  // Contacts
  contactInitialCircle: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#2a2a2a',
    alignItems: 'center', justifyContent: 'center',
  },
  contactInitialText: { color: '#888', fontSize: 14, fontWeight: '700' },
  smsBtn: {
    backgroundColor: '#1e3a2a', borderRadius: 8, borderWidth: 1,
    borderColor: '#22c55e44', paddingHorizontal: 12, paddingVertical: 7,
  },
  smsBtnText: { color: '#22c55e', fontSize: 12, fontWeight: '700' },

  // Add-to-crew picker row
  crewPickRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e',
  },

  toast: {
    position: 'absolute', bottom: 24, left: 24, right: 24,
    backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 0.5,
    borderColor: '#333', paddingHorizontal: 16, paddingVertical: 12,
    alignItems: 'center',
  },
  toastText: { color: '#fff', fontSize: 13, fontWeight: '500' },
});

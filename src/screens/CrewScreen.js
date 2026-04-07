import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  Alert, Share, Image, ActivityIndicator, Modal, KeyboardAvoidingView,
  Platform, Animated, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, documentId, serverTimestamp, getDocs, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import * as Haptics from 'expo-haptics';
import { auth, db } from '../config/firebase';
import { useCrews } from '../hooks/useCrews';
import { useAcceptedCrew } from '../hooks/useAcceptedCrew';
import { requestJoinChannel } from '../utils/radioJoinRequest';
import { SkeletonList } from '../components/SkeletonCard';

const ORANGE = '#f97316';
const MEMBER_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#f59e0b', '#06b6d4'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMemberColor(uid) {
  const n = (uid || 'x').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return MEMBER_COLORS[n % MEMBER_COLORS.length];
}

function getInitials(name) {
  if (!name) return '??';
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatCarString(car) {
  if (!car) return null;
  return [car.year, car.make, car.model].filter(Boolean).join(' ') || null;
}

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
  const color = getMemberColor(uid);
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

function CreateCrewModal({ visible, connections, uid, onClose, onCreated }) {
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
      const memberUids = [uid, ...selected];
      const ref = await addDoc(collection(db, 'crews'), {
        name: name.trim(),
        createdBy: uid,
        members: memberUids,
        createdAt: serverTimestamp(),
      });
      onCreated(ref.id);
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

function CrewDetailModal({ crew, uid, connections, visible, onClose }) {
  const insets = useSafeAreaInsets();
  const [addingMembers, setAddingMembers] = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState(new Set());
  const [addLoading, setAddLoading] = useState(false);

  const isCreator = crew?.createdBy === uid;
  const profiles = crew?.memberProfiles || [];
  const currentMemberIds = new Set(crew?.members || []);
  const eligibleToAdd = connections.filter((c) => !currentMemberIds.has(c.id));

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
      await updateDoc(doc(db, 'crews', crew.id), {
        members: arrayUnion(...selectedToAdd),
      });
      setSelectedToAdd(new Set());
      setAddingMembers(false);
    } catch (e) {
      Alert.alert('Failed to add members', e.message);
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
                : <Text style={[styles.modalSaveText, selectedToAdd.size === 0 && { opacity: 0.3 }]}>add</Text>
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
                  <View key={p.id} style={styles.memberRow}>
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
                  </View>
                );
              })}

              {eligibleToAdd.length > 0 && (
                <TouchableOpacity
                  style={styles.addMemberBtn}
                  onPress={() => setAddingMembers(true)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.addMemberBtnText}>+ add member</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <>
              {eligibleToAdd.length === 0 ? (
                <Text style={styles.modalEmpty}>all your connections are already in this crew</Text>
              ) : (
                eligibleToAdd.map((c) => (
                  <Checkbox
                    key={c.id}
                    checked={selectedToAdd.has(c.id)}
                    label={c.name || 'Unknown'}
                    subLabel={formatCarString(c.car) || c.location}
                    onToggle={() => toggleAdd(c.id)}
                  />
                ))
              )}
            </>
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
  const [sentUids, setSentUids] = useState(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [detailCrew, setDetailCrew] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [deepLinkUser, setDeepLinkUser] = useState(null);
  const searchTimer = useRef(null);

  // Loading skeleton — hide after first data arrives
  useEffect(() => {
    if (crews.length >= 0 || connections.length >= 0) {
      const t = setTimeout(() => setLoading(false), 300);
      return () => clearTimeout(t);
    }
  }, [crews, connections]);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
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

  // Invites I've sent (to track button state)
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, 'invites'), where('fromUid', '==', uid)),
      (snap) => setSentUids(new Set(snap.docs.map((d) => d.data().toUid)))
    );
  }, [uid]);

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
      await addDoc(collection(db, 'invites'), {
        fromUid: uid,
        fromName: myProfile?.name || auth.currentUser?.email || 'Unknown',
        toUid: toUser.id,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Failed to send invite', e.message);
    }
  };

  const respondToInvite = async (inviteId, status) => {
    try {
      await updateDoc(doc(db, 'invites', inviteId), { status });
      if (status === 'accepted') {
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
                  try { await deleteDoc(doc(db, 'crews', crew.id)); } catch (e) { Alert.alert('Failed', e.message); }
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

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
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

        {/* ── Header ─────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>crew</Text>
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
        </View>

        {/* ── Invite deep-link banner ────────────────── */}
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
                <TouchableOpacity
                  style={styles.addBtn}
                  onPress={() => sendInvite(deepLinkUser)}
                  activeOpacity={0.8}
                >
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

        {/* ── Your Crews ─────────────────────────────── */}
        <Text style={styles.sectionLabel}>
          your crews{crews.length > 0 ? ` · ${crews.length}` : ''}
        </Text>

        {loading ? (
          <SkeletonList count={3} height={72} />
        ) : crews.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>no crews yet</Text>
            <Text style={styles.emptySub}>
              create a crew to get started
            </Text>
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

        {/* ── Connections ────────────────────────────── */}
        <Text style={styles.sectionLabel}>
          connections{connections.length > 0 ? ` · ${connections.length}` : ''}
        </Text>

        {/* Search */}
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

        {loading ? (
          <SkeletonList count={2} height={60} />
        ) : connections.length === 0 && !searchText ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptySub}>
              search for people by username to add individual connections
            </Text>
            <TouchableOpacity style={styles.emptyAction} onPress={shareInviteLink} activeOpacity={0.8}>
              <Text style={styles.emptyActionText}>share invite link</Text>
            </TouchableOpacity>
          </View>
        ) : (
          connections.map((c) => (
            <View key={c.id} style={styles.card}>
              <Avatar photoURL={c.photoURL} name={c.name} uid={c.id} size={40} />
              <View style={[styles.cardBody, { marginLeft: 12 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.memberName} numberOfLines={1}>{c.name}</Text>
                  {isOnline(c) && <View style={styles.onlineDotGreen} />}
                </View>
                {c.username ? <Text style={styles.subText} numberOfLines={1}>@{c.username}</Text> : null}
                {formatCarString(c.car) ? <Text style={styles.subText} numberOfLines={1}>{formatCarString(c.car)}</Text> : null}
              </View>
            </View>
          ))
        )}

        {/* ── Pending invites ────────────────────────── */}
        {pendingInvites.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>pending invites</Text>
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

      </ScrollView>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      <CreateCrewModal
        visible={showCreateModal}
        connections={connections}
        uid={uid}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => {}}
      />

      <CrewDetailModal
        crew={detailCrew}
        uid={uid}
        connections={connections}
        visible={showDetail}
        onClose={() => setShowDetail(false)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 14,
  },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '700' },
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
});

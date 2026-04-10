import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Animated, Alert, ActivityIndicator, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import {
  createAgoraRtcEngine,
  ChannelProfileType,
  ClientRoleType,
} from 'react-native-agora';
import { httpsCallable } from 'firebase/functions';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { auth, db, functions } from '../config/firebase';
import { AGORA_APP_ID } from '../config/agora';
import { useMic } from '../context/MicContext';
import { useCrews } from '../hooks/useCrews';
import { consumeJoinRequest } from '../utils/radioJoinRequest';
import { ORANGE, getInitials, getAvatarColor } from '../utils/helpers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOnline(profile) {
  const last = profile?.lastSeen?.toMillis?.() ?? 0;
  return Date.now() - last < 2 * 60 * 1000;
}

// ─── Auth guard ───────────────────────────────────────────────────────────────

function waitForAuth() {
  return new Promise((resolve, reject) => {
    if (auth.currentUser) { resolve(auth.currentUser); return; }
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (user) resolve(user);
      else reject(new Error('Not authenticated'));
    });
    setTimeout(() => { unsub(); reject(new Error('Auth state did not resolve within 5 s')); }, 5000);
  });
}

// ─── Animated waveform ────────────────────────────────────────────────────────

const BAR_HEIGHTS = [8, 14, 10, 16, 8];

function Waveform() {
  const anims = useRef(BAR_HEIGHTS.map((h) => new Animated.Value(h))).current;
  useEffect(() => {
    const loops = anims.map((anim, i) => {
      const target = [14, 8, 16, 8, 14][i];
      return Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: target, duration: 280 + i * 60, useNativeDriver: false }),
          Animated.timing(anim, { toValue: BAR_HEIGHTS[i], duration: 280 + i * 60, useNativeDriver: false }),
        ])
      );
    });
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [anims]);
  return (
    <View style={styles.waveform}>
      {anims.map((anim, i) => (
        <Animated.View key={i} style={[styles.waveBar, { height: anim }]} />
      ))}
    </View>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ photoURL, name, uid, size = 32, dimmed = false }) {
  const color = getAvatarColor(uid);
  const opacity = dimmed ? 0.35 : 1;
  if (photoURL) {
    return (
      <Image source={{ uri: photoURL }} style={{ width: size, height: size, borderRadius: size / 2, opacity }} />
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center', opacity }}>
      <Text style={{ color: '#fff', fontSize: size * 0.33, fontWeight: '700' }}>{getInitials(name)}</Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function RadioScreen() {
  const { setMicOn, setChannelName, muteCallbackRef } = useMic();
  const uid = auth.currentUser?.uid;
  const crews = useCrews();

  const [selectedMode, setSelectedMode] = useState('hold');
  const [joinedChannel, setJoinedChannel] = useState(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [localUid, setLocalUid] = useState(0);
  const [activeSpeakerUid, setActiveSpeakerUid] = useState(null);
  const [remoteUsers, setRemoteUsers] = useState(new Set());
  const [isMicOn, setIsMicOn] = useState(false);
  const [talking, setTalking] = useState(false);
  const [presenceUids, setPresenceUids] = useState(new Set());

  const engineRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const joinedChannelRef = useRef(null);
  const joinChannelCallbackRef = useRef(null);

  // Map crew IDs to their channel objects
  const crewChannels = crews.map((crew) => ({
    id: crew.id,
    name: crew.name,
    memberProfiles: crew.memberProfiles || [],
    onlineCount: (crew.memberProfiles || []).filter(isOnline).length,
  }));

  // ── Presence for current channel ──────────────────────────────────────────

  useEffect(() => {
    if (!joinedChannel) { setPresenceUids(new Set()); return; }
    const unsub = onSnapshot(
      collection(db, 'crews', joinedChannel, 'presence'),
      (snap) => setPresenceUids(new Set(snap.docs.map((d) => d.id)))
    );
    return unsub;
  }, [joinedChannel]);

  // ── Agora engine lifecycle ─────────────────────────────────────────────────

  useEffect(() => {
    const engine = createAgoraRtcEngine();
    engineRef.current = engine;

    engine.initialize({
      appId: AGORA_APP_ID,
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
    });
    engine.enableAudio();
    engine.muteLocalAudioStream(true);
    engine.enableAudioVolumeIndication(500, 3, false);

    // Route audio to speaker so remote voices come through at full volume on all devices.
    // Without this, iOS defaults to earpiece on iPad/iPhone which is very quiet.
    engine.setDefaultAudioRouteToSpeakerphone(true);
    engine.setEnableSpeakerphone(true);

    const eventHandler = {
      onJoinChannelSuccess: (connection, elapsed) => {
        setLocalUid(connection.localUid);
      },
      onUserJoined: (connection, remoteUid) => {
        setRemoteUsers((prev) => { const n = new Set(prev); n.add(remoteUid); return n; });
      },
      onUserOffline: (connection, remoteUid) => {
        setRemoteUsers((prev) => { const n = new Set(prev); n.delete(remoteUid); return n; });
        setActiveSpeakerUid((prev) => (prev === remoteUid ? null : prev));
      },
      onActiveSpeaker: (connection, speakerUid) => setActiveSpeakerUid(speakerUid || null),
      onUserMuteAudio: (connection, remoteUid, muted) => {
        if (muted) setActiveSpeakerUid((prev) => (prev === remoteUid ? null : prev));
      },
      onUserEnableAudio: (connection, remoteUid, enabled) => {
        setRemoteUsers((prev) => {
          const n = new Set(prev);
          enabled ? n.add(remoteUid) : n.delete(remoteUid);
          return n;
        });
        if (!enabled) setActiveSpeakerUid((prev) => (prev === remoteUid ? null : prev));
      },
      onTokenPrivilegeWillExpire: async () => {
        const ch = joinedChannelRef.current;
        if (!ch) return;
        try {
          const newToken = await fetchToken(ch);
          engineRef.current?.renewToken(newToken);
        } catch (e) {
          console.warn('[Agora] Token renewal failed:', e.message);
        }
      },
      onError: (err, msg) => console.warn('[Agora] Error', err, msg),
    };

    engine.registerEventHandler(eventHandler);

    // Register mute callback so MicBar can trigger real Agora mute
    muteCallbackRef.current = (on) => {
      engine.muteLocalAudioStream(!on);
    };

    return () => {
      muteCallbackRef.current = null;
      clearTimeout(refreshTimerRef.current);
      engine.unregisterEventHandler(eventHandler);
      engine.muteLocalAudioStream(true);
      engine.leaveChannel();
      engine.release();
      engineRef.current = null;
      setMicOn(false);
      setChannelName(null);
    };
  }, [setMicOn, setChannelName, muteCallbackRef]);

  // ── Token fetch ───────────────────────────────────────────────────────────

  const fetchToken = async (channelName) => {
    const user = await waitForAuth();
    await user.getIdToken();
    const getAgoraToken = httpsCallable(functions, 'getAgoraToken');
    const result = await getAgoraToken({ channelName, uid: 0 });
    return result.data.token;
  };

  // ── Join / leave ──────────────────────────────────────────────────────────

  const joinChannel = async (channelId) => {
    if (joinedChannel === channelId) return;

    // Leave current channel + clean up presence
    if (joinedChannel) {
      clearTimeout(refreshTimerRef.current);
      if (uid) await deleteDoc(doc(db, 'crews', joinedChannel, 'presence', uid)).catch(() => {});
      engineRef.current?.leaveChannel();
      setMicOn(false);
      setIsMicOn(false);
      setTalking(false);
    }

    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) {
      Alert.alert('Microphone access needed', 'Enable microphone in Settings to use crew radio.');
      return;
    }

    // Configure audio session: stays active in background, uses communication mode
    // (echo cancellation, noise suppression), and routes to speaker.
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      interruptionModeIOS: 1, // DO_NOT_MIX
      shouldDuckAndroid: false,
      interruptionModeAndroid: 1,
      playThroughEarpieceAndroid: false,
    });

    setTokenLoading(true);
    try {
      const token = await fetchToken(channelId);

      engineRef.current?.setClientRole(ClientRoleType.ClientRoleBroadcaster);
      engineRef.current?.joinChannel(token, channelId, 0, {
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        publishMicrophoneTrack: true,
        autoSubscribeAudio: true,
      });
      engineRef.current?.muteLocalAudioStream(true);

      const crewName = crewChannels.find((c) => c.id === channelId)?.name ?? null;
      setJoinedChannel(channelId);
      joinedChannelRef.current = channelId;
      setChannelName(crewName);
      setActiveSpeakerUid(null);
      setRemoteUsers(new Set());

      // Write presence
      if (uid) {
        await setDoc(doc(db, 'crews', channelId, 'presence', uid), {
          uid,
          joinedAt: serverTimestamp(),
        });
      }

      // Haptic on successful join
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Auto-refresh token at 55 minutes
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(async () => {
        try {
          const newToken = await fetchToken(channelId);
          engineRef.current?.renewToken(newToken);
        } catch (e) {
          console.warn('[Agora] Auto-refresh failed:', e.message);
        }
      }, 55 * 60 * 1000);

    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Could not join channel', e.message);
      console.error('[Agora] joinChannel failed:', e);
    } finally {
      setTokenLoading(false);
    }
  };

  // Keep ref current so useFocusEffect can call latest version
  joinChannelCallbackRef.current = joinChannel;

  const leaveChannel = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    clearTimeout(refreshTimerRef.current);
    if (uid && joinedChannel) {
      await deleteDoc(doc(db, 'crews', joinedChannel, 'presence', uid)).catch(() => {});
    }
    engineRef.current?.muteLocalAudioStream(true);
    engineRef.current?.leaveChannel();
    setJoinedChannel(null);
    joinedChannelRef.current = null;
    setChannelName(null);
    setActiveSpeakerUid(null);
    setRemoteUsers(new Set());
    setIsMicOn(false);
    setTalking(false);
    setMicOn(false);
    // Reset audio session back to normal playback mode
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: false,
      staysActiveInBackground: false,
      interruptionModeIOS: 0,
      shouldDuckAndroid: true,
    }).catch(() => {});
  };

  // ── Auto-join from CrewScreen ─────────────────────────────────────────────

  useFocusEffect(
    useCallback(() => {
      const pendingCh = consumeJoinRequest();
      if (pendingCh && joinChannelCallbackRef.current) {
        joinChannelCallbackRef.current(pendingCh);
      }
    }, [])
  );

  // ── Hold-to-talk ──────────────────────────────────────────────────────────

  const onPressInHold = () => {
    if (!joinedChannel) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    engineRef.current?.muteLocalAudioStream(false);
    setTalking(true);
    setMicOn(true);
  };

  const onPressOutHold = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    engineRef.current?.muteLocalAudioStream(true);
    setTalking(false);
    setMicOn(false);
  };

  const toggleOpenMic = () => {
    if (!joinedChannel) return;
    const next = !isMicOn;
    if (next) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    engineRef.current?.muteLocalAudioStream(!next);
    setIsMicOn(next);
    setMicOn(next);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const isLocalSpeaking = activeSpeakerUid !== null && activeSpeakerUid === localUid;
  const isRemoteSpeaking = activeSpeakerUid !== null && activeSpeakerUid !== localUid;
  // Use Firestore presence for accurate count (presenceUids already includes current user)
  const liveCount = joinedChannel ? Math.max(presenceUids.size, 1) : 0;

  const joinedCrew = joinedChannel ? crewChannels.find((c) => c.id === joinedChannel) : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >

      {/* ── Header ─────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>radio</Text>
        {joinedChannel && (
          <View style={styles.inChannelPill}>
            <View style={styles.inChannelDot} />
            <Text style={styles.inChannelText}>{joinedCrew?.name ?? 'channel'}</Text>
          </View>
        )}
      </View>

      {/* ── Crew channels ──────────────────────────────── */}
      <Text style={styles.sectionLabel}>crew channels</Text>

      {crewChannels.length === 0 ? (
        <View style={styles.emptyChannels}>
          <Text style={styles.emptyChannelsTitle}>no channels yet</Text>
          <Text style={styles.emptyChannelsSub}>
            create a crew in the Crew tab to start talking
          </Text>
        </View>
      ) : (
        crewChannels.map((ch) => {
          const isJoined = joinedChannel === ch.id;
          return (
            <TouchableOpacity
              key={ch.id}
              style={[styles.channelCard, isJoined && styles.channelCardActive]}
              onPress={() => isJoined ? leaveChannel() : joinChannel(ch.id)}
              activeOpacity={0.75}
              disabled={tokenLoading && !isJoined}
            >
              <View style={[styles.channelDot, { backgroundColor: ch.onlineCount > 0 ? '#22c55e' : '#333' }]} />
              <View style={styles.channelMeta}>
                <Text style={styles.channelName} numberOfLines={1}>{ch.name}</Text>
                <Text style={styles.channelSub} numberOfLines={1}>
                  {ch.memberProfiles.length} member{ch.memberProfiles.length !== 1 ? 's' : ''}
                  {ch.onlineCount > 0 ? ` · ${ch.onlineCount} online` : ''}
                </Text>
              </View>
              {tokenLoading && !isJoined ? (
                <ActivityIndicator size="small" color={ORANGE} />
              ) : (
                <Text style={[styles.channelAction, isJoined && styles.channelActionActive]}>
                  {isJoined ? `${liveCount} live · leave` : 'join'}
                </Text>
              )}
            </TouchableOpacity>
          );
        })
      )}

      {tokenLoading && (
        <Text style={styles.connectingText}>connecting...</Text>
      )}

      {/* ── Members in channel ─────────────────────────── */}
      {joinedCrew && (
        <View style={styles.channelMembersRow}>
          {joinedCrew.memberProfiles.map((p) => {
            const inChannel = presenceUids.has(p.id);
            return (
              <View key={p.id} style={styles.channelMemberWrap}>
                <Avatar
                  photoURL={p.photoURL}
                  name={p.name}
                  uid={p.id}
                  size={34}
                  dimmed={!inChannel}
                />
                {inChannel && <View style={styles.inChannelIndicator} />}
              </View>
            );
          })}
        </View>
      )}

      {/* ── Divider ────────────────────────────────────── */}
      <View style={styles.divider} />

      {/* ── Now talking ────────────────────────────────── */}
      <View style={styles.talkingRow}>
        <View style={styles.talkingAvatar}>
          <Text style={styles.talkingInitials}>{isLocalSpeaking ? 'ME' : '??'}</Text>
        </View>
        <Text style={styles.talkingText}>
          {isLocalSpeaking
            ? 'You are talking...'
            : isRemoteSpeaking
            ? 'Crew member is talking...'
            : joinedChannel
            ? 'no one talking'
            : 'join a channel to start'}
        </Text>
        {(isLocalSpeaking || isRemoteSpeaking) && <Waveform />}
      </View>

      {/* ── Mode toggle ────────────────────────────────── */}
      <View style={styles.modeToggle}>
        {['hold', 'open'].map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[styles.modeOption, selectedMode === mode && styles.modeOptionActive]}
            onPress={() => {
              setSelectedMode(mode);
              engineRef.current?.muteLocalAudioStream(true);
              setIsMicOn(false);
              setTalking(false);
              setMicOn(false);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.modeText, selectedMode === mode ? styles.modeTextActive : styles.modeTextInactive]}>
              {mode === 'hold' ? 'hold to talk' : 'open mic'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Mode content ───────────────────────────────── */}
      {selectedMode === 'hold' ? (
        <View>
          <TouchableOpacity
            style={[styles.holdBtn, talking && styles.holdBtnActive]}
            onPressIn={onPressInHold}
            onPressOut={onPressOutHold}
            activeOpacity={1}
            disabled={!joinedChannel}
          >
            <Ionicons name="mic" size={20} color={joinedChannel ? '#fff' : '#444'} />
            <Text style={[styles.holdBtnText, !joinedChannel && styles.holdBtnTextDisabled]}>
              {!joinedChannel ? 'join a channel first' : talking ? 'broadcasting...' : 'hold to talk'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.holdHint}>
            {talking ? 'release to stop broadcasting' : 'press and hold to speak to your crew'}
          </Text>
        </View>
      ) : (
        <View style={styles.openMicWrap}>
          <TouchableOpacity
            style={[styles.micCircle, isMicOn ? styles.micCircleOn : styles.micCircleOff]}
            onPress={toggleOpenMic}
            activeOpacity={0.85}
            disabled={!joinedChannel}
          >
            <Ionicons name="mic" size={28} color={isMicOn ? '#fff' : joinedChannel ? '#555' : '#333'} />
          </TouchableOpacity>
          <View style={[styles.micBadge, isMicOn ? styles.micBadgeOn : styles.micBadgeOff]}>
            <Text style={[styles.micBadgeText, isMicOn ? styles.micBadgeTextOn : styles.micBadgeTextOff]}>
              {!joinedChannel ? 'join a channel' : isMicOn ? 'live' : 'mic off'}
            </Text>
          </View>
          <Text style={styles.micHint}>
            {!joinedChannel
              ? 'tap a channel above to join'
              : isMicOn ? 'tap to mute your mic' : 'tap to go live to your crew'}
          </Text>
        </View>
      )}

    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  content: { padding: 16, paddingBottom: 32 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 18,
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '500' },
  inChannelPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f9731620', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5, gap: 5,
  },
  inChannelDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: ORANGE },
  inChannelText: { color: ORANGE, fontSize: 10, fontWeight: '600' },

  sectionLabel: {
    color: '#555', fontSize: 10, textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: 8,
  },

  emptyChannels: {
    backgroundColor: '#1a1a1a', borderRadius: 8, borderWidth: 0.5,
    borderColor: '#2a2a2a', padding: 16, alignItems: 'center', marginBottom: 6,
  },
  emptyChannelsTitle: { color: '#555', fontSize: 13, fontWeight: '600', marginBottom: 4 },
  emptyChannelsSub: { color: '#333', fontSize: 11, textAlign: 'center', lineHeight: 16 },

  channelCard: {
    backgroundColor: '#1a1a1a', borderRadius: 8, borderWidth: 0.5,
    borderColor: '#2a2a2a', paddingVertical: 12, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6,
  },
  channelCardActive: { borderColor: ORANGE },
  channelDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  channelMeta: { flex: 1 },
  channelName: { color: '#fff', fontSize: 13, fontWeight: '500' },
  channelSub: { color: '#555', fontSize: 10, marginTop: 2 },
  channelAction: { color: '#555', fontSize: 11 },
  channelActionActive: { color: ORANGE, fontWeight: '600' },

  connectingText: {
    color: '#555', fontSize: 11, textAlign: 'center', marginTop: 4, marginBottom: 6,
  },

  // Channel member presence row
  channelMembersRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    backgroundColor: '#1a1a1a', borderRadius: 8, borderWidth: 0.5,
    borderColor: '#2a2a2a', padding: 10, marginBottom: 6,
  },
  channelMemberWrap: { alignItems: 'center', position: 'relative' },
  inChannelIndicator: {
    position: 'absolute', bottom: 0, right: 0,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#22c55e', borderWidth: 1.5, borderColor: '#1a1a1a',
  },

  divider: { height: 0.5, backgroundColor: '#1e1e1e', marginVertical: 12 },

  talkingRow: {
    backgroundColor: '#1a1a1a', borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  talkingAvatar: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#222', alignItems: 'center', justifyContent: 'center',
  },
  talkingInitials: { color: '#3b82f6', fontSize: 8, fontWeight: '500' },
  talkingText: { flex: 1, color: '#fff', fontSize: 11 },
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 20 },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: ORANGE },

  modeToggle: {
    flexDirection: 'row', backgroundColor: '#1a1a1a',
    borderRadius: 20, padding: 3, marginVertical: 16,
  },
  modeOption: { flex: 1, borderRadius: 16, paddingVertical: 8, alignItems: 'center' },
  modeOptionActive: { backgroundColor: ORANGE },
  modeText: { fontSize: 12, fontWeight: '600' },
  modeTextActive: { color: '#fff' },
  modeTextInactive: { color: '#666' },

  holdBtn: {
    backgroundColor: '#1e1e1e', borderRadius: 12, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  holdBtnActive: { backgroundColor: ORANGE },
  holdBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  holdBtnTextDisabled: { color: '#444' },
  holdHint: { color: '#444', fontSize: 9, textAlign: 'center', marginTop: 6 },

  openMicWrap: { alignItems: 'center', paddingVertical: 8, gap: 14 },
  micCircle: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  micCircleOn: { backgroundColor: ORANGE, borderColor: ORANGE },
  micCircleOff: { backgroundColor: '#1e1e1e', borderColor: '#2a2a2a' },
  micBadge: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  micBadgeOn: { backgroundColor: '#f9731620' },
  micBadgeOff: { backgroundColor: '#1e1e1e' },
  micBadgeText: { fontSize: 11, fontWeight: '600' },
  micBadgeTextOn: { color: ORANGE },
  micBadgeTextOff: { color: '#555' },
  micHint: { color: '#444', fontSize: 11, textAlign: 'center' },
});

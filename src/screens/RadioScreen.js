import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Animated, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import {
  createAgoraRtcEngine,
  ChannelProfileType,
  ClientRoleType,
} from 'react-native-agora';
import { AGORA_APP_ID, AGORA_TOKEN } from '../config/agora';
import { useMic } from '../context/MicContext';

const ORANGE = '#f97316';

// ─── Channel definitions ──────────────────────────────────────────────────────

const CHANNELS = [
  { id: 'sunday-cruise-crew', name: 'sunday cruise crew', active: true },
  { id: 'so-cal-meets', name: 'so cal meets', active: false },
  { id: 'track-day-squad', name: 'track day squad', active: false },
];

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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function RadioScreen() {
  const { setMicOn } = useMic();

  const [selectedMode, setSelectedMode] = useState('hold');
  const [joinedChannel, setJoinedChannel] = useState(null); // channel id string
  const [localUid, setLocalUid] = useState(0);
  const [activeSpeakerUid, setActiveSpeakerUid] = useState(null);
  const [remoteUsers, setRemoteUsers] = useState(new Set());
  const [isMicOn, setIsMicOn] = useState(false); // open mic toggle state
  const [talking, setTalking] = useState(false);  // hold-to-talk press state

  const engineRef = useRef(null);

  // ── Agora engine lifecycle ─────────────────────────────────────────────────

  useEffect(() => {
    const engine = createAgoraRtcEngine();
    engineRef.current = engine;

    engine.initialize({
      appId: AGORA_APP_ID,
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
    });

    engine.enableAudio();
    // Start muted — user controls when to speak
    engine.muteLocalAudioStream(true);

    // Enable volume indication so onActiveSpeaker fires (~500 ms interval)
    engine.enableAudioVolumeIndication(500, 3, false);

    const eventHandler = {
      onJoinChannelSuccess: (connection, elapsed) => {
        console.log('Agora: joined', connection.channelId, 'uid', connection.localUid);
        setLocalUid(connection.localUid);
      },
      onUserOffline: (connection, remoteUid) => {
        setRemoteUsers((prev) => {
          const next = new Set(prev);
          next.delete(remoteUid);
          return next;
        });
        setActiveSpeakerUid((prev) => (prev === remoteUid ? null : prev));
      },
      onActiveSpeaker: (connection, uid) => {
        setActiveSpeakerUid(uid || null);
      },
      onUserMuteAudio: (connection, uid, muted) => {
        if (muted) {
          setActiveSpeakerUid((prev) => (prev === uid ? null : prev));
        }
      },
      onUserEnableAudio: (connection, uid, enabled) => {
        setRemoteUsers((prev) => {
          const next = new Set(prev);
          enabled ? next.add(uid) : next.delete(uid);
          return next;
        });
        if (!enabled) {
          setActiveSpeakerUid((prev) => (prev === uid ? null : prev));
        }
      },
      onError: (err, msg) => {
        console.warn('Agora error', err, msg);
      },
    };

    engine.registerEventHandler(eventHandler);

    return () => {
      engine.unregisterEventHandler(eventHandler);
      engine.muteLocalAudioStream(true);
      engine.leaveChannel();
      engine.release();
      engineRef.current = null;
      setMicOn(false);
    };
  }, [setMicOn]);

  // ── Join / leave ──────────────────────────────────────────────────────────

  const joinChannel = async (channelId) => {
    if (joinedChannel === channelId) return;

    // Leave existing channel first
    if (joinedChannel) {
      engineRef.current?.leaveChannel();
      setMicOn(false);
      setIsMicOn(false);
      setTalking(false);
    }

    // Request mic permission via expo-av
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) {
      Alert.alert(
        'Microphone access needed',
        'Enable microphone in Settings to use crew radio.'
      );
      return;
    }

    engineRef.current?.setClientRole(ClientRoleType.ClientRoleBroadcaster);
    engineRef.current?.joinChannel(AGORA_TOKEN ?? '', channelId, 0, {
      clientRoleType: ClientRoleType.ClientRoleBroadcaster,
      publishMicrophoneTrack: true,
      autoSubscribeAudio: true,
    });

    // Start muted regardless of mode — user activates manually
    engineRef.current?.muteLocalAudioStream(true);
    setJoinedChannel(channelId);
    setActiveSpeakerUid(null);
    setRemoteUsers(new Set());
  };

  const leaveChannel = () => {
    engineRef.current?.muteLocalAudioStream(true);
    engineRef.current?.leaveChannel();
    setJoinedChannel(null);
    setActiveSpeakerUid(null);
    setRemoteUsers(new Set());
    setIsMicOn(false);
    setTalking(false);
    setMicOn(false);
  };

  // ── Hold-to-talk handlers ─────────────────────────────────────────────────

  const onPressInHold = () => {
    if (!joinedChannel) return;
    engineRef.current?.muteLocalAudioStream(false);
    setTalking(true);
    setMicOn(true);
  };

  const onPressOutHold = () => {
    engineRef.current?.muteLocalAudioStream(true);
    setTalking(false);
    setMicOn(false);
  };

  // ── Open-mic toggle ───────────────────────────────────────────────────────

  const toggleOpenMic = () => {
    if (!joinedChannel) return;
    const next = !isMicOn;
    engineRef.current?.muteLocalAudioStream(!next);
    setIsMicOn(next);
    setMicOn(next);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const isLocalSpeaking = activeSpeakerUid !== null && activeSpeakerUid === localUid;
  const isRemoteSpeaking = activeSpeakerUid !== null && activeSpeakerUid !== localUid;
  const liveCount = (joinedChannel ? 1 : 0) + remoteUsers.size;

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
            <Text style={styles.inChannelText}>in channel</Text>
          </View>
        )}
      </View>

      {/* ── Channels ───────────────────────────────────── */}
      <Text style={styles.sectionLabel}>channels</Text>
      {CHANNELS.map((ch) => {
        const isJoined = joinedChannel === ch.id;
        return (
          <TouchableOpacity
            key={ch.id}
            style={[styles.channelCard, isJoined && styles.channelCardActive]}
            onPress={() => isJoined ? leaveChannel() : joinChannel(ch.id)}
            activeOpacity={0.75}
          >
            <View style={[styles.channelDot, { backgroundColor: isJoined ? ORANGE : '#444' }]} />
            <Text style={styles.channelName}>{ch.name}</Text>
            <Text style={styles.channelCount}>
              {isJoined ? `${liveCount} live` : '0 live'}
            </Text>
          </TouchableOpacity>
        );
      })}

      {/* ── Divider ────────────────────────────────────── */}
      <View style={styles.divider} />

      {/* ── Now talking ────────────────────────────────── */}
      <View style={styles.talkingRow}>
        <View style={styles.talkingAvatar}>
          <Text style={styles.talkingInitials}>
            {isLocalSpeaking ? 'ME' : 'JD'}
          </Text>
        </View>
        <Text style={styles.talkingText}>
          {isLocalSpeaking
            ? 'You are talking...'
            : isRemoteSpeaking
            ? 'Crew member is talking...'
            : joinedChannel
            ? 'no one talking'
            : 'Jake D. is talking...'}
        </Text>
        {(isLocalSpeaking || isRemoteSpeaking || !joinedChannel) && <Waveform />}
      </View>

      {/* ── Mode toggle ────────────────────────────────── */}
      <View style={styles.modeToggle}>
        {['hold', 'open'].map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[styles.modeOption, selectedMode === mode && styles.modeOptionActive]}
            onPress={() => {
              setSelectedMode(mode);
              // Reset mic state when switching modes
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
              : isMicOn
              ? 'tap to mute your mic'
              : 'tap to go live to your crew'}
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

  // Header
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

  // Channel cards
  channelCard: {
    backgroundColor: '#1a1a1a', borderRadius: 8, borderWidth: 0.5,
    borderColor: '#2a2a2a', paddingVertical: 10, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6,
  },
  channelCardActive: { borderColor: ORANGE },
  channelDot: { width: 8, height: 8, borderRadius: 4 },
  channelName: { flex: 1, color: '#fff', fontSize: 11 },
  channelCount: { color: '#555', fontSize: 10 },

  divider: { height: 0.5, backgroundColor: '#1e1e1e', marginVertical: 12 },

  // Now talking
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

  // Waveform
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 20 },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: ORANGE },

  // Mode toggle
  modeToggle: {
    flexDirection: 'row', backgroundColor: '#1a1a1a',
    borderRadius: 20, padding: 3, marginVertical: 16,
  },
  modeOption: { flex: 1, borderRadius: 16, paddingVertical: 8, alignItems: 'center' },
  modeOptionActive: { backgroundColor: ORANGE },
  modeText: { fontSize: 12, fontWeight: '600' },
  modeTextActive: { color: '#fff' },
  modeTextInactive: { color: '#666' },

  // Hold to talk
  holdBtn: {
    backgroundColor: '#1e1e1e', borderRadius: 12, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  holdBtnActive: { backgroundColor: ORANGE },
  holdBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  holdBtnTextDisabled: { color: '#444' },
  holdHint: { color: '#444', fontSize: 9, textAlign: 'center', marginTop: 6 },

  // Open mic
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

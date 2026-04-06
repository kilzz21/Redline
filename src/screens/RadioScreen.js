import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const ORANGE = '#f97316';

const CHANNELS = [
  { id: 'sc', name: 'sunday cruise crew', live: 3, active: true },
  { id: 'socal', name: 'so cal meets', live: 0, active: false },
  { id: 'track', name: 'track day squad', live: 0, active: false },
];

const BAR_HEIGHTS = [8, 14, 10, 16, 8];

// Animated audio waveform
function Waveform() {
  const anims = useRef(BAR_HEIGHTS.map((h) => new Animated.Value(h))).current;

  useEffect(() => {
    const animations = anims.map((anim, i) => {
      const target = BAR_HEIGHTS[i] === 8 ? 14 : BAR_HEIGHTS[i] === 14 ? 8 : BAR_HEIGHTS[i] === 16 ? 10 : 14;
      return Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: target,
            duration: 280 + i * 60,
            useNativeDriver: false,
          }),
          Animated.timing(anim, {
            toValue: BAR_HEIGHTS[i],
            duration: 280 + i * 60,
            useNativeDriver: false,
          }),
        ])
      );
    });
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [anims]);

  return (
    <View style={styles.waveform}>
      {anims.map((anim, i) => (
        <Animated.View
          key={i}
          style={[styles.waveBar, { height: anim }]}
        />
      ))}
    </View>
  );
}

// Hold-to-talk button
function HoldToTalk() {
  const [active, setActive] = useState(false);

  return (
    <View>
      <TouchableOpacity
        style={[styles.holdBtn, active && styles.holdBtnActive]}
        onPressIn={() => setActive(true)}
        onPressOut={() => setActive(false)}
        activeOpacity={1}
      >
        <Ionicons name="mic" size={20} color="#fff" />
        <Text style={styles.holdBtnText}>
          {active ? 'broadcasting...' : 'hold to talk'}
        </Text>
      </TouchableOpacity>
      <Text style={styles.holdHint}>release to stop broadcasting</Text>
    </View>
  );
}

// Open-mic button
function OpenMic() {
  const [micOn, setMicOn] = useState(false);

  return (
    <View style={styles.openMicWrap}>
      <TouchableOpacity
        style={[styles.micCircle, micOn ? styles.micCircleOn : styles.micCircleOff]}
        onPress={() => setMicOn((v) => !v)}
        activeOpacity={0.85}
      >
        <Ionicons name="mic" size={28} color={micOn ? '#fff' : '#555'} />
      </TouchableOpacity>

      <View style={[styles.micBadge, micOn ? styles.micBadgeOn : styles.micBadgeOff]}>
        <Text style={[styles.micBadgeText, micOn ? styles.micBadgeTextOn : styles.micBadgeTextOff]}>
          {micOn ? 'live' : 'mic off'}
        </Text>
      </View>

      <Text style={styles.micHint}>
        {micOn ? 'tap to mute your mic' : 'tap to go live to your crew'}
      </Text>
    </View>
  );
}

export default function RadioScreen() {
  const [selectedMode, setSelectedMode] = useState('hold');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >

      {/* ── Header ─────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>radio</Text>
        <View style={styles.inChannelPill}>
          <View style={styles.inChannelDot} />
          <Text style={styles.inChannelText}>in channel</Text>
        </View>
      </View>

      {/* ── Channels ───────────────────────────────────── */}
      <Text style={styles.sectionLabel}>channels</Text>
      {CHANNELS.map((ch) => (
        <View
          key={ch.id}
          style={[styles.channelCard, ch.active && styles.channelCardActive]}
        >
          <View style={[styles.channelDot, { backgroundColor: ch.active ? ORANGE : '#444' }]} />
          <Text style={styles.channelName}>{ch.name}</Text>
          <Text style={styles.channelCount}>
            {ch.live > 0 ? `${ch.live} live` : '0 live'}
          </Text>
        </View>
      ))}

      {/* ── Divider ────────────────────────────────────── */}
      <View style={styles.divider} />

      {/* ── Now talking ────────────────────────────────── */}
      <View style={styles.talkingRow}>
        <View style={styles.talkingAvatar}>
          <Text style={styles.talkingInitials}>JD</Text>
        </View>
        <Text style={styles.talkingText}>Jake D. is talking...</Text>
        <Waveform />
      </View>

      {/* ── Mode toggle ────────────────────────────────── */}
      <View style={styles.modeToggle}>
        <TouchableOpacity
          style={[styles.modeOption, selectedMode === 'hold' && styles.modeOptionActive]}
          onPress={() => setSelectedMode('hold')}
          activeOpacity={0.8}
        >
          <Text style={[styles.modeText, selectedMode === 'hold' ? styles.modeTextActive : styles.modeTextInactive]}>
            hold to talk
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeOption, selectedMode === 'open' && styles.modeOptionActive]}
          onPress={() => setSelectedMode('open')}
          activeOpacity={0.8}
        >
          <Text style={[styles.modeText, selectedMode === 'open' ? styles.modeTextActive : styles.modeTextInactive]}>
            open mic
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Mode content ───────────────────────────────── */}
      {selectedMode === 'hold' ? <HoldToTalk /> : <OpenMic />}

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
    paddingBottom: 32,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '500',
  },
  inChannelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9731620',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
  },
  inChannelDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ORANGE,
  },
  inChannelText: {
    color: ORANGE,
    fontSize: 10,
    fontWeight: '600',
  },

  // Section label
  sectionLabel: {
    color: '#555',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },

  // Channel cards
  channelCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  channelCardActive: {
    borderColor: ORANGE,
  },
  channelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  channelName: {
    flex: 1,
    color: '#fff',
    fontSize: 11,
  },
  channelCount: {
    color: '#555',
    fontSize: 10,
  },

  // Divider
  divider: {
    height: 0.5,
    backgroundColor: '#1e1e1e',
    marginVertical: 12,
  },

  // Now talking row
  talkingRow: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 0,
  },
  talkingAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  talkingInitials: {
    color: '#3b82f6',
    fontSize: 8,
    fontWeight: '500',
  },
  talkingText: {
    flex: 1,
    color: '#fff',
    fontSize: 11,
  },

  // Waveform
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 20,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: ORANGE,
  },

  // Mode toggle
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    padding: 3,
    marginVertical: 16,
  },
  modeOption: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 8,
    alignItems: 'center',
  },
  modeOptionActive: {
    backgroundColor: ORANGE,
  },
  modeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modeTextActive: {
    color: '#fff',
  },
  modeTextInactive: {
    color: '#666',
  },

  // Hold to talk
  holdBtn: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  holdBtnActive: {
    backgroundColor: ORANGE,
  },
  holdBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  holdHint: {
    color: '#444',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 6,
  },

  // Open mic
  openMicWrap: {
    alignItems: 'center',
    paddingVertical: 8,
    gap: 14,
  },
  micCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micCircleOn: {
    backgroundColor: ORANGE,
    borderColor: ORANGE,
  },
  micCircleOff: {
    backgroundColor: '#1e1e1e',
    borderColor: '#2a2a2a',
  },
  micBadge: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  micBadgeOn: {
    backgroundColor: '#f9731620',
  },
  micBadgeOff: {
    backgroundColor: '#1e1e1e',
  },
  micBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  micBadgeTextOn: {
    color: ORANGE,
  },
  micBadgeTextOff: {
    color: '#555',
  },
  micHint: {
    color: '#444',
    fontSize: 11,
    textAlign: 'center',
  },
});

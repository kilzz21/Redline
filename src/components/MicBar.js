import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMic } from '../context/MicContext';
import { navigationRef } from '../navigation/navigationRef';

const ORANGE = '#f97316';

function PulsingDot() {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    ).start();
  }, [opacity]);

  return <Animated.View style={[styles.dot, { opacity }]} />;
}

export default function MicBar() {
  const { micOn, channelName, toggleMic } = useMic();
  const insets = useSafeAreaInsets();
  const toastAnim = useRef(new Animated.Value(0)).current;
  const [toastMsg, setToastMsg] = useState('');

  const showToast = (msg) => {
    setToastMsg(msg);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(toastAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  };

  const handlePress = () => {
    // Turning mic on — only allow if a channel is active
    if (!micOn && !channelName) {
      showToast('join a channel first');
      if (navigationRef.isReady()) {
        navigationRef.navigate('Radio');
      }
      return;
    }
    toggleMic();
  };

  return (
    <View>
      <TouchableOpacity
        style={[
          styles.bar,
          { paddingTop: insets.top, height: 38 + insets.top },
          micOn ? styles.barOn : styles.barOff,
        ]}
        onPress={handlePress}
        activeOpacity={0.9}
      >
        {micOn ? (
          <>
            <PulsingDot />
            <Text style={styles.textOn}>mic live — {channelName ?? 'crew'} · tap to mute</Text>
          </>
        ) : (
          <Text style={styles.textOff}>mic off — tap to go live</Text>
        )}
      </TouchableOpacity>

      {/* Toast */}
      <Animated.View
        style={[styles.toast, { opacity: toastAnim }]}
        pointerEvents="none"
      >
        <Text style={styles.toastText}>{toastMsg}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  barOn: { backgroundColor: ORANGE },
  barOff: { backgroundColor: '#1a1a1a' },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#fff',
    marginRight: 8,
  },
  textOn: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  textOff: {
    color: '#555',
    fontSize: 12,
    fontWeight: '500',
  },

  // Toast
  toast: {
    position: 'absolute',
    top: '100%',
    alignSelf: 'center',
    marginTop: 6,
    backgroundColor: 'rgba(30,30,30,0.95)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderWidth: 0.5,
    borderColor: '#333',
  },
  toastText: {
    color: '#ccc',
    fontSize: 12,
    fontWeight: '500',
  },
});

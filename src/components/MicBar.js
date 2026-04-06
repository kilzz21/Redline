import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMic } from '../context/MicContext';

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
  const { micOn, toggleMic } = useMic();
  const insets = useSafeAreaInsets();

  return (
    <TouchableOpacity
      style={[
        styles.bar,
        { paddingTop: insets.top, height: 38 + insets.top },
        micOn ? styles.barOn : styles.barOff,
      ]}
      onPress={toggleMic}
      activeOpacity={0.9}
    >
      {micOn ? (
        <>
          <PulsingDot />
          <Text style={styles.textOn}>mic live — sunday cruise crew · tap to mute</Text>
        </>
      ) : (
        <Text style={styles.textOff}>mic off — tap to go live</Text>
      )}
    </TouchableOpacity>
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
});

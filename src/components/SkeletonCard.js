import { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';

export function SkeletonCard({ height = 80, style }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, [opacity]);

  return (
    <Animated.View style={[styles.card, { height }, style, { opacity }]} />
  );
}

export function SkeletonList({ count = 3, height = 80, gap = 10 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} height={height} style={{ marginBottom: gap }} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
  },
});

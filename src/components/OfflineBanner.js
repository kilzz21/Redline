import { useEffect, useRef, useState } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';
import * as Network from 'expo-network';

export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const translateY = useRef(new Animated.Value(-40)).current;

  useEffect(() => {
    // Check initial state
    Network.getNetworkStateAsync().then((state) => {
      setOffline(!state.isConnected);
    });

    // Subscribe to changes
    const subscription = Network.addNetworkStateListener((state) => {
      setOffline(!state.isConnected);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: offline ? 0 : -40,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [offline, translateY]);

  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY }] }]}>
      <Text style={styles.text}>you're offline</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 36,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});

import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged } from 'firebase/auth';
import * as Notifications from 'expo-notifications';

import { auth } from './src/config/firebase';
import { MicProvider } from './src/context/MicContext';
import MicBar from './src/components/MicBar';
import OfflineBanner from './src/components/OfflineBanner';
import SplashScreen from './src/screens/SplashScreen';
import AuthNavigator from './src/navigation/AuthNavigator';
import TabNavigator from './src/navigation/TabNavigator';
import { navigationRef } from './src/navigation/navigationRef';
import { registerForPushNotificationsAsync, savePushToken } from './src/utils/notifications';

// ── Deep link config ──────────────────────────────────────────────────────────
// redline://invite/USER_ID  →  Crew tab with { inviteUserId } param
const linking = {
  prefixes: ['redline://'],
  config: {
    screens: {
      Crew: 'invite/:inviteUserId',
    },
  },
};

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <Text style={styles.loadingText}>REDLINE</Text>
    </View>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const notifListenerRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser ?? false);
      setAuthChecked(true);
      if (firebaseUser) {
        setSplashDone(true);
        // Register and save push token
        const token = await registerForPushNotificationsAsync();
        if (token) savePushToken(firebaseUser.uid, token);
      }
    });
    return unsubscribe;
  }, []);

  // Notification tap handler — navigate based on notification type
  useEffect(() => {
    notifListenerRef.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data ?? {};
      if (!navigationRef.isReady()) return;
      if (data.type === 'crewInvite' || data.type === 'connectionRequest') {
        navigationRef.navigate('Crew');
      }
    });
    return () => notifListenerRef.current?.remove();
  }, []);

  if (!authChecked) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <LoadingScreen />
      </SafeAreaProvider>
    );
  }

  if (!splashDone) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SplashScreen onDone={() => setSplashDone(true)} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <MicProvider>
        <OfflineBanner />
        <StatusBar style="light" />
        {user && <MicBar />}
        <NavigationContainer ref={navigationRef} linking={user ? linking : undefined}>
          {user ? <TabNavigator /> : <AuthNavigator />}
        </NavigationContainer>
      </MicProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#f97316',
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 10,
  },
});

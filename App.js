import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from './src/config/firebase';
import { MicProvider } from './src/context/MicContext';
import MicBar from './src/components/MicBar';
import SplashScreen from './src/screens/SplashScreen';
import AuthNavigator from './src/navigation/AuthNavigator';
import TabNavigator from './src/navigation/TabNavigator';

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <Text style={styles.loadingText}>REDLINE</Text>
    </View>
  );
}

export default function App() {
  // null = not yet determined, object = logged in, false = logged out
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser ?? false);
      setAuthChecked(true);
      // Already logged in — skip splash entirely
      if (firebaseUser) {
        setSplashDone(true);
      }
    });
    return unsubscribe;
  }, []);

  // Waiting for Firebase to resolve the initial auth state
  if (!authChecked) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <LoadingScreen />
      </SafeAreaProvider>
    );
  }

  // New / logged-out user — show splash first
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
        <StatusBar style="light" />
        {user && <MicBar />}
        <NavigationContainer>
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

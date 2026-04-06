import { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { MicProvider } from './src/context/MicContext';
import MicBar from './src/components/MicBar';
import SplashScreen from './src/screens/SplashScreen';
import AuthNavigator from './src/navigation/AuthNavigator';
import TabNavigator from './src/navigation/TabNavigator';

export default function App() {
  const [splashDone, setSplashDone] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Show splash until animation completes
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
        {/* MicBar sits above navigation, only shown in main app */}
        {isLoggedIn && <MicBar />}
        <NavigationContainer>
          {isLoggedIn
            ? <TabNavigator />
            : <AuthNavigator onLogin={() => setIsLoggedIn(true)} />
          }
        </NavigationContainer>
      </MicProvider>
    </SafeAreaProvider>
  );
}

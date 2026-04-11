export default {
  expo: {
    name: 'Redline',
    slug: 'redline',
    scheme: 'redline',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      url: 'https://u.expo.dev/e270e189-f79a-4bd9-b69d-1066aa145b4c',
    },
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#000000',
    },
    ios: {
      icon: './assets/icon.png',
      supportsTablet: true,
      config: {
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
      },
      infoPlist: {
        NSMicrophoneUsageDescription: 'Redline needs microphone access for crew radio',
        NSPhotoLibraryUsageDescription: 'Redline needs photo library access to set your profile picture',
        NSContactsUsageDescription: 'Redline uses your contacts to find friends already on the app',
        UIBackgroundModes: ['remote-notification', 'audio', 'voip'],
      },
      bundleIdentifier: 'com.kilzz21.redline',
      buildNumber: '2',
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      [
        'expo-notifications',
        {
          icon: './assets/icon.png',
          color: '#f97316',
          sounds: [],
        },
      ],
      'expo-updates',
    ],
    extra: {
      eas: {
        projectId: 'e270e189-f79a-4bd9-b69d-1066aa145b4c',
      },
      googlePlacesKey: process.env.GOOGLE_MAPS_API_KEY,
      agoraAppId: process.env.AGORA_APP_ID,
      firebaseApiKey: process.env.FIREBASE_API_KEY,
    },
  },
};

import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ORANGE = '#f97316';

export default function WelcomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* Logo block — centered in remaining space */}
      <View style={styles.hero}>
        <Text style={styles.logo}>REDLINE</Text>
        <Text style={styles.tagline}>drive together</Text>
      </View>

      {/* Buttons pinned to bottom */}
      <View style={[styles.buttons, { paddingBottom: insets.bottom + 32 }]}>
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={() => navigation.navigate('SignUp')}
          activeOpacity={0.85}
        >
          <Text style={styles.btnPrimaryText}>get started</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btnSecondary}
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.85}
        >
          <Text style={styles.btnSecondaryText}>log in</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    color: ORANGE,
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 10,
    marginBottom: 12,
  },
  tagline: {
    color: '#555',
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 2,
  },
  buttons: {
    paddingHorizontal: 24,
    gap: 12,
  },
  btnPrimary: {
    backgroundColor: ORANGE,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  btnSecondary: {
    backgroundColor: 'transparent',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnSecondaryText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '600',
  },
});

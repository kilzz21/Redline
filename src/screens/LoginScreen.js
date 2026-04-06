import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ORANGE = '#f97316';

export default function LoginScreen({ navigation, onLogin }) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.inner, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>

        {/* Back + header */}
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← back</Text>
        </TouchableOpacity>

        <Text style={styles.logoSmall}>REDLINE</Text>
        <Text style={styles.title}>log in</Text>

        {/* Inputs */}
        <TextInput
          style={styles.input}
          placeholder="email"
          placeholderTextColor="#444"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder="password"
          placeholderTextColor="#444"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* Forgot password */}
        <TouchableOpacity style={styles.forgotWrap}>
          <Text style={styles.forgotText}>forgot password?</Text>
        </TouchableOpacity>

        {/* Log in button */}
        <TouchableOpacity style={styles.btnPrimary} onPress={onLogin} activeOpacity={0.85}>
          <Text style={styles.btnPrimaryText}>log in</Text>
        </TouchableOpacity>

        {/* Switch to sign up */}
        <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
          <Text style={styles.switchLink}>
            no account?{' '}
            <Text style={styles.switchLinkOrange}>get started</Text>
          </Text>
        </TouchableOpacity>

      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111',
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
  },
  backBtn: {
    marginBottom: 20,
  },
  backText: {
    color: '#555',
    fontSize: 14,
    fontWeight: '500',
  },
  logoSmall: {
    color: ORANGE,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 5,
    marginBottom: 8,
  },
  title: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 28,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    color: '#fff',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  forgotWrap: {
    alignSelf: 'flex-end',
    marginBottom: 24,
    marginTop: 2,
  },
  forgotText: {
    color: '#555',
    fontSize: 13,
  },
  btnPrimary: {
    backgroundColor: ORANGE,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  switchLink: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
  },
  switchLinkOrange: {
    color: ORANGE,
    fontWeight: '600',
  },
});

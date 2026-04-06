import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ORANGE = '#f97316';

function Field({ placeholder, value, onChangeText, secureTextEntry, keyboardType, autoCapitalize }) {
  return (
    <TextInput
      style={styles.input}
      placeholder={placeholder}
      placeholderTextColor="#444"
      value={value}
      onChangeText={onChangeText}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType || 'default'}
      autoCapitalize={autoCapitalize ?? 'sentences'}
      autoCorrect={false}
    />
  );
}

export default function SignUpScreen({ navigation, onLogin }) {
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* Back + title */}
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← back</Text>
        </TouchableOpacity>

        <Text style={styles.logoSmall}>REDLINE</Text>
        <Text style={styles.title}>create account</Text>

        {/* Account fields */}
        <Text style={styles.sectionLabel}>your details</Text>
        <Field placeholder="full name" value={name} onChangeText={setName} />
        <Field
          placeholder="email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Field
          placeholder="password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />

        {/* Car fields */}
        <Text style={styles.sectionLabel}>your car</Text>
        <Field
          placeholder="year  (e.g. 2021)"
          value={year}
          onChangeText={setYear}
          keyboardType="number-pad"
          autoCapitalize="none"
        />
        <Field placeholder="make  (e.g. Toyota)" value={make} onChangeText={setMake} />
        <Field placeholder="model  (e.g. Supra GR)" value={model} onChangeText={setModel} />
        <Field placeholder="color  (e.g. Nitro Yellow)" value={color} onChangeText={setColor} />

        {/* Submit */}
        <TouchableOpacity style={styles.btnPrimary} onPress={onLogin} activeOpacity={0.85}>
          <Text style={styles.btnPrimaryText}>create account</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <Text style={styles.switchLink}>already have an account? <Text style={styles.switchLinkOrange}>log in</Text></Text>
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
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
  sectionLabel: {
    color: '#444',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
    marginTop: 4,
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
  btnPrimary: {
    backgroundColor: ORANGE,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
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

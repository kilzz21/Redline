import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, Alert,
  ActivityIndicator, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { uploadProfilePicture } from '../utils/uploadProfilePicture';

const ORANGE = '#f97316';

function friendlyAuthError(code) {
  switch (code) {
    case 'auth/wrong-password': return 'Incorrect password. Please try again.';
    case 'auth/user-not-found': return 'No account found with that email.';
    case 'auth/invalid-email': return 'Please enter a valid email address.';
    case 'auth/too-many-requests': return 'Too many attempts. Please wait a moment and try again.';
    default: return 'Something went wrong. Please try again.';
  }
}

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

export default function SignUpScreen({ navigation }) {
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [location, setLocation] = useState('');
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [profilePicUri, setProfilePicUri] = useState(null);
  const [loading, setLoading] = useState(false);

  const handlePhoneChange = (text) => {
    const digits = text.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) { setPhone(digits); return; }
    if (digits.length <= 6) { setPhone(`(${digits.slice(0, 3)}) ${digits.slice(3)}`); return; }
    setPhone(`(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`);
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to set a profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (!result.canceled) {
      setProfilePicUri(result.assets[0].uri);
    }
  };

  const handleSignUp = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!name || !username || !email || !password) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Missing fields', 'Please fill in your name, username, email, and password.');
      return;
    }
    const cleanUsername = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (cleanUsername.length < 3) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Invalid username', 'Username must be at least 3 characters (letters, numbers, underscores).');
      return;
    }

    setLoading(true);
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);

      let photoURL = null;
      if (profilePicUri) {
        try {
          photoURL = await uploadProfilePicture(user.uid, profilePicUri);
        } catch (e) {
          console.warn('Profile picture upload failed:', e.message);
        }
      }

      const phoneDigits = phone.replace(/\D/g, '');
      await setDoc(doc(db, 'users', user.uid), {
        name,
        username: cleanUsername,
        email,
        phoneNumber: phone || null,
        phoneNumberNormalized: phoneDigits || null,
        location: location.trim() || null,
        car: { year, make, model, color },
        photoURL,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      Alert.alert('Sign up failed', friendlyAuthError(error.code));
    } finally {
      setLoading(false);
    }
  };

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

        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>← back</Text>
        </TouchableOpacity>

        <Text style={styles.logoSmall}>REDLINE</Text>
        <Text style={styles.title}>create account</Text>

        <TouchableOpacity style={styles.pickerWrap} onPress={pickImage} activeOpacity={0.7}>
          {profilePicUri ? (
            <Image source={{ uri: profilePicUri }} style={styles.pickerImage} />
          ) : (
            <View style={styles.pickerPlaceholder}>
              <Text style={styles.pickerPlaceholderText}>tap to add{'\n'}photo</Text>
            </View>
          )}
          <View style={styles.pickerBadge}>
            <Text style={styles.pickerBadgeText}>+</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>your details</Text>
        <Field placeholder="full name" value={name} onChangeText={setName} />
        <Field
          placeholder="username  (e.g. jake_speed)"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
        />
        <Field
          placeholder="email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Field
          placeholder="phone  (e.g. (555) 555-5555)"
          value={phone}
          onChangeText={handlePhoneChange}
          keyboardType="phone-pad"
          autoCapitalize="none"
        />
        <Field
          placeholder="password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />
        <Field
          placeholder="city, state  (e.g. Los Angeles, CA)"
          value={location}
          onChangeText={setLocation}
        />

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

        <TouchableOpacity
          style={[styles.btnPrimary, loading && styles.btnDisabled]}
          onPress={handleSignUp}
          disabled={loading}
          activeOpacity={0.7}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnPrimaryText}>create account</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Login')} activeOpacity={0.7}>
          <Text style={styles.switchLink}>
            already have an account?{' '}
            <Text style={styles.switchLinkOrange}>log in</Text>
          </Text>
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
    marginBottom: 24,
  },

  pickerWrap: {
    alignSelf: 'center',
    marginBottom: 28,
  },
  pickerImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  pickerPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerPlaceholderText: {
    color: '#444',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
  pickerBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerBadgeText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
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
  btnDisabled: {
    opacity: 0.6,
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

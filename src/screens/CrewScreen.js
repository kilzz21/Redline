import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const ORANGE = '#f97316';

const CREW_MEMBERS = [
  {
    id: 'jd',
    initials: 'JD',
    color: '#3b82f6',
    name: 'Jake D.',
    car: '2019 Mustang GT · Shadow Black',
    online: true,
    topSpeed: 89,
  },
  {
    id: 'mr',
    initials: 'MR',
    color: '#22c55e',
    name: 'Marco R.',
    car: '2020 WRX STI · World Rally Blue',
    online: false,
    topSpeed: 102,
  },
];

const PENDING = [
  { id: 'cm', initials: 'CM', color: '#a855f7', name: 'Carlos M.' },
];

const INVITE_ROWS = [
  { id: 'link', icon: 'link-outline', label: 'invite via link' },
  { id: 'contacts', icon: 'people-outline', label: 'invite via contacts' },
  { id: 'username', icon: 'search-outline', label: 'find by username' },
];

function CrewCard({ member }) {
  return (
    <View style={styles.card}>
      {/* Avatar */}
      <View style={[styles.avatar, { backgroundColor: member.color }]}>
        <Text style={styles.avatarText}>{member.initials}</Text>
      </View>

      {/* Name + car */}
      <View style={styles.cardBody}>
        <View style={styles.nameRow}>
          <Text style={styles.memberName}>{member.name}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: member.online ? '#22c55e' : '#444' }]} />
            <Text style={[styles.statusText, { color: member.online ? '#22c55e' : '#444' }]}>
              {member.online ? 'online' : 'offline'}
            </Text>
          </View>
        </View>
        <Text style={styles.carText}>{member.car}</Text>
      </View>

      {/* Top speed */}
      <View style={styles.statWrap}>
        <Text style={styles.statValue}>{member.topSpeed}</Text>
        <Text style={styles.statUnit}>mph top</Text>
      </View>
    </View>
  );
}

function InviteRow({ icon, label, onPress }) {
  return (
    <TouchableOpacity style={styles.inviteRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.inviteIconWrap}>
        <Ionicons name={icon} size={18} color={ORANGE} />
      </View>
      <Text style={styles.inviteLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color="#444" />
    </TouchableOpacity>
  );
}

function PendingCard({ member, onAccept, onDecline }) {
  return (
    <View style={styles.pendingCard}>
      <View style={[styles.avatar, { backgroundColor: member.color }]}>
        <Text style={styles.avatarText}>{member.initials}</Text>
      </View>
      <View style={styles.pendingBody}>
        <Text style={styles.pendingName}>{member.name}</Text>
        <Text style={styles.pendingSubtitle}>wants to join your crew</Text>
      </View>
      <View style={styles.pendingActions}>
        <TouchableOpacity style={styles.acceptBtn} onPress={onAccept} activeOpacity={0.8}>
          <Text style={styles.acceptText}>accept</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.declineBtn} onPress={onDecline} activeOpacity={0.8}>
          <Text style={styles.declineText}>decline</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function CrewScreen({ navigation }) {
  const [pending, setPending] = useState(PENDING);

  const handleInvite = async (type) => {
    if (type === 'link') {
      await Share.share({
        message: 'Join my crew on Redline! Download the app and use my invite link: https://redline.app/invite/abc123',
      });
    } else if (type === 'username') {
      Alert.alert('Find by Username', 'Search coming soon.');
    } else {
      Alert.alert('Contacts', 'Contacts access coming soon.');
    }
  };

  const handleAccept = (id) => {
    Alert.alert('Accepted', 'Crew member added!');
    setPending((p) => p.filter((m) => m.id !== id));
  };

  const handleDecline = (id) => {
    setPending((p) => p.filter((m) => m.id !== id));
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >

        {/* ── Header ─────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>your crew</Text>
          <TouchableOpacity style={styles.inviteHeaderBtn} activeOpacity={0.8}>
            <Text style={styles.inviteHeaderText}>+ invite</Text>
          </TouchableOpacity>
        </View>

        {/* ── Crew members ───────────────────────────── */}
        {CREW_MEMBERS.map((m) => (
          <CrewCard key={m.id} member={m} />
        ))}

        {/* ── Invite section ─────────────────────────── */}
        <Text style={styles.sectionLabel}>invite to Redline</Text>
        <View style={styles.inviteBlock}>
          {INVITE_ROWS.map((row, i) => (
            <View key={row.id}>
              <InviteRow
                icon={row.icon}
                label={row.label}
                onPress={() => handleInvite(row.id)}
              />
              {i < INVITE_ROWS.length - 1 && <View style={styles.rowDivider} />}
            </View>
          ))}
        </View>

        {/* ── Pending invites ────────────────────────── */}
        {pending.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>pending invites</Text>
            {pending.map((m) => (
              <PendingCard
                key={m.id}
                member={m}
                onAccept={() => handleAccept(m.id)}
                onDecline={() => handleDecline(m.id)}
              />
            ))}
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  inviteHeaderBtn: {
    backgroundColor: ORANGE,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  inviteHeaderText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },

  // Crew card
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginBottom: 10,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  cardBody: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  memberName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
  },
  carText: {
    color: '#555',
    fontSize: 12,
  },
  statWrap: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  statValue: {
    color: ORANGE,
    fontSize: 18,
    fontWeight: '700',
  },
  statUnit: {
    color: '#444',
    fontSize: 10,
    marginTop: 1,
  },

  // Section label
  sectionLabel: {
    color: '#444',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 10,
  },

  // Invite block
  inviteBlock: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    overflow: 'hidden',
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  inviteIconWrap: {
    width: 30,
    alignItems: 'center',
    marginRight: 12,
  },
  inviteLabel: {
    flex: 1,
    color: '#ccc',
    fontSize: 14,
    fontWeight: '500',
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#2a2a2a',
    marginLeft: 56,
  },

  // Pending card
  pendingCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginBottom: 10,
  },
  pendingBody: {
    flex: 1,
    marginLeft: 12,
  },
  pendingName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  pendingSubtitle: {
    color: '#555',
    fontSize: 12,
  },
  pendingActions: {
    flexDirection: 'row',
    gap: 8,
  },
  acceptBtn: {
    backgroundColor: ORANGE,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  acceptText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  declineBtn: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  declineText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '600',
  },
});

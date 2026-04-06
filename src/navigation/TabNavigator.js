import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Text, StyleSheet } from 'react-native';

import MapScreen from '../screens/MapScreen';
import DrivesScreen from '../screens/DrivesScreen';
import CrewScreen from '../screens/CrewScreen';
import ProfileScreen from '../screens/ProfileScreen';
import RadioScreen from '../screens/RadioScreen';

const Tab = createBottomTabNavigator();

const ORANGE = '#f97316';
const INACTIVE = '#555';

function RedlineHeader() {
  return <Text style={styles.headerTitle}>REDLINE</Text>;
}

export default function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: '#0d0d0d', shadowColor: 'transparent', elevation: 0, borderBottomWidth: 0 },
        headerStatusBarHeight: 0,
        headerTitleAlign: 'center',
        headerTitle: () => <RedlineHeader />,
        tabBarStyle: {
          backgroundColor: '#0d0d0d',
          borderTopColor: '#2a2a2a',
          borderTopWidth: 1,
          height: 80,
          paddingBottom: 20,
          paddingTop: 6,
        },
        tabBarActiveTintColor: ORANGE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarIcon: ({ focused, color, size }) => {
          const icons = {
            Map: focused ? 'location' : 'location-outline',
            Drives: focused ? 'stats-chart' : 'stats-chart-outline',
            Crew: focused ? 'people' : 'people-outline',
            Profile: focused ? 'person' : 'person-outline',
            Radio: focused ? 'mic' : 'mic-outline',
          };
          return <Ionicons name={icons[route.name]} size={22} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Map" component={MapScreen} />
      <Tab.Screen name="Drives" component={DrivesScreen} />
      <Tab.Screen name="Crew" component={CrewScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
      <Tab.Screen name="Radio" component={RadioScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  headerTitle: {
    color: ORANGE,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 4,
  },
});

export const BADGES = [
  // Speed
  { id: 'century',       name: 'century',        description: 'hit 100 mph',               icon: '💯', category: 'speed',    condition: (s) => s.topSpeed >= 100 },
  { id: 'redline',       name: 'redline',         description: 'hit 150 mph',               icon: '🔴', category: 'speed',    condition: (s) => s.topSpeed >= 150 },
  { id: 'untamed',       name: 'untamed',         description: 'hit 200+ mph',              icon: '🚀', category: 'speed',    condition: (s) => s.topSpeed >= 200 },
  // Distance
  { id: 'first_mile',    name: 'first mile',      description: 'log your first drive',      icon: '🛣️', category: 'distance', condition: (s) => s.totalDrives >= 1 },
  { id: 'road_warrior',  name: 'road warrior',    description: '100 total miles',           icon: '🏅', category: 'distance', condition: (s) => s.totalMiles >= 100 },
  { id: 'cross_country', name: 'cross country',   description: '1000 total miles',          icon: '🗺️', category: 'distance', condition: (s) => s.totalMiles >= 1000 },
  { id: 'nomad',         name: 'nomad',           description: '10000 total miles',         icon: '🌎', category: 'distance', condition: (s) => s.totalMiles >= 10000 },
  // Drives
  { id: 'rookie',        name: 'rookie',          description: '5 drives logged',           icon: '🔰', category: 'drives',   condition: (s) => s.totalDrives >= 5 },
  { id: 'regular',       name: 'regular',         description: '25 drives logged',          icon: '⭐', category: 'drives',   condition: (s) => s.totalDrives >= 25 },
  { id: 'veteran',       name: 'veteran',         description: '100 drives logged',         icon: '🏆', category: 'drives',   condition: (s) => s.totalDrives >= 100 },
  // Time
  { id: 'night_owl',     name: 'night owl',       description: 'drove after midnight',      icon: '🦉', category: 'time',     condition: (s) => s.hasNightDrive },
  { id: 'early_bird',    name: 'early bird',      description: 'drove before 6am',          icon: '🌅', category: 'time',     condition: (s) => s.hasEarlyDrive },
  { id: 'weekend_warrior', name: 'weekend warrior', description: '10 weekend drives',       icon: '📅', category: 'time',     condition: (s) => s.weekendDrives >= 10 },
  // Crew
  { id: 'social',        name: 'social',          description: 'joined your first crew',    icon: '👥', category: 'crew',     condition: (s) => s.crewCount >= 1 },
  { id: 'leader',        name: 'leader',          description: 'created a crew',            icon: '👑', category: 'crew',     condition: (s) => s.createdCrew },
  { id: 'popular',       name: 'popular',         description: '5+ crew members',           icon: '🌟', category: 'crew',     condition: (s) => s.totalCrewMembers >= 5 },
  // Special
  { id: 'canyon_king',   name: 'canyon king',     description: 'high turn count drive',     icon: '🏔️', category: 'special',  condition: (s) => s.hasCanyonDrive },
  { id: 'founding_member', name: 'founding member', description: 'one of the first 100 users', icon: '🎖️', category: 'special', condition: (s) => s.userNumber > 0 && s.userNumber <= 100 },
];

export const BADGE_CATEGORIES = [
  { key: 'speed',    label: 'speed' },
  { key: 'distance', label: 'distance' },
  { key: 'drives',   label: 'drives' },
  { key: 'time',     label: 'time' },
  { key: 'crew',     label: 'crew' },
  { key: 'special',  label: 'special' },
];

export const CAPABILITIES = [
  'workspace:read',
  'workspace:write',
  'tasks:read',
  'tasks:write',
  'people:read',
  'people:write',
  'members:read',
  'discussions:read',
  'discussions:write',
  'direct-messages:read',
  'direct-messages:write',
  'audit:read',
  'kpi:read',
  'system:read',
  'database:read'
];

export const RESPONSIBILITY_PROFILES = {
  'project-manager': {
    label: 'Project manager',
    capabilities: [
      'workspace:read', 'workspace:write', 'tasks:read', 'tasks:write',
      'people:read', 'people:write', 'members:read',
      'discussions:read', 'discussions:write',
      'direct-messages:read', 'direct-messages:write', 'kpi:read'
    ]
  },
  executive: {
    label: 'Executive / CEO',
    capabilities: [
      'workspace:read', 'tasks:read', 'people:read', 'members:read',
      'discussions:read', 'direct-messages:read', 'audit:read', 'kpi:read'
    ]
  },
  hr: {
    label: 'Human resources',
    capabilities: [
      'workspace:read', 'tasks:read', 'people:read', 'people:write',
      'members:read', 'discussions:read', 'discussions:write',
      'direct-messages:read', 'direct-messages:write', 'kpi:read'
    ]
  },
  'backend-developer': {
    label: 'Backend developer',
    capabilities: [
      'workspace:read', 'tasks:read', 'tasks:write',
      'discussions:read', 'discussions:write',
      'direct-messages:read', 'direct-messages:write', 'kpi:read'
    ]
  },
  'frontend-developer': {
    label: 'Frontend developer',
    capabilities: [
      'workspace:read', 'tasks:read', 'tasks:write',
      'discussions:read', 'discussions:write',
      'direct-messages:read', 'direct-messages:write', 'kpi:read'
    ]
  },
  cybersecurity: {
    label: 'Cybersecurity',
    capabilities: [
      'workspace:read', 'tasks:read', 'members:read',
      'discussions:read', 'audit:read', 'kpi:read'
    ]
  },
  'system-administrator': {
    label: 'System administrator',
    capabilities: ['workspace:read', 'discussions:read', 'system:read', 'kpi:read']
  },
  'database-administrator': {
    label: 'Database administrator',
    capabilities: ['workspace:read', 'discussions:read', 'database:read', 'audit:read', 'kpi:read']
  },
  hr: {
    label: 'Human resources',
    capabilities: [
      'workspace:read', 'tasks:read', 'people:read', 'people:write',
      'members:read', 'discussions:read', 'discussions:write',
      'direct-messages:read', 'direct-messages:write', 'kpi:read'
    ]
  },
  'hr-manager': {
    label: 'HR manager',
    capabilities: [
      'workspace:read', 'tasks:read', 'people:read', 'people:write',
      'members:read', 'discussions:read', 'discussions:write',
      'direct-messages:read', 'direct-messages:write', 'audit:read', 'kpi:read'
    ]
  },
  manager: {
    label: 'Manager',
    capabilities: [
      'workspace:read', 'tasks:read', 'people:read', 'members:read',
      'discussions:read', 'discussions:write',
      'direct-messages:read', 'direct-messages:write', 'kpi:read'
    ]
  },
  'team-leader': {
    label: 'Team leader',
    capabilities: [
      'workspace:read', 'tasks:read', 'tasks:write', 'people:read',
      'members:read', 'discussions:read', 'discussions:write',
      'direct-messages:read', 'direct-messages:write', 'kpi:read'
    ]
  },
  employee: {
    label: 'Employee',
    capabilities: [
      'workspace:read', 'tasks:read', 'tasks:write',
      'discussions:read', 'discussions:write',
      'direct-messages:read', 'direct-messages:write', 'kpi:read'
    ]
  },
  'demo-readonly': {
    label: 'Guest demo (read only)',
    capabilities: [
      'workspace:read', 'tasks:read', 'people:read', 'members:read',
      'discussions:read', 'direct-messages:read', 'kpi:read'
    ]
  }
};

const ROLE_CAPABILITIES = {
  owner: new Set(CAPABILITIES),
  admin: new Set(CAPABILITIES),
  editor: new Set([
    'workspace:read', 'workspace:write', 'tasks:read', 'tasks:write',
    'people:read', 'people:write', 'members:read',
    'discussions:read', 'discussions:write',
    'direct-messages:read', 'direct-messages:write', 'kpi:read'
  ]),
  viewer: new Set([
    'workspace:read', 'tasks:read', 'people:read', 'members:read',
    'discussions:read', 'direct-messages:read', 'kpi:read'
  ])
};

const ROLE_CAPABILITY_CEILINGS = {
  owner: new Set(CAPABILITIES),
  admin: new Set(CAPABILITIES),
  editor: new Set(CAPABILITIES),
  viewer: ROLE_CAPABILITIES.viewer
};

export function getEffectiveCapabilities(membership) {
  const roleCapabilities = ROLE_CAPABILITIES[membership?.role] || new Set();
  if (membership?.role === 'owner' || membership?.role === 'admin') {
    return new Set(roleCapabilities);
  }
  const profile = RESPONSIBILITY_PROFILES[membership?.capabilityProfile];
  if (!profile) return new Set(roleCapabilities);
  const ceiling = ROLE_CAPABILITY_CEILINGS[membership?.role] || roleCapabilities;
  return new Set(profile.capabilities.filter(capability => ceiling.has(capability)));
}

export function hasCapability(membership, capability) {
  return getEffectiveCapabilities(membership).has(capability);
}

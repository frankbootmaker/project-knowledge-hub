import { describe, it, expect } from 'vitest';

/**
 * Unit tests for system user sign-in refusal logic.
 * These tests verify the logic without requiring a database.
 */

type User = {
  id: string;
  email: string;
  userType: 'human' | 'system';
  passwordHash: string | null;
  status: string;
};

function shouldAllowWebLogin(user: User | null): { allowed: boolean; reason?: string } {
  if (!user) {
    return { allowed: false, reason: 'USER_NOT_FOUND' };
  }

  if (user.userType === 'system') {
    return { allowed: false, reason: 'SYSTEM_USER_LOGIN_FORBIDDEN' };
  }

  if (!user.passwordHash) {
    return { allowed: false, reason: 'NO_PASSWORD' };
  }

  if (user.status !== 'active') {
    return { allowed: false, reason: 'USER_NOT_ACTIVE' };
  }

  return { allowed: true };
}

function shouldAllowPasswordReset(user: User | null): { allowed: boolean; reason?: string } {
  if (!user) {
    return { allowed: false, reason: 'USER_NOT_FOUND' };
  }

  if (user.userType === 'system') {
    return { allowed: false, reason: 'SYSTEM_USER_NO_PASSWORD_RESET' };
  }

  if (user.status !== 'active') {
    return { allowed: false, reason: 'USER_NOT_ACTIVE' };
  }

  return { allowed: true };
}

describe('System user sign-in refusal logic', () => {
  describe('shouldAllowWebLogin', () => {
    it('should allow human users with password and active status', () => {
      const user: User = {
        id: '1',
        email: 'human@example.com',
        userType: 'human',
        passwordHash: 'hashed',
        status: 'active',
      };
      const result = shouldAllowWebLogin(user);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should refuse system users regardless of password', () => {
      const user: User = {
        id: '2',
        email: 'system@example.com',
        userType: 'system',
        passwordHash: 'hashed',
        status: 'active',
      };
      const result = shouldAllowWebLogin(user);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('SYSTEM_USER_LOGIN_FORBIDDEN');
    });

    it('should refuse system users with null password', () => {
      const user: User = {
        id: '3',
        email: 'system2@example.com',
        userType: 'system',
        passwordHash: null,
        status: 'active',
      };
      const result = shouldAllowWebLogin(user);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('SYSTEM_USER_LOGIN_FORBIDDEN');
    });

    it('should refuse human users without password', () => {
      const user: User = {
        id: '4',
        email: 'invited@example.com',
        userType: 'human',
        passwordHash: null,
        status: 'active',
      };
      const result = shouldAllowWebLogin(user);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('NO_PASSWORD');
    });

    it('should refuse inactive human users', () => {
      const user: User = {
        id: '5',
        email: 'disabled@example.com',
        userType: 'human',
        passwordHash: 'hashed',
        status: 'disabled',
      };
      const result = shouldAllowWebLogin(user);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('USER_NOT_ACTIVE');
    });

    it('should refuse null user', () => {
      const result = shouldAllowWebLogin(null);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('USER_NOT_FOUND');
    });
  });

  describe('shouldAllowPasswordReset', () => {
    it('should allow human users', () => {
      const user: User = {
        id: '1',
        email: 'human@example.com',
        userType: 'human',
        passwordHash: 'hashed',
        status: 'active',
      };
      const result = shouldAllowPasswordReset(user);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should refuse system users', () => {
      const user: User = {
        id: '2',
        email: 'system@example.com',
        userType: 'system',
        passwordHash: null,
        status: 'active',
      };
      const result = shouldAllowPasswordReset(user);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('SYSTEM_USER_NO_PASSWORD_RESET');
    });

    it('should refuse inactive human users', () => {
      const user: User = {
        id: '3',
        email: 'disabled@example.com',
        userType: 'human',
        passwordHash: 'hashed',
        status: 'disabled',
      };
      const result = shouldAllowPasswordReset(user);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('USER_NOT_ACTIVE');
    });

    it('should refuse null user', () => {
      const result = shouldAllowPasswordReset(null);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('USER_NOT_FOUND');
    });
  });
});

/**
 * Test user exclusion filter logic for pickers and lists
 */
describe('System user exclusion filters', () => {
  type UserRow = {
    id: string;
    displayName: string;
    userType: 'human' | 'system';
    status: string;
  };

  function filterUsersForPicker(
    users: UserRow[],
    options: { includeSystemUsers?: boolean } = {},
  ): UserRow[] {
    return users.filter((user) => {
      if (user.status !== 'active') {
        return false;
      }
      if (!options.includeSystemUsers && user.userType === 'system') {
        return false;
      }
      return true;
    });
  }

  const sampleUsers: UserRow[] = [
    { id: '1', displayName: 'Alice Human', userType: 'human', status: 'active' },
    { id: '2', displayName: 'Bob Human', userType: 'human', status: 'active' },
    { id: '3', displayName: 'QA Bot', userType: 'system', status: 'active' },
    { id: '4', displayName: 'API Integration', userType: 'system', status: 'active' },
    { id: '5', displayName: 'Disabled Human', userType: 'human', status: 'disabled' },
  ];

  it('should exclude system users by default', () => {
    const result = filterUsersForPicker(sampleUsers);
    expect(result).toHaveLength(2);
    expect(result.every((u) => u.userType === 'human')).toBe(true);
    expect(result.map((u) => u.id)).toEqual(['1', '2']);
  });

  it('should include system users when explicitly requested', () => {
    const result = filterUsersForPicker(sampleUsers, { includeSystemUsers: true });
    expect(result).toHaveLength(4);
    expect(result.map((u) => u.id)).toEqual(['1', '2', '3', '4']);
  });

  it('should always exclude inactive users', () => {
    const result = filterUsersForPicker(sampleUsers, { includeSystemUsers: true });
    expect(result.every((u) => u.status === 'active')).toBe(true);
    expect(result.find((u) => u.id === '5')).toBeUndefined();
  });

  it('should return empty array when all users are system and not included', () => {
    const systemOnly: UserRow[] = [
      { id: '3', displayName: 'QA Bot', userType: 'system', status: 'active' },
      { id: '4', displayName: 'API Integration', userType: 'system', status: 'active' },
    ];
    const result = filterUsersForPicker(systemOnly);
    expect(result).toHaveLength(0);
  });
});

/**
 * Test serializer field inclusion
 */
describe('User serializer userType field', () => {
  type UserEntity = {
    id: string;
    email: string;
    displayName: string;
    userType: 'human' | 'system';
    status: string;
  };

  function serializeUser(user: UserEntity) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      userType: user.userType,
      status: user.status,
    };
  }

  it('should include userType field for human users', () => {
    const user: UserEntity = {
      id: '1',
      email: 'human@example.com',
      displayName: 'Human User',
      userType: 'human',
      status: 'active',
    };
    const result = serializeUser(user);
    expect(result.userType).toBe('human');
  });

  it('should include userType field for system users', () => {
    const user: UserEntity = {
      id: '2',
      email: 'system@example.com',
      displayName: 'System User',
      userType: 'system',
      status: 'active',
    };
    const result = serializeUser(user);
    expect(result.userType).toBe('system');
  });

  it('should preserve userType through serialization', () => {
    const users: UserEntity[] = [
      { id: '1', email: 'a@example.com', displayName: 'A', userType: 'human', status: 'active' },
      { id: '2', email: 'b@example.com', displayName: 'B', userType: 'system', status: 'active' },
    ];
    const serialized = users.map(serializeUser);
    expect(serialized[0].userType).toBe('human');
    expect(serialized[1].userType).toBe('system');
  });
});

/**
 * Test admin-only category change authorization
 */
describe('Admin-only category change authorization', () => {
  type Principal = {
    userId: string;
    isSystemAdmin: boolean;
  };

  function canChangeuserType(principal: Principal | null): boolean {
    if (!principal) {
      return false;
    }
    return principal.isSystemAdmin === true;
  }

  function validateCategoryChange(from: 'human' | 'system', to: 'human' | 'system'): {
    valid: boolean;
    reason?: string;
  } {
    if (from === to) {
      return { valid: false, reason: 'CATEGORY_UNCHANGED' };
    }
    return { valid: true };
  }

  it('should allow system admins to change category', () => {
    const admin: Principal = { userId: '1', isSystemAdmin: true };
    expect(canChangeuserType(admin)).toBe(true);
  });

  it('should deny non-admin users', () => {
    const user: Principal = { userId: '2', isSystemAdmin: false };
    expect(canChangeuserType(user)).toBe(false);
  });

  it('should deny null principal', () => {
    expect(canChangeuserType(null)).toBe(false);
  });

  it('should reject unchanged category', () => {
    const result = validateCategoryChange('human', 'human');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('CATEGORY_UNCHANGED');
  });

  it('should allow human to system', () => {
    const result = validateCategoryChange('human', 'system');
    expect(result.valid).toBe(true);
  });

  it('should allow system to human', () => {
    const result = validateCategoryChange('system', 'human');
    expect(result.valid).toBe(true);
  });
});

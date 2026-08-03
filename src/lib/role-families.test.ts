import { describe, expect, it } from 'vitest';
import { roleFamilyEnum } from '@/server/db/schema';
import { ROLE_FAMILIES } from './role-families';

describe('ROLE_FAMILIES', () => {
  it('matches the DB role_family enum exactly (order included)', () => {
    expect([...ROLE_FAMILIES]).toEqual([...roleFamilyEnum.enumValues]);
  });
});

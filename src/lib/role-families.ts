/**
 * Client-safe list of role families, mirroring the DB `role_family` enum
 * (`roleFamilyEnum` in schema.ts). Kept here so client components don't import
 * the Drizzle schema; `role-families.test.ts` pins it to the enum so the two
 * can never silently drift.
 */
export const ROLE_FAMILIES = [
  'frontend',
  'backend',
  'fullstack',
  'sre',
  'data',
  'ml',
  'mobile',
  'systems',
  'software',
  'other',
] as const;

export type RoleFamily = (typeof ROLE_FAMILIES)[number];

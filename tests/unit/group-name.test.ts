import { describe, expect, it } from 'vitest';
import { groupNameFor, readGroupName } from '@/lib/group-name';

const form = (name?: string) => {
  const f = new FormData();
  if (name !== undefined) f.set('groupName', name);
  return f;
};

describe('a group’s name in Messages (D-62)', () => {
  it('is tidied: invisible characters out, spaces squeezed', () => {
    expect(readGroupName(form('  Dinosaur​   party '))).toEqual({ name: 'Dinosaur party' });
  });
  it('may be left blank when making a group, but not when renaming one', () => {
    expect(readGroupName(form(''))).toEqual({ name: '' });
    expect(readGroupName(form())).toEqual({ name: '' });
    expect(readGroupName(form('   '), true)).toHaveProperty('error');
  });
  it('is up to 60 letters, and needs something you can see', () => {
    expect(readGroupName(form('n'.repeat(60)))).toEqual({ name: 'n'.repeat(60) });
    expect(readGroupName(form('n'.repeat(61)))).toHaveProperty('error');
    expect(readGroupName(form('ㅤㅤ'))).toHaveProperty('error');
  });
  it('left blank, is called by the date in Orillia', () => {
    expect(groupNameFor('', new Date('2026-10-25T15:00:00Z'))).toBe('Message all · 25 Oct');
    // Late evening in Orillia is still the 25th there, though it's the 26th in UTC.
    expect(groupNameFor('', new Date('2026-10-26T02:30:00Z'))).toBe('Message all · 25 Oct');
    expect(groupNameFor('Sophie’s shower')).toBe('Sophie’s shower');
  });
});

import { describe, it, expect } from 'vitest';
import { extractRepoName } from '../../src/shared/git.js';

describe('git utilities', () => {
  describe('extractRepoName', () => {
    it('extracts name from HTTPS URL with .git', () => {
      expect(extractRepoName('https://github.com/user/my-repo.git')).toBe('my-repo');
    });

    it('extracts name from HTTPS URL without .git', () => {
      expect(extractRepoName('https://github.com/user/my-repo')).toBe('my-repo');
    });

    it('extracts name from SSH URL', () => {
      expect(extractRepoName('git@github.com:user/my-repo.git')).toBe('my-repo');
    });

    it('extracts name from URL with trailing slash', () => {
      expect(extractRepoName('https://github.com/user/my-repo/')).toBe('my-repo');
    });

    it('handles nested paths', () => {
      expect(extractRepoName('https://gitlab.com/group/subgroup/repo.git')).toBe('repo');
    });

    it('throws on empty/invalid URL', () => {
      expect(() => extractRepoName('')).toThrow();
    });
  });
});

import { describe, expect, it } from 'vitest';
import { diffPacts, renderMarkdown } from '../../scripts/pact-diff';

const interaction = (description: string, path: string, status = 200) => ({
  description,
  request: { method: 'GET', path },
  response: { status, body: { ok: true } },
});

describe('pact diff', () => {
  it('classifies added, removed, and changed interactions', () => {
    const result = diffPacts(
      { interactions: [interaction('removed', '/removed'), interaction('changed', '/old')] },
      { interactions: [interaction('changed', '/new', 400), interaction('added', '/added')] },
    );
    expect(result.added.map((change) => change.current)).toEqual(['added']);
    expect(result.removed.map((change) => change.previous)).toEqual(['removed']);
    expect(result.changed[0]).toMatchObject({ previous: 'changed', current: 'changed', details: ['request', 'response'] });
    expect(result.breaking).toHaveLength(2);
  });

  it('detects description-only renames without marking them breaking', () => {
    const result = diffPacts(
      { interactions: [interaction('old name', '/same')] },
      { interactions: [interaction('new name', '/same')] },
    );
    expect(result.renamed).toEqual([{ kind: 'renamed', previous: 'old name', current: 'new name' }]);
    expect(result.breaking).toHaveLength(0);
  });

  it('escapes interaction names in Markdown', () => {
    const markdown = renderMarkdown(diffPacts({ interactions: [] }, { interactions: [interaction('a * risky * [name]', '/x')] }));
    expect(markdown).toContain('a \\* risky \\* \\[name\\]');
  });
});
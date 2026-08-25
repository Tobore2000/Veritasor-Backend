import fs from 'node:fs';

export interface PactInteraction {
  description?: string;
  providerState?: string;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
}

export interface PactDocument {
  interactions?: PactInteraction[];
}

export interface ContractChange {
  kind: 'added' | 'removed' | 'changed' | 'renamed';
  previous?: string;
  current?: string;
  details?: string[];
}

export interface ContractDiff {
  added: ContractChange[];
  removed: ContractChange[];
  changed: ContractChange[];
  renamed: ContractChange[];
  breaking: ContractChange[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function serialize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function interactionName(interaction: PactInteraction): string {
  return interaction.description?.trim() || '<unnamed interaction>';
}

function interactionKey(interaction: PactInteraction): string {
  return `${interaction.providerState ?? ''}\u0000${interactionName(interaction)}`;
}

function interactionFingerprint(interaction: PactInteraction): string {
  return serialize({ request: interaction.request ?? {}, response: interaction.response ?? {} });
}

function diffFields(previous: PactInteraction, current: PactInteraction): string[] {
  const fields: string[] = [];
  if (serialize(previous.request ?? {}) !== serialize(current.request ?? {})) fields.push('request');
  if (serialize(previous.response ?? {}) !== serialize(current.response ?? {})) fields.push('response');
  return fields;
}

export function diffPacts(previous: PactDocument, current: PactDocument): ContractDiff {
  const oldInteractions = previous.interactions ?? [];
  const newInteractions = current.interactions ?? [];
  const oldByKey = new Map(oldInteractions.map((interaction) => [interactionKey(interaction), interaction]));
  const newByKey = new Map(newInteractions.map((interaction) => [interactionKey(interaction), interaction]));
  const added: ContractChange[] = [];
  const removed: ContractChange[] = [];
  const changed: ContractChange[] = [];
  const renamed: ContractChange[] = [];

  for (const [key, interaction] of newByKey) {
    const previousInteraction = oldByKey.get(key);
    if (!previousInteraction) added.push({ kind: 'added', current: interactionName(interaction) });
    else {
      const details = diffFields(previousInteraction, interaction);
      if (details.length > 0) changed.push({ kind: 'changed', previous: interactionName(previousInteraction), current: interactionName(interaction), details });
    }
  }

  for (const [key, interaction] of oldByKey) {
    if (!newByKey.has(key)) removed.push({ kind: 'removed', previous: interactionName(interaction) });
  }

  for (const removal of [...removed]) {
    const previousInteraction = oldInteractions.find((interaction) => interactionName(interaction) === removal.previous);
    const matchingAddition = added.find((addition) => {
      const currentInteraction = newInteractions.find((interaction) => interactionName(interaction) === addition.current);
      return previousInteraction && currentInteraction && interactionFingerprint(previousInteraction) === interactionFingerprint(currentInteraction);
    });
    if (matchingAddition) {
      renamed.push({ kind: 'renamed', previous: removal.previous, current: matchingAddition.current });
      removed.splice(removed.indexOf(removal), 1);
      added.splice(added.indexOf(matchingAddition), 1);
    }
  }

  return { added, removed, changed, renamed, breaking: [...removed, ...changed] };
}

function markdownName(value: string): string {
  return value.replace(/[\\`*_{}\[\]()<>#+.!|]/g, '\\$&');
}

function renderSection(title: string, changes: ContractChange[]): string {
  if (changes.length === 0) return `### ${title}\n\n_None_\n`;
  return `### ${title}\n\n${changes.map((change) => {
    const label = change.previous && change.current ? `${markdownName(change.previous)} -> ${markdownName(change.current)}` : markdownName(change.previous ?? change.current ?? '');
    const suffix = change.details?.length ? ` (${change.details.join(' and ')} changed)` : '';
    return `- ${label}${suffix}`;
  }).join('\n')}\n`;
}

export function renderMarkdown(diff: ContractDiff): string {
  const status = diff.breaking.length > 0 ? 'Breaking changes detected' : 'No breaking changes detected';
  return [
    '<!-- pact-diff-report -->',
    `## Contract diff: ${status}`,
    '',
    renderSection('Added interactions', diff.added),
    renderSection('Removed interactions', diff.removed),
    renderSection('Changed interactions', diff.changed),
    renderSection('Renamed interactions', diff.renamed),
    '_Removed and changed interactions are treated as breaking. Added and renamed interactions are informational._',
    '',
  ].join('\n');
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  const previousPath = argument('--base');
  const currentPath = argument('--head');
  const outputPath = argument('--output');
  const failOnBreaking = process.argv.includes('--fail-on-breaking');
  if (!previousPath || !currentPath) throw new Error('Usage: pact-diff.ts --base <file> --head <file> [--output <file>] [--fail-on-breaking]');
  const diff = diffPacts(JSON.parse(fs.readFileSync(previousPath, 'utf8')), JSON.parse(fs.readFileSync(currentPath, 'utf8')));
  const markdown = renderMarkdown(diff);
  if (outputPath) fs.writeFileSync(outputPath, markdown);
  else process.stdout.write(markdown);
  if (failOnBreaking && diff.breaking.length > 0) process.exitCode = 1;
}
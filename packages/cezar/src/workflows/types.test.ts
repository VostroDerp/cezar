import { describe, expect, it } from 'vitest';
import { workflowStepDefSchema } from '@open-mercato/cezar-contract';
import { skillStackOf, workflowFileSchema, workflowStepSchema } from './types.ts';

describe('workflow reasoning effort', () => {
  it('parses a per-step reasoning effort from YAML-shaped workflow data', () => {
    const parsed = workflowFileSchema.parse({
      name: 'careful-implementation',
      steps: [{ id: 'implement', prompt: '{{task}}', reasoningEffort: 'high' }],
    });
    expect(parsed.steps?.[0]?.reasoningEffort).toBe('high');
  });

  it('does not serialize an effort-bearing step as the portable skills shorthand', () => {
    expect(skillStackOf([{ id: 'implement', skill: 'implement', prompt: '{{task}}', reasoningEffort: 'high' }])).toBeNull();
  });
});

describe('step sandbox', () => {
  it('validates both step schemas and preserves the skills shorthand distinction', () => {
    for (const schema of [workflowStepSchema, workflowStepDefSchema]) {
      for (const sandbox of ['read-only', 'no-network']) expect(schema.parse({ id: 'a', skill: 'review', sandbox })).toMatchObject({ sandbox });
      expect(schema.safeParse({ id: 'a', skill: 'review', sandbox: 'bad' }).success).toBe(false);
      expect(schema.safeParse({ id: 'a', command: 'true', sandbox: 'read-only' }).success).toBe(false);
    }
    expect(skillStackOf([{ id: 'a', skill: 'review', sandbox: 'read-only' }])).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { describeAuthoring } from '../../src/core/authoring';
import { AUTHORING_MODELS, authoringSchema } from '../../src/core/authoring/models';
import { examplesOf } from '../../src/core/authoring/examples';

describe('the examples', () => {
  it.each(AUTHORING_MODELS)('%s has at least one example, each valid for its schema and with a reading', (model) => {
    const examples = examplesOf(model);
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(example.title.length).toBeGreaterThan(0);
      expect(example.reading.length).toBeGreaterThan(0);
      const parsed = authoringSchema(model).safeParse(example.value);
      expect(parsed.success, `${model} / ${example.title}`).toBe(true);
    }
  });

  it('gives a scene example for every preset but the blank one, and a fight example for every combat preset', () => {
    expect(examplesOf('scene').length).toBe(8);
    expect(examplesOf('fight').length).toBe(7);
    expect(examplesOf('scene').map((e) => e.title)).not.toContain('Blank scene');
  });

  it("reads a scene aloud in the editor's own words", () => {
    const accept = examplesOf('scene').find((e) => e.title.includes('accepted'))!;
    expect(accept.reading).toMatch(/quest is accepted/i);
  });
});

describe('describeAuthoring', () => {
  it.each(AUTHORING_MODELS)('assembles the summary, schema, guide and examples for %s', (model) => {
    const out = describeAuthoring(model);
    expect(out.model).toBe(model);
    expect(out.summary.length).toBeGreaterThan(10);
    expect(typeof out.jsonSchema).toBe('object');
    expect(out.guide).toContain('## What it is');
    expect(out.examples.length).toBeGreaterThan(0);
    expect(JSON.stringify(out).length).toBeLessThan(60_000);
  });
});

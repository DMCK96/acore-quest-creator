import { z } from 'zod';

/**
 * What the CoA Content Tracker's candidate API sends (piece 2a, format `acqc-candidate/1`). The
 * shapes are checked on arrival: a tracker that sends something else fails with a clear message
 * instead of an import that half works.
 */

export const CANDIDATE_FORMAT = 'acqc-candidate/1';

export const candidateRowSchema = z
  .object({
    key: z.number().int(),
    title: z.string(),
    status: z.string(),
    tier: z.number().int(),
    tier_label: z.string(),
    top_blocker: z.string(),
    giver: z.string(),
    ender: z.string(),
    work: z.string(),
  })
  .passthrough();

export const candidateListSchema = z.object({ total: z.number().int(), rows: z.array(candidateRowSchema) });

export const candidateQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.string().max(50).optional(),
  tier: z.number().int().min(0).max(4).optional(),
  work: z.string().max(50).optional(),
  depsOnly: z.boolean().optional(),
  page: z.number().int().min(1).optional(),
});

const record = z.record(z.string(), z.unknown());

const payloadEntitySchema = z.object({ kind: z.enum(['npc', 'object']), entry: z.number().int(), how: z.string(), in_world: z.boolean() });

const payloadDependencySchema = z.object({
  kind: z.enum(['npc', 'object', 'item']),
  entry: z.number().int(),
  role: z.string(),
  in_world: z.boolean(),
  status: z.string(),
  record: record.nullable(),
});

export const candidatePayloadSchema = z.object({
  format: z.literal(CANDIDATE_FORMAT),
  quest: z.record(z.string(), z.union([record, z.array(record)])),
  givers: z.array(payloadEntitySchema),
  enders: z.array(payloadEntitySchema),
  dependencies: z.array(payloadDependencySchema),
  sources: record,
  evaluation: z.object({ status: z.string(), tier: z.number().int(), blockers: z.array(z.string()) }),
  tracker: record,
});

export const workStateSchema = z.object({ state: z.string(), notes: z.string() });

export type CandidateRow = z.infer<typeof candidateRowSchema>;
export type CandidateList = z.infer<typeof candidateListSchema>;
export type CandidateQuery = z.infer<typeof candidateQuerySchema>;
export type PayloadEntity = z.infer<typeof payloadEntitySchema>;
export type PayloadDependency = z.infer<typeof payloadDependencySchema>;
export type CandidatePayload = z.infer<typeof candidatePayloadSchema>;
export type WorkState = z.infer<typeof workStateSchema>;

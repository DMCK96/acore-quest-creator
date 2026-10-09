import { guideOf } from './guides';
import { examplesOf, type AuthoringExample } from './examples';
import { authoringSummary, jsonSchemaOf, type AuthoringModel } from './models';

export { AUTHORING_MODELS, authoringSchema, type AuthoringModel } from './models';
export type { AuthoringExample } from './examples';

/** Everything an assistant needs to author one model: what it is, its JSON Schema, a guide and worked examples. */
export function describeAuthoring(model: AuthoringModel): {
  model: AuthoringModel;
  summary: string;
  jsonSchema: Record<string, unknown>;
  guide: string;
  examples: AuthoringExample[];
} {
  return { model, summary: authoringSummary(model), jsonSchema: jsonSchemaOf(model), guide: guideOf(model), examples: examplesOf(model) };
}

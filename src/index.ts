// landermixer — deep prospect research from any LinkedIn URL.
// Library entry. See https://github.com/ShapeStudio/landermixer

export { research, nameFromLinkedinUrl } from "./research.js";
export type { ResearchOptions, ResearchDepth } from "./research.js";
export { researchMany } from "./batch.js";
export type { BatchOptions, BatchResult } from "./batch.js";
export {
  prospectResearchSchema,
  researchToolSchema,
  researchInputSchema,
  SCHEMA_VERSION,
} from "./schema.js";
export type {
  ProspectResearch,
  ResearchInput,
  Person,
  Company,
  Competitor,
  Commercials,
  Outreach,
} from "./schema.js";
export type { ProgressEvent, OnProgress } from "./anthropic.js";
export { DEFAULT_MODEL } from "./anthropic.js";

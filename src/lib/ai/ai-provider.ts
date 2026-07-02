/**
 * AI Provider — re-export shim. All AI calls route to claude-api (Claude
 * Sonnet 4.6). This module exists so consumers don't need to change their
 * imports if the underlying provider ever changes again.
 */

export {
  classifyEmail,
  extractProjectInfo,
  classifyDrawingDiscipline,
  classifyReputation,
  analyzeSpecifications,
  analyzeWaterSupplyDrawing,
  analyzeDuctRouteDrawing,
  analyzeMEPDrawing,
  analyzeElectricalDrawing,
  analyzeElectricalProcedure,
} from './claude-api';

export type AIProvider = 'anthropic' | string;
export type {
  ClassificationResult,
  ExtractionResult,
  AttachmentFile,
  DisciplineResult,
  ReputationResult,
  SpecRequirement,
  SpecAnalysisResult,
  WaterSupplyComponents,
  DuctRouteComponents,
  MEPComponentResult,
  HVACProcedureResult,
  ElectricalComponents,
  ElectricalDistributionBoard,
  ElectricalCable,
  ElectricalOutletCounts,
  ElectricalProcedureResult,
} from './claude-api';

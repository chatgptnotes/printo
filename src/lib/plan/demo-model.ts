// A tidy sample building used when /plan is opened with no project (or no estimate
// data), so the 3D view + cost panel are always presentable in a client meeting.
import type { ElectricalProcedureResult } from '@/lib/ai/ai-provider';
import { buildPlanModel } from './build-model';
import type { SvgPlanModel } from './types';

// Only the fields buildPlanModel reads are populated; the rest are irrelevant here.
export const DEMO_ELEC = {
  floor_labels: ['Basement 1', 'Ground', '1F', '2F'],
  floors_identified: 4,
  typical_floor_height_m: 3.4,
  drawing_scale: '1:100',
  scale_detected: true,
  confidence: 0.82,
  mdb_info: { tag: 'LVP-01', floor: 'Ground', rating_a: 1600, location: 'Ground LV Room' },
  smdb_inventory: [
    { id: 'SMDB-B1', floor: 'Basement 1', rating_a: 250, cable_size_from_mdb: '4C×95mm²' },
    { id: 'SMDB-GF', floor: 'Ground', rating_a: 400, cable_size_from_mdb: '4C×185mm²' },
    { id: 'SMDB-1F', floor: '1F', rating_a: 250, cable_size_from_mdb: '4C×95mm²' },
    { id: 'SMDB-2F', floor: '2F', rating_a: 250, cable_size_from_mdb: '4C×95mm²' },
  ],
  db_inventory: [
    { smdb_id: 'SMDB-B1', db_id: 'DB-B1-01', floor: 'Basement 1', rating_a: 63, cable_size: '4C×16mm²' },
    { smdb_id: 'SMDB-GF', db_id: 'DB-GF-01', floor: 'Ground', rating_a: 100, cable_size: '4C×35mm²' },
    { smdb_id: 'SMDB-GF', db_id: 'DB-GF-02', floor: 'Ground', rating_a: 63, cable_size: '4C×16mm²' },
    { smdb_id: 'SMDB-1F', db_id: 'DB-1F-01', floor: '1F', rating_a: 63, cable_size: '4C×10mm²' },
    { smdb_id: 'SMDB-1F', db_id: 'DB-1F-02', floor: '1F', rating_a: 63, cable_size: '4C×10mm²' },
    { smdb_id: 'SMDB-2F', db_id: 'DB-2F-01', floor: '2F', rating_a: 63, cable_size: '4C×10mm²' },
  ],
  cable_schedule: [
    { from: 'LVP-01', to: 'SMDB-B1', size_mm2: 95, length_m: 38, type: 'XLPE/SWA', circuit_description: 'Basement feeder', floor: 'Basement 1' },
    { from: 'LVP-01', to: 'SMDB-GF', size_mm2: 185, length_m: 18, type: 'XLPE/SWA', circuit_description: 'Ground feeder', floor: 'Ground' },
    { from: 'LVP-01', to: 'SMDB-1F', size_mm2: 95, length_m: 28, type: 'XLPE/SWA', circuit_description: '1F riser', floor: '1F' },
    { from: 'LVP-01', to: 'SMDB-2F', size_mm2: 95, length_m: 34, type: 'XLPE/SWA', circuit_description: '2F riser', floor: '2F' },
    { from: 'SMDB-B1', to: 'DB-B1-01', size_mm2: 16, length_m: 22, type: 'XLPE', circuit_description: 'Basement DB', floor: 'Basement 1' },
    { from: 'SMDB-GF', to: 'DB-GF-01', size_mm2: 35, length_m: 26, type: 'XLPE', circuit_description: 'Ground DB-01', floor: 'Ground' },
    { from: 'SMDB-GF', to: 'DB-GF-02', size_mm2: 16, length_m: 19, type: 'XLPE', circuit_description: 'Ground DB-02', floor: 'Ground' },
    { from: 'SMDB-1F', to: 'DB-1F-01', size_mm2: 10, length_m: 21, type: 'PVC', circuit_description: '1F DB-01', floor: '1F' },
    { from: 'SMDB-1F', to: 'DB-1F-02', size_mm2: 10, length_m: 24, type: 'PVC', circuit_description: '1F DB-02', floor: '1F' },
    { from: 'SMDB-2F', to: 'DB-2F-01', size_mm2: 10, length_m: 23, type: 'PVC', circuit_description: '2F DB-01', floor: '2F' },
  ],
  power_outlets: [
    { description: '13A switched socket', unit: 'No.', estimated_qty: 120 },
  ],
  lighting_fixtures: [
    { type_ref: 'B-01', description: 'LED recessed downlight', floor: 'Ground', qty: 64 },
    { type_ref: 'B-02', description: 'LED surface batten', floor: '1F', qty: 48 },
    { type_ref: 'B-02', description: 'LED surface batten', floor: '2F', qty: 48 },
    { type_ref: 'D-07', description: 'Bulkhead / utility light', floor: 'Basement 1', qty: 22 },
  ],
} as unknown as ElectricalProcedureResult;

export const DEMO_MODEL: SvgPlanModel = {
  ...buildPlanModel(DEMO_ELEC, { floors: 4, total_area_sqft: 12000, building_name: 'Demo Tower (sample)' }),
  isDemo: true,
};

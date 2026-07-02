import { supabaseAdmin } from '@/lib/storage/supabase';
import { YardstickStatus } from '@/lib/shared/types';

export interface YardstickComparison {
  status: YardstickStatus;
  totalMinAed: number;
  totalMaxAed: number;
  costPerSqft: number;
  marketMinPerSqft: number;
  marketMaxPerSqft: number;
  details: Array<{
    service_type: string;
    estimated_per_sqft: number;
    market_min: number;
    market_max: number;
    status: YardstickStatus;
  }>;
}

export async function compareYardstick(
  buildingType: string,
  totalAreaSqft: number,
  costPerSqft: number,
  serviceBreakdown: Array<{ service_type: string; total_aed: number }>
): Promise<YardstickComparison | null> {
  const { data: rates, error } = await supabaseAdmin
    .from('sabi_yardstick_rates')
    .select('*')
    .eq('building_type', buildingType);

  if (error || !rates || rates.length === 0) {
    return null;
  }

  const details = serviceBreakdown.map(svc => {
    const rate = rates.find(r => r.service_type === svc.service_type);
    const estimatedPerSqft = totalAreaSqft > 0 ? svc.total_aed / totalAreaSqft : 0;

    if (!rate) {
      return {
        service_type: svc.service_type,
        estimated_per_sqft: Math.round(estimatedPerSqft * 100) / 100,
        market_min: 0,
        market_max: 0,
        status: 'within_range' as YardstickStatus,
      };
    }

    let status: YardstickStatus = 'within_range';
    if (estimatedPerSqft < rate.min_aed_per_sqft) status = 'below_market';
    else if (estimatedPerSqft > rate.max_aed_per_sqft) status = 'above_market';

    return {
      service_type: svc.service_type,
      estimated_per_sqft: Math.round(estimatedPerSqft * 100) / 100,
      market_min: rate.min_aed_per_sqft,
      market_max: rate.max_aed_per_sqft,
      status,
    };
  });

  const marketMinPerSqft = rates.reduce((sum, r) => sum + r.min_aed_per_sqft, 0);
  const marketMaxPerSqft = rates.reduce((sum, r) => sum + r.max_aed_per_sqft, 0);
  const totalMinAed = Math.round(marketMinPerSqft * totalAreaSqft);
  const totalMaxAed = Math.round(marketMaxPerSqft * totalAreaSqft);

  let overallStatus: YardstickStatus = 'within_range';
  if (costPerSqft < marketMinPerSqft) overallStatus = 'below_market';
  else if (costPerSqft > marketMaxPerSqft) overallStatus = 'above_market';

  return {
    status: overallStatus,
    totalMinAed,
    totalMaxAed,
    costPerSqft,
    marketMinPerSqft,
    marketMaxPerSqft,
    details,
  };
}

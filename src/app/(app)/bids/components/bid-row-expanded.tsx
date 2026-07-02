'use client';

import Link from 'next/link';
import { Project } from '@/lib/shared/types';
import { formatDate, stripHtml, truncate, formatNumber } from '@/lib/shared/utils';
import { BUILDING_ICONS, BUILDING_TYPE_LABELS, REPUTATION_META } from '@/lib/shared/constants';
import {
  Mail, Building2, Layers, ParkingSquare, Ruler, SquareStack, ArrowUpRight,
  Zap, Check, X, Shield,
} from 'lucide-react';
import AddToFolderMenu from '@/components/master/add-to-folder-menu';

interface Props {
  project: Project;
  colSpan: number;
}

function InfoItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <Icon className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
      <span className="text-[11px] text-gray-500">{label}</span>
      <span className="text-[11px] font-medium text-gray-700 ml-auto">{value}</span>
    </div>
  );
}

function ExtractionCheck({ label, extracted }: { label: string; extracted: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {extracted
        ? <Check className="h-3 w-3 text-green-500" />
        : <X className="h-3 w-3 text-gray-300" />}
      <span className={`text-[11px] ${extracted ? 'text-gray-600' : 'text-gray-400'}`}>{label}</span>
    </div>
  );
}

export default function BidRowExpanded({ project, colSpan }: Props) {
  const snippet = project.email_snippet ? stripHtml(project.email_snippet) : null;
  const buildingIcon = BUILDING_ICONS[project.building_type || ''] || '';
  const buildingLabel = BUILDING_TYPE_LABELS[project.building_type || ''] || null;
  const rep = REPUTATION_META[project.reputation_class || 'unknown'] || REPUTATION_META.unknown;

  // Check if notes is displayable text (not JSON)
  let displayNotes: string | null = null;
  if (project.notes) {
    try { JSON.parse(project.notes); } catch { displayNotes = project.notes; }
  }

  const isProcessable = !['quotation_ready', 'sent', 'won', 'lost', 'declined'].includes(project.status);

  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <div className="bg-gray-50/80 border-t border-gray-100 px-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

            {/* Section 1: Email Preview */}
            <div className="md:col-span-1">
              <div className="flex items-center gap-1.5 mb-2">
                <Mail className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Email Preview</span>
              </div>
              {snippet ? (
                <p className="text-xs text-gray-600 leading-relaxed">{truncate(snippet, 200)}</p>
              ) : (
                <p className="text-xs text-gray-400 italic">No email preview available</p>
              )}
              <div className="mt-2 text-[10px] text-gray-400">
                <span>{project.email_from}</span>
                {project.email_date && <span className="ml-2">{formatDate(project.email_date)}</span>}
              </div>
              {displayNotes && (
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Notes</span>
                  <p className="text-xs text-gray-600 mt-0.5">{truncate(displayNotes, 120)}</p>
                </div>
              )}
            </div>

            {/* Section 2: Building Specs */}
            <div className="md:col-span-1">
              <div className="flex items-center gap-1.5 mb-2">
                <Building2 className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Building Specs</span>
              </div>
              <div className="space-y-0.5">
                {buildingLabel && (
                  <InfoItem icon={Building2} label="Type" value={`${buildingIcon} ${buildingLabel}`} />
                )}
                {project.floors != null && (
                  <InfoItem icon={Layers} label="Floors" value={
                    project.parking_floors
                      ? `${project.floors} + ${project.parking_floors}P`
                      : `${project.floors}`
                  } />
                )}
                {project.typical_floors != null && (
                  <InfoItem icon={SquareStack} label="Typical" value={`${project.typical_floors}`} />
                )}
                {project.area_per_floor_sqft != null && (
                  <InfoItem icon={Ruler} label="Area/Floor" value={`${formatNumber(project.area_per_floor_sqft)} sqft`} />
                )}
                {project.total_area_sqft != null && (
                  <InfoItem icon={Ruler} label="Total Area" value={`${formatNumber(project.total_area_sqft)} sqft`} />
                )}
                {project.typical_height_m != null && (
                  <InfoItem icon={ArrowUpRight} label="Height" value={`${project.typical_height_m}m`} />
                )}
                {!buildingLabel && project.floors == null && project.total_area_sqft == null && (
                  <p className="text-xs text-gray-400 italic">No building data extracted yet</p>
                )}
              </div>
            </div>

            {/* Section 3: Extraction Status */}
            <div className="md:col-span-1">
              <div className="flex items-center gap-1.5 mb-2">
                <Shield className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Extraction Status</span>
              </div>
              <div className="space-y-1">
                <ExtractionCheck label="Building type" extracted={!!project.building_type} />
                <ExtractionCheck label="Location" extracted={!!project.location} />
                <ExtractionCheck label="Floors" extracted={project.floors != null} />
                <ExtractionCheck label="Total area" extracted={project.total_area_sqft != null} />
                <ExtractionCheck label="Floor height" extracted={project.typical_height_m != null} />
                <ExtractionCheck label="Client name" extracted={!!project.client_name} />
                <ExtractionCheck label="Deadline" extracted={!!project.deadline} />
              </div>
              {project.reputation_class && (
                <div className="mt-3">
                  <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${rep.bgColor} ${rep.color}`}>
                    {rep.label}
                  </span>
                </div>
              )}
            </div>

            {/* Section 4: Quick Actions */}
            <div className="md:col-span-1 flex flex-col items-start md:items-end justify-between">
              <div className="flex items-center gap-1.5 mb-2 md:self-start">
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Actions</span>
              </div>
              <div className="flex flex-col gap-2 w-full md:w-auto">
                {isProcessable && (
                  <Link href={`/bids/${project.id}`}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    <Zap className="h-3.5 w-3.5" /> Process Project
                  </Link>
                )}
                <Link href={`/bids/${project.id}`}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                  View Details
                </Link>
                <AddToFolderMenu descriptor={{ source: 'bid', projectId: project.id }} className="w-full md:w-auto" />
              </div>
            </div>

          </div>
        </div>
      </td>
    </tr>
  );
}

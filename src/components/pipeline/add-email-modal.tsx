'use client';

import { useState, useRef } from 'react';
import { X, Send, Loader2, Plus, ImagePlus, Paperclip, Trash2 } from 'lucide-react';

interface AddEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}

interface AttachmentEntry {
  filename: string;
  size: number;
  mimeType: string;
}

const SAMPLE_TEMPLATES: Record<string, { label: string; emoji: string; from: string; subject: string; body: string; attachments: AttachmentEntry[] }> = {
  office: {
    label: 'Office Tower',
    emoji: '🏢',
    from: 'procurement@alzahra-properties.ae',
    subject: 'RFQ — MEP Works for Al Zahra Commercial Tower, JLT (B+2P+18F), Please Quote',
    body: `Dear ERP Realsoft Estimation Team,

We are pleased to invite you to submit your best price for the MEP supply and installation works for the following project:

Project: Al Zahra Commercial Tower
Location: JLT (Jumeirah Lake Towers), Dubai
Client: Al Zahra Properties LLC
Consultant: KEO International Consultants

Building Details:
- Type: Office / Commercial Tower
- Configuration: Basement + 2 Parking + 18 Typical Floors + Roof
- Total Floors: 21 (including 2 parking levels)
- Area per Floor: 3,200 sqft
- Total Built-Up Area: 72,000 sqft
- Typical Floor Height: 3.4m
- Basement Height: 4.2m

Scope of Work:
1. HVAC Supply & Installation (VRF System)
2. Electrical Works (LV & ELV)
3. Plumbing & Drainage
4. Fire Fighting & Fire Alarm
5. BMS Integration

Please find attached the tender drawings (AutoCAD + PDF) and specifications. Kindly note the submission deadline is 25 April 2026.

Best regards,
Mohammed Al Rashid
Procurement Manager
Al Zahra Properties LLC`,
    attachments: [
      { filename: 'MEP_Tender_Drawings.zip', mimeType: 'application/zip', size: 45000000 },
      { filename: 'HVAC_Equipment_Schedule.pdf', mimeType: 'application/pdf', size: 2400000 },
      { filename: 'Thermal_Load_Calculation.pdf', mimeType: 'application/pdf', size: 1800000 },
      { filename: 'Electrical_SLD.dwg', mimeType: 'application/acad', size: 8500000 },
      { filename: 'Plumbing_Layout.dwg', mimeType: 'application/acad', size: 6200000 },
      { filename: 'Fire_Fighting_Layout.pdf', mimeType: 'application/pdf', size: 3100000 },
      { filename: 'BOQ_Template.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 520000 },
      { filename: 'Specifications_MEP.pdf', mimeType: 'application/pdf', size: 12000000 },
    ],
  },
  villa: {
    label: 'Villa Cluster',
    emoji: '🏡',
    from: 'tenders@palmvillas-dev.ae',
    subject: 'Invitation to Bid — Palm Villas Phase 3, MEP Works (12 Villas), Dubai Hills',
    body: `Dear Estimation Team,

We invite ERP Realsoft to submit a competitive quotation for MEP works at our new villa cluster development:

Project: Palm Villas Phase 3
Location: Dubai Hills Estate
Client: Palm Villas Development LLC
Consultant: Dar Al Handasah

Building Details:
- Type: Residential Villa Cluster
- Units: 12 Villas (4-Bedroom, G+1)
- Area per Villa: 4,500 sqft
- Total Built-Up Area: 54,000 sqft
- Typical Floor Height: 3.2m
- Each villa includes private pool plant room

Scope of Work:
1. HVAC — Split Unit Systems (per villa)
2. Electrical — LV Distribution, Lighting, ELV
3. Plumbing — Hot/Cold Water, Drainage, Pool Piping
4. Fire Alarm System
5. LPG Gas Distribution

Submission Deadline: 30 April 2026

Please find tender documents attached.

Best regards,
Sarah Al Maktoum
Senior Contracts Manager
Palm Villas Development LLC
Tel: +971 4 888 5678`,
    attachments: [
      { filename: 'Villa_MEP_Drawings.zip', mimeType: 'application/zip', size: 32000000 },
      { filename: 'Villa_Typical_HVAC_Layout.pdf', mimeType: 'application/pdf', size: 1500000 },
      { filename: 'Electrical_Distribution_Board.pdf', mimeType: 'application/pdf', size: 900000 },
      { filename: 'Plumbing_Isometric.dwg', mimeType: 'application/acad', size: 4200000 },
      { filename: 'Pool_Plant_Room_Layout.pdf', mimeType: 'application/pdf', size: 1100000 },
      { filename: 'LPG_Schematic.pdf', mimeType: 'application/pdf', size: 650000 },
    ],
  },
  hotel: {
    label: 'Hotel',
    emoji: '🏨',
    from: 'projects@marinabay-hotels.ae',
    subject: 'RFQ: MEP Services — Marina Bay Hotel & Serviced Apartments (2B+G+30F)',
    body: `Dear ERP Realsoft MEP Team,

Marina Bay Hotels & Resorts invites your quotation for a full MEP package for our flagship property:

Project: Marina Bay Hotel & Serviced Apartments
Location: Dubai Marina, Plot MB-207
Client: Marina Bay Hotels & Resorts
Consultant: WSP Middle East

Building Details:
- Type: 5-Star Hotel + Serviced Apartments
- Configuration: 2 Basements + Ground + 30 Floors + Roof (Helipad)
- Total Floors: 33
- Area per Floor: 8,500 sqft
- Total Built-Up Area: 280,000 sqft
- Typical Floor Height: 3.6m
- Basement: 4.5m (chiller plant in B2)
- Includes: Ballroom, spa, 3 restaurants, rooftop pool

Scope of Work:
1. HVAC — Chiller System (water-cooled, 1200 TR)
2. Electrical — HV/LV, Generator, UPS, Lightning Protection
3. Plumbing — Domestic, Hot Water, Swimming Pool, Kitchen Grease Trap
4. Fire Fighting — Sprinklers, Hydrants, FM200 for Server Room
5. Fire Alarm & PA System
6. BMS — Full Building Management Integration
7. Drainage — Storm Water, Sewage, Grease Interceptors

Submission Deadline: 15 May 2026. Site visit on 20 April 2026.

Best regards,
Khalid Hassan
VP — Projects
Marina Bay Hotels & Resorts
Tel: +971 4 777 9012`,
    attachments: [
      { filename: 'Hotel_Full_MEP_Package.zip', mimeType: 'application/zip', size: 120000000 },
      { filename: 'Chiller_Plant_Layout_B2.pdf', mimeType: 'application/pdf', size: 5600000 },
      { filename: 'HVAC_Thermal_Load_Summary.pdf', mimeType: 'application/pdf', size: 3200000 },
      { filename: 'Equipment_Schedule_HVAC.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 980000 },
      { filename: 'Electrical_SLD_HV_LV.dwg', mimeType: 'application/acad', size: 15000000 },
      { filename: 'Plumbing_Riser_Diagram.dwg', mimeType: 'application/acad', size: 7800000 },
      { filename: 'Fire_Fighting_Sprinkler_Layout.pdf', mimeType: 'application/pdf', size: 4100000 },
      { filename: 'BMS_Architecture_Diagram.pdf', mimeType: 'application/pdf', size: 2300000 },
      { filename: 'BOQ_Template_Hotel.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 750000 },
      { filename: 'MEP_Specifications_Vol1.pdf', mimeType: 'application/pdf', size: 25000000 },
    ],
  },
  warehouse: {
    label: 'Warehouse',
    emoji: '🏭',
    from: 'procurement@gulflogistics.ae',
    subject: 'RFQ — MEP for Gulf Logistics Warehouse Complex, JAFZA (3 Units)',
    body: `Dear Sir/Madam,

Gulf Logistics LLC requires MEP quotation for our new warehouse complex:

Project: Gulf Logistics Warehouse Complex
Location: JAFZA (Jebel Ali Free Zone), Dubai
Client: Gulf Logistics LLC
Consultant: Aecom Middle East

Building Details:
- Type: Logistics Warehouse + Office Block
- Units: 3 Warehouse Units + 1 Admin Office Block
- Warehouse Unit: 25,000 sqft each (75,000 sqft total)
- Office Block: 5,000 sqft (G+1)
- Total Area: 80,000 sqft
- Warehouse Height: 10m clear
- Office Height: 3.2m per floor

Scope of Work:
1. HVAC — Package Units for warehouse, Split Units for office
2. Electrical — Industrial Power, Lighting (High Bay LED), Fire Alarm
3. Plumbing — Washrooms, Pantry, External Drainage
4. Fire Fighting — Sprinkler system (Warehouse), Extinguishers

Deadline: 10 May 2026.

Regards,
Ahmed Bin Saud
Procurement Director
Gulf Logistics LLC`,
    attachments: [
      { filename: 'Warehouse_MEP_Drawings.zip', mimeType: 'application/zip', size: 28000000 },
      { filename: 'Warehouse_HVAC_Layout.pdf', mimeType: 'application/pdf', size: 1800000 },
      { filename: 'High_Bay_Lighting_Layout.pdf', mimeType: 'application/pdf', size: 1200000 },
      { filename: 'Power_Distribution_SLD.dwg', mimeType: 'application/acad', size: 5500000 },
      { filename: 'Fire_Sprinkler_Layout.pdf', mimeType: 'application/pdf', size: 2100000 },
    ],
  },
  hospital: {
    label: 'Hospital',
    emoji: '🏥',
    from: 'projects@dhcc-healthcare.ae',
    subject: 'Tender: MEP Works — DHCC Medical Center Expansion (B+G+5F), Urgent',
    body: `URGENT — Tender Invitation

Dear ERP Realsoft Estimation Team,

We urgently require your best quotation for MEP works on our medical center expansion:

Project: DHCC Medical Center — Phase 2 Expansion
Location: Dubai Healthcare City (DHCC)
Client: DHCC Healthcare Group
Consultant: Bureau Veritas

Building Details:
- Type: Healthcare / Medical Center
- Configuration: Basement + Ground + 5 Floors
- Total Floors: 7
- Area per Floor: 6,000 sqft
- Total Built-Up Area: 42,000 sqft
- Typical Floor Height: 4.0m (medical grade)
- Basement: Parking + Medical Gas Plant Room
- Includes: 2 Operating Theaters, ICU, Pharmacy, Lab

Scope of Work:
1. HVAC — Chiller System with HEPA filtration for OT/ICU (250 TR)
2. Electrical — Essential Power, Normal Power, UPS for Critical Areas
3. Plumbing — Medical Gas (O2, N2O, Vacuum), Hot/Cold Water
4. Fire Fighting — Sprinklers, Clean Agent for Server/Pharmacy
5. Fire Alarm — Addressable System with Nurse Call Integration
6. BMS — Full monitoring with medical alert integration

CRITICAL: OT and ICU areas require 100% fresh air with HEPA H14 filtration.

Submission Deadline: 20 April 2026 (STRICT — no extensions).

Best regards,
Dr. Fatima Al Marzouqi
Director of Projects
DHCC Healthcare Group`,
    attachments: [
      { filename: 'Medical_Center_MEP.zip', mimeType: 'application/zip', size: 65000000 },
      { filename: 'OT_HVAC_AHU_Schedule.pdf', mimeType: 'application/pdf', size: 3800000 },
      { filename: 'Medical_Gas_Piping.dwg', mimeType: 'application/acad', size: 9200000 },
      { filename: 'Electrical_Essential_Power.pdf', mimeType: 'application/pdf', size: 2700000 },
      { filename: 'Clean_Room_Specifications.pdf', mimeType: 'application/pdf', size: 4500000 },
      { filename: 'Fire_Alarm_Addressable.pdf', mimeType: 'application/pdf', size: 1900000 },
      { filename: 'BMS_Points_List.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 420000 },
    ],
  },
};

export default function AddEmailModal({ isOpen, onClose, onAdded }: AddEmailModalProps) {
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<AttachmentEntry[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [newAttName, setNewAttName] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const loadTemplate = (key: string) => {
    const t = SAMPLE_TEMPLATES[key];
    if (!t) return;
    setFrom(t.from);
    setSubject(t.subject);
    setBody(t.body);
    setAttachments(t.attachments);
    setImages([]);
    setError(null);
  };

  if (!isOpen) return null;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });

    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const addAttachment = () => {
    if (!newAttName.trim()) return;
    const ext = newAttName.split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      zip: 'application/zip',
      dwg: 'application/acad',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      png: 'image/png',
      jpg: 'image/jpeg',
    };
    setAttachments((prev) => [
      ...prev,
      {
        filename: newAttName.trim(),
        mimeType: mimeMap[ext] || 'application/octet-stream',
        size: Math.floor(Math.random() * 10000000) + 500000,
      },
    ]);
    setNewAttName('');
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!from || !subject || !body) {
      setError('From, Subject, and Body are required.');
      return;
    }

    setSending(true);
    setError(null);

    try {
      // Build HTML body with inline images
      let htmlBody = body.replace(/\n/g, '<br/>');
      if (images.length > 0) {
        htmlBody += '<br/><hr style="margin: 16px 0; border: none; border-top: 1px solid #e5e7eb;"/>';
        htmlBody += '<p style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">Attached Images:</p>';
        htmlBody += '<div style="display: flex; flex-wrap: wrap; gap: 8px;">';
        images.forEach((img, i) => {
          htmlBody += `<img src="${img}" alt="Attachment ${i + 1}" style="max-width: 400px; max-height: 300px; border-radius: 8px; border: 1px solid #e5e7eb;" />`;
        });
        htmlBody += '</div>';
      }

      const res = await fetch('/api/gmail/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          subject,
          emailBody: `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">${htmlBody}</div>`,
          attachments,
          images,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add email');
      }

      // Reset form
      setFrom('');
      setSubject('');
      setBody('');
      setAttachments([]);
      setImages([]);
      onAdded();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add email';
      setError(message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-lg sm:rounded-xl shadow-xl w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Add Test Email</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Create a demo RFQ email for local testing
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Quick-load templates */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Quick Load Sample RFQ</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(SAMPLE_TEMPLATES).map(([key, t]) => (
                <button key={key} onClick={() => loadTemplate(key)}
                  className="px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-medium hover:bg-amber-100 transition-colors">
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* From */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From (sender email)</label>
            <input
              type="text"
              placeholder="e.g. procurement@client-company.ae"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
            <input
              type="text"
              placeholder="e.g. RFQ — MEP Works for Project Name"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Email Body <span className="text-gray-400">(plain text — HTML tags allowed)</span>
            </label>
            <textarea
              placeholder="Dear ERP Realsoft Team,&#10;&#10;Please quote your best price for MEP works..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono"
            />
          </div>

          {/* Attachments */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">
              <Paperclip className="h-3.5 w-3.5 inline mr-1" />
              Attachments (filenames only — for display)
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                placeholder="e.g. MEP_Drawings.zip"
                value={newAttName}
                onChange={(e) => setNewAttName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addAttachment()}
                className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={addAttachment}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((att, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700"
                  >
                    <Paperclip className="h-3 w-3 text-gray-400" />
                    {att.filename}
                    <button
                      onClick={() => removeAttachment(i)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Images */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">
              <ImagePlus className="h-3.5 w-3.5 inline mr-1" />
              Images (inline in email body)
            </label>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
            />
            <button
              onClick={() => imageInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:border-gray-400 transition-colors w-full justify-center"
            >
              <ImagePlus className="h-4 w-4" />
              Upload Images (drawings, photos, screenshots)
            </button>
            {images.length > 0 && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                {images.map((img, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={img}
                      alt={`Upload ${i + 1}`}
                      className="w-full h-32 object-cover rounded-lg border border-gray-200"
                    />
                    <button
                      onClick={() => removeImage(i)}
                      className="absolute top-1.5 right-1.5 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={sending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Add Email
          </button>
        </div>
      </div>
    </div>
  );
}

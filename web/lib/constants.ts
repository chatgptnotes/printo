// Ported verbatim from the Streamlit frontend so the Next.js UI stays at parity.

export const FLOOR_CATEGORIES = [
  "Ground Floor",
  "First Floor",
  "Second Floor",
  "Third Floor",
  "Fourth Floor",
  "Basement",
  "Terrace / Roof",
  "Kitchen",
  "Other",
];

export const MARQUEE_TAGS = [
  "Title Block",
  "Drawing Number",
  "Floor Area",
  "Room Schedule",
  "Dimensions",
  "Materials",
  "Approval Stamp",
  "Revision",
  "Scale",
  "Door / Window Count",
  "Grid Lines",
  "North Arrow",
  "18 Validation Rules",
  "RealSoft ERP",
];

export interface Sample {
  file: string;
  label: string;
  floor: string;
  icon: string;
}

export const SAMPLE_DRAWINGS: Sample[] = [
  { file: "ground_floor_plan.png", label: "Ground Floor Plan", floor: "Ground Floor", icon: "🏠" },
  { file: "first_floor_plan.png", label: "First Floor Plan", floor: "First Floor", icon: "🏢" },
  { file: "basement_plan.png", label: "Basement Plan", floor: "Basement", icon: "🅿️" },
];

export const STEP_CARDS = [
  { n: "1", title: "Upload", body: "Drop an approved construction drawing (PDF or image)." },
  { n: "2", title: "AI Extract", body: "Claude Vision reads the title block, plan, dimensions and stamps." },
  { n: "3", title: "Validate", body: "18 rules check completeness, confidence and format." },
  { n: "4", title: "Push to ERP", body: "Mapped to RealSoft format and pushed — with a full report." },
];

// field key -> display label, grouped
export const FIELD_GROUPS: Record<string, [string, string][]> = {
  "📋 Title Block": [
    ["drawing_number", "Drawing Number"],
    ["drawing_title", "Drawing Title"],
    ["project_name", "Project Name"],
    ["project_location", "Project Location"],
    ["client_name", "Client Name"],
    ["contractor_name", "Contractor Name"],
    ["date_of_issue", "Date of Issue"],
    ["revision_number", "Revision Number"],
    ["sheet_number", "Sheet Number"],
    ["total_sheets", "Total Sheets"],
    ["scale", "Scale"],
  ],
  "🏠 Floor Plan Info": [
    ["floor_level", "Floor Level"],
    ["total_floor_area", "Total Floor Area"],
    ["building_type", "Building Type"],
    ["number_of_rooms", "Number of Rooms"],
    ["door_count", "Door Count"],
    ["window_count", "Window Count"],
    ["dimensions", "Dimensions"],
  ],
  "👷 Participants": [
    ["drawn_by", "Drawn By"],
    ["checked_by", "Checked By"],
    ["approved_by", "Approved By"],
  ],
  "🔧 Technical": [
    ["structural_notes", "Structural Notes"],
    ["materials", "Materials"],
    ["quantities", "Quantities"],
    ["approval_stamp", "Approval Stamp"],
    ["north_arrow", "North Arrow"],
    ["grid_lines", "Grid Lines"],
    ["additional_notes", "Additional Notes"],
  ],
};

export const HEAT_LABELS: Record<string, string> = {
  drawing_number: "Drawing No.",
  drawing_title: "Title",
  project_name: "Project",
  floor_level: "Floor",
  total_floor_area: "Area",
  scale: "Scale",
  revision_number: "Revision",
  approval_stamp: "Stamp",
  dimensions: "Dimensions",
  materials: "Materials",
  room_schedule: "Rooms",
  building_type: "Type",
  client_name: "Client",
  date_of_issue: "Date",
};

export const TABS = ["Upload", "Results", "Report", "History"] as const;

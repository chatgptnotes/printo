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

// Drawing discipline — drives the rigorous, per-discipline take-off reading.
// "Auto-detect" lets the AI classify the sheets itself.
export const DISCIPLINES = [
  "Auto-detect",
  "Electrical",
  "Industrial",
  "Civil / Structural",
  "Plumbing & MEP",
  "General",
];

export const MARQUEE_TAGS = [
  "Title Block",
  "Drawing Number",
  "BOQ Items",
  "Trade Sections",
  "Dimensions",
  "Materials",
  "Rates",
  "Revision",
  "Scale",
  "Quantities",
  "Excel Export",
  "Fresh Extraction",
  "AI Take-off",
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
  { n: "1", title: "Upload", body: "Upload a drawing set or file for a fresh AI take-off." },
  { n: "2", title: "AI Extract", body: "Codex Vision reads the sheets and extracts title-block and scope data." },
  { n: "3", title: "Generate BOQ", body: "The system builds trade sections, BOQ rows, quantities, rates and references." },
  { n: "4", title: "Review & Approve", body: "Review and edit the BOQ, then approve it for ERP/export." },
];

// field key -> display label, grouped
export const FIELD_GROUPS: Record<string, [string, string][]> = {
  "📋 Title Block": [
    ["drawing_number", "Drawing Number"],
    ["drawing_title", "Drawing Title"],
    ["project_name", "Project Name"],
    ["project_location", "Project Location"],
    ["plot_number", "Plot No."],
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

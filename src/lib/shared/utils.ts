// SABI Pipeline Utility Functions

export function formatAED(amount: number | null | undefined): string {
  if (amount == null) return '-';
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(num: number | null | undefined): string {
  if (num == null) return '-';
  return new Intl.NumberFormat('en-AE').format(num);
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(dateStr);
}

export function priorityColor(priority: string): string {
  const colors: Record<string, string> = {
    priority_top: 'bg-red-100 text-red-800 border-red-200',
    priority_gen: 'bg-amber-100 text-amber-800 border-amber-200',
    new: 'bg-blue-100 text-blue-800 border-blue-200',
    ignore: 'bg-gray-100 text-gray-500 border-gray-200',
  };
  return colors[priority] || colors.new;
}

export function statusColor(status: string): string {
  const colors: Record<string, string> = {
    new: 'bg-blue-100 text-blue-800',
    classified: 'bg-indigo-100 text-indigo-800',
    extracting: 'bg-yellow-100 text-yellow-800',
    extracted: 'bg-purple-100 text-purple-800',
    quote_decision: 'bg-amber-100 text-amber-800',
    fast_pricing: 'bg-orange-100 text-orange-800',
    detailed_decision: 'bg-amber-100 text-amber-800',
    services_identified: 'bg-cyan-100 text-cyan-800',
    estimating: 'bg-yellow-100 text-yellow-800',
    estimated: 'bg-teal-100 text-teal-800',
    consent_pending: 'bg-amber-100 text-amber-800',
    yardstick_checked: 'bg-emerald-100 text-emerald-800',
    quotation_ready: 'bg-green-100 text-green-800',
    sent: 'bg-green-200 text-green-900',
    won: 'bg-green-300 text-green-900',
    lost: 'bg-red-100 text-red-800',
    declined: 'bg-gray-100 text-gray-600',
  };
  return colors[status] || colors.new;
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    new: 'New',
    classified: 'Classified',
    extracting: 'Extracting...',
    extracted: 'Info Extracted',
    quote_decision: 'Prepare Quote?',
    fast_pricing: 'Fast Pricing',
    detailed_decision: 'Detailed?',
    services_identified: 'Services ID\'d',
    estimating: 'Estimating...',
    estimated: 'Estimated',
    consent_pending: 'Awaiting Consent',
    yardstick_checked: 'Yardstick OK',
    quotation_ready: 'Quote Ready',
    sent: 'Sent',
    won: 'Won',
    lost: 'Lost',
    declined: 'Declined',
  };
  return labels[status] || status;
}

export function statusToStep(status: string): number {
  // 14-step electrical pipeline mapping
  const map: Record<string, number> = {
    new: 1, pending: 1,
    classified: 2, extracting: 3, extracted: 4,
    project_info_pending: 4, scope_pending: 5,
    services_identified: 5, estimating: 6, estimated: 13,
    pricing_pending: 14, boq_ready: 14,
    // Legacy / unused statuses
    quote_decision: 9, fast_pricing: 10, detailed_decision: 9,
    total_pending: 13, consent_pending: 13,
    yardstick_checked: 13, quotation_ready: 13,
    send_pending: 14, sent: 14, won: 14, lost: 14, declined: 4,
  };
  return map[status] || 1;
}

export function truncate(text: string, length: number = 80): string {
  if (text.length <= length) return text;
  return text.slice(0, length) + '...';
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

export function classifyFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['dwg', 'dxf'].includes(ext)) return 'drawing_autocad';
  if (ext === 'pdf') return 'drawing_pdf';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'schedule_excel';
  if (['doc', 'docx'].includes(ext)) return 'specification';
  if (['zip', 'rar', '7z'].includes(ext)) return 'archive_zip';
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'].includes(ext)) return 'image';
  return 'other';
}

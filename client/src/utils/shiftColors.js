// Maps legacy color names (stored in DB seeds) to HEX values
const COLOR_NAME_TO_HEX = {
  blue:   '#3B82F6',
  indigo: '#6366F1',
  amber:  '#F59E0B',
  yellow: '#EAB308',
  green:  '#22C55E',
  cyan:   '#06B6D4',
  sky:    '#0EA5E9',
  red:    '#EF4444',
  purple: '#A855F7',
  teal:   '#14B8A6',
  orange: '#F97316',
  slate:  '#64748B',
  gray:   '#9CA3AF',
  pink:   '#EC4899',
};

const DEFAULT_HEX = '#94A3B8'; // slate-400

export function resolveColor(raw) {
  if (!raw) return DEFAULT_HEX;
  if (raw.startsWith('#')) return raw;
  return COLOR_NAME_TO_HEX[raw.toLowerCase()] || DEFAULT_HEX;
}

// Light tinted background (for shift cells)
export function getShiftStyle(colorRaw) {
  const hex = resolveColor(colorRaw);
  return {
    backgroundColor: hex + '20',
    color: hex,
    borderColor: hex + '50',
  };
}

// Solid background (for selected state in type pickers)
export function getShiftStyleSelected(colorRaw) {
  const hex = resolveColor(colorRaw);
  return {
    backgroundColor: hex,
    color: '#ffffff',
    borderColor: hex,
  };
}

// Build a name→shiftType lookup from the shiftTypes array
export function buildShiftTypeMap(shiftTypes) {
  return Object.fromEntries((shiftTypes || []).map(t => [t.name, t]));
}

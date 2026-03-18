import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

/**
 * SortableHeader — drop-in replacement for <th> with click-to-sort
 *
 * Usage:
 *   const { sorted, sortKey, sortDir, toggle } = useSort(data, 'last_name');
 *
 *   <SortableHeader label="Name"    sortKey="last_name"  currentKey={sortKey} direction={sortDir} onSort={toggle} className="text-left w-40" />
 *   <SortableHeader label="Date"    sortKey="created_at" currentKey={sortKey} direction={sortDir} onSort={toggle} />
 */
export default function SortableHeader({ label, sortKey, currentKey, direction, onSort, className = '' }) {
  const active = currentKey === sortKey;

  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`bg-slate-100 cursor-pointer select-none group transition-colors hover:bg-blue-50 ${className}`}
    >
      <div className="flex items-center gap-1 px-3 py-2.5 whitespace-nowrap">
        <span className={`text-xs font-medium uppercase tracking-wide ${active ? 'text-blue-600' : 'text-gray-700 group-hover:text-blue-600'}`}>
          {label}
        </span>
        <span className="flex-shrink-0">
          {active
            ? direction === 'asc'
              ? <ChevronUp size={11} className="text-blue-600" />
              : <ChevronDown size={11} className="text-blue-600" />
            : <ChevronsUpDown size={11} className="text-gray-400 group-hover:text-blue-400 transition-colors" />
          }
        </span>
      </div>
    </th>
  );
}

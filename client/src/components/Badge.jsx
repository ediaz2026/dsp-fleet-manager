import clsx from 'clsx';

const variants = {
  present:        'bg-green-100 text-green-700',
  active:         'bg-green-100 text-green-700',
  matched:        'bg-green-100 text-green-700',
  completed:      'bg-green-100 text-green-700',
  good:           'bg-green-100 text-green-700',
  excellent:      'bg-emerald-100 text-emerald-700',

  late:           'bg-yellow-100 text-yellow-700',
  warning:        'bg-yellow-100 text-yellow-700',
  in_progress:    'bg-yellow-100 text-yellow-700',
  fair:           'bg-yellow-100 text-yellow-700',

  scheduled:      'bg-blue-100 text-blue-700',
  synced:         'bg-blue-100 text-blue-700',
  driver:         'bg-blue-100 text-blue-700',

  pending:        'bg-slate-100 text-slate-600',
  unmatched:      'bg-slate-100 text-slate-600',

  called_out:     'bg-orange-100 text-orange-700',
  mismatched:     'bg-orange-100 text-orange-700',
  maintenance:    'bg-orange-100 text-orange-700',

  ncns:           'bg-red-100 text-red-700',
  critical:       'bg-red-100 text-red-700',
  flagged:        'bg-red-100 text-red-700',
  terminated:     'bg-red-100 text-red-700',
  poor:           'bg-red-100 text-red-700',
  damage_flag:    'bg-red-100 text-red-700',

  manager:        'bg-purple-100 text-purple-700',
  dispatcher:     'bg-indigo-100 text-indigo-700',
};

const labels = {
  ncns: 'NCNS',
  called_out: 'Called Out',
  in_progress: 'In Progress',
  damage_flag: 'Damage Flag',
  insurance_expiry: 'Insurance',
  registration_expiry: 'Registration',
  inspection_due: 'Inspection Due',
  termination_review: 'Termination Review',
  written_warning: 'Written Warning',
  verbal_warning: 'Verbal Warning',
};

export default function Badge({ status, label }) {
  const key = (status || '').toLowerCase().replace(/ /g, '_');
  const display = label || labels[key] || (status ? status.replace(/_/g, ' ') : '');
  return (
    <span className={clsx('badge capitalize', variants[key] || 'bg-slate-100 text-slate-600')}>
      {display}
    </span>
  );
}

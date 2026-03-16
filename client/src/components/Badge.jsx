import clsx from 'clsx';

const variants = {
  present:        'bg-green-500/20 text-green-400',
  active:         'bg-green-500/20 text-green-400',
  matched:        'bg-green-500/20 text-green-400',
  completed:      'bg-green-500/20 text-green-400',
  good:           'bg-green-500/20 text-green-400',

  late:           'bg-yellow-500/20 text-yellow-400',
  warning:        'bg-yellow-500/20 text-yellow-400',
  in_progress:    'bg-yellow-500/20 text-yellow-400',
  scheduled:      'bg-blue-500/20 text-blue-400',
  pending:        'bg-slate-500/20 text-slate-400',
  synced:         'bg-blue-500/20 text-blue-400',
  fair:           'bg-yellow-500/20 text-yellow-400',

  called_out:     'bg-orange-500/20 text-orange-400',
  mismatched:     'bg-orange-500/20 text-orange-400',
  maintenance:    'bg-orange-500/20 text-orange-400',

  ncns:           'bg-red-500/20 text-red-400',
  critical:       'bg-red-500/20 text-red-400',
  flagged:        'bg-red-500/20 text-red-400',
  terminated:     'bg-red-500/20 text-red-400',
  poor:           'bg-red-500/20 text-red-400',
  damage_flag:    'bg-red-500/20 text-red-400',

  unmatched:      'bg-slate-500/20 text-slate-400',
  manager:        'bg-purple-500/20 text-purple-400',
  dispatcher:     'bg-indigo-500/20 text-indigo-400',
  driver:         'bg-blue-500/20 text-blue-400',
  excellent:      'bg-emerald-500/20 text-emerald-400',
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
    <span className={clsx('badge capitalize', variants[key] || 'bg-slate-500/20 text-slate-400')}>
      {display}
    </span>
  );
}

import clsx from 'clsx';

export default function StatCard({ title, value, subtitle, icon: Icon, color = 'blue', trend }) {
  const colors = {
    blue: 'bg-blue-500/20 text-blue-400',
    green: 'bg-green-500/20 text-green-400',
    yellow: 'bg-yellow-500/20 text-yellow-400',
    red: 'bg-red-500/20 text-red-400',
    purple: 'bg-purple-500/20 text-purple-400',
    orange: 'bg-orange-500/20 text-orange-400',
  };

  return (
    <div className="card flex items-start gap-4">
      <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', colors[color])}>
        {Icon && <Icon size={20} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{title}</p>
        <p className="text-2xl font-bold text-slate-100 mt-0.5">{value ?? '—'}</p>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        {trend !== undefined && (
          <p className={clsx('text-xs mt-1', trend >= 0 ? 'text-green-400' : 'text-red-400')}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </p>
        )}
      </div>
    </div>
  );
}

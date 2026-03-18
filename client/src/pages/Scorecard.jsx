import { BarChart2, TrendingUp, Users, Package, Star } from 'lucide-react';

export default function Scorecard() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-content">Scorecard</h1>
        <p className="text-sm text-content-muted mt-1">Driver and operational performance metrics</p>
      </div>

      {[
        { icon: BarChart2, label: 'Overall Performance', desc: 'Week-over-week delivery metrics' },
        { icon: TrendingUp, label: 'Delivery Success Rate', desc: 'On-time, missed, and attempted deliveries' },
        { icon: Users, label: 'Driver Rankings', desc: 'Top performers this week' },
        { icon: Package, label: 'Package Volume', desc: 'Packages delivered vs. planned' },
        { icon: Star, label: 'Customer Feedback', desc: 'Ratings and escalations' },
      ].map(({ icon: Icon, label, desc }) => (
        <div key={label} className="card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon size={20} className="text-primary" />
          </div>
          <div>
            <div className="font-semibold text-content">{label}</div>
            <div className="text-sm text-content-muted mt-0.5">{desc} — <em className="text-slate-400">coming soon</em></div>
          </div>
        </div>
      ))}
    </div>
  );
}

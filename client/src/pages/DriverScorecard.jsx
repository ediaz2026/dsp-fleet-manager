import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Award, Package, Shield, Star, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

function titleCase(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }

function Badge({ pass, label }) {
  return pass
    ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700"><CheckCircle size={10} /> {label || 'Pass'}</span>
    : <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600"><XCircle size={10} /> {label || 'Fail'}</span>;
}

function MetricRow({ label, value, suffix = '', passThreshold, invert }) {
  const numVal = parseFloat(value);
  const pass = invert ? numVal === 0 : numVal >= (passThreshold || 100);
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`font-bold text-sm ${pass ? 'text-green-700' : 'text-red-600'}`}>{value ?? '—'}{suffix}</span>
        <Badge pass={pass} />
      </div>
    </div>
  );
}

export default function DriverScorecard() {
  const { user } = useAuth();
  const [selectedWeek, setSelectedWeek] = useState(null);

  const { data: weeks = [] } = useQuery({
    queryKey: ['amazon-scorecard-weeks'],
    queryFn: () => api.get('/amazon-scorecard/weeks').then(r => r.data),
  });

  const weekParam = selectedWeek || (weeks[0]?.week_label || null);

  const { data: sc, isLoading } = useQuery({
    queryKey: ['amazon-scorecard-mine', weekParam],
    queryFn: () => api.get('/amazon-scorecard/mine', { params: { week: weekParam } }).then(r => r.data),
    enabled: !!weekParam,
  });

  const weekIdx = weeks.findIndex(w => w.week_label === weekParam);
  const prevWeek = weekIdx < weeks.length - 1 ? weeks[weekIdx + 1]?.week_label : null;
  const nextWeek = weekIdx > 0 ? weeks[weekIdx - 1]?.week_label : null;

  const firstName = titleCase(user?.firstName);

  // Perfect incentive check
  const isPerfect = sc && sc.final_ranking == 100 && sc.packages > 899
    && sc.speeding_score == 100 && sc.seatbelt_score == 100
    && sc.distraction_score == 100 && sc.sign_signal_score == 100
    && sc.following_dist_score == 100 && sc.cdf_revised === 0 && sc.dsb_revised === 0;

  return (
    <div className="bg-[#F1F5F9]">
      {/* Header */}
      <div className="bg-[#1a3a5c] text-white px-5 pt-[max(env(safe-area-inset-top),20px)] pb-6 rounded-b-3xl">
        <p className="text-sm text-blue-200 font-medium mb-1">{weekParam || 'Scorecard'}{sc?.year ? ` — ${sc.year}` : ''}</p>
        <h1 className="text-xl font-bold">{firstName}'s Scorecard</h1>
        {/* Week nav */}
        <div className="flex items-center justify-between mt-3">
          <button disabled={!prevWeek} onClick={() => setSelectedWeek(prevWeek)} className="p-1.5 rounded-lg bg-white/10 disabled:opacity-30"><ChevronLeft size={18} /></button>
          <span className="font-semibold text-sm">{weekParam || '—'}</span>
          <button disabled={!nextWeek} onClick={() => setSelectedWeek(nextWeek)} className="p-1.5 rounded-lg bg-white/10 disabled:opacity-30"><ChevronRight size={18} /></button>
        </div>
      </div>

      {isLoading && <p className="text-center text-slate-400 py-12">Loading...</p>}

      {!isLoading && !sc && (
        <div className="px-4 mt-6">
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <Award size={36} className="mx-auto text-slate-300 mb-3" />
            <p className="font-semibold text-slate-500">No scorecard available yet</p>
            <p className="text-xs text-slate-400 mt-1">Check back after your manager uploads it.</p>
          </div>
        </div>
      )}

      {sc && (
        <div className="px-4 -mt-3 space-y-4 pb-8">
          {/* Stats tiles */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-xl p-3 text-center shadow-sm">
              <p className="text-2xl font-bold text-[#111827]">#{sc.rank_position || '—'}</p>
              <p className="text-[10px] font-semibold text-slate-400 uppercase">Rank</p>
            </div>
            <div className="bg-white rounded-xl p-3 text-center shadow-sm">
              <p className="text-2xl font-bold text-[#111827]">{sc.final_ranking ?? '—'}</p>
              <p className="text-[10px] font-semibold text-slate-400 uppercase">Score</p>
            </div>
            <div className="bg-white rounded-xl p-3 text-center shadow-sm">
              <p className="text-2xl font-bold text-[#111827]">{sc.packages != null ? Math.round(sc.packages) : '—'}</p>
              <p className="text-[10px] font-semibold text-slate-400 uppercase">Packages</p>
            </div>
          </div>

          {/* Incentives & Bonus */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-[#166534] px-4 py-2.5"><p className="text-white font-bold text-sm">Incentives & Bonus</p></div>
            <div className="p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Bonus Hours</span>
                <Badge pass={sc.bonus_hours} label={sc.bonus_hours ? 'Earned' : 'Not eligible'} />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Perfect Incentive</span>
                {isPerfect
                  ? <span className="font-bold text-green-700 text-sm">${parseFloat(sc.perfect_incentive || 0).toFixed(2)}</span>
                  : <span className="text-xs text-slate-400">Not eligible</span>}
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Per Package</span>
                <span className="font-bold text-sm text-slate-700">{sc.incentive_per_package > 0 ? `$${parseFloat(sc.incentive_per_package).toFixed(2)}` : '—'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Safety</span>
                <Badge pass={sc.safety_pass} />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">DSB</span>
                <Badge pass={sc.dsb_pass} />
              </div>
            </div>
          </div>

          {/* Quality Metrics */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-[#1a3a5c] px-4 py-2.5"><p className="text-white font-bold text-sm">Quality Metrics</p></div>
            <div className="px-4">
              <MetricRow label="DCR Score" value={sc.dcr_score} passThreshold={95} />
              <MetricRow label="POD Rate" value={sc.pod_rate ? (sc.pod_rate * 100).toFixed(1) : null} suffix="%" passThreshold={98} />
              <MetricRow label="CDF (Revised)" value={sc.cdf_revised} invert />
              <MetricRow label="DSB (Revised)" value={sc.dsb_revised} invert />
            </div>
          </div>

          {/* Safety Metrics */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-[#374151] px-4 py-2.5"><p className="text-white font-bold text-sm">Safety Metrics</p></div>
            <div className="px-4">
              <MetricRow label="Speeding" value={sc.speeding_score} />
              <MetricRow label="Seatbelt" value={sc.seatbelt_score} />
              <MetricRow label="Distraction" value={sc.distraction_score} />
              <MetricRow label="Sign/Signal" value={sc.sign_signal_score} />
              <MetricRow label="Following Distance" value={sc.following_dist_score} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

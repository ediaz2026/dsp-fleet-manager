import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Award, CheckCircle, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

function titleCase(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }
function fmt(v) {
  if (v === null || v === undefined) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return Number.isInteger(n) ? n.toString() : parseFloat(n.toFixed(2)).toString();
}
function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  const n = parseFloat(v) * 100;
  return (Number.isInteger(n) ? n.toString() : parseFloat(n.toFixed(1)).toString()) + '%';
}
function int(v) { return v != null ? Math.round(Number(v)) : '—'; }

function Badge({ pass, label }) {
  return pass
    ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700"><CheckCircle size={10} /> {label || 'Pass'}</span>
    : <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600"><XCircle size={10} /> {label || 'Fail'}</span>;
}

function MetricRow({ label, value, suffix = '', passThreshold, invert, fmt }) {
  const numVal = parseFloat(value);
  const pass = invert ? numVal === 0 : numVal >= (passThreshold || 100);
  const display = fmt ? fmt(value) : (value ?? '—');
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`font-bold text-sm ${pass ? 'text-green-700' : 'text-red-600'}`}>{display}{suffix}</span>
        <Badge pass={pass} />
      </div>
    </div>
  );
}

const ANIM_CSS = `
@keyframes trophyDrop { 0%{transform:translateY(-200px) scale(0);opacity:0} 30%{transform:translateY(20px) scale(1.2);opacity:1} 50%{transform:translateY(-15px) scale(0.95)} 70%{transform:translateY(5px) scale(1.05)} 100%{transform:translateY(0) scale(1)} }
@keyframes fadeUp { 0%{opacity:0;transform:translateY(30px)} 100%{opacity:1;transform:translateY(0)} }
@keyframes confettiFall { 0%{transform:translateY(-10vh) rotate(0) scale(1);opacity:1} 80%{opacity:1} 100%{transform:translateY(110vh) rotate(720deg) scale(0.5);opacity:0} }
@keyframes burst { 0%{transform:scale(0);opacity:1} 40%{opacity:0.9} 100%{transform:scale(3);opacity:0} }
@keyframes popIn { 0%{transform:scale(0);opacity:0} 60%{transform:scale(1.2);opacity:1} 100%{transform:scale(1);opacity:1} }
@keyframes rocketUp { 0%{transform:translateY(100vh)} 35%{transform:translateY(0)} 100%{transform:translateY(-120vh)} }
@keyframes starTrail { 0%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:translateY(80px) scale(0.3)} }
@keyframes overlayFade { 0%{opacity:1} 80%{opacity:1} 100%{opacity:0} }
`;

function CelebrationOverlay({ type, onDone }) {
  useEffect(() => { const dur = type === 'rocket' ? 2500 : 3000; const t = setTimeout(onDone, dur); return () => clearTimeout(t); }, [type, onDone]);
  const isPerfect = type === 'perfect' || type === 'combo';
  const isTop4 = type === 'top4' || type === 'combo';
  const isRocket = type === 'rocket';
  return (
    <div className="fixed inset-0 z-[1000]" onClick={onDone} style={{ animation: `overlayFade ${isRocket ? 2.5 : 3}s forwards` }}>
      <div className="absolute inset-0 bg-black/60" />
      <style>{ANIM_CSS}</style>
      {/* Confetti — 50 pieces */}
      {isPerfect && Array.from({ length: 50 }, (_, i) => (
        <div key={`c${i}`} className="absolute" style={{
          left: `${Math.random()*100}%`, top: -10,
          width: 5 + Math.random()*6, height: 5 + Math.random()*6,
          background: ['#FFD700','#fff','#1a3a5c','#FF6B35','#87CEEB','#90EE90','#FF69B4'][i%7],
          borderRadius: i%3===0 ? '50%' : i%3===1 ? '2px' : '0',
          animation: `confettiFall ${2+Math.random()*1.5}s ease-out ${Math.random()*1.2}s forwards`,
        }} />
      ))}
      {/* Trophy */}
      {isPerfect && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center">
            <div style={{ animation: 'trophyDrop 1s cubic-bezier(0.34,1.56,0.64,1) forwards', fontSize: 90 }}>🏆</div>
            <p style={{ animation: 'fadeUp 0.5s ease-out 0.7s forwards', opacity: 0 }} className="text-3xl font-black text-[#FFD700] mt-2 drop-shadow-lg">PERFECT SCORE</p>
          </div>
        </div>
      )}
      {/* Fireworks bursts */}
      {isTop4 && Array.from({ length: 8 }, (_, i) => (
        <div key={`b${i}`} className="absolute rounded-full" style={{
          width: 50+Math.random()*50, height: 50+Math.random()*50,
          left: `${15+Math.random()*70}%`, top: `${15+Math.random()*60}%`,
          background: ['#FFD700','#1a3a5c','#10B981','#2563EB','#FF6B35'][i%5],
          animation: `burst 1.5s ease-out ${i*0.2}s forwards`, opacity: 0,
        }} />
      ))}
      {isTop4 && !isPerfect && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center">
            <div style={{ animation: 'popIn 0.6s ease-out forwards', fontSize: 70 }}>🎆</div>
            <p style={{ animation: 'popIn 0.5s ease-out 0.4s forwards', opacity: 0 }} className="text-2xl font-black text-[#FFD700] mt-2 drop-shadow-lg">Top Performer!</p>
          </div>
        </div>
      )}
      {/* Rocket + star trail */}
      {isRocket && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div style={{ animation: 'rocketUp 2.2s ease-in forwards', fontSize: 60 }}>🚀</div>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={`s${i}`} className="absolute" style={{
              left: '48%', bottom: `${10+i*8}%`, fontSize: 16,
              animation: `starTrail 1s ease-out ${0.3+i*0.15}s forwards`, opacity: 0,
            }}>⭐</div>
          ))}
          <p className="absolute mt-32 text-xl font-bold text-blue-300 drop-shadow" style={{ animation: 'fadeUp 0.5s ease-out 0.5s forwards', opacity: 0 }}>Keep Climbing!</p>
        </div>
      )}
    </div>
  );
}

export default function DriverScorecard() {
  const { user } = useAuth();
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [showAnim, setShowAnim] = useState(null); // 'perfect' | 'top4' | 'rocket' | null

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

  const hasPerfectIncentive = sc && sc.perfect_incentive > 0;
  const isTop4 = sc && sc.rank_position && sc.rank_position <= 4 && sc.packages > 899 && sc.incentive_per_package > 0;
  const isNext4 = sc && sc.rank_position && sc.rank_position > 4 && sc.rank_position <= 8 && sc.packages > 899 && sc.incentive_per_package > 0;

  // Animation plays every time scorecard loads or week changes
  useEffect(() => {
    if (!sc) return;
    const isPerfectScore = sc.final_ranking == 100;
    if (isPerfectScore && isTop4) setShowAnim('combo');
    else if (isPerfectScore) setShowAnim('perfect');
    else if (isTop4) setShowAnim('top4');
    else if (isNext4) setShowAnim('rocket');
    else setShowAnim(null);
  }, [sc, weekParam]);

  const dismissAnim = () => setShowAnim(null);

  return (
    <div className="bg-[#F1F5F9]">
      {showAnim && <CelebrationOverlay type={showAnim} onDone={dismissAnim} />}

      {/* Header */}
      <div className="bg-[#1a3a5c] text-white px-5 pt-[max(env(safe-area-inset-top),20px)] pb-6 rounded-b-3xl">
        <p className="text-sm text-blue-200 font-medium mb-1">{weekParam || 'Scorecard'}{sc?.year ? ` — ${sc.year}` : ''}</p>
        <h1 className="text-xl font-bold">{firstName}'s Scorecard</h1>
        {sc && (() => {
          const r = parseFloat(sc.final_ranking);
          let msg, color;
          if (r >= 100) { msg = `Congratulations ${firstName}! 🏆 Perfect score this week — absolutely outstanding!`; color = '#FFD700'; }
          else if (r >= 95) { msg = `Great work ${firstName}! 🌟 Elite performance this week — keep pushing for perfect!`; color = '#fff'; }
          else if (r >= 90) { msg = `Nice job ${firstName}! 💪 Above the bar this week — a little more focus and you'll be at the top!`; color = '#fff'; }
          else { msg = `Keep going ${firstName}! 🚀 New week, new opportunity — let's get those numbers up together!`; color = '#FEF9C3'; }
          return <p className="text-xs mt-2 leading-relaxed" style={{ color, animation: 'fadeIn 0.5s ease-out' }}>{msg}</p>;
        })()}
        <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
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
              <p className="text-2xl font-bold text-[#111827]">#{int(sc.rank_position)}</p>
              <p className="text-[10px] font-semibold text-slate-400 uppercase">Rank</p>
            </div>
            <div className="bg-white rounded-xl p-3 text-center shadow-sm">
              <p className="text-2xl font-bold text-[#111827]">{fmt(sc.final_ranking)}</p>
              <p className="text-[10px] font-semibold text-slate-400 uppercase">Score</p>
            </div>
            <div className="bg-white rounded-xl p-3 text-center shadow-sm">
              <p className="text-2xl font-bold text-[#111827]">{int(sc.packages)}</p>
              <p className="text-[10px] font-semibold text-slate-400 uppercase">Packages</p>
            </div>
          </div>

          {/* Incentives */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-[#166534] px-4 py-2.5"><p className="text-white font-bold text-sm">Incentives & Bonus</p></div>
            <div className="p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Bonus Hours</span>
                <Badge pass={sc.bonus_hours} label={sc.bonus_hours ? 'Earned' : 'Not eligible'} />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Perfect Incentive</span>
                {hasPerfectIncentive
                  ? <span className="font-bold text-green-700 text-sm">${dec(sc.perfect_incentive)}</span>
                  : <span className="text-xs text-slate-400">Not eligible</span>}
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Per Package</span>
                <span className="font-bold text-sm text-slate-700">{sc.incentive_per_package > 0 ? `$${dec(sc.incentive_per_package)}` : '—'}</span>
              </div>
              <div className="flex justify-between items-center"><span className="text-sm text-slate-600">Safety</span><Badge pass={sc.safety_pass} /></div>
              <div className="flex justify-between items-center"><span className="text-sm text-slate-600">DSB</span><Badge pass={sc.dsb_pass} /></div>
            </div>
          </div>

          {/* Quality */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-[#1a3a5c] px-4 py-2.5"><p className="text-white font-bold text-sm">Quality Metrics</p></div>
            <div className="px-4">
              <MetricRow label="DCR Score" value={sc.dcr_score} fmt={fmt} passThreshold={95} />
              <MetricRow label="POD Rate" value={sc.pod_rate != null ? fmtPct(sc.pod_rate).replace('%','') : null} suffix="%" passThreshold={98} />
              <MetricRow label="CDF (Revised)" value={sc.cdf_revised} fmt={fmt} invert />
              <MetricRow label="DSB (Revised)" value={sc.dsb_revised} fmt={fmt} invert />
            </div>
          </div>

          {/* Safety */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-[#374151] px-4 py-2.5"><p className="text-white font-bold text-sm">Safety Metrics</p></div>
            <div className="px-4">
              <MetricRow label="Speeding" value={sc.speeding_score} fmt={fmt} />
              <MetricRow label="Seatbelt" value={sc.seatbelt_score} fmt={fmt} />
              <MetricRow label="Distraction" value={sc.distraction_score} fmt={fmt} />
              <MetricRow label="Sign/Signal" value={sc.sign_signal_score} fmt={fmt} />
              <MetricRow label="Following Distance" value={sc.following_dist_score} fmt={fmt} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

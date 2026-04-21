import { useState, useEffect, Component } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Award, CheckCircle, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

function titleCase(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }

// Convert Amazon week number + year to Sun–Sat date range
function weekDateRange(amazonWeek, year) {
  if (!amazonWeek || !year) return '';
  // Jan 4 is always in ISO week 1; find Monday of week 1
  const jan4 = new Date(year, 0, 4);
  const w1Mon = new Date(jan4);
  w1Mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  // Monday of target week
  const mon = new Date(w1Mon);
  mon.setDate(w1Mon.getDate() + (amazonWeek - 1) * 7);
  // Amazon week: Sunday (day before Monday) to Saturday
  const sun = new Date(mon); sun.setDate(mon.getDate() - 1);
  const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(sun)} – ${fmt(sat)}`;
}

function fmt(v) {
  if (v === null || v === undefined) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return Number.isInteger(n) ? n.toString() : parseFloat(n.toFixed(2)).toString();
}

function fmtMoney(v) {
  if (!v || parseFloat(v) === 0) return '—';
  return '$' + parseFloat(v).toFixed(2);
}

function Badge({ pass, label }) {
  return pass
    ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700"><CheckCircle size={10} /> {label || 'Pass'}</span>
    : <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600"><XCircle size={10} /> {label || 'Fail'}</span>;
}

function MetricRow({ label, value, suffix, passThreshold, invert, scorecardType }) {
  const numVal = parseFloat(value);
  let pass;
  if (scorecardType === 'pre_dispute' && invert) {
    // Pre Dispute safety: 0 or null = no infractions = Pass
    pass = isNaN(numVal) || numVal === 0;
  } else if (invert) {
    // Final safety: 0 or 100 = Pass
    pass = isNaN(numVal) || numVal === 0 || numVal === 100;
  } else {
    pass = isNaN(numVal) ? false : numVal >= (passThreshold || 100);
  }
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`font-bold text-sm ${pass ? 'text-green-700' : 'text-red-600'}`}>{fmt(value)}{suffix || ''}</span>
        <Badge pass={pass} />
      </div>
    </div>
  );
}

// Error boundary to prevent blank screen
class ScorecardErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="bg-[#F1F5F9] min-h-screen">
          <div className="bg-[#1a3a5c] text-white px-5 pt-12 pb-6 rounded-b-3xl">
            <h1 className="text-xl font-bold">Scorecard</h1>
          </div>
          <div className="px-4 mt-6">
            <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
              <p className="font-semibold text-red-500">Something went wrong loading your scorecard.</p>
              <p className="text-xs text-slate-400 mt-2">Please try again or contact your dispatcher.</p>
              <button onClick={() => this.setState({ error: null })} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Try Again</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const ANIM_STYLE = `
@keyframes scTrophyDrop{0%{transform:translateX(-50%) translateY(-200px);opacity:0}100%{transform:translateX(-50%) translateY(0);opacity:1}}
@keyframes scConfetti{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(100vh) rotate(720deg);opacity:0}}
@keyframes scBurst{0%{transform:scale(0);opacity:1}100%{transform:scale(4);opacity:0}}
@keyframes scFadeUp{0%{opacity:0;transform:translateX(-50%) translateY(20px)}100%{opacity:1;transform:translateX(-50%) translateY(0)}}
@keyframes scRocket{0%{transform:translateX(-50%) translateY(0);opacity:1}100%{transform:translateX(-50%) translateY(-100vh);opacity:0}}
`;

function TrophyAnim() {
  return <>
    <div style={{position:'absolute',top:'30%',left:'50%',fontSize:80,animation:'scTrophyDrop 0.8s cubic-bezier(0.34,1.56,0.64,1) forwards'}}>🏆</div>
    {Array.from({length:30},(_,i)=><div key={i} style={{position:'absolute',left:`${Math.random()*100}%`,top:-10,width:6+Math.random()*6,height:6+Math.random()*6,borderRadius:'50%',background:['#FFD700','#1a3a5c','#fff','#4ade80'][i%4],animation:`scConfetti ${1.5+Math.random()}s ${Math.random()*0.5}s linear forwards`}}/>)}
  </>;
}
function FireworksAnim() {
  return <>
    {Array.from({length:6},(_,i)=><div key={i} style={{position:'absolute',left:`${15+Math.random()*70}%`,top:`${15+Math.random()*50}%`,width:50+Math.random()*40,height:50+Math.random()*40,borderRadius:'50%',background:['#FFD700','#ff6b6b','#4ade80','#60a5fa','#1a3a5c'][i%5],animation:`scBurst 1.2s ${i*0.15}s ease-out forwards`,opacity:0}}/>)}
    <div style={{position:'absolute',top:'20%',left:'50%',color:'#FFD700',fontSize:22,fontWeight:700,animation:'scFadeUp 0.5s 0.3s forwards',opacity:0}}>🎆 Top Performer!</div>
  </>;
}
function RocketAnim() {
  return <>
    <div style={{position:'absolute',bottom:'10%',left:'50%',fontSize:60,animation:'scRocket 2s ease-in forwards'}}>🚀</div>
    <div style={{position:'absolute',bottom:'30%',left:'50%',color:'#93c5fd',fontSize:18,fontWeight:600,animation:'scFadeUp 0.5s 0.3s forwards',opacity:0}}>Keep Climbing!</div>
  </>;
}

function DriverScorecardInner() {
  const { user } = useAuth();
  const location = useLocation();
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [animType, setAnimType] = useState(null);
  const [rescueView, setRescueView] = useState('weekly');

  const { data: rescueData } = useQuery({
    queryKey: ['my-rescues'],
    queryFn: () => api.get('/drivers/my-rescues').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: weeks = [] } = useQuery({
    queryKey: ['amazon-scorecard-weeks'],
    queryFn: () => api.get('/amazon-scorecard/weeks').then(r => r.data),
  });

  const weekParam = selectedWeek || (weeks.length > 0 ? weeks[0].week_label : null);

  const { data: sc, isLoading } = useQuery({
    queryKey: ['amazon-scorecard-mine', weekParam],
    queryFn: () => api.get('/amazon-scorecard/mine', { params: { week: weekParam } }).then(r => r.data),
    enabled: !!weekParam,
  });

  const weekIdx = weeks.findIndex(w => w.week_label === weekParam);
  const prevWeek = weekIdx < weeks.length - 1 ? weeks[weekIdx + 1]?.week_label : null;
  const nextWeek = weekIdx > 0 ? weeks[weekIdx - 1]?.week_label : null;
  const firstName = titleCase(user?.firstName);

  // Greeting
  let greeting = '';
  let greetColor = '#fff';
  if (sc) {
    const r = parseFloat(sc.final_ranking) || 0;
    if (r >= 100) { greeting = `Congratulations ${firstName}! 🏆 Perfect score this week — absolutely outstanding!`; greetColor = '#FFD700'; }
    else if (r >= 95) { greeting = `Great work ${firstName}! 🌟 Elite performance this week — keep pushing for perfect!`; greetColor = '#fff'; }
    else if (r >= 90) { greeting = `Nice job ${firstName}! 💪 Above the bar this week — a little more focus and you'll be at the top!`; greetColor = '#fff'; }
    else { greeting = `Keep going ${firstName}! 🚀 New week, new opportunity — let's get those numbers up together!`; greetColor = '#FEF9C3'; }
  }

  // Animation: reset on tab change
  useEffect(() => { setAnimType(null); }, [location.pathname]);

  // Animation: trigger after data loads (stable deps only)
  const scId = sc?.id;
  const scWeek = sc?.week_label;
  useEffect(() => {
    if (!sc) return;
    const r = parseFloat(sc.final_ranking) || 0;
    const ipp = parseFloat(sc.incentive_per_package) || 0;
    const pkgs = parseFloat(sc.packages) || 0;
    if (r >= 100) setAnimType('perfect');
    else if (ipp > 0 && pkgs > 0 && ipp >= pkgs * 0.09) setAnimType('fireworks');
    else if (ipp > 0) setAnimType('rocket');
    else setAnimType(null);
  }, [scId, scWeek]);

  // Auto-dismiss animation
  useEffect(() => {
    if (!animType) return;
    const t = setTimeout(() => setAnimType(null), 3000);
    return () => clearTimeout(t);
  }, [animType]);

  const podDisplay = sc?.pod_rate != null ? (() => {
    const p = parseFloat(sc.pod_rate) * 100;
    return (Number.isInteger(p) ? p.toString() : parseFloat(p.toFixed(1)).toString());
  })() : null;

  return (
    <div className="bg-[#F1F5F9]">
      {/* Animation overlay — never blocks content */}
      {animType && (
        <div style={{position:'fixed',inset:0,pointerEvents:'none',zIndex:999,overflow:'hidden'}}>
          <style>{ANIM_STYLE}</style>
          {animType === 'perfect' && <TrophyAnim />}
          {animType === 'fireworks' && <FireworksAnim />}
          {animType === 'rocket' && <RocketAnim />}
        </div>
      )}
      {/* Header */}
      <div className="bg-[#1a3a5c] text-white px-5 pt-[max(env(safe-area-inset-top),20px)] pb-6 rounded-b-3xl">
        <p className="text-sm text-blue-200 font-medium mb-1">{weekParam || 'Scorecard'}{sc?.year ? ` — ${sc.year}` : ''}</p>
        <h1 className="text-xl font-bold">{firstName}'s Scorecard</h1>
        {greeting && <p className="text-xs mt-2 leading-relaxed" style={{ color: greetColor }}>{greeting}</p>}
        <div className="flex items-center justify-between mt-3">
          <button disabled={!prevWeek} onClick={() => setSelectedWeek(prevWeek)} className="p-1.5 rounded-lg bg-white/10 disabled:opacity-30"><ChevronLeft size={18} /></button>
          <div className="text-center">
            <div className="font-semibold text-sm">{weekParam || '—'}</div>
            {weekIdx >= 0 && weeks[weekIdx] && (
              <div className="text-[11px] text-blue-200 mt-0.5">
                {weekDateRange(weeks[weekIdx].amazon_week, weeks[weekIdx].year)}
              </div>
            )}
          </div>
          <button disabled={!nextWeek} onClick={() => setSelectedWeek(nextWeek)} className="p-1.5 rounded-lg bg-white/10 disabled:opacity-30"><ChevronRight size={18} /></button>
        </div>
        {/* Scorecard type label — inside header, right-aligned */}
        {sc && (
          <div style={{ textAlign: 'right', marginTop: '6px' }}>
            <span style={{
              fontSize: '14px',
              fontWeight: 800,
              color: sc.scorecard_type === 'final' ? '#16a34a' : '#d97706',
            }}>
              {sc.scorecard_type === 'final' ? 'Final Scorecard' : 'Pre Dispute'}
            </span>
          </div>
        )}
      </div>

      {isLoading && <p className="text-center text-slate-400 py-12">Loading...</p>}

      {!isLoading && !sc && (
        <div className="px-4 mt-6">
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <Award size={36} className="mx-auto text-slate-300 mb-3" />
            <p className="font-semibold text-slate-500">No scorecard available yet</p>
            <p className="text-xs text-slate-400 mt-1">Your manager will upload it weekly. Check back soon!</p>
          </div>
        </div>
      )}

      {sc && (
        <div className="px-4 -mt-3 space-y-4 pb-8">
          {/* Stats — Rank and Score only shown for Final Scorecard */}
          <div className={`grid gap-3 ${sc.scorecard_type === 'final' ? 'grid-cols-3' : 'grid-cols-1'}`}>
            {sc.scorecard_type === 'final' && sc.rank_position != null && (
              <div className="bg-white rounded-xl p-3 text-center shadow-sm">
                <p className="text-2xl font-bold text-[#111827]">#{Math.round(Number(sc.rank_position) || 0)}</p>
                <p className="text-[10px] font-semibold text-slate-400 uppercase">Rank</p>
              </div>
            )}
            {sc.scorecard_type === 'final' && (
              <div className="bg-white rounded-xl p-3 text-center shadow-sm">
                <p className="text-2xl font-bold text-[#111827]">{fmt(sc.final_ranking)}</p>
                <p className="text-[10px] font-semibold text-slate-400 uppercase">Score</p>
              </div>
            )}
            <div className="bg-white rounded-xl p-3 text-center shadow-sm">
              <p className="text-2xl font-bold text-[#111827]">{Math.round(Number(sc.packages) || 0)}</p>
              <p className="text-[10px] font-semibold text-slate-400 uppercase">Packages</p>
            </div>
          </div>

          {/* Incentives */}
          {(() => {
            // Pre Dispute: derive Safety/DSB/Bonus pass from raw metrics
            const pdSafetyPass = [sc.speeding_score, sc.seatbelt_score, sc.distraction_score, sc.sign_signal_score, sc.following_dist_score]
              .every(v => v == null || parseFloat(v) === 0);
            const pdDsbPass = sc.dsb_revised == null || parseFloat(sc.dsb_revised) === 0;
            const isPD = sc.scorecard_type === 'pre_dispute';
            const safetyPass = isPD ? pdSafetyPass : !!sc.safety_pass;
            const dsbPass    = isPD ? pdDsbPass : !!sc.dsb_pass;
            // Pre Dispute: Bonus Hours = Safety AND DSB both pass
            const bonusPass  = isPD ? (pdSafetyPass && pdDsbPass) : !!sc.bonus_hours;
            return (
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-[#166534] px-4 py-2.5"><p className="text-white font-bold text-sm">Incentives & Bonus</p></div>
                <div className="p-4 space-y-3">
                  <div className="flex justify-between items-center"><span className="text-sm text-slate-600">Bonus Hours</span><Badge pass={bonusPass} label={bonusPass ? 'Earned' : 'Not eligible'} /></div>
                  <div className="flex justify-between items-center"><span className="text-sm text-slate-600">Perfect Incentive</span>{sc.perfect_incentive > 0 ? <span className="font-bold text-green-700 text-sm">{fmtMoney(sc.perfect_incentive)}</span> : <span className="text-xs text-slate-400">Not eligible</span>}</div>
                  <div className="flex justify-between items-center"><span className="text-sm text-slate-600">Per Package</span><span className="font-bold text-sm text-slate-700">{fmtMoney(sc.incentive_per_package)}</span></div>
                  <div className="flex justify-between items-center"><span className="text-sm text-slate-600">Safety</span><Badge pass={safetyPass} /></div>
                  <div className="flex justify-between items-center"><span className="text-sm text-slate-600">DSB</span><Badge pass={dsbPass} /></div>
                </div>
              </div>
            );
          })()}

          {/* Quality */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-[#1a3a5c] px-4 py-2.5"><p className="text-white font-bold text-sm">Quality Metrics</p></div>
            <div className="px-4">
              <MetricRow label="DCR Score" value={sc.dcr_score} passThreshold={95} />
              <MetricRow label="POD Rate" value={podDisplay} suffix="%" passThreshold={98} />
              <MetricRow label="CDF (Revised)" value={sc.cdf_revised} invert />
              <MetricRow label="DSB (Revised)" value={sc.dsb_revised} invert />
            </div>
          </div>

          {/* Safety */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-[#374151] px-4 py-2.5"><p className="text-white font-bold text-sm">Safety Metrics</p></div>
            <div className="px-4">
              <MetricRow label="Speeding" value={sc.speeding_score} invert scorecardType={sc.scorecard_type} />
              <MetricRow label="Seatbelt" value={sc.seatbelt_score} invert scorecardType={sc.scorecard_type} />
              <MetricRow label="Distraction" value={sc.distraction_score} invert scorecardType={sc.scorecard_type} />
              <MetricRow label="Sign/Signal" value={sc.sign_signal_score} invert scorecardType={sc.scorecard_type} />
              <MetricRow label="Following Distance" value={sc.following_dist_score} invert scorecardType={sc.scorecard_type} />
            </div>
          </div>
        </div>
      )}

      {/* ── My Rescues section ─────────────────────────────────────────── */}
      {rescueData && (
        <div className="px-4 pb-8 space-y-3">
          {/* Header + toggle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a2e4a' }}>🚨 My Rescues</div>
            <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '20px', padding: '2px' }}>
              {['weekly', 'monthly'].map(v => (
                <button key={v} onClick={() => setRescueView(v)} style={{
                  padding: '4px 12px', borderRadius: '16px', border: 'none',
                  fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                  background: rescueView === v ? '#1a2e4a' : 'transparent',
                  color: rescueView === v ? 'white' : '#64748b',
                }}>
                  {v === 'weekly' ? 'This Week' : 'This Month'}
                </button>
              ))}
            </div>
          </div>

          {/* Summary counts */}
          {(() => {
            const d = rescueData[rescueView];
            if (!d) return null;
            return (
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1, background: d.total > 0 ? '#fef2f2' : '#f0fdf4', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: d.total > 0 ? '#dc2626' : '#16a34a' }}>{d.total}</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>Total Rescues</div>
                </div>
                {d.performance > 0 && (
                  <div style={{ flex: 1, background: '#fff7ed', borderRadius: '10px', padding: '10px', textAlign: 'center', border: '1px solid #fed7aa' }}>
                    <div style={{ fontSize: '22px', fontWeight: 800, color: '#ea580c' }}>{d.performance}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>Performance</div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Empty state */}
          {rescueData[rescueView]?.rescues.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px', color: '#16a34a', fontSize: '13px', fontWeight: 600 }}>
              ✓ No rescues {rescueView === 'weekly' ? 'this week' : 'this month'}
            </div>
          )}

          {/* Rescue list */}
          {rescueData[rescueView]?.rescues.map(r => {
            const isPerfomance = r.reason === 'Performance';
            const dateStr = typeof r.plan_date === 'string' ? r.plan_date.slice(0, 10) : new Date(r.plan_date).toISOString().slice(0, 10);
            return (
              <div key={r.id} style={{
                background: isPerfomance ? '#fff7ed' : '#f8fafc',
                border: `1px solid ${isPerfomance ? '#fed7aa' : '#e2e8f0'}`,
                borderLeft: `4px solid ${isPerfomance ? '#ea580c' : '#94a3b8'}`,
                borderRadius: '8px', padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: isPerfomance ? '#ea580c' : '#374151' }}>
                      {isPerfomance ? '⚠️ Performance' : r.reason || 'Heavy Route'} — Route {r.rescued_route}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                      Assisted by {r.rescuer_name} · {r.packages_rescued} pkgs
                    </div>
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'right', flexShrink: 0 }}>
                    {new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {r.rescue_time && <div>{r.rescue_time}</div>}
                  </div>
                </div>
                {isPerfomance && (
                  <div style={{ marginTop: '6px', fontSize: '11px', color: '#ea580c', fontWeight: 500 }}>
                    This rescue was logged due to performance concerns. Focus on improvement this week.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function DriverScorecard() {
  return (
    <ScorecardErrorBoundary>
      <DriverScorecardInner />
    </ScorecardErrorBoundary>
  );
}

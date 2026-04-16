import React, { useState, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Upload, Star, Award, CheckCircle, XCircle, X, Search } from 'lucide-react';
import api from '../api/client';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

function Badge({ pass, label }) {
  return pass
    ? <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700"><CheckCircle size={9} />{label || 'Pass'}</span>
    : <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600"><XCircle size={9} />{label || 'Fail'}</span>;
}

function fmt(v) {
  if (v === null || v === undefined) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return Number.isInteger(n) ? n.toString() : parseFloat(n.toFixed(2)).toString();
}

function MetricCell({ value, good, suffix = '' }) {
  const v = parseFloat(value);
  const isGood = !isNaN(v) && good(v);
  return <span className={`font-semibold ${isGood ? 'text-green-700' : 'text-red-600'}`}>{fmt(value)}{suffix}</span>;
}

function SafetyCard({ label, value }) {
  const v = parseFloat(value);
  const color = value == null || isNaN(v) ? 'text-slate-400' : v === 0 ? 'text-green-600' : v <= 1 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value != null && !isNaN(v) ? v.toFixed(1) : 'No Data'}</p>
      <p className="text-[9px] text-slate-400">events/100 trips</p>
    </div>
  );
}

function DriverScoreView({ weekLabel, currentYear, scorecardType = 'final' }) {
  const { data: sc, isLoading } = useQuery({
    queryKey: ['my-scorecard', weekLabel, currentYear, scorecardType],
    queryFn: () => api.get('/amazon-scorecard/mine', { params: { week: weekLabel, type: scorecardType } }).then(r => r.data),
    enabled: !!weekLabel,
  });

  if (isLoading) return <div className="h-32 bg-slate-100 rounded-xl animate-pulse" />;
  if (!sc) return <div className="text-center text-slate-400 py-16">No scorecard data available for this week.</div>;

  const fmtMoney = v => v != null ? `$${parseFloat(v).toFixed(2)}` : '—';
  const fmtPct = v => v != null ? `${parseFloat(v).toFixed(1)}%` : '—';

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-center">
          <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide">Rank</p>
          <p className="text-2xl font-black text-indigo-700">#{sc.rank_position || '—'}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Packages</p>
          <p className="text-2xl font-black text-slate-800">{sc.packages != null ? Math.round(sc.packages) : '—'}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">DCR</p>
          <p className="text-2xl font-black text-slate-800">{fmtPct(sc.dcr_score)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">POD Rate</p>
          <p className="text-2xl font-black text-slate-800">{sc.pod_rate != null ? `${(parseFloat(sc.pod_rate) * 100).toFixed(1)}%` : '—'}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Bonus Hours</p>
          <p className="text-2xl font-black">{sc.bonus_hours ? <span className="text-green-600">✓</span> : <span className="text-red-500">✗</span>}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Incentive</p>
          <p className="text-xl font-black text-emerald-700">{fmtMoney(sc.perfect_incentive)}</p>
          {sc.incentive_per_package != null && <p className="text-[10px] text-slate-400">~{fmtMoney(sc.incentive_per_package)}/pkg</p>}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">CDF DPMO</p>
          <p className="text-2xl font-black text-slate-800">{sc.cdf_revised != null ? Math.round(sc.cdf_revised) : '—'}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">DSB DPMO</p>
          <p className="text-2xl font-black text-slate-800">{sc.dsb_revised != null ? Math.round(sc.dsb_revised) : '—'}</p>
        </div>
      </div>

      {/* Safety metrics */}
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Safety Metrics</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <SafetyCard label="Seatbelt Off Rate" value={sc.seatbelt_score} />
          <SafetyCard label="Speeding Event Rate" value={sc.speeding_score} />
          <SafetyCard label="Distractions Rate" value={sc.distraction_score} />
          <SafetyCard label="Following Distance" value={sc.following_dist_score} />
          <SafetyCard label="Sign/Signal Violations" value={sc.sign_signal_score} />
        </div>
      </div>
    </div>
  );
}

export default function Scorecard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isDriver = user?.role === 'driver';
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('rank');
  const [scorecardView, setScorecardView] = useState('final');
  const fileRef = useRef();
  const pdfRef = useRef();

  const { data: weeks = [] } = useQuery({
    queryKey: ['amazon-scorecard-weeks'],
    queryFn: () => api.get('/amazon-scorecard/weeks').then(r => r.data),
  });

  const weekLabel = selectedWeek || (weeks[0]?.week_label || null);
  const weekIdx = weeks.findIndex(w => w.week_label === weekLabel);
  const prevWeek = weekIdx < weeks.length - 1 ? weeks[weekIdx + 1]?.week_label : null;
  const nextWeek = weekIdx > 0 ? weeks[weekIdx - 1]?.week_label : null;

  const { data: rawDrivers = [], isLoading } = useQuery({
    queryKey: ['amazon-scorecard-all', weekLabel, scorecardView],
    queryFn: () => api.get('/amazon-scorecard', { params: { week: weekLabel, type: scorecardView } }).then(r => r.data),
    enabled: !!weekLabel && !isDriver,
  });

  const drivers = useMemo(() => {
    let list = rawDrivers;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(d => (d.driver_name || '').toLowerCase().includes(s));
    }
    const sorters = {
      rank: (a, b) => (a.rank_position || 999) - (b.rank_position || 999),
      score: (a, b) => (b.final_ranking || 0) - (a.final_ranking || 0),
      packages: (a, b) => (b.packages || 0) - (a.packages || 0),
      name: (a, b) => (a.driver_name || '').localeCompare(b.driver_name || ''),
      dcr: (a, b) => (b.dcr_score || 0) - (a.dcr_score || 0),
    };
    return [...list].sort(sorters[sortBy] || sorters.rank);
  }, [rawDrivers, search, sortBy]);

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/amazon-scorecard/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setUploadResult(data);
      qc.invalidateQueries({ queryKey: ['amazon-scorecard-weeks'] });
      qc.invalidateQueries({ queryKey: ['amazon-scorecard-all'] });
      toast.success(`Uploaded ${data.weekLabel} — ${data.matched}/${data.uploaded} matched`);
      if (data.weekLabel) setSelectedWeek(data.weekLabel);
    } catch (err) { toast.error(err?.response?.data?.error || 'Upload failed'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const currentYear = weeks[weekIdx]?.year || new Date().getFullYear();

  const handlePdfUpload = async (file) => {
    if (!file) return;
    setUploadingPdf(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/amazon-scorecard/upload-pdf', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setUploadResult(data);
      qc.invalidateQueries({ queryKey: ['amazon-scorecard-weeks'] });
      qc.invalidateQueries({ queryKey: ['amazon-scorecard-all'] });
      toast.success(`Uploaded ${data.weekLabel} Pre Dispute — ${data.matched}/${data.uploaded} matched`);
      if (data.weekLabel) setSelectedWeek(data.weekLabel);
      setScorecardView('pre_dispute');
    } catch (err) { toast.error(err?.response?.data?.error || 'PDF upload failed'); }
    finally { setUploadingPdf(false); if (pdfRef.current) pdfRef.current.value = ''; }
  };

  const isPerfect = (d) => d.final_ranking == 100 && d.packages > 899
    && d.speeding_score == 100 && d.seatbelt_score == 100 && d.distraction_score == 100
    && d.sign_signal_score == 100 && d.following_dist_score == 100
    && d.cdf_revised == 0 && d.dsb_revised == 0;

  const getRowBg = (d, i) => {
    if (d.packages > 899 && d.rank_position <= 4) return 'bg-green-50';
    if (d.packages > 899 && d.rank_position <= 8) return 'bg-blue-50';
    return i % 2 === 1 ? 'bg-slate-50/50' : '';
  };

  const pkgs = (v) => v != null ? Math.round(v) : '—';
  const isPD = scorecardView === 'pre_dispute';

  // Pre Dispute derived pass logic
  const pdSafetyPass = (d) => {
    const metrics = [d.seatbelt_score, d.speeding_score, d.distraction_score, d.following_dist_score, d.sign_signal_score];
    return metrics.every(v => v == null || parseFloat(v) === 0);
  };
  const pdDsbPass = (d) => d.dsb_revised == null || parseFloat(d.dsb_revised) === 0;
  const pdBonusPass = (d) => pdSafetyPass(d) && pdDsbPass(d);

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{isDriver ? 'My Scorecard' : 'Scorecard'}</h1>
        {!isDriver && (
          scorecardView === 'pre_dispute' ? (
            <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border bg-indigo-50 border-indigo-200 hover:bg-indigo-100 cursor-pointer text-sm font-medium text-indigo-700 ${uploadingPdf ? 'opacity-50 pointer-events-none' : ''}`}>
              <Upload size={14} /> {uploadingPdf ? 'Uploading…' : 'Upload Pre Dispute PDF'}
              <input type="file" accept=".pdf" className="hidden" ref={pdfRef} disabled={uploadingPdf} onChange={e => handlePdfUpload(e.target.files?.[0])} />
            </label>
          ) : (
            <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border bg-white hover:bg-slate-50 cursor-pointer text-sm font-medium ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
              <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload Final Scorecard (Excel)'}
              <input type="file" accept=".xlsx,.xls" className="hidden" ref={fileRef} disabled={uploading} onChange={e => handleUpload(e.target.files?.[0])} />
            </label>
          )
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200 w-fit">
        {[['pre_dispute', 'Pre Dispute'], ['final', 'Final Scorecard']].map(([v, l]) => (
          <button key={v} onClick={() => setScorecardView(v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${scorecardView === v ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Upload result — managers only, final view */}
      {!isDriver && scorecardView === 'final' && uploadResult && (
        <div className="bg-white rounded-xl border p-4 text-sm space-y-2">
          <div className="flex justify-between items-center">
            <p className="font-semibold">{uploadResult.weekLabel}: {uploadResult.matched}/{uploadResult.uploaded} matched</p>
            <button onClick={() => setUploadResult(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
          </div>
          {uploadResult.unmatched?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-bold text-amber-700 mb-1">Unmatched ({uploadResult.unmatched.length}):</p>
              <p className="text-xs text-amber-600">{uploadResult.unmatched.join(', ')}</p>
            </div>
          )}
        </div>
      )}

      {/* Week nav */}
      {weeks.length > 0 && (
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => { setSelectedWeek(prevWeek); setIframeError(false); }} disabled={!prevWeek} className="p-2 rounded-lg border bg-white hover:bg-slate-50 disabled:opacity-30"><ChevronLeft size={16} /></button>
          <div className="text-center">
            <p className="font-bold text-lg text-slate-900">{weekLabel || '—'}</p>
            <p className="text-xs text-slate-400">{weeks[weekIdx]?.year || ''}</p>
          </div>
          <button onClick={() => { setSelectedWeek(nextWeek); setIframeError(false); }} disabled={!nextWeek} className="p-2 rounded-lg border bg-white hover:bg-slate-50 disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
      )}

      {/* Driver view */}
      {isDriver && weekLabel && <DriverScoreView weekLabel={weekLabel} currentYear={currentYear} scorecardType={scorecardView} />}

      {/* Search + sort — managers only. Gated on rawDrivers (the full list)
          so the input stays visible even when the filter returns 0 matches. */}
      {!isDriver && rawDrivers.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-white" placeholder="Search driver..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-slate-400 font-medium">Sort:</span>
            {[['rank','Rank'],['score','Score'],['packages','Pkgs'],['name','Name'],['dcr','DCR']].map(([k,l]) => (
              <button key={k} onClick={() => setSortBy(k)} className={`px-2 py-1 rounded ${sortBy === k ? 'bg-blue-600 text-white' : 'bg-white border text-slate-600 hover:bg-slate-50'}`}>{l}</button>
            ))}
          </div>
        </div>
      )}

      {/* Empty / loading */}
      {!isDriver && isLoading && <p className="text-center text-slate-400 py-12">Loading…</p>}
      {!isDriver && !isLoading && rawDrivers.length === 0 && weekLabel && (
        <div className="bg-white rounded-xl border py-12 text-center">
          <Award size={36} className="mx-auto text-slate-300 mb-3" />
          <p className="font-semibold text-slate-500">No scorecard data for {weekLabel}</p>
          <p className="text-xs text-slate-400 mt-1">Upload a scorecard Excel file to get started</p>
        </div>
      )}

      {/* No-match empty state — when there's data but the search filter
          excludes everything. */}
      {!isDriver && !isLoading && rawDrivers.length > 0 && drivers.length === 0 && search && (
        <div className="bg-white rounded-xl border py-8 text-center">
          <p className="text-sm text-slate-500">No drivers found for “{search}”.</p>
        </div>
      )}

      {/* Leaderboard — managers only */}
      {!isDriver && drivers.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-[10px] font-semibold text-slate-500 uppercase">
                <th className="px-3 py-2.5 text-center w-8">#</th>
                <th className="px-3 py-2.5 text-left">Driver</th>
                <th className="px-3 py-2.5 text-center">Score</th>
                <th className="px-3 py-2.5 text-center">Pkgs</th>
                <th className="px-3 py-2.5 text-center">Safety</th>
                <th className="px-3 py-2.5 text-center">DSB</th>
                <th className="px-3 py-2.5 text-center">Bonus</th>
                <th className="px-3 py-2.5 text-center">Incentive</th>
                <th className="px-2 py-2.5 w-6"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {drivers.map((d, i) => (
                <React.Fragment key={d.id || i}>
                  <tr className={`${getRowBg(d, i)} cursor-pointer hover:bg-slate-100/70 transition-colors`} onClick={() => setExpandedRow(expandedRow === d.id ? null : d.id)}>
                    <td className="px-3 py-2 text-center font-mono text-xs text-slate-400">{d.rank_position ?? i + 1}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {!isPD && isPerfect(d) && <Star size={12} className="inline text-amber-500 mr-1" fill="#F59E0B" />}
                      {d.driver_name}
                      {!d.staff_id && <span className="ml-1 text-[9px] text-red-400">(unmatched)</span>}
                    </td>
                    <td className="px-3 py-2 text-center font-bold">{isPD ? '—' : fmt(d.final_ranking)}</td>
                    <td className="px-3 py-2 text-center">{pkgs(d.packages)}</td>
                    <td className="px-3 py-2 text-center">{isPD ? <Badge pass={pdSafetyPass(d)} /> : <Badge pass={d.safety_pass} />}</td>
                    <td className="px-3 py-2 text-center">{isPD ? <Badge pass={pdDsbPass(d)} /> : <Badge pass={d.dsb_pass} />}</td>
                    <td className="px-3 py-2 text-center">{isPD ? <Badge pass={pdBonusPass(d)} label={pdBonusPass(d) ? 'Yes' : '—'} /> : <Badge pass={d.bonus_hours} label={d.bonus_hours ? 'Yes' : '—'} />}</td>
                    <td className="px-3 py-2 text-center text-xs">{isPD ? '—' : (d.incentive_per_package > 0 ? `$${parseFloat(d.incentive_per_package).toFixed(2)}` : '—')}</td>
                    <td className="px-2 py-2 text-center text-slate-400">
                      {expandedRow === d.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </td>
                  </tr>
                  {expandedRow === d.id && (
                    <tr><td colSpan={9} className="p-0">
                      <div className="bg-indigo-50 border-t border-indigo-100 px-6 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* Left — Safety */}
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-600 mb-2">Safety Metrics</p>
                            <div className="space-y-1.5">
                              {[
                                ['Seatbelt Off Rate', d.seatbelt_score],
                                ['Speeding Event Rate', d.speeding_score],
                                ['Distractions Rate', d.distraction_score],
                                ['Following Distance Rate', d.following_dist_score],
                                ['Sign/Signal Violations Rate', d.sign_signal_score],
                              ].map(([label, val]) => {
                                const v = parseFloat(val);
                                const color = val == null || isNaN(v) ? 'text-slate-400' : v === 0 ? 'text-green-600' : v <= 1 ? 'text-amber-600' : 'text-red-600';
                                return (
                                  <div key={label} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-indigo-100">
                                    <span className="text-xs text-slate-600">{label}</span>
                                    <span className={`text-xs font-bold ${color}`}>{val != null && !isNaN(v) ? v.toFixed(1) : 'No Data'}<span className="text-slate-400 font-normal ml-1">events/100 trips</span></span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          {/* Right — Delivery */}
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-600 mb-2">Delivery Details</p>
                            <div className="space-y-1.5">
                              {[
                                ['DCR', d.dcr_score != null ? `${fmt(d.dcr_score)}%` : '—'],
                                ['DSB DPMO', d.dsb_revised != null ? Math.round(d.dsb_revised) : '—'],
                                ['CDF DPMO', d.cdf_revised != null ? Math.round(d.cdf_revised) : '—'],
                                ['POD Rate', d.pod_rate != null ? `${(parseFloat(d.pod_rate) * 100).toFixed(1)}%` : '—'],
                                ...(!isPD ? [
                                  ['Transporter ID', d.transporter_id || '—'],
                                  ['Incentive/pkg', d.incentive_per_package > 0 ? `$${parseFloat(d.incentive_per_package).toFixed(2)}` : '—'],
                                  ['Perfect Incentive', isPerfect(d) ? `$${parseFloat(d.perfect_incentive||0).toFixed(2)}` : '—'],
                                ] : []),
                              ].map(([label, val]) => (
                                <div key={label} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-indigo-100">
                                  <span className="text-xs text-slate-600">{label}</span>
                                  <span className="text-xs font-bold text-slate-800">{val}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload history */}
      {weeks.length > 1 && (
        <div className="bg-white rounded-xl border p-4">
          <p className="font-semibold text-sm text-slate-800 mb-2">Upload History</p>
          <div className="space-y-1">
            {weeks.map((w, i) => (
              <button key={i} onClick={() => setSelectedWeek(w.week_label)}
                className={`w-full flex justify-between text-sm py-1.5 px-2 rounded ${w.week_label === weekLabel ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-50 text-slate-600'}`}>
                <span>{w.week_label}</span>
                <span className="text-xs text-slate-400">{w.uploaded_at ? new Date(w.uploaded_at).toLocaleDateString() : ''}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

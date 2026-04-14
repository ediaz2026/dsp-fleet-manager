import React, { useState, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Upload, Star, Award, CheckCircle, XCircle, X, Search } from 'lucide-react';
import api from '../api/client';
import toast from 'react-hot-toast';

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

export default function Scorecard() {
  const qc = useQueryClient();
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('rank');
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
    queryKey: ['amazon-scorecard-all', weekLabel],
    queryFn: () => api.get('/amazon-scorecard', { params: { week: weekLabel } }).then(r => r.data),
    enabled: !!weekLabel,
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

  // PDF scorecard data
  const currentYear = weeks[weekIdx]?.year || new Date().getFullYear();
  const { data: scorecardPdfs = [] } = useQuery({
    queryKey: ['scorecard-pdfs', weekLabel, currentYear],
    queryFn: () => api.get('/amazon-scorecard/pdfs', { params: { week_label: weekLabel, year: currentYear } }).then(r => r.data),
    enabled: !!weekLabel,
  });
  const preDisputePdf = scorecardPdfs.find(p => p.scorecard_type === 'pre_dispute');

  const handlePdfUpload = async (file) => {
    if (!file || !weekLabel) return;
    setUploadingPdf(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('week_label', weekLabel);
      formData.append('year', currentYear);
      formData.append('scorecard_type', 'pre_dispute');
      await api.post('/amazon-scorecard/upload-pdf', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      qc.invalidateQueries({ queryKey: ['scorecard-pdfs'] });
      toast.success('Pre Dispute PDF uploaded');
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

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Scorecard</h1>
        <div className="flex items-center gap-2">
          <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border bg-indigo-50 border-indigo-200 hover:bg-indigo-100 cursor-pointer text-sm font-medium text-indigo-700 ${uploadingPdf ? 'opacity-50 pointer-events-none' : ''}`}>
            <Upload size={14} /> {uploadingPdf ? 'Uploading…' : 'Upload Pre Dispute PDF'}
            <input type="file" accept=".pdf" className="hidden" ref={pdfRef} disabled={uploadingPdf} onChange={e => handlePdfUpload(e.target.files?.[0])} />
          </label>
          <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border bg-white hover:bg-slate-50 cursor-pointer text-sm font-medium ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
            <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload Final Scorecard (Excel)'}
            <input type="file" accept=".xlsx,.xls" className="hidden" ref={fileRef} disabled={uploading} onChange={e => handleUpload(e.target.files?.[0])} />
          </label>
        </div>
      </div>

      {/* Upload result */}
      {uploadResult && (
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
          <button onClick={() => setSelectedWeek(prevWeek)} disabled={!prevWeek} className="p-2 rounded-lg border bg-white hover:bg-slate-50 disabled:opacity-30"><ChevronLeft size={16} /></button>
          <div className="text-center">
            <p className="font-bold text-lg text-slate-900">{weekLabel || '—'}</p>
            <p className="text-xs text-slate-400">{weeks[weekIdx]?.year || ''}</p>
          </div>
          <button onClick={() => setSelectedWeek(nextWeek)} disabled={!nextWeek} className="p-2 rounded-lg border bg-white hover:bg-slate-50 disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
      )}

      {/* Pre Dispute PDF viewer */}
      {weekLabel && (
        preDisputePdf ? (
          <div className="w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm">
            <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between border-b border-slate-200">
              <span className="text-sm font-semibold text-slate-700">Pre Dispute Scorecard — {weekLabel}</span>
              <a href={preDisputePdf.pdf_url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:underline font-medium">
                Open in new tab ↗
              </a>
            </div>
            <iframe src={preDisputePdf.pdf_url} className="w-full" style={{ height: '800px' }} title="Pre Dispute Scorecard" />
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-4 text-center">
            <p className="text-sm text-slate-400">No Pre Dispute Scorecard uploaded for {weekLabel}.</p>
          </div>
        )
      )}

      {/* Search + sort */}
      {drivers.length > 0 && (
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
      {isLoading && <p className="text-center text-slate-400 py-12">Loading…</p>}
      {!isLoading && rawDrivers.length === 0 && weekLabel && (
        <div className="bg-white rounded-xl border py-12 text-center">
          <Award size={36} className="mx-auto text-slate-300 mb-3" />
          <p className="font-semibold text-slate-500">No scorecard data for {weekLabel}</p>
          <p className="text-xs text-slate-400 mt-1">Upload a scorecard Excel file to get started</p>
        </div>
      )}

      {/* Leaderboard */}
      {drivers.length > 0 && (
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {drivers.map((d, i) => (
                <React.Fragment key={d.id || i}>
                  <tr className={`${getRowBg(d, i)} cursor-pointer hover:bg-slate-100/70 transition-colors`} onClick={() => setExpandedRow(expandedRow === d.id ? null : d.id)}>
                    <td className="px-3 py-2 text-center font-mono text-xs text-slate-400">{d.rank_position ?? i + 1}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {isPerfect(d) && <Star size={12} className="inline text-amber-500 mr-1" fill="#F59E0B" />}
                      {d.driver_name}
                      {!d.staff_id && <span className="ml-1 text-[9px] text-red-400">(unmatched)</span>}
                    </td>
                    <td className="px-3 py-2 text-center font-bold">{fmt(d.final_ranking)}</td>
                    <td className="px-3 py-2 text-center">{pkgs(d.packages)}</td>
                    <td className="px-3 py-2 text-center"><Badge pass={d.safety_pass} /></td>
                    <td className="px-3 py-2 text-center"><Badge pass={d.dsb_pass} /></td>
                    <td className="px-3 py-2 text-center"><Badge pass={d.bonus_hours} label={d.bonus_hours ? 'Yes' : '—'} /></td>
                    <td className="px-3 py-2 text-center text-xs">{d.incentive_per_package > 0 ? `$${parseFloat(d.incentive_per_package).toFixed(2)}` : '—'}</td>
                  </tr>
                  {expandedRow === d.id && (
                    <tr><td colSpan={8} className="bg-slate-50 p-0">
                      <div className="px-6 py-4 space-y-4">
                        {/* Incentives */}
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-green-700 mb-2">Incentives & Bonus</p>
                          <div className="grid grid-cols-3 gap-3 text-xs">
                            <div className="bg-white rounded-lg p-2.5 border"><span className="text-slate-400 block mb-0.5">Bonus Hours</span><Badge pass={d.bonus_hours} label={d.bonus_hours ? 'Earned' : 'Not eligible'} /></div>
                            <div className="bg-white rounded-lg p-2.5 border"><span className="text-slate-400 block mb-0.5">Perfect Incentive</span>{isPerfect(d) ? <span className="font-bold text-green-700">${parseFloat(d.perfect_incentive||0).toFixed(2)}</span> : <span className="text-slate-400">—</span>}</div>
                            <div className="bg-white rounded-lg p-2.5 border"><span className="text-slate-400 block mb-0.5">Per Package</span><span className="font-bold">{d.incentive_per_package > 0 ? `$${parseFloat(d.incentive_per_package).toFixed(2)}` : '—'}</span></div>
                          </div>
                        </div>
                        {/* Quality */}
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700 mb-2">Quality Metrics</p>
                          <div className="grid grid-cols-4 gap-3 text-xs">
                            <div className="bg-white rounded-lg p-2.5 border"><span className="text-slate-400 block mb-0.5">DCR Score</span><MetricCell value={d.dcr_score} good={v => v >= 95} /></div>
                            <div className="bg-white rounded-lg p-2.5 border"><span className="text-slate-400 block mb-0.5">POD Rate</span><MetricCell value={d.pod_rate != null ? parseFloat((d.pod_rate * 100).toFixed(1)) : null} good={v => v >= 98} suffix="%" /></div>
                            <div className="bg-white rounded-lg p-2.5 border"><span className="text-slate-400 block mb-0.5">CDF (Revised)</span><MetricCell value={d.cdf_revised} good={v => v === 0} /></div>
                            <div className="bg-white rounded-lg p-2.5 border"><span className="text-slate-400 block mb-0.5">DSB (Revised)</span><MetricCell value={d.dsb_revised} good={v => v === 0} /></div>
                          </div>
                        </div>
                        {/* Safety */}
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-2">Safety Metrics</p>
                          <div className="grid grid-cols-5 gap-3 text-xs">
                            {[['Speeding',d.speeding_score],['Seatbelt',d.seatbelt_score],['Distraction',d.distraction_score],['Sign/Signal',d.sign_signal_score],['Following Dist',d.following_dist_score]].map(([label,val]) => (
                              <div key={label} className="bg-white rounded-lg p-2.5 border">
                                <span className="text-slate-400 block mb-0.5">{label}</span>
                                <span className="font-bold mr-1">{fmt(val)}</span><Badge pass={val == 100} />
                              </div>
                            ))}
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

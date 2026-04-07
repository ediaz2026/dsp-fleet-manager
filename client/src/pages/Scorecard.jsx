import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Upload, Star, Award, CheckCircle, XCircle, X } from 'lucide-react';
import api from '../api/client';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

function Badge({ pass, label }) {
  return pass
    ? <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700"><CheckCircle size={9} />{label || 'Pass'}</span>
    : <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600"><XCircle size={9} />{label || 'Fail'}</span>;
}

export default function Scorecard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const fileRef = useRef();

  const { data: weeks = [] } = useQuery({
    queryKey: ['amazon-scorecard-weeks'],
    queryFn: () => api.get('/amazon-scorecard/weeks').then(r => r.data),
  });

  const weekLabel = selectedWeek || (weeks[0]?.week_label || null);
  const weekIdx = weeks.findIndex(w => w.week_label === weekLabel);
  const prevWeek = weekIdx < weeks.length - 1 ? weeks[weekIdx + 1]?.week_label : null;
  const nextWeek = weekIdx > 0 ? weeks[weekIdx - 1]?.week_label : null;

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: ['amazon-scorecard-all', weekLabel],
    queryFn: () => api.get('/amazon-scorecard', { params: { week: weekLabel } }).then(r => r.data),
    enabled: !!weekLabel,
  });

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
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Upload failed');
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const getRowBg = (d, i) => {
    if (d.packages > 899 && d.rank_position <= 4) return 'bg-green-50';
    if (d.packages > 899 && d.rank_position <= 8) return 'bg-blue-50';
    return i % 2 === 1 ? 'bg-slate-50/50' : '';
  };

  const isPerfect = (d) => d.final_ranking == 100 && d.packages > 899
    && d.speeding_score == 100 && d.seatbelt_score == 100 && d.distraction_score == 100
    && d.sign_signal_score == 100 && d.following_dist_score == 100
    && d.cdf_revised == 0 && d.dsb_revised == 0;

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Scorecard</h1>
        <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border bg-white hover:bg-slate-50 cursor-pointer text-sm font-medium transition-all ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
          <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload Scorecard'}
          <input type="file" accept=".xlsx,.xls" className="hidden" ref={fileRef} disabled={uploading} onChange={e => handleUpload(e.target.files?.[0])} />
        </label>
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

      {/* Week navigation */}
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

      {/* Leaderboard */}
      {isLoading && <p className="text-center text-slate-400 py-12">Loading…</p>}
      {!isLoading && drivers.length === 0 && weekLabel && (
        <div className="bg-white rounded-xl border py-12 text-center">
          <Award size={36} className="mx-auto text-slate-300 mb-3" />
          <p className="font-semibold text-slate-500">No scorecard data for {weekLabel}</p>
          <p className="text-xs text-slate-400 mt-1">Upload a scorecard Excel file to get started</p>
        </div>
      )}
      {drivers.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-xs font-semibold text-slate-500 uppercase">
                <th className="px-3 py-2.5 text-center w-10">#</th>
                <th className="px-3 py-2.5 text-left">Driver</th>
                <th className="px-3 py-2.5 text-center">Score</th>
                <th className="px-3 py-2.5 text-center">Packages</th>
                <th className="px-3 py-2.5 text-center">Safety</th>
                <th className="px-3 py-2.5 text-center">DSB</th>
                <th className="px-3 py-2.5 text-center">Bonus</th>
                <th className="px-3 py-2.5 text-center">DCR</th>
                <th className="px-3 py-2.5 text-center">POD</th>
                <th className="px-3 py-2.5 text-center">Incentive</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {drivers.map((d, i) => (
                <>
                  <tr key={d.id} className={`${getRowBg(d, i)} cursor-pointer hover:bg-slate-100 transition-colors`} onClick={() => setExpandedRow(expandedRow === d.id ? null : d.id)}>
                    <td className="px-3 py-2 text-center font-mono text-xs text-slate-400">{d.rank_position}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {isPerfect(d) && <Star size={12} className="inline text-amber-500 mr-1" fill="#F59E0B" />}
                      {d.driver_name}
                      {!d.staff_id && <span className="ml-1 text-[9px] text-red-400">(unmatched)</span>}
                    </td>
                    <td className="px-3 py-2 text-center font-bold">{d.final_ranking ?? '—'}</td>
                    <td className="px-3 py-2 text-center">{d.packages ?? '—'}</td>
                    <td className="px-3 py-2 text-center"><Badge pass={d.safety_pass} /></td>
                    <td className="px-3 py-2 text-center"><Badge pass={d.dsb_pass} /></td>
                    <td className="px-3 py-2 text-center"><Badge pass={d.bonus_hours} label={d.bonus_hours ? 'Yes' : '—'} /></td>
                    <td className={`px-3 py-2 text-center font-semibold ${d.dcr_score >= 95 ? 'text-green-700' : 'text-red-600'}`}>{d.dcr_score ?? '—'}</td>
                    <td className="px-3 py-2 text-center">{d.pod_rate ? (d.pod_rate * 100).toFixed(1) + '%' : '—'}</td>
                    <td className="px-3 py-2 text-center text-xs">{d.incentive_per_package > 0 ? `$${parseFloat(d.incentive_per_package).toFixed(2)}` : '—'}</td>
                  </tr>
                  {expandedRow === d.id && (
                    <tr key={`exp-${d.id}`}>
                      <td colSpan={10} className="bg-slate-50 px-6 py-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                          <div><span className="text-slate-400 block">Speeding</span><span className="font-bold">{d.speeding_score ?? '—'}</span> <Badge pass={d.speeding_score == 100} /></div>
                          <div><span className="text-slate-400 block">Seatbelt</span><span className="font-bold">{d.seatbelt_score ?? '—'}</span> <Badge pass={d.seatbelt_score == 100} /></div>
                          <div><span className="text-slate-400 block">Distraction</span><span className="font-bold">{d.distraction_score ?? '—'}</span> <Badge pass={d.distraction_score == 100} /></div>
                          <div><span className="text-slate-400 block">Sign/Signal</span><span className="font-bold">{d.sign_signal_score ?? '—'}</span> <Badge pass={d.sign_signal_score == 100} /></div>
                          <div><span className="text-slate-400 block">Following Dist</span><span className="font-bold">{d.following_dist_score ?? '—'}</span> <Badge pass={d.following_dist_score == 100} /></div>
                          <div><span className="text-slate-400 block">CDF (Revised)</span><span className={`font-bold ${d.cdf_revised == 0 ? 'text-green-700' : 'text-red-600'}`}>{d.cdf_revised}</span></div>
                          <div><span className="text-slate-400 block">DSB (Revised)</span><span className={`font-bold ${d.dsb_revised == 0 ? 'text-green-700' : 'text-red-600'}`}>{d.dsb_revised}</span></div>
                          <div><span className="text-slate-400 block">Standing</span><span className="font-bold">{d.overall_standing || '—'}</span></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
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
                className={`w-full flex justify-between text-sm py-1.5 px-2 rounded transition-colors ${w.week_label === weekLabel ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-50 text-slate-600'}`}>
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

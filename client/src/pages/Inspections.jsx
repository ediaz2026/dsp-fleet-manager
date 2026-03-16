import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { format } from 'date-fns';
import { Camera, CheckCircle, AlertTriangle, Clock, ZoomIn } from 'lucide-react';
import api from '../api/client';
import Badge from '../components/Badge';
import Modal from '../components/Modal';

export default function Inspections() {
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [photoModal, setPhotoModal] = useState(null);

  const { data: inspections = [], isLoading } = useQuery({
    queryKey: ['inspections', filter],
    queryFn: () => api.get('/inspections', {
      params: filter !== 'all' ? (filter === 'flagged' ? { ai_status: 'flagged' } : { status: filter }) : {}
    }).then(r => r.data),
  });

  const { data: detail } = useQuery({
    queryKey: ['inspection-detail', selected?.id],
    queryFn: () => api.get(`/inspections/${selected.id}`).then(r => r.data),
    enabled: !!selected,
  });

  const PHOTO_ANGLES = ['front', 'left_side', 'right_side', 'rear', 'interior'];
  const angleLabels = { front: 'Front', left_side: 'Left Side', right_side: 'Right Side', rear: 'Rear', interior: 'Interior' };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Vehicle Inspections</h1>
        <p className="text-slate-400 text-sm">Drivers scan QR codes to submit inspections</p>
      </div>

      <div className="flex gap-1 p-1 bg-surface-card rounded-xl border border-surface-border w-fit">
        {[['all','All'],['flagged','Flagged'],['completed','Completed'],['in_progress','In Progress']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === v ? 'bg-primary text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            {l}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="card h-16 animate-pulse bg-surface-hover" />)}</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-xs text-slate-400">
                <th className="text-left px-4 py-3">Vehicle</th>
                <th className="text-left px-4 py-3">Driver</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Condition</th>
                <th className="text-left px-4 py-3">AI Status</th>
                <th className="text-left px-4 py-3">Photos</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {inspections.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-500">No inspections found</td></tr>
              ) : inspections.map(i => (
                <tr key={i.id} className="table-row cursor-pointer" onClick={() => setSelected(i)}>
                  <td className="px-4 py-3 font-medium text-slate-200">{i.vehicle_name}</td>
                  <td className="px-4 py-3 text-slate-400">{i.driver_first} {i.driver_last}</td>
                  <td className="px-4 py-3 text-slate-500">{format(new Date(i.inspection_date), 'MMM d, h:mm a')}</td>
                  <td className="px-4 py-3 text-slate-400 capitalize">{i.inspection_type?.replace('_', ' ')}</td>
                  <td className="px-4 py-3">{i.overall_condition ? <Badge status={i.overall_condition} /> : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {i.ai_analysis_status === 'flagged' && <AlertTriangle size={14} className="text-red-400" />}
                      {i.ai_analysis_status === 'analyzed' && <CheckCircle size={14} className="text-green-400" />}
                      {i.ai_analysis_status === 'pending' && <Clock size={14} className="text-slate-400" />}
                      <span className="text-xs text-slate-400 capitalize">{i.ai_analysis_status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{i.photo_count}</td>
                  <td className="px-4 py-3"><Badge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Modal */}
      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={`Inspection — ${selected?.vehicle_name}`} size="xl">
        {detail && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><p className="text-xs text-slate-400">Driver</p><p className="text-slate-200">{detail.driver_first} {detail.driver_last}</p></div>
              <div><p className="text-xs text-slate-400">Date</p><p className="text-slate-200">{format(new Date(detail.inspection_date), 'MMM d, yyyy h:mm a')}</p></div>
              <div><p className="text-xs text-slate-400">Overall Condition</p>{detail.overall_condition ? <Badge status={detail.overall_condition} /> : <p className="text-slate-500">—</p>}</div>
            </div>

            {detail.ai_analysis_notes && (
              <div className={`rounded-xl px-4 py-3 ${detail.ai_analysis_status === 'flagged' ? 'bg-red-500/10 border border-red-500/30' : 'bg-green-500/10 border border-green-500/30'}`}>
                <p className={`text-xs font-bold mb-1 ${detail.ai_analysis_status === 'flagged' ? 'text-red-400' : 'text-green-400'}`}>
                  AI Analysis {detail.ai_analysis_status === 'flagged' ? '— DAMAGE DETECTED' : '— Clear'}
                </p>
                <p className="text-sm text-slate-300">{detail.ai_analysis_notes}</p>
              </div>
            )}

            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-3">Photos</p>
              <div className="grid grid-cols-3 gap-3">
                {PHOTO_ANGLES.map(angle => {
                  const photo = detail.photos?.find(p => p.photo_angle === angle);
                  return (
                    <div key={angle} className="relative">
                      <p className="text-xs text-slate-500 mb-1">{angleLabels[angle]}</p>
                      {photo ? (
                        <div className={`relative rounded-lg overflow-hidden border ${photo.ai_flagged ? 'border-red-500' : 'border-surface-border'}`}>
                          <img src={photo.file_path} alt={angle} className="w-full h-28 object-cover cursor-pointer"
                            onClick={() => setPhotoModal(photo)}
                            onError={e => { e.target.src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="%23334155"/><text x="50" y="45" text-anchor="middle" fill="%2394a3b8" font-size="10">No Preview</text></svg>`; }} />
                          {photo.ai_flagged && (
                            <div className="absolute top-1 right-1 bg-red-500 rounded-full px-1.5 py-0.5 text-[10px] text-white font-bold">AI</div>
                          )}
                          <button onClick={() => setPhotoModal(photo)} className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 bg-black/40 transition-opacity">
                            <ZoomIn size={20} className="text-white" />
                          </button>
                        </div>
                      ) : (
                        <div className="h-28 rounded-lg border border-dashed border-surface-border flex items-center justify-center">
                          <Camera size={20} className="text-slate-600" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {detail.notes && (
              <div className="border-t border-surface-border pt-4">
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-1">Driver Notes</p>
                <p className="text-slate-400 text-sm">{detail.notes}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Photo zoom modal */}
      <Modal isOpen={!!photoModal} onClose={() => setPhotoModal(null)} title={`Photo — ${photoModal?.photo_angle}`}>
        {photoModal && <img src={photoModal.file_path} alt="" className="w-full rounded-lg" />}
      </Modal>
    </div>
  );
}

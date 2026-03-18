import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { format } from 'date-fns';
import { Camera, CheckCircle, AlertTriangle, Clock, ZoomIn } from 'lucide-react';
import api from '../api/client';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import { useSort } from '../hooks/useSort';
import SortableHeader from '../components/SortableHeader';

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

  const { sorted, sortKey, sortDir, toggle } = useSort(inspections, 'inspection_date', 'desc');

  const PHOTO_ANGLES = ['front', 'left_side', 'right_side', 'rear', 'interior'];
  const angleLabels = { front: 'Front', left_side: 'Left Side', right_side: 'Right Side', rear: 'Rear', interior: 'Interior' };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Vehicle Inspections</h1>
        <p className="text-slate-500 text-sm">Drivers scan QR codes to submit inspections</p>
      </div>

      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200 w-fit">
        {[['all','All'],['flagged','Flagged'],['completed','Completed'],['in_progress','In Progress']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === v ? 'bg-primary text-white' : 'text-slate-500 hover:text-slate-700'}`}>
            {l}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="card h-16 animate-pulse bg-slate-100" />)}</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100">
                <SortableHeader label="Vehicle" sortKey="vehicle_name" currentKey={sortKey} direction={sortDir} onSort={toggle} className="text-left" />
                <SortableHeader label="Driver" sortKey="driver_first" currentKey={sortKey} direction={sortDir} onSort={toggle} className="text-left" />
                <SortableHeader label="Date" sortKey="inspection_date" currentKey={sortKey} direction={sortDir} onSort={toggle} className="text-left" />
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-700 uppercase tracking-wide bg-slate-100">Type</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-700 uppercase tracking-wide bg-slate-100">Condition</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-700 uppercase tracking-wide bg-slate-100">AI Status</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-700 uppercase tracking-wide bg-slate-100">Photos</th>
                <SortableHeader label="Status" sortKey="status" currentKey={sortKey} direction={sortDir} onSort={toggle} className="text-left" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-500">No inspections found</td></tr>
              ) : sorted.map(i => (
                <tr key={i.id} className="table-row cursor-pointer even:bg-slate-50" onClick={() => setSelected(i)}>
                  <td className="px-3 py-3 font-medium text-slate-800">{i.vehicle_name}</td>
                  <td className="px-3 py-3 text-slate-600">{i.driver_first} {i.driver_last}</td>
                  <td className="px-3 py-3 text-slate-500">{format(new Date(i.inspection_date), 'MMM d, h:mm a')}</td>
                  <td className="px-3 py-3 text-slate-600 capitalize">{i.inspection_type?.replace('_', ' ')}</td>
                  <td className="px-3 py-3">{i.overall_condition ? <Badge status={i.overall_condition} /> : '—'}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      {i.ai_analysis_status === 'flagged' && <AlertTriangle size={14} className="text-red-500" />}
                      {i.ai_analysis_status === 'analyzed' && <CheckCircle size={14} className="text-green-500" />}
                      {i.ai_analysis_status === 'pending' && <Clock size={14} className="text-slate-400" />}
                      <span className="text-xs text-slate-500 capitalize">{i.ai_analysis_status}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-500">{i.photo_count}</td>
                  <td className="px-3 py-3"><Badge status={i.status} /></td>
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
              <div><p className="text-xs text-slate-500">Driver</p><p className="text-slate-800">{detail.driver_first} {detail.driver_last}</p></div>
              <div><p className="text-xs text-slate-500">Date</p><p className="text-slate-800">{format(new Date(detail.inspection_date), 'MMM d, yyyy h:mm a')}</p></div>
              <div><p className="text-xs text-slate-500">Overall Condition</p>{detail.overall_condition ? <Badge status={detail.overall_condition} /> : <p className="text-slate-500">—</p>}</div>
            </div>

            {detail.ai_analysis_notes && (
              <div className={`rounded-xl px-4 py-3 ${detail.ai_analysis_status === 'flagged' ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                <p className={`text-xs font-bold mb-1 ${detail.ai_analysis_status === 'flagged' ? 'text-red-600' : 'text-green-600'}`}>
                  AI Analysis {detail.ai_analysis_status === 'flagged' ? '— DAMAGE DETECTED' : '— Clear'}
                </p>
                <p className="text-sm text-slate-700">{detail.ai_analysis_notes}</p>
              </div>
            )}

            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-3">Photos</p>
              <div className="grid grid-cols-3 gap-3">
                {PHOTO_ANGLES.map(angle => {
                  const photo = detail.photos?.find(p => p.photo_angle === angle);
                  return (
                    <div key={angle} className="relative">
                      <p className="text-xs text-slate-500 mb-1">{angleLabels[angle]}</p>
                      {photo ? (
                        <div className={`relative rounded-lg overflow-hidden border ${photo.ai_flagged ? 'border-red-400' : 'border-slate-200'}`}>
                          <img src={photo.file_path} alt={angle} className="w-full h-28 object-cover cursor-pointer"
                            onClick={() => setPhotoModal(photo)}
                            onError={e => { e.target.src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="%23e2e8f0"/><text x="50" y="45" text-anchor="middle" fill="%2394a3b8" font-size="10">No Preview</text></svg>`; }} />
                          {photo.ai_flagged && (
                            <div className="absolute top-1 right-1 bg-red-500 rounded-full px-1.5 py-0.5 text-[10px] text-white font-bold">AI</div>
                          )}
                          <button onClick={() => setPhotoModal(photo)} className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 bg-black/40 transition-opacity">
                            <ZoomIn size={20} className="text-white" />
                          </button>
                        </div>
                      ) : (
                        <div className="h-28 rounded-lg border border-dashed border-slate-200 flex items-center justify-center bg-slate-50">
                          <Camera size={20} className="text-slate-300" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {detail.notes && (
              <div className="border-t border-slate-200 pt-4">
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-1">Driver Notes</p>
                <p className="text-slate-600 text-sm">{detail.notes}</p>
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

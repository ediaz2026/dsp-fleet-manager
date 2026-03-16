import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Eye, CheckCircle, AlertTriangle, Cpu, RefreshCw, ZoomIn, X } from 'lucide-react';
import api from '../api/client';
import { useState } from 'react';
import Modal from '../components/Modal';
import toast from 'react-hot-toast';

export default function AIMonitor() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [photoZoom, setPhotoZoom] = useState(null);

  const { data: flagged = [], isLoading } = useQuery({
    queryKey: ['flagged-inspections'],
    queryFn: () => api.get('/inspections/flagged').then(r => r.data),
  });

  const { data: detail } = useQuery({
    queryKey: ['inspection-comparison', selected?.id],
    queryFn: () => api.get(`/inspections/${selected.id}/comparison`).then(r => r.data),
    enabled: !!selected,
  });

  const dismissMutation = useMutation({
    mutationFn: id => api.put(`/inspections/${id}/dismiss-flag`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flagged-inspections'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Flag dismissed');
      setSelected(null);
    },
  });

  const angleLabels = { front: 'Front', left_side: 'Left Side', right_side: 'Right Side', rear: 'Rear', interior: 'Interior' };
  const currentPhotos = detail?.current || [];
  const prevPhotos = detail?.previous || [];

  // Group previous photos by angle
  const prevByAngle = {};
  prevPhotos.forEach(p => { prevByAngle[p.photo_angle] = p; });

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">AI Damage Monitor</h1>
          <p className="text-slate-400 text-sm mt-1">AI compares each inspection to the previous one and flags visual changes</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Cpu size={16} className="text-primary" />
          Powered by Claude Vision
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="card h-24 animate-pulse bg-surface-hover" />)}</div>
      ) : flagged.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-green-400" />
          </div>
          <h2 className="text-lg font-semibold text-slate-200">No Damage Flags</h2>
          <p className="text-slate-500 text-sm mt-1">All recent inspections look clean</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
            <AlertTriangle size={18} className="text-red-400" />
            <p className="text-sm text-red-300 font-medium">{flagged.length} vehicle{flagged.length > 1 ? 's' : ''} flagged for potential damage — review required</p>
          </div>

          {flagged.map(insp => (
            <div key={insp.id} className="card border-red-500/20 hover:border-red-500/40 cursor-pointer transition-colors" onClick={() => setSelected(insp)}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                    <Eye size={20} className="text-red-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-100">{insp.vehicle_name}</h3>
                    <p className="text-xs text-slate-500">{insp.license_plate}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="badge bg-red-500/20 text-red-400">FLAGGED</span>
                  <p className="text-xs text-slate-500 mt-1">{format(new Date(insp.inspection_date), 'MMM d, h:mm a')}</p>
                </div>
              </div>

              {insp.ai_analysis_notes && (
                <div className="mt-3 px-3 py-2 bg-red-500/5 rounded-lg border border-red-500/10">
                  <p className="text-xs text-slate-400">{insp.ai_analysis_notes}</p>
                </div>
              )}

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-border">
                <p className="text-xs text-slate-500">Driver: {insp.driver_first} {insp.driver_last}</p>
                <button className="text-xs text-primary hover:underline">View comparison →</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Comparison Modal */}
      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={`Damage Review — ${selected?.vehicle_name}`} size="xl">
        {selected && (
          <div className="space-y-5">
            {/* AI Analysis banner */}
            {detail?.inspection?.ai_analysis_notes && (
              <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <Cpu size={14} className="text-red-400" />
                  <p className="text-xs font-bold text-red-400">AI Analysis Report</p>
                </div>
                <p className="text-sm text-slate-300">{detail.inspection.ai_analysis_notes}</p>
              </div>
            )}

            {/* Photo comparison */}
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-3">Before vs. After Comparison</p>
              <div className="space-y-4">
                {currentPhotos.map(photo => {
                  const prev = prevByAngle[photo.photo_angle];
                  return (
                    <div key={photo.id} className={`p-3 rounded-xl border ${photo.ai_flagged ? 'border-red-500/50 bg-red-500/5' : 'border-surface-border'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-slate-300">{angleLabels[photo.photo_angle] || photo.photo_angle}</p>
                        {photo.ai_flagged && (
                          <span className="badge bg-red-500/20 text-red-400 text-[10px]">
                            ⚠ {photo.ai_confidence ? `${Math.round(photo.ai_confidence)}% confidence` : 'AI Flagged'}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Previous</p>
                          {prev ? (
                            <div className="relative cursor-pointer" onClick={() => setPhotoZoom(prev)}>
                              <img src={prev.file_path} alt="previous" className="w-full h-36 object-cover rounded-lg border border-surface-border"
                                onError={e => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="%23334155"/><text x="50" y="45" text-anchor="middle" fill="%2394a3b8" font-size="9">Previous</text></svg>'; }} />
                              <ZoomIn size={16} className="absolute top-2 right-2 text-white opacity-70" />
                            </div>
                          ) : (
                            <div className="h-36 rounded-lg border border-dashed border-surface-border flex items-center justify-center">
                              <p className="text-xs text-slate-600">No previous photo</p>
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Current {photo.ai_flagged ? '⚠' : ''}</p>
                          <div className="relative cursor-pointer" onClick={() => setPhotoZoom(photo)}>
                            <img src={photo.file_path} alt="current" className={`w-full h-36 object-cover rounded-lg border ${photo.ai_flagged ? 'border-red-500' : 'border-surface-border'}`}
                              onError={e => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="%23334155"/><text x="50" y="45" text-anchor="middle" fill="%2394a3b8" font-size="9">Current</text></svg>'; }} />
                            <ZoomIn size={16} className="absolute top-2 right-2 text-white opacity-70" />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {currentPhotos.length === 0 && (
                  <p className="text-slate-500 text-sm text-center py-8">No photos available for comparison</p>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-2 border-t border-surface-border">
              <button className="btn-secondary flex-1" onClick={() => dismissMutation.mutate(selected.id)} disabled={dismissMutation.isPending}>
                <X size={16} /> Dismiss Flag (No Damage)
              </button>
              <button className="btn-danger flex-1" onClick={() => { toast('Damage claim opened — contact manager'); setSelected(null); }}>
                <AlertTriangle size={16} /> Flag for Repair
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Photo zoom */}
      <Modal isOpen={!!photoZoom} onClose={() => setPhotoZoom(null)} title="Photo" size="lg">
        {photoZoom && <img src={photoZoom.file_path} alt="" className="w-full rounded-lg"
          onError={e => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="%23334155"/></svg>'; }} />}
      </Modal>
    </div>
  );
}

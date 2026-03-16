import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { format } from 'date-fns';
import { Upload, Package, CheckCircle, XCircle, AlertTriangle, ChevronRight } from 'lucide-react';
import api from '../api/client';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import toast from 'react-hot-toast';
import { useAuth } from '../App';

export default function AmazonRoutes() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isManager = ['manager', 'admin', 'dispatcher'].includes(user?.role);
  const [selectedFile, setSelectedFile] = useState(null);
  const [routeDate, setRouteDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [file, setFile] = useState(null);
  const [viewFile, setViewFile] = useState(null);
  const [matchModal, setMatchModal] = useState(null);
  const [matchStaffId, setMatchStaffId] = useState('');

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['amazon-files'],
    queryFn: () => api.get('/amazon-routes').then(r => r.data),
  });

  const { data: routes = [] } = useQuery({
    queryKey: ['amazon-routes', viewFile?.id],
    queryFn: () => api.get(`/amazon-routes/${viewFile.id}/routes`).then(r => r.data),
    enabled: !!viewFile,
  });

  const { data: staff = [] } = useQuery({
    queryKey: ['staff-drivers'],
    queryFn: () => api.get('/staff', { params: { role: 'driver', status: 'active' } }).then(r => r.data),
    enabled: !!matchModal,
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('route_date', routeDate);
      return api.post('/amazon-routes/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['amazon-files'] });
      const { matched, mismatched, unmatched, total } = res.data;
      toast.success(`Uploaded: ${matched}/${total} matched, ${mismatched} mismatched, ${unmatched} unmatched`);
      setSelectedFile(null); setFile(null);
    },
    onError: err => toast.error(err.response?.data?.error || 'Upload failed'),
  });

  const matchMutation = useMutation({
    mutationFn: ({ routeId }) => api.post(`/amazon-routes/${viewFile.id}/match/${routeId}`, { staff_id: matchStaffId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['amazon-routes', viewFile?.id] });
      qc.invalidateQueries({ queryKey: ['amazon-files'] });
      toast.success('Driver matched'); setMatchModal(null);
    },
  });

  const matchColors = { matched: 'text-green-400', mismatched: 'text-orange-400', unmatched: 'text-red-400' };
  const matchIcons = { matched: CheckCircle, mismatched: AlertTriangle, unmatched: XCircle };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Amazon Routes</h1>
        {isManager && (
          <button className="btn-primary" onClick={() => setSelectedFile('upload')}>
            <Upload size={16} /> Upload Route File
          </button>
        )}
      </div>

      {/* Upload Modal */}
      <Modal isOpen={selectedFile === 'upload'} onClose={() => { setSelectedFile(null); setFile(null); }} title="Upload Amazon Route File">
        <div className="space-y-4">
          <div>
            <label className="label">Route Date</label>
            <input type="date" className="input" value={routeDate} onChange={e => setRouteDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Route File (CSV or Excel)</label>
            <label className="block w-full border-2 border-dashed border-surface-border rounded-xl p-8 text-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-all">
              {file ? (
                <div>
                  <Package size={24} className="text-primary mx-auto mb-2" />
                  <p className="text-sm text-slate-300 font-medium">{file.name}</p>
                  <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <Upload size={24} className="text-slate-500 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">Click to select file</p>
                  <p className="text-xs text-slate-600 mt-1">CSV or XLSX format</p>
                </div>
              )}
              <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
            </label>
            <p className="text-xs text-slate-500 mt-2">File should contain columns: Route Code, Driver Name (or Associate Name), Driver ID (or Badge ID)</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button className="btn-secondary flex-1" onClick={() => { setSelectedFile(null); setFile(null); }}>Cancel</button>
            <button className="btn-primary flex-1" disabled={!file || uploadMutation.isPending} onClick={() => uploadMutation.mutate()}>
              {uploadMutation.isPending ? 'Processing…' : 'Upload & Match'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Files list */}
      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="card h-20 animate-pulse bg-surface-hover" />)}</div>
      ) : files.length === 0 ? (
        <div className="card text-center py-16">
          <Package size={40} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No route files uploaded yet</p>
          <p className="text-slate-600 text-sm">Upload an Amazon route CSV to match drivers</p>
        </div>
      ) : !viewFile ? (
        <div className="space-y-3">
          {files.map(f => (
            <div key={f.id} className="card flex items-center justify-between cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setViewFile(f)}>
              <div className="flex items-center gap-3">
                <Package size={20} className="text-primary" />
                <div>
                  <p className="font-medium text-slate-200">{f.file_name}</p>
                  <p className="text-xs text-slate-500">Route date: {format(new Date(f.route_date), 'MMM d, yyyy')} · Uploaded {format(new Date(f.created_at), 'MMM d')}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-green-400">{f.matched_routes} matched</span>
                <span className="text-orange-400">{f.mismatched_routes} mismatched</span>
                <span className="text-red-400">{f.unmatched_routes} unmatched</span>
                <ChevronRight size={16} className="text-slate-500" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <button className="btn-secondary" onClick={() => setViewFile(null)}>← Back to Files</button>

          <div className="card">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-slate-100">{viewFile.file_name}</h2>
                <p className="text-sm text-slate-400">Route date: {format(new Date(viewFile.route_date), 'MMMM d, yyyy')}</p>
              </div>
              <div className="flex gap-3 text-center text-sm">
                <div><p className="text-2xl font-bold text-green-400">{viewFile.matched_routes}</p><p className="text-xs text-slate-500">Matched</p></div>
                <div><p className="text-2xl font-bold text-orange-400">{viewFile.mismatched_routes}</p><p className="text-xs text-slate-500">Mismatch</p></div>
                <div><p className="text-2xl font-bold text-red-400">{viewFile.unmatched_routes}</p><p className="text-xs text-slate-500">Unmatched</p></div>
              </div>
            </div>

            {/* Mismatch indicator */}
            {(viewFile.mismatched_routes > 0 || viewFile.unmatched_routes > 0) && (
              <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                <AlertTriangle size={14} className="text-yellow-400" />
                <p className="text-xs text-yellow-300">{viewFile.mismatched_routes + viewFile.unmatched_routes} routes need review — Amazon roster doesn't match internal schedule</p>
              </div>
            )}
          </div>

          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border text-xs text-slate-400">
                  <th className="text-left px-4 py-3">Route</th>
                  <th className="text-left px-4 py-3">Amazon Driver Name</th>
                  <th className="text-left px-4 py-3">Internal Match</th>
                  <th className="text-left px-4 py-3">Status</th>
                  {isManager && <th className="text-left px-4 py-3">Action</th>}
                </tr>
              </thead>
              <tbody>
                {routes.map(r => {
                  const Icon = matchIcons[r.match_status] || XCircle;
                  return (
                    <tr key={r.id} className="table-row">
                      <td className="px-4 py-3 font-mono text-slate-300">{r.route_code}</td>
                      <td className="px-4 py-3 text-slate-400">{r.amazon_driver_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-300">
                        {r.internal_first ? `${r.internal_first} ${r.internal_last}` : <span className="text-slate-600">Not matched</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Icon size={14} className={matchColors[r.match_status]} />
                          <Badge status={r.match_status} />
                        </div>
                      </td>
                      {isManager && (
                        <td className="px-4 py-3">
                          {r.match_status !== 'matched' && (
                            <button onClick={() => { setMatchModal(r); setMatchStaffId(''); }} className="text-xs text-primary hover:underline">
                              {r.match_status === 'mismatched' ? 'Fix match' : 'Match driver'}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual match modal */}
      <Modal isOpen={!!matchModal} onClose={() => setMatchModal(null)} title="Match Driver" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-400">Amazon route <span className="text-slate-200 font-medium">{matchModal?.route_code}</span> — Amazon driver: <span className="text-slate-200 font-medium">{matchModal?.amazon_driver_name}</span></p>
          <div>
            <label className="label">Internal Driver</label>
            <select className="select" value={matchStaffId} onChange={e => setMatchStaffId(e.target.value)}>
              <option value="">Select driver…</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.employee_id})</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => setMatchModal(null)}>Cancel</button>
            <button className="btn-primary flex-1" disabled={!matchStaffId || matchMutation.isPending} onClick={() => matchMutation.mutate({ routeId: matchModal.id })}>
              {matchMutation.isPending ? 'Saving…' : 'Save Match'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

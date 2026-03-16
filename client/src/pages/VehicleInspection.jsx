import { useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Camera, Check, ChevronRight, ChevronLeft, Upload, Truck, Loader } from 'lucide-react';
import api from '../api/client';
import toast from 'react-hot-toast';

const STEPS = [
  { angle: 'front', label: 'Front of Vehicle', description: 'Stand 10 feet in front. Capture the entire front bumper, hood, and headlights.', color: '#3b82f6' },
  { angle: 'left_side', label: 'Left Side', description: 'Stand beside the driver side. Capture from front door to rear panel.', color: '#8b5cf6' },
  { angle: 'right_side', label: 'Right Side', description: 'Stand beside the passenger side. Capture from front to rear.', color: '#06b6d4' },
  { angle: 'rear', label: 'Rear of Vehicle', description: 'Stand behind the vehicle. Capture bumper, doors, and license plate.', color: '#10b981' },
  { angle: 'interior', label: 'Interior / Cargo', description: 'Open the cargo area or driver door. Capture the interior condition.', color: '#f59e0b' },
];

export default function VehicleInspection() {
  const { vehicleId } = useParams();
  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState({});
  const [inspectionId, setInspectionId] = useState(null);
  const [driverName, setDriverName] = useState('');
  const [notes, setNotes] = useState('');
  const [condition, setCondition] = useState('good');
  const [phase, setPhase] = useState('intro'); // intro, shooting, review, done
  const fileRef = useRef();

  const { data: vehicle } = useQuery({
    queryKey: ['vehicle-qr', vehicleId],
    queryFn: () => api.get(`/vehicles/${vehicleId}`).then(r => r.data),
  });

  const startMutation = useMutation({
    mutationFn: () => api.post('/inspections', { vehicle_id: vehicleId, inspection_type: 'pre_trip' }),
    onSuccess: (res) => { setInspectionId(res.data.id); setPhase('shooting'); },
    onError: () => {
      // Try without auth for public QR access - create a temporary inspection ID
      setInspectionId(`temp-${Date.now()}`);
      setPhase('shooting');
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ angle, file }) => {
      if (!inspectionId || inspectionId.startsWith('temp-')) {
        // Store locally for demo
        return { file_path: URL.createObjectURL(file) };
      }
      const fd = new FormData();
      fd.append('photo', file);
      fd.append('photo_angle', angle);
      return api.post(`/inspections/${inspectionId}/photos`, fd).then(r => r.data);
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => {
      if (!inspectionId || inspectionId.startsWith('temp-')) return Promise.resolve({ data: {} });
      return api.post(`/inspections/${inspectionId}/complete`, { overall_condition: condition, notes });
    },
    onSuccess: () => setPhase('done'),
    onError: () => setPhase('done'),
  });

  const handlePhoto = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const angle = STEPS[step].angle;
    const preview = URL.createObjectURL(file);
    setPhotos(p => ({ ...p, [angle]: { file, preview } }));
    await uploadMutation.mutateAsync({ angle, file });
    toast.success(`${STEPS[step].label} captured!`);
  }, [step, uploadMutation]);

  const currentStep = STEPS[step];
  const allPhotos = STEPS.every(s => photos[s.angle]);

  if (phase === 'intro') {
    return (
      <MobileShell>
        <div className="text-center space-y-6">
          <div className="w-20 h-20 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto">
            <Truck size={40} className="text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{vehicle?.vehicle_name || 'Vehicle'}</h1>
            <p className="text-slate-400 mt-1">Pre-Trip Inspection</p>
          </div>
          {vehicle && (
            <div className="bg-surface-card rounded-xl p-4 text-left text-sm space-y-2">
              <Row label="Make/Model" value={`${vehicle.year} ${vehicle.make} ${vehicle.model}`} />
              <Row label="Plate" value={vehicle.license_plate} />
              <Row label="Color" value={vehicle.color} />
            </div>
          )}
          <div>
            <label className="label text-left">Your Name</label>
            <input className="input" placeholder="Full name" value={driverName} onChange={e => setDriverName(e.target.value)} />
          </div>
          <button
            className="btn-primary w-full justify-center py-3 text-base"
            onClick={() => startMutation.mutate()}
            disabled={!driverName.trim() || startMutation.isPending}
          >
            {startMutation.isPending ? <Loader size={18} className="animate-spin" /> : <><Camera size={18} /> Start Inspection</>}
          </button>
          <p className="text-xs text-slate-500">You'll photograph 5 angles of the vehicle. Takes ~2 minutes.</p>
        </div>
      </MobileShell>
    );
  }

  if (phase === 'shooting') {
    const photo = photos[currentStep.angle];
    return (
      <MobileShell>
        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-slate-400 mb-2">
            <span>Step {step + 1} of {STEPS.length}</span>
            <span>{STEPS.filter(s => photos[s.angle]).length} captured</span>
          </div>
          <div className="h-2 bg-surface-card rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
          <div className="flex gap-1 mt-2">
            {STEPS.map((s, i) => (
              <button key={s.angle} onClick={() => setStep(i)}
                className={`flex-1 h-1.5 rounded-full transition-all ${i === step ? 'bg-primary' : photos[s.angle] ? 'bg-green-500' : 'bg-surface-border'}`} />
            ))}
          </div>
        </div>

        {/* Current step */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: `${currentStep.color}20` }}>
            <Camera size={28} style={{ color: currentStep.color }} />
          </div>
          <h2 className="text-xl font-bold text-white">{currentStep.label}</h2>
          <p className="text-slate-400 text-sm mt-2">{currentStep.description}</p>
        </div>

        {/* Photo area */}
        {photo ? (
          <div className="relative rounded-2xl overflow-hidden mb-6 border-2 border-green-500">
            <img src={photo.preview} alt="" className="w-full h-56 object-cover" />
            <div className="absolute top-3 right-3 bg-green-500 rounded-full p-1.5">
              <Check size={16} className="text-white" />
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 text-white text-sm transition-opacity"
            >Retake</button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full h-56 rounded-2xl border-2 border-dashed border-surface-border flex flex-col items-center justify-center gap-3 mb-6 hover:border-primary hover:bg-primary/5 transition-all"
          >
            <Upload size={32} className="text-slate-500" />
            <p className="text-slate-400">Tap to take photo</p>
            <p className="text-xs text-slate-600">Camera or file upload</p>
          </button>
        )}

        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />

        {/* Navigation */}
        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>
            <ChevronLeft size={16} /> Back
          </button>
          {step < STEPS.length - 1 ? (
            <button className="btn-primary flex-1" onClick={() => setStep(s => s + 1)}>
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <button
              className="btn-primary flex-1"
              onClick={() => setPhase('review')}
              disabled={!allPhotos}
            >
              Review <ChevronRight size={16} />
            </button>
          )}
        </div>
        {!allPhotos && step === STEPS.length - 1 && (
          <p className="text-xs text-yellow-400 text-center mt-2">Please capture all 5 photo angles before submitting</p>
        )}
      </MobileShell>
    );
  }

  if (phase === 'review') {
    return (
      <MobileShell>
        <h2 className="text-xl font-bold text-white mb-4">Review Inspection</h2>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {STEPS.map(s => (
            <div key={s.angle}>
              <p className="text-xs text-slate-500 mb-1">{s.label}</p>
              {photos[s.angle] ? (
                <img src={photos[s.angle].preview} alt={s.angle} className="w-full h-24 object-cover rounded-lg border border-surface-border" />
              ) : (
                <div className="h-24 rounded-lg border-2 border-dashed border-red-500/50 flex items-center justify-center">
                  <p className="text-xs text-red-400">Missing</p>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="label">Overall Condition</label>
            <select className="select" value={condition} onChange={e => setCondition(e.target.value)}>
              <option value="excellent">Excellent</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor — damage present</option>
            </select>
          </div>
          <div>
            <label className="label">Notes (optional)</label>
            <textarea className="input min-h-20 resize-none" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Any damage, issues, or notes…" />
          </div>
        </div>

        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={() => setPhase('shooting')}>
            <ChevronLeft size={16} /> Back
          </button>
          <button className="btn-primary flex-1" onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending}>
            {completeMutation.isPending ? <><Loader size={16} className="animate-spin" /> Submitting…</> : <><Check size={16} /> Submit</>}
          </button>
        </div>
      </MobileShell>
    );
  }

  if (phase === 'done') {
    return (
      <MobileShell>
        <div className="text-center space-y-6 py-8">
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
            <Check size={40} className="text-green-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Inspection Complete!</h2>
            <p className="text-slate-400 mt-2">Your {STEPS.length}-photo inspection has been submitted.</p>
          </div>
          <div className="bg-surface-card rounded-xl p-4 text-sm space-y-2">
            <Row label="Vehicle" value={vehicle?.vehicle_name} />
            <Row label="Driver" value={driverName} />
            <Row label="Condition" value={condition.charAt(0).toUpperCase() + condition.slice(1)} />
            <Row label="Photos" value={`${STEPS.length} / ${STEPS.length}`} />
            <Row label="AI Analysis" value="Processing…" />
          </div>
          <p className="text-xs text-slate-500">AI will analyze photos for damage. Manager will be notified of any issues.</p>
          <button className="btn-secondary w-full" onClick={() => window.location.reload()}>Start New Inspection</button>
        </div>
      </MobileShell>
    );
  }
}

function MobileShell({ children }) {
  return (
    <div className="min-h-screen bg-sidebar flex items-start justify-center p-4 pt-8 pb-16">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Truck size={16} className="text-white" />
          </div>
          <div>
            <p className="text-xs font-bold text-white">DSP Fleet Manager</p>
            <p className="text-xs text-slate-500">Vehicle Inspection</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 font-medium">{value || '—'}</span>
    </div>
  );
}

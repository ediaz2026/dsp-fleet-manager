import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Camera, X, CheckCircle, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import toast from 'react-hot-toast';

export default function DriverReportIssue() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef();
  const [vehicleId, setVehicleId] = useState(null);
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const [confirmChange, setConfirmChange] = useState(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState([]); // { file, preview, url, uploading }
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const { data: assignment } = useQuery({
    queryKey: ['my-assignment'],
    queryFn: () => api.get('/ops/my-assignment').then(r => r.data),
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => api.get('/vehicles').then(r => r.data),
    enabled: true,
  });

  const assignedVehicle = assignment?.vehicle_name || null;
  const activeVehicleId = vehicleId || (vehicles.find(v => v.vehicle_name === assignedVehicle)?.id) || null;
  const activeVehicleName = vehicleId ? vehicles.find(v => v.id === vehicleId)?.vehicle_name : assignedVehicle;

  const handlePhotos = async (files) => {
    const newPhotos = [...photos];
    for (const file of Array.from(files).slice(0, 4 - photos.length)) {
      const preview = URL.createObjectURL(file);
      const idx = newPhotos.length;
      newPhotos.push({ file, preview, url: null, uploading: true });
      setPhotos([...newPhotos]);

      try {
        const reader = new FileReader();
        const base64 = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const { data } = await api.post('/driver-reports/upload-photo', { image: base64 });
        newPhotos[idx] = { ...newPhotos[idx], url: data.url, uploading: false };
        setPhotos([...newPhotos]);
      } catch {
        newPhotos[idx] = { ...newPhotos[idx], uploading: false };
        setPhotos([...newPhotos]);
        toast.error('Photo upload failed');
      }
    }
  };

  const removePhoto = (idx) => setPhotos(p => p.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (!activeVehicleId || !description.trim()) {
      toast.error('Please select a vehicle and describe the issue');
      return;
    }
    setSubmitting(true);
    try {
      const photoUrls = photos.filter(p => p.url).map(p => p.url);
      await api.post('/driver-reports', { vehicle_id: activeVehicleId, description, photo_urls: photoUrls });
      setSubmitted(true);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-[#F1F5F9] min-h-screen flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center max-w-sm w-full">
          <CheckCircle size={48} className="mx-auto text-green-500 mb-4" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">Report Submitted</h2>
          <p className="text-sm text-slate-500 mb-6">Your dispatcher has been notified and will review the issue.</p>
          <button onClick={() => navigate('/today')} className="btn-primary w-full justify-center">Back to Today</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#F1F5F9] min-h-screen pb-24">
      <div className="bg-[#1a3a5c] text-white px-5 pt-[max(env(safe-area-inset-top),20px)] pb-6 rounded-b-3xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-blue-200 font-medium">Vehicle Report</p>
            <h1 className="text-xl font-bold">Report an Issue</h1>
          </div>
          <button onClick={() => navigate(-1)} className="text-blue-200 text-sm">Cancel</button>
        </div>
      </div>

      <div className="px-4 -mt-3 space-y-4">
        {/* Vehicle selection */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Vehicle</p>
          <div className="flex items-center justify-between">
            <p className="text-lg font-bold text-slate-800">{activeVehicleName || 'No vehicle assigned'}</p>
            <button onClick={() => setShowVehiclePicker(true)} className="text-xs text-blue-600 font-semibold">
              {assignedVehicle ? 'Not your vehicle? Change' : 'Select vehicle'} <ChevronDown size={12} className="inline" />
            </button>
          </div>
          {showVehiclePicker && (
            <select
              className="input mt-2"
              value={activeVehicleId || ''}
              onChange={e => {
                const vid = parseInt(e.target.value);
                const vName = vehicles.find(v => v.id === vid)?.vehicle_name;
                if (assignedVehicle && vName !== assignedVehicle) {
                  setConfirmChange({ vid, name: vName });
                } else {
                  setVehicleId(vid);
                  setShowVehiclePicker(false);
                }
              }}
            >
              <option value="">Select vehicle...</option>
              {vehicles.filter(v => v.status === 'active').map(v => (
                <option key={v.id} value={v.id}>{v.vehicle_name}{v.license_plate ? ` (${v.license_plate})` : ''}</option>
              ))}
            </select>
          )}
          {confirmChange && (
            <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <p className="text-amber-800 font-semibold mb-2">Are you sure? Your assigned vehicle is {assignedVehicle}</p>
              <div className="flex gap-2">
                <button className="btn-primary text-xs py-1 px-3" onClick={() => { setVehicleId(confirmChange.vid); setShowVehiclePicker(false); setConfirmChange(null); }}>Confirm</button>
                <button className="btn-secondary text-xs py-1 px-3" onClick={() => setConfirmChange(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Description */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase mb-2">What's wrong?</p>
          <textarea
            className="input min-h-[120px] resize-none"
            placeholder="Describe the issue with the vehicle..."
            value={description}
            onChange={e => setDescription(e.target.value)}
            required
          />
        </div>

        {/* Photos */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Photos (optional)</p>
          <div className="flex gap-2 flex-wrap mb-3">
            {photos.map((p, i) => (
              <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-slate-200">
                <img src={p.preview} className="w-full h-full object-cover" alt="" />
                {p.uploading && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>}
                <button onClick={() => removePhoto(i)} className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5"><X size={12} className="text-white" /></button>
              </div>
            ))}
          </div>
          {photos.length < 4 && (
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-4 py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
              <Camera size={16} /> Add Photos {photos.length > 0 && `(${photos.length}/4)`}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handlePhotos(e.target.files)} />
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting || !description.trim()}
          className="btn-primary w-full justify-center py-3 text-base disabled:opacity-50"
        >
          {submitting ? 'Submitting...' : 'Submit Report'}
        </button>
      </div>
    </div>
  );
}

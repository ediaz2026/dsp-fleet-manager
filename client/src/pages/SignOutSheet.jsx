import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import api from '../api/client';

const OPS_EXCLUDED = new Set(['ON CALL','UTO','PTO','SUSPENSION','TRAINING','DISPATCH AM','DISPATCH PM']);
const ATT_LABELS = { ncns: 'NCNS', late: 'LATE', called_out: 'CALL OUT' };

export default function SignOutSheet() {
  const [params] = useSearchParams();
  const planDate = params.get('date') || format(new Date(), 'yyyy-MM-dd');

  const { data: shiftsData = [] } = useQuery({
    queryKey: ['shifts-daily-print', planDate],
    queryFn: () => api.get('/shifts', { params: { start: planDate, end: planDate } }).then(r => r.data),
  });
  const { data: routesData } = useQuery({
    queryKey: ['ops-routes-print', planDate],
    queryFn: () => api.get('/ops-planner/daily-routes', { params: { date: planDate } }).then(r => r.data),
  });
  const { data: loadoutData } = useQuery({
    queryKey: ['ops-loadout-print', planDate],
    queryFn: () => api.get('/ops-planner/loadout', { params: { date: planDate } }).then(r => r.data),
  });
  const { data: assignmentsArr = [] } = useQuery({
    queryKey: ['ops-assignments-print', planDate],
    queryFn: () => api.get('/ops-planner/assignments', { params: { date: planDate } }).then(r => r.data),
  });
  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles-print'],
    queryFn: () => api.get('/vehicles').then(r => r.data),
  });
  const { data: driverProfiles = [] } = useQuery({
    queryKey: ['drivers-print'],
    queryFn: () => api.get('/drivers').then(r => r.data),
  });
  const { data: allStaff = [] } = useQuery({
    queryKey: ['staff-print'],
    queryFn: () => api.get('/staff').then(r => r.data),
  });

  // Build maps
  const assignments = {};
  for (const a of assignmentsArr) assignments[a.staff_id] = a;
  const loadoutMap = {};
  for (const item of (loadoutData?.loadout || [])) loadoutMap[item.routeCode] = item;
  const shiftByStaff = {};
  for (const s of shiftsData) shiftByStaff[s.staff_id] = s;

  // Dispatchers
  const dispAM = shiftsData.filter(s => s.shift_type === 'DISPATCH AM').map(s => `${s.first_name} ${s.last_name}`);
  const dispPM = shiftsData.filter(s => s.shift_type === 'DISPATCH PM').map(s => `${s.first_name} ${s.last_name}`);

  // Build driver rows from all sources
  const driverRows = [];
  const seenStaff = new Set();

  // From assignments
  for (const a of assignmentsArr) {
    if (a.removed_from_ops || !a.staff_id) continue;
    const shift = shiftByStaff[a.staff_id];
    const type = (shift?.shift_type || a.shift_type || '').toUpperCase();
    if (OPS_EXCLUDED.has(type)) continue;
    const rc = (a.route_code || '').toUpperCase();
    if (rc.startsWith('AT')) continue;
    if (seenStaff.has(a.staff_id)) continue;
    seenStaff.add(a.staff_id);

    const st = allStaff.find(x => x.id === a.staff_id);
    const v = vehicles.find(x => x.id === a.vehicle_id);
    const loadout = loadoutMap[a.route_code] || {};
    const wave = loadout.wave || '';
    const canopyInitial = (loadout.canopy || '')[0] || '';
    const station = wave ? `W${wave.replace(/\D/g,'')}${canopyInitial ? '-' + canopyInitial : ''}` : canopyInitial || '';

    const name = a.name_override || (st ? `${st.first_name} ${st.last_name}` : '');
    const att = shift?.attendance_status ? (ATT_LABELS[shift.attendance_status] || '') : '';

    driverRows.push({
      route: a.route_code || '',
      name: name.toUpperCase(),
      van: v?.vehicle_name || '',
      device: a.device_id || '',
      staging: loadout.staging || a.staging_override || '',
      station,
      stationSort: station || 'ZZZ',
      att,
      attStatus: shift?.attendance_status || '',
    });
  }

  // From shifts (DSP-only drivers not in assignments)
  for (const shift of shiftsData) {
    if (seenStaff.has(shift.staff_id)) continue;
    const type = (shift.shift_type || '').toUpperCase();
    if (OPS_EXCLUDED.has(type)) continue;
    seenStaff.add(shift.staff_id);
    const asgn = assignments[shift.staff_id] || {};
    if (asgn.removed_from_ops) continue;
    const rc = (asgn.route_code || '').toUpperCase();
    if (rc.startsWith('AT')) continue;
    if (!asgn.route_code) continue; // no route assigned

    const v = vehicles.find(x => x.id === asgn.vehicle_id);
    const loadout = loadoutMap[asgn.route_code] || {};
    const wave = loadout.wave || '';
    const canopyInitial = (loadout.canopy || '')[0] || '';
    const station = wave ? `W${wave.replace(/\D/g,'')}${canopyInitial ? '-' + canopyInitial : ''}` : '';

    const att = shift.attendance_status ? (ATT_LABELS[shift.attendance_status] || '') : '';

    driverRows.push({
      route: asgn.route_code || '',
      name: `${shift.first_name} ${shift.last_name}`.toUpperCase(),
      van: v?.vehicle_name || '',
      device: asgn.device_id || '',
      staging: loadout.staging || '',
      station,
      stationSort: station || 'ZZZ',
      att,
      attStatus: shift.attendance_status || '',
    });
  }

  // Sort by station then route
  driverRows.sort((a, b) => a.stationSort.localeCompare(b.stationSort, undefined, { numeric: true }) || a.route.localeCompare(b.route, undefined, { numeric: true }));

  const dateLabel = planDate ? format(parseISO(planDate), 'EEEE, MMMM d, yyyy') : '';
  const isReady = shiftsData.length > 0 || assignmentsArr.length > 0;

  // Auto-print when data loads
  useEffect(() => {
    if (isReady && driverRows.length > 0) {
      const timer = setTimeout(() => window.print(), 800);
      return () => clearTimeout(timer);
    }
  }, [isReady, driverRows.length]);

  const attColor = (status) => {
    if (status === 'ncns') return { bg: '#FEE2E2', color: '#B91C1C' };
    if (status === 'called_out') return { bg: '#FFF7ED', color: '#C2410C' };
    if (status === 'late') return { bg: '#FEF9C3', color: '#A16207' };
    return {};
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '12px', maxWidth: '100%' }}>
      <style>{`
        @media print {
          @page { size: landscape; margin: 8mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Header */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
        <tbody>
          <tr>
            <td style={{ fontSize: 12, fontWeight: 'bold', width: '30%' }}>{dateLabel}</td>
            <td style={{ fontSize: 14, fontWeight: 'bold', textAlign: 'center', width: '40%' }}>Last Mile DSP — DMF5</td>
            <td style={{ fontSize: 10, fontWeight: 'bold', textAlign: 'right', width: '30%', lineHeight: 1.5 }}>
              OPEN: {dispAM.length ? dispAM.join(' \\ ') : '________'}<br />
              CLOSING: {dispPM.length ? dispPM.join(' \\ ') : '________'}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Main table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 30 }} />
          <col style={{ width: 70 }} />
          <col style={{ width: 160 }} />
          <col style={{ width: 55 }} />
          <col style={{ width: 55 }} />
          <col style={{ width: 70 }} />
          <col style={{ width: 70 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 60 }} />
          <col style={{ width: 55 }} />
          <col style={{ width: 75 }} />
        </colgroup>
        <thead>
          <tr>
            {['#','ROUTE','DELIVERY ASSOCIATE','VAN #','DEVICE #','POWER BANK #','STG #','SIGNATURE','RTS TIME','STATION','EXTRAS'].map(h => (
              <th key={h} style={{ background: '#1a3a5c', color: 'white', fontWeight: 'bold', fontSize: 8, padding: '5px 3px', border: '1px solid #000', textAlign: 'center', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {driverRows.map((r, i) => {
            const ac = attColor(r.attStatus);
            return (
              <tr key={i} style={{ background: i % 2 === 1 ? '#f8f8f8' : '#fff' }}>
                <td style={{ border: '1px solid #000', padding: '3px 2px', textAlign: 'center', fontSize: 8 }}>{i + 1}</td>
                <td style={{ border: '1px solid #000', padding: '3px 4px', fontWeight: 'bold', fontSize: 9 }}>{r.route}</td>
                <td style={{ border: '1px solid #000', padding: '3px 4px', fontSize: 9 }}>{r.name}</td>
                <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'center', fontSize: 9 }}>{r.van}</td>
                <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'center', fontSize: 9 }}>{r.device}</td>
                <td style={{ border: '1px solid #000', padding: '3px 4px' }}></td>
                <td style={{ border: '1px solid #000', padding: '3px 4px', fontSize: 8 }}>{r.staging}</td>
                <td style={{ border: '1px solid #000', padding: '3px 4px', minHeight: 25 }}></td>
                <td style={{ border: '1px solid #000', padding: '3px 4px' }}></td>
                <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'center', fontSize: 9, fontWeight: 'bold' }}>{r.station}</td>
                <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'center', fontSize: 8, fontWeight: 'bold', background: ac.bg || '', color: ac.color || '' }}>{r.att}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Notes section */}
      <div style={{ marginTop: 16, fontSize: 10, fontWeight: 'bold' }}>CALL OUTS / NOTES:</div>
      <div style={{ borderBottom: '1px solid #ccc', marginTop: 12, height: 16 }} />
      <div style={{ borderBottom: '1px solid #ccc', marginTop: 12, height: 16 }} />
      <div style={{ borderBottom: '1px solid #ccc', marginTop: 12, height: 16 }} />

      {!isReady && <p style={{ textAlign: 'center', color: '#999', marginTop: 40 }}>Loading data...</p>}
    </div>
  );
}

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import api from '../api/client';

export default function SignOutSheet() {
  const [params] = useSearchParams();
  const planDate = params.get('date') || format(new Date(), 'yyyy-MM-dd');

  const { data } = useQuery({
    queryKey: ['sign-out-data', planDate],
    queryFn: () => api.get('/ops/sign-out-data', { params: { date: planDate } }).then(r => r.data),
  });

  const rows = data?.rows || [];
  const dispAM = data?.dispAM || [];
  const dispPM = data?.dispPM || [];
  const dateLabel = planDate ? format(parseISO(planDate), 'EEEE, MMMM d, yyyy') : '';

  useEffect(() => {
    if (rows.length > 0) {
      const t = setTimeout(() => window.print(), 800);
      return () => clearTimeout(t);
    }
  }, [rows.length]);

  const attColor = (s) => {
    if (s === 'ncns') return { background: '#FEE2E2', color: '#B91C1C' };
    if (s === 'called_out') return { background: '#FFF7ED', color: '#C2410C' };
    if (s === 'late') return { background: '#FEF9C3', color: '#A16207' };
    return {};
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '12px', maxWidth: '100%' }}>
      <style>{`
        @media print {
          @page { size: landscape; margin: 8mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
          {rows.map((r, i) => (
            <tr key={i} style={{ background: i % 2 === 1 ? '#f8f8f8' : '#fff' }}>
              <td style={{ border: '1px solid #000', padding: '3px 2px', textAlign: 'center', fontSize: 8 }}>{i + 1}</td>
              <td style={{ border: '1px solid #000', padding: '3px 4px', fontWeight: 'bold', fontSize: 9 }}>{r.route}</td>
              <td style={{ border: '1px solid #000', padding: '3px 4px', fontSize: 9 }}>{r.name}</td>
              <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'center', fontSize: 9 }}>{r.van}</td>
              <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'center', fontSize: 9 }}>{r.device}</td>
              <td style={{ border: '1px solid #000', padding: '3px 4px' }} />
              <td style={{ border: '1px solid #000', padding: '3px 4px', fontSize: 8 }}>{r.staging}</td>
              <td style={{ border: '1px solid #000', padding: '3px 4px', minHeight: 25 }} />
              <td style={{ border: '1px solid #000', padding: '3px 4px' }} />
              <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'center', fontSize: 9, fontWeight: 'bold' }}>{r.station}</td>
              <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'center', fontSize: 8, fontWeight: 'bold', ...attColor(r.attStatus) }}>{r.att}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 16, fontSize: 10, fontWeight: 'bold' }}>CALL OUTS / NOTES:</div>
      <div style={{ borderBottom: '1px solid #ccc', marginTop: 12, height: 16 }} />
      <div style={{ borderBottom: '1px solid #ccc', marginTop: 12, height: 16 }} />
      <div style={{ borderBottom: '1px solid #ccc', marginTop: 12, height: 16 }} />

      {!data && <p style={{ textAlign: 'center', color: '#999', marginTop: 40 }}>Loading data...</p>}
    </div>
  );
}

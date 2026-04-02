import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import api from '../api/client';

const BD = '1px solid #000';
const TD = { border: BD, padding: '1px 3px', fontSize: 7 };
const TDC = { ...TD, textAlign: 'center' };

export default function SignOutSheet() {
  const [params] = useSearchParams();
  const planDate = params.get('date') || format(new Date(), 'yyyy-MM-dd');

  const { data } = useQuery({
    queryKey: ['sign-out-data', planDate],
    queryFn: () => api.get('/ops/sign-out-data', { params: { date: planDate } }).then(r => r.data),
  });

  const rows = data?.rows || [];
  const extras = data?.extras || {};
  const dispAM = data?.dispAM || [];
  const dispPM = data?.dispPM || [];
  const dateLabel = planDate ? format(parseISO(planDate), 'EEEE, MMMM d, yyyy') : '';

  useEffect(() => {
    if (rows.length > 0) {
      const t = setTimeout(() => window.print(), 800);
      return () => clearTimeout(t);
    }
  }, [rows.length]);

  const attStyle = (s) => {
    if (s === 'ncns') return { background: '#FEE2E2', color: '#B91C1C' };
    if (s === 'called_out') return { background: '#FFF7ED', color: '#C2410C' };
    if (s === 'late') return { background: '#FEF9C3', color: '#A16207' };
    return {};
  };

  const HDR = { background: '#1a3a5c', color: '#fff', fontWeight: 'bold', fontSize: 6.5, padding: '3px 2px', border: BD, textAlign: 'center', whiteSpace: 'nowrap' };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: 6, margin: 0 }}>
      <style>{`
        @media print {
          @page { size: landscape; margin: 0.25in; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
        }
        body { margin: 0; }
      `}</style>

      {/* Header */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 3 }}>
        <tbody><tr>
          <td style={{ fontSize: 9, fontWeight: 'bold', width: '28%' }}>{dateLabel}</td>
          <td style={{ fontSize: 11, fontWeight: 'bold', textAlign: 'center', width: '44%' }}>Last Mile DSP — DMF5</td>
          <td style={{ fontSize: 8, fontWeight: 'bold', textAlign: 'right', width: '28%', lineHeight: 1.3 }}>
            OPEN: {dispAM.length ? dispAM.join(' \\ ') : '________'}<br />
            CLOSING: {dispPM.length ? dispPM.join(' \\ ') : '________'}
          </td>
        </tr></tbody>
      </table>

      {/* Main table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 7, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 18 }} />
          <col style={{ width: 48 }} />
          <col style={{ width: 125 }} />
          <col style={{ width: 38 }} />
          <col style={{ width: 38 }} />
          <col style={{ width: 48 }} />
          <col style={{ width: 52 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 38 }} />
          <col style={{ width: 36 }} />
          <col style={{ width: 50 }} />
        </colgroup>
        <thead>
          <tr>{['#','ROUTE','DELIVERY ASSOCIATE','VAN','DEV','PWR BNK','STG','SIGNATURE','RTS','STN','EXTRAS'].map(h => <th key={h} style={HDR}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ background: i % 2 === 1 ? '#f8f8f8' : '#fff' }}>
              <td style={{ ...TDC, fontSize: 6 }}>{i + 1}</td>
              <td style={{ ...TD, fontWeight: 'bold' }}>{r.route}</td>
              <td style={TD}>{r.name}</td>
              <td style={TDC}>{r.van}</td>
              <td style={TDC}>{r.device}</td>
              <td style={TD} />
              <td style={{ ...TD, fontSize: 6 }}>{r.staging}</td>
              <td style={{ ...TD, minHeight: 16 }} />
              <td style={TD} />
              <td style={{ ...TDC, fontWeight: 'bold' }}>{r.station}</td>
              <td style={{ ...TDC, fontWeight: r.att ? 'bold' : 'normal', ...attStyle(r.attStatus) }}>{r.att}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Extras/Attendance section */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 7, marginTop: 6 }}>
        <tbody>
          {[
            { label: 'CALL OUTS:', val: extras.callOuts },
            { label: 'LATES:', val: extras.lates },
            { label: 'NCNS:', val: extras.ncns },
          ].map(({ label, val }, i) => (
            <tr key={i}>
              <td style={{ border: BD, padding: '2px 4px', fontWeight: 'bold', fontSize: 7, width: 80, background: '#f0f0f0' }}>{label}</td>
              <td style={{ border: BD, padding: '2px 4px', fontSize: 7, minHeight: 14 }}>{(val || []).join(', ') || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {!data && <p style={{ textAlign: 'center', color: '#999', marginTop: 40 }}>Loading...</p>}
    </div>
  );
}

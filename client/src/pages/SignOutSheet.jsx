import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import api from '../api/client';

const BD = '1px solid #000';
const TD = { border: BD, padding: '1px 3px', fontSize: 7 };
const TDC = { ...TD, textAlign: 'center' };
const HDR_S = { background: '#1a3a5c', color: '#fff', fontWeight: 'bold', fontSize: 6.5, padding: '3px 2px', border: BD, textAlign: 'center', whiteSpace: 'nowrap' };

function buildExtrasColumn(extras) {
  const cells = [];
  // Top rows: EXTRA drivers + blank for manual notes
  const extraDrivers = extras.extraDrivers || [];
  const topCount = Math.max(6, extraDrivers.length);
  for (let j = 0; j < topCount; j++) cells.push({ text: extraDrivers[j] || '', isHeader: false });
  // Attendance sections
  const sections = [
    { label: 'CALL OUTS:', min: 5, items: extras.callOuts || [] },
    { label: 'NO CALL NO SHOW:', min: 5, items: extras.ncns || [] },
    { label: 'LATE:', min: 5, items: extras.lates || [] },
    { label: 'SENT HOME:', min: 5, items: extras.sentHome || [] },
    { label: 'TRAINING:', min: 5, items: extras.training || [] },
    { label: 'TRAINER:', min: 5, items: extras.trainer || [] },
  ];
  for (const sec of sections) {
    cells.push({ text: sec.label, isHeader: true });
    const count = Math.max(sec.min, sec.items.length);
    for (let j = 0; j < count; j++) {
      cells.push({ text: sec.items[j] || '', isHeader: false });
    }
  }
  return cells;
}

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

  const extrasCells = useMemo(() => buildExtrasColumn(extras), [extras]);

  // Total rows = max of driver rows and extras cells
  const totalRows = Math.max(rows.length, extrasCells.length);

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
    if (s === 'sent_home') return { background: '#FEF3C7', color: '#92400E' };
    return {};
  };

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

      {/* Main table — EXTRAS column is populated from extrasCells within each row */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 7, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 18 }} />
          <col style={{ width: 48 }} />
          <col style={{ width: 125 }} />
          <col style={{ width: 38 }} />
          <col style={{ width: 38 }} />
          <col style={{ width: 48 }} />
          <col style={{ width: 45 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 38 }} />
          <col style={{ width: 32 }} />
          <col style={{ width: 120 }} />
        </colgroup>
        <thead>
          <tr>{['#','ROUTE','DELIVERY ASSOCIATE','VAN','DEV','PWR BNK','STG','SIGNATURE','RTS','STN','EXTRAS'].map(h => <th key={h} style={HDR_S}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: totalRows }, (_, i) => {
            const r = rows[i];
            const ec = extrasCells[i];
            const hasDriver = !!r;

            // EXTRAS cell style
            let extrasCell;
            if (ec?.isHeader) {
              extrasCell = <td style={{ border: BD, padding: '2px 3px', fontSize: 7, fontWeight: 'bold', background: ec.navy ? '#1a3a5c' : '#e8e8e8', color: ec.navy ? '#fff' : '#000', borderLeft: '3px solid #1a3a5c' }}>{ec.text}</td>;
            } else if (ec) {
              extrasCell = <td style={{ border: BD, padding: '1px 3px', fontSize: 7, borderBottom: '1px solid #ccc' }}>{ec.text}</td>;
            } else if (hasDriver) {
              // Driver row with no extras content — show attendance if any
              extrasCell = <td style={{ ...TDC, fontWeight: r.att ? 'bold' : 'normal', ...attStyle(r.attStatus) }}>{r.att || ''}</td>;
            } else {
              extrasCell = <td style={{ border: BD, padding: '1px 3px' }} />;
            }

            return (
              <tr key={i} style={{ background: hasDriver && i % 2 === 1 ? '#f8f8f8' : '#fff' }}>
                <td style={{ ...TDC, fontSize: 6 }}>{hasDriver ? i + 1 : ''}</td>
                <td style={{ ...TD, fontWeight: 'bold' }}>{r?.route || ''}</td>
                <td style={TD}>{r?.name || ''}</td>
                <td style={TDC}>{r?.van || ''}</td>
                <td style={TDC}>{r?.device || ''}</td>
                <td style={TD} />
                <td style={{ ...TD, fontSize: 6 }}>{r?.staging || ''}</td>
                <td style={TD} />
                <td style={TD} />
                <td style={{ ...TDC, fontWeight: 'bold' }}>{r?.station || ''}</td>
                {extrasCell}
              </tr>
            );
          })}
        </tbody>
      </table>

      {!data && <p style={{ textAlign: 'center', color: '#999', marginTop: 40 }}>Loading...</p>}
    </div>
  );
}

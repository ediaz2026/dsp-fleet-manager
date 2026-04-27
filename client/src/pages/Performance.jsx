import { useState } from 'react';
import { VolumeShareTab, CRTrackerTab, DailyRoutesSummaryTab } from './Analytics';

export default function Performance() {
  const [activeTab, setActiveTab] = useState('volume-share');

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1400px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#1a2e4a', marginBottom: '4px' }}>Performance</h1>
      <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px' }}>
        Volume share, daily routes, and capacity reliability
      </p>

      <div style={{ display: 'flex', gap: '4px', borderBottom: '2px solid #e2e8f0', marginBottom: '24px' }}>
        {[
          { id: 'volume-share', label: '📊 Volume Share' },
          { id: 'daily-routes', label: '📋 Daily Routes Summary' },
          { id: 'cr-tracker', label: '📈 CR Tracker' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '8px 18px', border: 'none', cursor: 'pointer', fontSize: '14px', background: 'transparent',
            borderBottom: activeTab === tab.id ? '3px solid #1a2e4a' : '3px solid transparent', marginBottom: '-2px',
            fontWeight: activeTab === tab.id ? 700 : 400, color: activeTab === tab.id ? '#1a2e4a' : '#64748b',
          }}>{tab.label}</button>
        ))}
      </div>

      {activeTab === 'volume-share' && <VolumeShareTab />}
      {activeTab === 'daily-routes' && <DailyRoutesSummaryTab />}
      {activeTab === 'cr-tracker' && <CRTrackerTab />}
    </div>
  );
}

import { useState } from 'react';
import { VolumeShareTab, CRTrackerTab } from './Analytics';
import { useNavigate } from 'react-router-dom';

export default function Performance() {
  const [activeTab, setActiveTab] = useState('volume-share');
  const navigate = useNavigate();

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1400px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#1a2e4a', marginBottom: '4px' }}>Performance</h1>
      <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px' }}>
        Volume share, daily routes, and capacity reliability
      </p>

      {/* Tab row */}
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

      {/* Tab content */}
      {activeTab === 'volume-share' && <VolumeShareTab />}
      {activeTab === 'daily-routes' && (
        <div>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <p style={{ fontSize: '15px', color: '#374151', fontWeight: 600, marginBottom: '12px' }}>
              Daily Routes Summary
            </p>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
              The full Daily Routes Summary with editable fields is available in Analytics.
            </p>
            <button
              onClick={() => navigate('/analytics?tab=daily-summary')}
              style={{
                padding: '10px 24px', background: '#1a2e4a', color: 'white', border: 'none',
                borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
              }}
            >
              Open Daily Routes Summary →
            </button>
          </div>
        </div>
      )}
      {activeTab === 'cr-tracker' && <CRTrackerTab />}
    </div>
  );
}

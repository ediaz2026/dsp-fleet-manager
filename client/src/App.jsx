import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, createContext, useContext } from 'react';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Schedule from './pages/Schedule';
import Attendance from './pages/Attendance';
import Payroll from './pages/Payroll';
import AmazonRoutes from './pages/AmazonRoutes';
import Vehicles from './pages/Vehicles';
import Drivers from './pages/Drivers';
import Inspections from './pages/Inspections';
import AIMonitor from './pages/AIMonitor';
import VehicleInspection from './pages/VehicleInspection';
import Settings from './pages/Settings';

export const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

function RequireAuth({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dsp_user')); } catch { return null; }
  });

  const login = (userData, token) => {
    localStorage.setItem('dsp_token', token);
    localStorage.setItem('dsp_user', JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('dsp_token');
    localStorage.removeItem('dsp_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <Routes>
        {/* Public inspection route for QR codes - no auth needed */}
        <Route path="/inspect/:vehicleId" element={<VehicleInspection />} />
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />

        {/* Protected routes */}
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="payroll" element={<Payroll />} />
          <Route path="amazon-routes" element={<AmazonRoutes />} />
          <Route path="vehicles" element={<Vehicles />} />
          <Route path="drivers" element={<Drivers />} />
          <Route path="inspections" element={<Inspections />} />
          <Route path="ai-monitor" element={<AIMonitor />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}

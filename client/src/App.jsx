import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, createContext, useContext } from 'react';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Schedule from './pages/Schedule';
import Attendance from './pages/Attendance';
import Payroll from './pages/Payroll';
import Vehicles from './pages/Vehicles';
import Drivers from './pages/Drivers';
import Inspections from './pages/Inspections';
import AIMonitor from './pages/AIMonitor';
import VehicleInspection from './pages/VehicleInspection';
import Settings from './pages/Settings';
import Management from './pages/Management';
import OperationalPlanner from './pages/OperationalPlanner';
import Scorecard from './pages/Scorecard';
import DriverSchedule from './pages/DriverSchedule';
import ChangePassword from './pages/ChangePassword';

export const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

const MGMT_ROLES = ['manager', 'admin', 'dispatcher'];

function RequireAuth({ children, allowedRoles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === 'driver' ? '/my-schedule' : '/schedule'} replace />;
  }
  return children;
}

function roleHome(role) {
  if (role === 'driver') return '/my-schedule';
  if (role === 'manager' || role === 'dispatcher') return '/schedule';
  return '/'; // admin
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
        <Route
          path="/login"
          element={user ? <Navigate to={roleHome(user.role)} replace /> : <Login />}
        />

        {/* Protected routes */}
        <Route path="/" element={<RequireAuth allowedRoles={MGMT_ROLES}><Layout /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="payroll" element={<RequireAuth allowedRoles={['admin']}><Payroll /></RequireAuth>} />
          <Route path="operational-planner" element={<OperationalPlanner />} />
          <Route path="vehicles" element={<Vehicles />} />
          <Route path="drivers" element={<Drivers />} />
          <Route path="inspections" element={<Inspections />} />
          <Route path="ai-monitor" element={<AIMonitor />} />
          <Route path="settings" element={<RequireAuth allowedRoles={['admin']}><Settings /></RequireAuth>} />
          <Route path="management" element={<RequireAuth allowedRoles={['admin']}><Management /></RequireAuth>} />
          <Route path="scorecard" element={<Scorecard />} />
        </Route>

        {/* Driver personal routes — all authenticated users can access */}
        <Route
          path="/my-schedule"
          element={<RequireAuth><Layout /></RequireAuth>}
        >
          <Route index element={<DriverSchedule />} />
        </Route>

        {/* Change password — all roles */}
        <Route
          path="/change-password"
          element={<RequireAuth><Layout /></RequireAuth>}
        >
          <Route index element={<ChangePassword />} />
        </Route>

        <Route path="*" element={<Navigate to={user ? roleHome(user?.role) : '/login'} replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}

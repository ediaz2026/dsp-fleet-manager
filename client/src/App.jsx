import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
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
import Analytics from './pages/Analytics';
import DriverSchedule from './pages/DriverSchedule';
import DriverAttendance from './pages/DriverAttendance';
import ChangePassword from './pages/ChangePassword';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AcceptInvitation from './pages/AcceptInvitation';

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

function LoginRoute() {
  const { user } = useAuth();
  return user ? <Navigate to={roleHome(user.role)} replace /> : <Login />;
}

function FallbackRoute() {
  const { user } = useAuth();
  return <Navigate to={user ? roleHome(user.role) : '/login'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public routes — no auth needed */}
        <Route path="/inspect/:vehicleId" element={<VehicleInspection />} />
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />
        <Route path="/accept-invitation/:token" element={<AcceptInvitation />} />

        {/* Protected routes */}
        <Route path="/" element={<RequireAuth allowedRoles={MGMT_ROLES}><Layout /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="attendance" element={<RequireAuth allowedRoles={['admin']}><Attendance /></RequireAuth>} />
          <Route path="payroll" element={<RequireAuth allowedRoles={['admin']}><Payroll /></RequireAuth>} />
          <Route path="operational-planner" element={<OperationalPlanner />} />
          <Route path="vehicles" element={<Vehicles />} />
          <Route path="drivers" element={<Drivers />} />
          <Route path="inspections" element={<Inspections />} />
          <Route path="ai-monitor" element={<AIMonitor />} />
          <Route path="settings" element={<RequireAuth allowedRoles={['admin']}><Settings /></RequireAuth>} />
          <Route path="management" element={<RequireAuth allowedRoles={['admin']}><Management /></RequireAuth>} />
          <Route path="scorecard" element={<Scorecard />} />
          <Route path="analytics" element={<Analytics />} />
        </Route>

        {/* Driver personal routes — all authenticated users can access */}
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route path="/my-schedule" element={<DriverSchedule />} />
          <Route path="/my-attendance" element={<DriverAttendance />} />
          <Route path="/my-scorecard" element={<Scorecard />} />
        </Route>

        {/* Change password — all roles */}
        <Route
          path="/change-password"
          element={<RequireAuth><Layout /></RequireAuth>}
        >
          <Route index element={<ChangePassword />} />
        </Route>

        <Route path="*" element={<FallbackRoute />} />
      </Routes>
    </AuthProvider>
  );
}

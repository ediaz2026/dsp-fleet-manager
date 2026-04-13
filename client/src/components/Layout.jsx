import { Outlet, useLocation } from 'react-router-dom';
import TopNav from './TopNav';

const fullWidthPages = [
  '/schedule',
  '/operational-planner',
  '/sign-out-sheet',
  '/attendance',
];

export default function Layout() {
  const { pathname } = useLocation();
  const isFullWidth = fullWidthPages.some(p => pathname.startsWith(p));

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <TopNav />
      <main className={`flex-1 p-6 mx-auto w-full ${isFullWidth ? 'max-w-none' : 'max-w-screen-2xl'}`}>
        <Outlet />
      </main>
    </div>
  );
}

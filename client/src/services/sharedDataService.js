/**
 * sharedDataService.js
 *
 * The ONLY shared code between Schedule (Weekly/Daily) and Ops Planner.
 * Provides React Query hooks for data that multiple features need:
 *   - Drivers list
 *   - Vehicles list
 *   - Shift types
 *
 * React Query caches these by queryKey so calling them from multiple
 * components does NOT cause duplicate network requests.
 */
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';

export function useDrivers({ status = 'active', role = 'driver' } = {}) {
  return useQuery({
    queryKey: ['staff', 'drivers', status, role],
    queryFn: () => api.get('/staff', { params: { role, status } }).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });
}

export function useVehicles() {
  return useQuery({
    queryKey: ['vehicles'],
    queryFn: () => api.get('/vehicles').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });
}

export function useShiftTypes() {
  return useQuery({
    queryKey: ['shift-types'],
    queryFn: () => api.get('/schedule/shift-types').then(r => r.data),
    staleTime: 10 * 60 * 1000,
  });
}

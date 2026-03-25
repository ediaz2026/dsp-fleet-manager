import { createContext, useContext, useState } from 'react';

export const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
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
      {children}
    </AuthContext.Provider>
  );
}

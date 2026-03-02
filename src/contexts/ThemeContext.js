import React, { createContext, useState, useContext, useEffect } from 'react';

const ThemeContext = createContext();

export const useTheme = () => useContext(ThemeContext);

export const AVAILABLE_THEMES = [
  { id: 'dark', name: 'Dark', color: '#0a0e27' },
  { id: 'light', name: 'Light', color: '#ffffff' },
  { id: 'midnight', name: 'Midnight', color: '#0f0f1e' },
  { id: 'ocean', name: 'Ocean', color: '#001f3f' },
  { id: 'forest', name: 'Forest', color: '#1b2d1f' },
  { id: 'indigo', name: 'Indigo', color: '#1a0933' },
  { id: 'sunset', name: 'Sunset', color: '#2d1810' },
  { id: 'emerald', name: 'Emerald', color: '#0d3d2d' },
  { id: 'lavender', name: 'Lavender', color: '#f3e9ff' },
  { id: 'cream', name: 'Cream', color: '#fefaf0' },
  { id: 'terminal', name: 'Terminal', color: '#0a130d' },
  { id: 'newsprint', name: 'Newsprint', color: '#f3ecd9' },
  { id: 'blueprint', name: 'Blueprint', color: '#0b2f47' },
  { id: 'antique-paper', name: 'Antique Paper', color: '#e8dcc0' }
];

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('selectedTheme') || 'dark';
  });

  const changeTheme = (newTheme) => {
    setTheme(newTheme);
    localStorage.setItem('selectedTheme', newTheme);
  };

  useEffect(() => {
    document.body.className = '';
    document.body.classList.add(`${theme}-theme`);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, changeTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

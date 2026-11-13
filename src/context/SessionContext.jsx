'use client';

import { createContext, useContext } from 'react';

const SessionContext = createContext(null);

export function SessionProvider({ session = null, children }) {
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}

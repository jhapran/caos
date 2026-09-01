import { createContext } from 'react';

import type { AuthService } from './authService';
import type { AuthSnapshot } from './types';

export interface AuthContextValue {
  snapshot: AuthSnapshot;
  service: AuthService;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

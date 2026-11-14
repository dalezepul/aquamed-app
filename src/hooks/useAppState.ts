import { useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

/** Current AppState; re-renders the caller when the app returns to the foreground. */
export const useAppState = (): AppStateStatus => {
  const [state, setState] = useState(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', setState);
    return () => sub.remove();
  }, []);
  return state;
};

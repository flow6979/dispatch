// Shared data hooks: polling for tasks/health/context with graceful offline handling.
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './api';

// Generic 2s poller. Returns { data, error, offline, refresh }.
export function usePoll(fn, intervalMs = 2000, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [offline, setOffline] = useState(false);
  const mounted = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const tick = useCallback(async () => {
    try {
      const d = await fnRef.current();
      if (!mounted.current) return;
      setData(d);
      setError(null);
      setOffline(false);
    } catch (e) {
      if (!mounted.current) return;
      setError(e);
      setOffline(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mounted.current = true;
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, intervalMs]);

  return { data, error, offline, refresh: tick };
}

export function useTasks(intervalMs = 2000) {
  const { data, offline, refresh } = usePoll(() => api.tasks(), intervalMs);
  const tasks = (data && data.tasks) || [];
  return { tasks, offline, refresh };
}

export function useHealth(intervalMs = 3000) {
  const { data, offline } = usePoll(() => api.health(), intervalMs);
  return { health: data, offline };
}

export function useContext(intervalMs = 3000) {
  const { data, offline, refresh } = usePoll(() => api.getContext(), intervalMs);
  return { context: data, offline, refresh };
}

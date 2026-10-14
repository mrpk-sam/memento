import { useEffect, useState } from 'react';

export function useViewport() {
  const [vp, setVp] = useState({ vw: window.innerWidth, vh: window.innerHeight });
  useEffect(() => {
    const on = () => setVp({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

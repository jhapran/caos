import { useEffect } from 'react';
import Lenis from 'lenis';
import LandingNav from './landing/LandingNav';
import HeroSection from './landing/HeroSection';
import PinnedNarrative from './landing/PinnedNarrative';
import DrilldownSection from './landing/DrilldownSection';
import FinalCTA from './landing/FinalCTA';
import { useEnterDemo } from './landing/EnterDemoButton';
import { prefersReducedMotion } from '@/components/CountUp';

/**
 * Landing — cinematic single-screen product entry (design: landing.md).
 * The only page with heavy motion: Lenis smooth scroll + GSAP pinned narrative.
 */
export default function Landing() {
  const { enter, wipeOverlay } = useEnterDemo();

  // Lenis smooth scroll (landing page only)
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  return (
    <div className="bg-brand-deep">
      <LandingNav onEnter={enter} />
      <HeroSection onEnter={enter} />
      <PinnedNarrative />
      <DrilldownSection />
      <FinalCTA onEnter={enter} />
      {wipeOverlay}
    </div>
  );
}

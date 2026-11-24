import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { IDLE_SHIELD_MINUTES } from "@/lib/retention";

/**
 * Covers the app after a period without interaction, so customer data isn't
 * left on screen when someone steps away. Nothing is deleted; any click or
 * key resumes.
 */
export function IdleShield() {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    let timer = 0;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_SHIELD_MINUTES * 60 * 1000);
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, reset, { passive: true });
    reset();
    return () => {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, reset);
    };
  }, []);

  useEffect(() => {
    if (!idle) return;
    const resume = (e: KeyboardEvent) => {
      e.preventDefault();
      setIdle(false);
    };
    window.addEventListener("keydown", resume);
    return () => window.removeEventListener("keydown", resume);
  }, [idle]);

  if (!idle) return null;

  return (
    <button
      type="button"
      onClick={() => setIdle(false)}
      className="idle-shield"
      aria-label="Screen hidden for privacy. Click or press any key to continue."
      autoFocus
    >
      <Lock size={28} className="text-primary" aria-hidden />
      <span className="text-lg font-semibold">Screen hidden for privacy</span>
      <span className="text-sm text-muted-foreground">
        No activity for {IDLE_SHIELD_MINUTES} minutes. Click or press any key to continue.
      </span>
    </button>
  );
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Application } from "@splinetool/runtime";

// Extensible Odin States
export type OdinState =
  | "Speaking"
  | "Listening"
  | "Thinking"
  | "Executing Tool"
  | "Idle"
  | "Sleeping"
  | "Alert"
  | "Celebrating";

interface ObjectTransform {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}

type OriginalStates = Record<string, ObjectTransform>;

// Easing: ease-in-out cubic
function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// Custom animation helper using requestAnimationFrame with easing and AbortSignal support
function animate(
  duration: number,
  tick: (progress: number) => void,
  onComplete?: () => void,
  abortSignal?: AbortSignal
) {
  const startTime = performance.now();
  let rafId: number;

  const loop = (now: number) => {
    if (abortSignal?.aborted) return;
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeInOutCubic(progress);

    tick(eased);

    if (progress < 1) {
      rafId = requestAnimationFrame(loop);
    } else if (onComplete) {
      onComplete();
    }
  };

  rafId = requestAnimationFrame(loop);

  if (abortSignal) {
    abortSignal.addEventListener("abort", () => {
      cancelAnimationFrame(rafId);
    });
  }
}

// Smoothly restore Spline objects to their default positions/rotations/scales
function smoothRestoreDefaults(app: Application, originalStates: OriginalStates, duration = 300) {
  const objectsToRestore: {
    obj: any;
    orig: ObjectTransform;
    startPos: { x: number; y: number; z: number };
    startRot: { x: number; y: number; z: number };
    startScale: { x: number; y: number; z: number };
  }[] = [];

  for (const name in originalStates) {
    const obj = app.findObjectByName(name);
    if (!obj) continue;
    objectsToRestore.push({
      obj,
      orig: originalStates[name],
      startPos: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
      startRot: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
      startScale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z }
    });
  }

  animate(duration, (p) => {
    for (const item of objectsToRestore) {
      const { obj, orig, startPos, startRot, startScale } = item;
      
      obj.position.x = startPos.x + (orig.position.x - startPos.x) * p;
      obj.position.y = startPos.y + (orig.position.y - startPos.y) * p;
      obj.position.z = startPos.z + (orig.position.z - startPos.z) * p;

      obj.rotation.x = startRot.x + (orig.rotation.x - startRot.x) * p;
      obj.rotation.y = startRot.y + (orig.rotation.y - startRot.y) * p;
      obj.rotation.z = startRot.z + (orig.rotation.z - startRot.z) * p;

      obj.scale.x = startScale.x + (orig.scale.x - startScale.x) * p;
      obj.scale.y = startScale.y + (orig.scale.y - startScale.y) * p;
      obj.scale.z = startScale.z + (orig.scale.z - startScale.z) * p;
    }
  });
}

// Set of Spontaneous Idle Behaviors
const BEHAVIORS = {
  blink: async (app: Application, originalStates: OriginalStates, abortSignal: AbortSignal) => {
    const visor = app.findObjectByName("Visor");
    if (!visor) return;
    const initialScaleY = originalStates["Visor"]?.scale?.y ?? 1;
    
    await new Promise<void>((resolve, reject) => {
      if (abortSignal.aborted) return reject();
      animate(80, (p) => {
        visor.scale.y = initialScaleY * (1 - p * 0.95);
      }, () => {
        animate(80, (p) => {
          visor.scale.y = initialScaleY * (0.05 + p * 0.95);
        }, resolve, abortSignal);
      }, abortSignal);
      abortSignal.addEventListener("abort", reject);
    });
  },

  look_around: async (app: Application, originalStates: OriginalStates, abortSignal: AbortSignal) => {
    const head = app.findObjectByName("Head");
    const neck = app.findObjectByName("Neck");
    if (!head) return;

    const initialHeadY = originalStates["Head"]?.rotation?.y ?? 0;
    const initialNeckY = originalStates["Neck"]?.rotation?.y ?? 0;
    const targetHeadY = initialHeadY + (Math.random() > 0.5 ? 0.28 : -0.28);
    const targetNeckY = initialNeckY + (targetHeadY - initialHeadY) * 0.35;

    // Turn head to the side
    await new Promise<void>((resolve, reject) => {
      if (abortSignal.aborted) return reject();
      animate(1200, (p) => {
        head.rotation.y = initialHeadY + (targetHeadY - initialHeadY) * p;
        if (neck) neck.rotation.y = initialNeckY + (targetNeckY - initialNeckY) * p;
      }, resolve, abortSignal);
      abortSignal.addEventListener("abort", reject);
    });

    // Hold side pose
    await new Promise<void>((resolve, reject) => {
      if (abortSignal.aborted) return reject();
      const timer = setTimeout(resolve, 800 + Math.random() * 1000);
      abortSignal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject();
      });
    });

    // Return to center
    await new Promise<void>((resolve, reject) => {
      if (abortSignal.aborted) return reject();
      animate(900, (p) => {
        head.rotation.y = targetHeadY + (initialHeadY - targetHeadY) * p;
        if (neck) neck.rotation.y = targetNeckY + (initialNeckY - targetNeckY) * p;
      }, resolve, abortSignal);
      abortSignal.addEventListener("abort", reject);
    });
  },

  tilt_head: async (app: Application, originalStates: OriginalStates, abortSignal: AbortSignal) => {
    const head = app.findObjectByName("Head");
    if (!head) return;

    const initialHeadZ = originalStates["Head"]?.rotation?.z ?? 0;
    const targetHeadZ = initialHeadZ + (Math.random() > 0.5 ? 0.08 : -0.08);

    // Tilt head
    await new Promise<void>((resolve, reject) => {
      if (abortSignal.aborted) return reject();
      animate(1000, (p) => {
        head.rotation.z = initialHeadZ + (targetHeadZ - initialHeadZ) * p;
      }, resolve, abortSignal);
      abortSignal.addEventListener("abort", reject);
    });

    // Hold tilt
    await new Promise<void>((resolve, reject) => {
      if (abortSignal.aborted) return reject();
      const timer = setTimeout(resolve, 600 + Math.random() * 800);
      abortSignal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject();
      });
    });

    // Return to vertical
    await new Promise<void>((resolve, reject) => {
      if (abortSignal.aborted) return reject();
      animate(800, (p) => {
        head.rotation.z = targetHeadZ + (initialHeadZ - targetHeadZ) * p;
      }, resolve, abortSignal);
      abortSignal.addEventListener("abort", reject);
    });
  },

  breathe: async (app: Application, originalStates: OriginalStates, abortSignal: AbortSignal) => {
    const body = app.findObjectByName("Body");
    if (!body) return;

    const initialBodyScaleY = originalStates["Body"]?.scale?.y ?? 1;
    const initialBodyScaleZ = originalStates["Body"]?.scale?.z ?? 1;
    const scaleFactor = 1.025; // Subtle expansion

    // Inhale
    await new Promise<void>((resolve, reject) => {
      if (abortSignal.aborted) return reject();
      animate(1600, (p) => {
        body.scale.y = initialBodyScaleY + (initialBodyScaleY * (scaleFactor - 1)) * p;
        body.scale.z = initialBodyScaleZ + (initialBodyScaleZ * (scaleFactor - 1)) * p;
      }, resolve, abortSignal);
      abortSignal.addEventListener("abort", reject);
    });

    // Exhale
    await new Promise<void>((resolve, reject) => {
      if (abortSignal.aborted) return reject();
      animate(2000, (p) => {
        body.scale.y = (initialBodyScaleY * scaleFactor) - (initialBodyScaleY * (scaleFactor - 1)) * p;
        body.scale.z = (initialBodyScaleZ * scaleFactor) - (initialBodyScaleZ * (scaleFactor - 1)) * p;
      }, resolve, abortSignal);
      abortSignal.addEventListener("abort", reject);
    });
  },

  check_hud: async (app: Application, originalStates: OriginalStates, abortSignal: AbortSignal) => {
    const head = app.findObjectByName("Head");
    const neck = app.findObjectByName("Neck");
    if (!head) return;

    const lookLeft = Math.random() > 0.5; // Left panel vs Right panel
    const initialHeadY = originalStates["Head"]?.rotation?.y ?? 0;
    const initialHeadX = originalStates["Head"]?.rotation?.x ?? 0;
    const initialNeckY = originalStates["Neck"]?.rotation?.y ?? 0;

    // Look slightly towards left or right panel
    const targetHeadY = initialHeadY + (lookLeft ? -0.38 : 0.38);
    const targetHeadX = initialHeadX + 0.04; // Look slightly down towards the panels
    const targetNeckY = initialNeckY + (targetHeadY - initialHeadY) * 0.35;

    // Glance
    await new Promise<void>((resolve, reject) => {
      if (abortSignal.aborted) return reject();
      animate(900, (p) => {
        head.rotation.y = initialHeadY + (targetHeadY - initialHeadY) * p;
        head.rotation.x = initialHeadX + (targetHeadX - initialHeadX) * p;
        if (neck) neck.rotation.y = initialNeckY + (targetNeckY - initialNeckY) * p;
      }, resolve, abortSignal);
      abortSignal.addEventListener("abort", reject);
    });

    // Observe HUD panel
    await new Promise<void>((resolve, reject) => {
      if (abortSignal.aborted) return reject();
      const timer = setTimeout(resolve, 1500 + Math.random() * 1000);
      abortSignal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject();
      });
    });

    // Return to center
    await new Promise<void>((resolve, reject) => {
      if (abortSignal.aborted) return reject();
      animate(800, (p) => {
        head.rotation.y = targetHeadY + (initialHeadY - targetHeadY) * p;
        head.rotation.x = targetHeadX + (initialHeadX - targetHeadX) * p;
        if (neck) neck.rotation.y = targetNeckY + (initialNeckY - targetNeckY) * p;
      }, resolve, abortSignal);
      abortSignal.addEventListener("abort", reject);
    });
  }
};

type BehaviorName = keyof typeof BEHAVIORS;

export function useOdinBehaviors({
  app,
  speaking,
  listening,
  thinking,
  inactivityThresholdMs = 5000,
}: {
  app: Application | null;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  inactivityThresholdMs?: number;
}) {
  const [currentState, setCurrentState] = useState<OdinState>("Idle");
  
  // Ref for original object positions/rotations/scales
  const originalStatesRef = useRef<OriginalStates>({});
  
  // Abort controller to interrupt active animations
  const animationAbortControllerRef = useRef<AbortController | null>(null);

  // Inactivity timeout ref
  const inactivityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Scheduling timeout ref for the next idle animation
  const nextIdleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Record initial positions once Spline is loaded
  useEffect(() => {
    if (!app) return;
    const names = ["Head", "Neck", "Body", "Visor"];
    const states: OriginalStates = {};
    for (const name of names) {
      const obj = app.findObjectByName(name);
      if (obj) {
        states[name] = {
          position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
          rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
          scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
        };
      }
    }
    originalStatesRef.current = states;
  }, [app]);

  // Determine Odin's main active state
  useEffect(() => {
    if (speaking) {
      setCurrentState("Speaking");
    } else if (listening) {
      setCurrentState("Listening");
    } else if (thinking) {
      setCurrentState("Thinking");
    } else {
      setCurrentState("Idle");
    }
  }, [speaking, listening, thinking]);

  // Cancel any running animation and restore defaults smoothly
  const cancelActiveAnimation = useCallback(() => {
    if (animationAbortControllerRef.current) {
      animationAbortControllerRef.current.abort();
      animationAbortControllerRef.current = null;
    }
    if (app && Object.keys(originalStatesRef.current).length > 0) {
      smoothRestoreDefaults(app, originalStatesRef.current, 250);
    }
  }, [app]);

  // Clear timers helper
  const clearTimers = useCallback(() => {
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
      inactivityTimeoutRef.current = null;
    }
    if (nextIdleTimeoutRef.current) {
      clearTimeout(nextIdleTimeoutRef.current);
      nextIdleTimeoutRef.current = null;
    }
  }, []);

  // Function to run a single random behavior
  const executeRandomBehavior = useCallback(async () => {
    if (!app || currentState !== "Idle") return;

    // Interrupt any other active animation
    if (animationAbortControllerRef.current) {
      animationAbortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    animationAbortControllerRef.current = abortController;

    const behaviorList: BehaviorName[] = ["blink", "look_around", "tilt_head", "breathe", "check_hud"];
    const randomBehaviorName = behaviorList[Math.floor(Math.random() * behaviorList.length)];
    const behaviorFn = BEHAVIORS[randomBehaviorName];

    try {
      await behaviorFn(app, originalStatesRef.current, abortController.signal);
    } catch (e) {
      // Swallowed: either aborted or error
    } finally {
      if (animationAbortControllerRef.current === abortController) {
        animationAbortControllerRef.current = null;
      }
      // Schedule next idle behavior with random delay (2 - 5.5s) if still Idle
      if (currentState === "Idle" && !abortController.signal.aborted) {
        nextIdleTimeoutRef.current = setTimeout(
          executeRandomBehavior,
          2000 + Math.random() * 3500
        );
      }
    }
  }, [app, currentState]);

  // Restart the inactivity timer
  const resetInactivityTimer = useCallback(() => {
    clearTimers();
    cancelActiveAnimation();

    if (currentState !== "Idle") return;

    // Start inactivity countdown
    inactivityTimeoutRef.current = setTimeout(() => {
      // Inactivity reached -> start spontaneous idle animations
      executeRandomBehavior();
    }, inactivityThresholdMs);
  }, [currentState, inactivityThresholdMs, clearTimers, cancelActiveAnimation, executeRandomBehavior]);

  // Event listener setup for user interaction
  useEffect(() => {
    if (currentState !== "Idle") {
      // If we are not in Idle state (Speaking, Listening, Thinking), clear any active idle behaviors/timers
      clearTimers();
      cancelActiveAnimation();
      return;
    }

    // Initialize/Restart timer on mount or state change to Idle
    resetInactivityTimer();

    const handleInteraction = () => {
      resetInactivityTimer();
    };

    window.addEventListener("mousemove", handleInteraction);
    window.addEventListener("keydown", handleInteraction);
    window.addEventListener("mousedown", handleInteraction);
    window.addEventListener("touchstart", handleInteraction, { passive: true });

    return () => {
      window.removeEventListener("mousemove", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
      window.removeEventListener("mousedown", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
      clearTimers();
    };
  }, [currentState, resetInactivityTimer, clearTimers, cancelActiveAnimation]);

  return {
    currentState,
  };
}

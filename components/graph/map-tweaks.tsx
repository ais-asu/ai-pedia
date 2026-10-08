"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { Tweaks } from "./network";

const CONTROLS: {
  key: keyof Tweaks;
  label: string;
  min: number;
  max: number;
}[] = [
  { key: "density", label: "Network density", min: 0.3, max: 2 },
  { key: "glow", label: "Edge glow", min: 0.2, max: 2 },
  { key: "drift", label: "Drift", min: 0, max: 2.5 },
];

/** The little control drawer for how busy and bright the network is. */
export function MapTweaks({
  tweaks,
  onChange,
}: {
  tweaks: Tweaks;
  onChange: (next: Tweaks) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="nmap-tweaks">
      {open && (
        <div className="nmap-tweaks-body">
          {CONTROLS.map((c) => (
            <label key={c.key} className="block">
              <span className="flex justify-between">
                <span className="nmap-meta">{c.label}</span>
                <span className="nmap-meta tabular-nums">
                  {tweaks[c.key].toFixed(1)}×
                </span>
              </span>
              <input
                type="range"
                min={c.min}
                max={c.max}
                step={0.1}
                value={tweaks[c.key]}
                onChange={(e) =>
                  onChange({ ...tweaks, [c.key]: Number(e.target.value) })
                }
                className="nmap-range mt-2"
              />
            </label>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="nmap-tweaks-toggle"
      >
        <SlidersHorizontal size={13} aria-hidden="true" />
        Tweaks
      </button>
    </div>
  );
}

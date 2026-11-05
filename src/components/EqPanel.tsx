import { useEqStore } from '../store/eq';
import { defaultPresets } from '../audio/presets';
import { EQ_FREQUENCIES } from '../audio/eq';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { useRef, useCallback } from 'react';

function VerticalFader({
  value,
  min,
  max,
  step,
  onChange,
  label,
  labelStyle,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
  labelStyle?: React.CSSProperties;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const clamp = (v: number) => {
    const stepped = Math.round(v / step) * step;
    return Math.max(min, Math.min(max, parseFloat(stepped.toFixed(2))));
  };

  const getValueFromY = useCallback(
    (clientY: number) => {
      const track = trackRef.current;
      if (!track) return value;
      const rect = track.getBoundingClientRect();
      const pct = 1 - (clientY - rect.top) / rect.height;
      return clamp(min + pct * (max - min));
    },
    [min, max, value]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onChange(getValueFromY(e.clientY));
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    onChange(getValueFromY(e.clientY));
  };

  const handlePointerUp = () => {
    dragging.current = false;
  };

  // fill percentage: 0 at min, 1 at max
  const fillPct = ((value - min) / (max - min)) * 100;
  // zero-line percentage (where 0dB sits)
  const zeroPct = ((0 - min) / (max - min)) * 100;
  const displayVal = value > 0 ? `+${value.toFixed(1)}` : `${value.toFixed(1)}`;

  return (
    <div className="eq-fader-col">
      <span className="eq-gain-val">{displayVal}</span>
      <div
        className="eq-fader-track"
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* zero line */}
        <div className="eq-fader-zero" style={{ bottom: `${zeroPct}%` }} />
        {/* fill bar from zero to thumb */}
        {value >= 0 ? (
          <div
            className="eq-fader-fill"
            style={{ bottom: `${zeroPct}%`, height: `${fillPct - zeroPct}%` }}
          />
        ) : (
          <div
            className="eq-fader-fill negative"
            style={{ bottom: `${fillPct}%`, height: `${zeroPct - fillPct}%` }}
          />
        )}
        {/* thumb knob */}
        <div className="eq-fader-thumb" style={{ bottom: `${fillPct}%` }} />
      </div>
      <span className="eq-freq-label" style={labelStyle}>
        {label}
      </span>
    </div>
  );
}

export function EqPanel() {
  const {
    isEnabled,
    activePresetName,
    currentGains,
    currentPreamp,
    toggleEnabled,
    applyPreset,
    setBandGain,
    setPreamp,
  } = useEqStore();

  const handleReset = () => {
    applyPreset('Flat');
  };

  return (
    <div className="eq-container">
      {/* Top Controls */}
      <div className="eq-top-bar">
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-system)' }}>
            Equalizer
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-system)', marginTop: 2 }}>
            Shape the tone of your music
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            className={`btn-secondary ${isEnabled ? 'active' : ''}`}
            onClick={toggleEnabled}
            style={{
              fontFamily: 'var(--font-system)',
              fontSize: 11,
              fontWeight: 600,
              height: 28,
              padding: '0 12px',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${isEnabled ? 'var(--accent)' : 'var(--border-contrast)'}`,
              background: isEnabled ? 'var(--accent)' : 'var(--surface-element)',
              color: isEnabled ? 'var(--accent-contrast, #000)' : 'var(--text-tertiary)',
            }}
          >
            {isEnabled ? 'On' : 'Off'}
          </button>

          <button
            className="btn-secondary"
            onClick={handleReset}
            title="Reset to flat (0 dB)"
            style={{
              fontFamily: 'var(--font-system)',
              fontSize: 11,
              fontWeight: 500,
              height: 28,
              padding: '0 12px',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <ArrowCounterClockwise size={12} />
            <span>Flat</span>
          </button>
        </div>
      </div>

      {/* Presets */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6, fontFamily: 'var(--font-system)' }}>
          Presets
        </div>
        <div className="eq-presets-wrap">
          {defaultPresets.map((p) => (
            <button
              key={p.name}
              className={`eq-preset-chip ${activePresetName === p.name ? 'active' : ''}`}
              onClick={() => applyPreset(p.name)}
            >
              {p.name}
            </button>
          ))}
          {activePresetName === 'Custom' && (
            <span className="eq-preset-chip active">Custom</span>
          )}
        </div>
      </div>

      {/* Fader Rack */}
      <div
        className="eq-rack-box"
        style={{
          opacity: isEnabled ? 1 : 0.4,
          pointerEvents: isEnabled ? 'auto' : 'none',
        }}
      >
        {/* Master Preamp */}
        <VerticalFader
          value={currentPreamp}
          min={-12}
          max={12}
          step={0.5}
          onChange={setPreamp}
          label="Pre"
          labelStyle={{ color: 'var(--text-secondary)' }}
        />

        <div className="eq-rack-divider" />

        {/* 10 Parametric Bands */}
        {EQ_FREQUENCIES.map((freq: number, i: number) => {
          const gain = currentGains[i];
          const freqLabel = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
          return (
            <VerticalFader
              key={freq}
              value={gain}
              min={-12}
              max={12}
              step={0.5}
              onChange={(v) => setBandGain(i, v)}
              label={freqLabel}
            />
          );
        })}
      </div>
    </div>
  );
}

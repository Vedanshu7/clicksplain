"use client";

import { useState } from "react";

interface Profile {
  preInfusion: number;
  bloom: number;
  peakPressure: number;
  brewTemp: number;
}

const PROFILES: Record<string, Profile> = {
  Classic: { preInfusion: 5, bloom: 0, peakPressure: 9, brewTemp: 93 },
  Lungo: { preInfusion: 8, bloom: 4, peakPressure: 7, brewTemp: 92 },
  Ristretto: { preInfusion: 3, bloom: 0, peakPressure: 10.5, brewTemp: 94 },
};

const SHOTS = [
  { pulled: "Today, 8:12", dose: "18.0 g", yield: "36.4 g", ratio: "1:2.0", time: "28 s", note: null },
  { pulled: "Today, 7:55", dose: "18.0 g", yield: "41.0 g", ratio: "1:2.3", time: "22 s", note: "Channeling" },
  { pulled: "Yesterday, 18:40", dose: "18.5 g", yield: "37.0 g", ratio: "1:2.0", time: "31 s", note: null },
];

export function CremaApp() {
  const [profileName, setProfileName] = useState("Classic");
  const [profile, setProfile] = useState<Profile>(PROFILES.Classic!);

  const update = (patch: Partial<Profile>) => setProfile((current) => ({ ...current, ...patch }));
  const chooseProfile = (name: string) => {
    setProfileName(name);
    setProfile(PROFILES[name]!);
  };

  return (
    <main className="page">
      <header className="masthead">
        <span className="wordmark">Crema</span>
        <label className="profile-picker">
          Profile
          <select value={profileName} onChange={(event) => chooseProfile(event.target.value)}>
            {Object.keys(PROFILES).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
      </header>

      <p className="intro">
        Not sure what Bloom or PID offset do? Press <kbd>?</kbd> at the bottom right, then click any control on
        the machine to have it explained.
      </p>

      <section className="machine" aria-label="Machine controls">
        <div className="gauge-wrap">
          <PressureGauge bar={profile.peakPressure} />
          <p className="gauge-caption">Peak brew pressure</p>
        </div>

        <div className="settings">
          <Slider
            id="pre-infusion"
            label="Pre-infusion"
            unit="s"
            min={0}
            max={10}
            step={1}
            value={profile.preInfusion}
            onChange={(preInfusion) => update({ preInfusion })}
          />
          <Slider
            id="bloom"
            label="Bloom"
            unit="s"
            min={0}
            max={10}
            step={1}
            value={profile.bloom}
            onChange={(bloom) => update({ bloom })}
          />
          <Slider
            id="peak-pressure"
            label="Peak pressure"
            unit="bar"
            min={6}
            max={11}
            step={0.5}
            value={profile.peakPressure}
            onChange={(peakPressure) => update({ peakPressure })}
          />
          <div className="setting setting-temp">
            <span className="setting-name" id="brew-temp-label">
              Brew temperature
            </span>
            <div className="stepper" role="group" aria-labelledby="brew-temp-label">
              <button
                type="button"
                aria-label="Lower brew temperature"
                onClick={() => update({ brewTemp: Math.max(88, profile.brewTemp - 0.5) })}
              >
                −
              </button>
              <output>{profile.brewTemp.toFixed(1)} °C</output>
              <button
                type="button"
                aria-label="Raise brew temperature"
                onClick={() => update({ brewTemp: Math.min(96, profile.brewTemp + 0.5) })}
              >
                +
              </button>
            </div>
            <span className="pid">PID offset +0.3 °C</span>
          </div>
        </div>

        <div className="actions">
          <button type="button" className="button button-primary">
            Pull shot
          </button>
          <button type="button" className="button button-quiet">
            Flush group head
          </button>
          <button type="button" className="button button-quiet" data-agent-id="descale">
            Descale
          </button>
          <span className="descale-due">Descale due in 12 shots</span>
        </div>
      </section>

      <div className="lower">
        <section className="sheet" aria-labelledby="shots-heading">
          <h2 id="shots-heading">Recent shots</h2>
          <div className="table-scroll">
            <table className="shots">
            <thead>
              <tr>
                <th>Pulled</th>
                <th>Dose</th>
                <th>Yield</th>
                <th>Ratio</th>
                <th>Time</th>
                <th>
                  <span className="visually-hidden">Notes</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {SHOTS.map((shot) => (
                <tr key={shot.pulled}>
                  <td>{shot.pulled}</td>
                  <td>{shot.dose}</td>
                  <td>{shot.yield}</td>
                  <td>{shot.ratio}</td>
                  <td>{shot.time}</td>
                  <td>{shot.note && <span className="flag">{shot.note}</span>}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </section>

        <section className="sheet" aria-labelledby="share-heading">
          <h2 id="share-heading">Share this profile</h2>
          <form className="share" onSubmit={(event) => event.preventDefault()}>
            <label htmlFor="share-email">Email</label>
            <input id="share-email" type="email" placeholder="friend@example.com" />
            <label htmlFor="share-access">They can</label>
            <select id="share-access">
              <option>Use it</option>
              <option>Use and edit it</option>
            </select>
            <button type="submit" className="button button-primary">
              Send link
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

function Slider(props: {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="setting">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      <output htmlFor={props.id}>
        {props.value} {props.unit}
      </output>
    </div>
  );
}

const GAUGE_MAX = 12;
const REDLINE_FROM = 10;
const CX = 150;
const CY = 150;
const R = 104;

// Angles in degrees clockwise from 12 o'clock: the dial sweeps 240°.
const angleFor = (bar: number) => -120 + (240 * bar) / GAUGE_MAX;

function pointAt(angle: number, radius: number): [number, number] {
  const radians = (angle * Math.PI) / 180;
  return [CX + radius * Math.sin(radians), CY - radius * Math.cos(radians)];
}

function arc(fromBar: number, toBar: number, radius: number): string {
  const [x1, y1] = pointAt(angleFor(fromBar), radius);
  const [x2, y2] = pointAt(angleFor(toBar), radius);
  const largeArc = angleFor(toBar) - angleFor(fromBar) > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
}

function PressureGauge({ bar }: { bar: number }) {
  const ticks = Array.from({ length: GAUGE_MAX * 2 + 1 }, (_, i) => i / 2);

  return (
    <svg className="gauge" viewBox="0 0 300 250" role="img" aria-label={`Pressure gauge reading ${bar} bar`}>
      <path d={arc(0, GAUGE_MAX, R)} fill="none" stroke="rgba(152,161,168,0.35)" strokeWidth="3" />
      <path d={arc(REDLINE_FROM, GAUGE_MAX, R)} fill="none" stroke="var(--redline)" strokeWidth="6" />

      {ticks.map((value) => {
        const major = Number.isInteger(value) && value % 3 === 0;
        const whole = Number.isInteger(value);
        const [x1, y1] = pointAt(angleFor(value), R - 6);
        const [x2, y2] = pointAt(angleFor(value), R - (major ? 22 : whole ? 15 : 10));
        return (
          <line
            key={value}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={value >= REDLINE_FROM ? "var(--redline)" : "#c9d0d5"}
            strokeWidth={major ? 2.5 : 1.2}
          />
        );
      })}

      {[0, 3, 6, 9, 12].map((value) => {
        const [x, y] = pointAt(angleFor(value), R + 22);
        return (
          <text
            key={value}
            x={x}
            y={y + 6}
            textAnchor="middle"
            fill="#c9d0d5"
            fontSize="17"
            fontWeight="600"
            style={{ fontStretch: "125%" }}
          >
            {value}
          </text>
        );
      })}

      <g className="gauge-needle" style={{ transform: `rotate(${angleFor(bar)}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
        <line x1={CX} y1={CY + 14} x2={CX} y2={CY - R + 20} stroke="var(--crema)" strokeWidth="4" strokeLinecap="round" />
      </g>
      <circle cx={CX} cy={CY} r="9" fill="var(--crema)" />
      <circle cx={CX} cy={CY} r="3.5" fill="var(--gunmetal)" />

      <text x={CX} y={CY + 58} textAnchor="middle" fill="#eef1f3" fontSize="34" fontWeight="700" style={{ fontStretch: "125%" }}>
        {bar.toFixed(1)}
      </text>
      <text x={CX} y={CY + 78} textAnchor="middle" fill="var(--brushed)" fontSize="14">
        bar
      </text>
    </svg>
  );
}

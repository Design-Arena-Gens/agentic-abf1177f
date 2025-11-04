"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Subtitle = { start: number; end: number; en: string };

type VoiceLine = { start: number; text: string };

const TOTAL_DURATION = 60_000; // ms

const subtitles: Subtitle[] = [
  { start: 0, end: 8000, en: "Night swallows the old house. The forest holds its breath." },
  { start: 8000, end: 16000, en: "A window blinks with a light that should not exist." },
  { start: 16000, end: 22000, en: "Something wakes." },
  { start: 22000, end: 30000, en: "The hallway exhales dust. The oil lamp starves." },
  { start: 30000, end: 36000, en: "The doll listens. The house remembers your name." },
  { start: 36000, end: 40000, en: "Silence arrives like a closed mouth." },
  { start: 40000, end: 51000, en: "Steps retreat, eyes adjust. The stairs descend by themselves." },
  { start: 51000, end: 54000, en: "Something tall is waiting. It sees you first." },
  { start: 54000, end: 60000, en: "There is no last step." }
];

const voiceHindi: VoiceLine[] = [
  { start: 0, text: "??? ?? ?????? ???? ?? ???? ???? ??? ???? ???? ???? ???? ???" },
  { start: 8000, text: "???? ?????? ?? ?????? ???, ?? ??? ????? ????????? ?? ?? ???? ???? ??????" },
  { start: 16000, text: "??? ??? ???? ???" },
  { start: 22000, text: "??????? ??? ?????? ??? ??? ?? ???? ?????? ???" },
  { start: 30000, text: "??????? ??? ??? ??? ???? ???????? ??? ??? ?? ??? ???" },
  { start: 36000, text: "?????? ??? ????? ?? ???? ??? ??? ?????" },
  { start: 40000, text: "??? ???? ???? ???, ????? ??????? ???? ???? ???????? ??? ???? ????? ????" },
  { start: 51000, text: "???? ??? ???? ???? ??? ?? ???? ??????? ????? ???" },
  { start: 54000, text: "?????? ????? ???? ?? ?????" }
];

function useAnimationFrame(callback: (t: number) => void, enabled: boolean) {
  const rafRef = useRef<number | null>(null);
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    const tick = (time: number) => {
      cbRef.current(time);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled]);
}

export default function Page() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [cutToBlack, setCutToBlack] = useState(false);
  const [subtitle, setSubtitle] = useState<string>("");
  const startRef = useRef<number>(0);
  const [ctx, setCtx] = useState<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

  const resize = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    c.style.width = w + "px";
    c.style.height = h + "px";
  }, [dpr]);

  useEffect(() => {
    if (!started) return;
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [started, resize]);

  const scheduleAudio = useCallback(async () => {
    const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
    const master = ac.createGain();
    master.gain.value = 0.8;
    master.connect(ac.destination);
    masterGainRef.current = master;

    const now = ac.currentTime;

    // Ambient drone: layered detuned sines
    const makeDrone = (freq: number, detune: number, gain: number) => {
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ac.createGain();
      g.gain.value = gain;
      o.connect(g).connect(master);
      o.start();
      return { o, g };
    };

    const d1 = makeDrone(48, -8, 0.035);
    const d2 = makeDrone(56, 6, 0.03);
    const d3 = makeDrone(32, 0, 0.02);

    // Subtle LFO on master
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 0.04;
    lfo.connect(lfoGain).connect(master.gain);
    lfo.start();

    // Heartbeat: short pulses on a low noise thump
    const heartbeat = () => {
      const osc = ac.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 60; // thump core
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      osc.connect(g).connect(master);
      osc.start();
      // two-peak envelope
      const t = ac.currentTime;
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      // second bump
      setTimeout(() => {
        const t2 = ac.currentTime;
        g.gain.exponentialRampToValueAtTime(0.25, t2 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t2 + 0.12);
      }, 120);
      setTimeout(() => {
        osc.stop();
      }, 400);
    };

    // Schedule heartbeat more frequent towards the end
    let hbInterval = 1200;
    let hbTimer: number;
    const scheduleHB = () => {
      heartbeat();
      hbTimer = window.setTimeout(scheduleHB, hbInterval);
      // accelerate after 45s
      const elapsed = performance.now() - startRef.current;
      if (elapsed > 45_000) hbInterval = 700;
      if (elapsed > 53_000) hbInterval = 420;
    };
    scheduleHB();

    // Metallic scrape: filtered noise burst
    const metallicScrape = () => {
      const bufferSize = ac.sampleRate * 1.2;
      const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // tail off
      }
      const src = ac.createBufferSource();
      src.buffer = buffer;
      const hp = ac.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 4000;
      const g = ac.createGain();
      g.gain.value = 0.18;
      src.connect(hp).connect(g).connect(master);
      src.start();
    };

    // CRACK: ultra-short white noise hit
    const crack = () => {
      const bufferSize = ac.sampleRate * 0.08;
      const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      const src = ac.createBufferSource();
      src.buffer = buffer;
      const hp = ac.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 3000;
      const g = ac.createGain();
      g.gain.value = 0.8;
      src.connect(hp).connect(g).connect(master);
      src.start();
    };

    // scene-timed events
    const t0 = performance.now();
    startRef.current = t0;

    // metallic scrapes randomly in scene 2
    const scrapeTimers: number[] = [];
    const scheduleScrapes = () => {
      const scheduleAt = (ms: number) => scrapeTimers.push(window.setTimeout(metallicScrape, ms));
      scheduleAt(25_000);
      scheduleAt(31_000);
      scheduleAt(34_000);
    };
    scheduleScrapes();

    // crack at ~32s
    const crackTimer = window.setTimeout(() => {
      crack();
      // brief silence dip
      if (masterGainRef.current) {
        const g = masterGainRef.current.gain;
        const ct = ac.currentTime;
        const prev = g.value;
        g.cancelScheduledValues(ct);
        g.setValueAtTime(prev, ct);
        g.exponentialRampToValueAtTime(0.05, ct + 0.02);
        g.exponentialRampToValueAtTime(0.8, ct + 1.0);
      }
    }, 32_000);

    // cleanup on stop
    return () => {
      d1.o.stop();
      d2.o.stop();
      d3.o.stop();
      lfo.stop();
      window.clearTimeout(hbTimer);
      scrapeTimers.forEach(clearTimeout);
      window.clearTimeout(crackTimer);
      ac.close();
    };
  }, []);

  const speakHindi = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setVoiceEnabled(false);
      return () => {};
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    setVoiceEnabled(true);

    const timers: number[] = [];
    const utter = (text: string) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "hi-IN";
      u.rate = 0.92;
      u.pitch = 0.8;
      u.volume = 1.0;
      return u;
    };

    const startBase = performance.now();

    for (const line of voiceHindi) {
      const delay = Math.max(0, line.start - (performance.now() - startBase));
      const id = window.setTimeout(() => {
        try {
          synth.speak(utter(line.text));
        } catch {}
      }, delay);
      timers.push(id);
    }

    return () => {
      timers.forEach(clearTimeout);
      try { synth.cancel(); } catch {}
    };
  }, []);

  // Visuals draw
  useAnimationFrame((timeMs) => {
    const c = canvasRef.current;
    if (!c || !started) return;
    const ctx2d = c.getContext("2d");
    if (!ctx2d) return;

    const w = c.width;
    const h = c.height;

    // film base
    ctx2d.fillStyle = "#060606";
    ctx2d.fillRect(0, 0, w, h);

    const t = performance.now() - startRef.current;

    // grain
    const grainDensity = 0.08 * dpr;
    const grainCount = Math.floor((w * h) * (0.00002 + 0.00002 * Math.sin(timeMs * 0.001)));
    ctx2d.globalAlpha = 0.06;
    for (let i = 0; i < grainCount; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const lum = Math.random() * 50 + 50;
      ctx2d.fillStyle = `rgb(${lum},${lum},${lum})`;
      ctx2d.fillRect(x, y, 1 * dpr, 1 * dpr);
    }
    ctx2d.globalAlpha = 1;

    // vignette
    const grad = ctx2d.createRadialGradient(w/2, h/2, Math.min(w,h)*0.2, w/2, h/2, Math.max(w,h)*0.6);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.75)");
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, w, h);

    // scene selection
    if (t < 20_000) {
      drawScene1(ctx2d, w, h, t);
    } else if (t < 40_000) {
      drawScene2(ctx2d, w, h, t - 20_000);
    } else if (t < 60_000 && !cutToBlack) {
      drawScene3(ctx2d, w, h, t - 40_000);
    }

    // Subtitle timing
    const s = subtitles.find(s => t >= s.start && t < s.end);
    setSubtitle(s ? s.en : "");

    // abrupt cut to black near end of scene 3 after figure flash
    if (t > 54_000 && !cutToBlack) {
      setCutToBlack(true);
    }

    if (t >= TOTAL_DURATION && !ended) {
      setEnded(true);
    }
  }, started);

  const startFilm = useCallback(async () => {
    if (started) return;
    setStarted(true);
    setEnded(false);
    setCutToBlack(false);
    startRef.current = performance.now();

    const stopAudio = await scheduleAudio();
    const stopVoice = speakHindi();

    // cleanup when finished
    window.setTimeout(() => {
      stopAudio && stopAudio();
      stopVoice && stopVoice();
    }, TOTAL_DURATION + 500);
  }, [scheduleAudio, speakHindi, started]);

  // Scene renderers
  const drawScene1 = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
    // Fog layers
    for (let i = 0; i < 4; i++) {
      const y = h * 0.6 + Math.sin(t * 0.0003 + i * 1.3) * 10 * dpr;
      ctx.fillStyle = `rgba(180,180,180,${0.03 + i*0.02})`;
      ctx.beginPath();
      ctx.ellipse(w * 0.5 + Math.sin(t * 0.0002 + i) * 50, y + i * 18, w * 0.7, 80 + i * 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Trees silhouettes
    for (let i = 0; i < 20; i++) {
      const x = (i / 19) * w + Math.sin(i * 12.3) * 10;
      const height = h * (0.3 + Math.random()*0.2);
      ctx.fillStyle = "#030303";
      ctx.fillRect(x, h - height, 6 * dpr, height);
    }

    // House silhouette
    const houseW = w * 0.22;
    const houseH = h * 0.22;
    const hx = w * 0.5 - houseW / 2;
    const hy = h * 0.6 - houseH;

    ctx.fillStyle = "#070707";
    ctx.fillRect(hx, hy, houseW, houseH);

    // Roof
    ctx.beginPath();
    ctx.moveTo(hx - 10, hy);
    ctx.lineTo(hx + houseW/2, hy - houseH * 0.4);
    ctx.lineTo(hx + houseW + 10, hy);
    ctx.closePath();
    ctx.fillStyle = "#060606";
    ctx.fill();

    // Window flicker
    const wx = hx + houseW * 0.68;
    const wy = hy + houseH * 0.12;
    const ww = houseW * 0.16;
    const wh = houseH * 0.22;
    const flicker = (t > 7_800 && t < 10_800) && (Math.sin(t * 0.06) > 0.2);
    ctx.fillStyle = flicker ? "rgba(220,30,30,0.9)" : "rgba(20,20,20,0.6)";
    ctx.fillRect(wx, wy, ww, wh);
  };

  const drawScene2 = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
    // Hallway perspective
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "#111";
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    ctx.moveTo(w * 0.15, h);
    ctx.lineTo(w * 0.45, h * 0.35);
    ctx.moveTo(w * 0.85, h);
    ctx.lineTo(w * 0.55, h * 0.35);
    ctx.stroke();

    // Table and oil lamp glow
    const tableY = h * 0.65;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(w*0.4, tableY, w*0.2, 12 * dpr);

    const lampX = w * 0.5, lampY = tableY - 10 * dpr;
    const glow = 40 + Math.sin(t * 0.01) * 6;
    const g = ctx.createRadialGradient(lampX, lampY, 2, lampX, lampY, glow * dpr);
    g.addColorStop(0, "rgba(255,180,90,0.8)");
    g.addColorStop(1, "rgba(30,15,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lampX, lampY, glow * dpr, 0, Math.PI * 2);
    ctx.fill();

    // Doll zoom + subtle head tilt
    const zoom = 1 + Math.min(0.15, t / 80_000);
    ctx.save();
    ctx.translate(w/2, h/2);
    ctx.scale(zoom, zoom);
    ctx.translate(-w/2, -h/2);

    const headTilt = t > 30_000 - 20_000 ? Math.sin((t - 10_000) * 0.001) * 0.08 : 0;

    // Doll body
    ctx.fillStyle = "#0e0e0e";
    ctx.fillRect(w*0.49, h*0.54, 20*dpr, 38*dpr);

    // Head
    ctx.save();
    ctx.translate(w*0.5, h*0.5);
    ctx.rotate(headTilt);
    ctx.fillStyle = "#151515";
    ctx.beginPath();
    ctx.arc(0, 0, 16*dpr, 0, Math.PI*2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = "#d0d0d0";
    ctx.beginPath();
    ctx.arc(-6*dpr, -2*dpr, 2.5*dpr, 0, Math.PI*2);
    ctx.arc(6*dpr, -2*dpr, 2.5*dpr, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    ctx.restore();

    // Jump cut hint: slight frame tear
    if (t > 19_000) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(120,0,0,0.04)";
      ctx.fillRect(0, 0, w, 2 * dpr);
      ctx.globalCompositeOperation = "source-over";
    }
  };

  const drawScene3 = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
    // extreme camera shake
    const intensity = Math.min(1, (t / 4000)) * 5;
    const jitterX = (Math.random() - 0.5) * intensity * dpr * 6;
    const jitterY = (Math.random() - 0.5) * intensity * dpr * 6;
    const rot = (Math.random() - 0.5) * 0.02 * intensity;

    ctx.save();
    ctx.translate(w/2, h/2);
    ctx.rotate(rot);
    ctx.translate(-w/2 + jitterX, -h/2 + jitterY);

    // stairs lines
    ctx.fillStyle = "#080808";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#0f0f0f";
    ctx.lineWidth = 4 * dpr;

    for (let i = 0; i < 20; i++) {
      const y = h * 0.2 + i * (h * 0.03 + Math.sin((t*0.01+i)*0.2));
      ctx.beginPath();
      ctx.moveTo(w * 0.2, y);
      ctx.lineTo(w * 0.8, y + 10);
      ctx.stroke();
    }

    // fleeting figure at bottom
    if (t > 10_000 && t < 10_120) {
      ctx.fillStyle = "#0b0b0b";
      ctx.fillRect(w*0.45, h*0.72, w*0.1, h*0.2);
      // eyes
      ctx.fillStyle = "rgba(200,30,30,0.95)";
      ctx.beginPath();
      ctx.arc(w*0.48, h*0.78, 4*dpr, 0, Math.PI*2);
      ctx.arc(w*0.52, h*0.78, 4*dpr, 0, Math.PI*2);
      ctx.fill();
    }

    ctx.restore();
  };

  useEffect(() => {
    if (!started) return;
    const id = window.setInterval(() => {
      const t = performance.now() - startRef.current;
      if (t >= TOTAL_DURATION) {
        window.clearInterval(id);
        setEnded(true);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [started]);

  return (
    <div className={`film-frame grain ${cutToBlack ? "cut-to-black" : ""}`}>
      <canvas ref={canvasRef} className="canvas" />
      {!started && (
        <div className="controls">
          <div style={{ textAlign: "center", padding: 24 }}>
            <div className="badge">4K Analog ? Hindi VO ? Subtitled</div>
            <h1 className="title" style={{ fontSize: "clamp(20px,4vw,36px)", marginBottom: 16 }}>The House That Remembers</h1>
            <p style={{ opacity: 0.8, marginBottom: 16 }}>60-second psychological/analog horror sequence</p>
            <button onClick={startFilm}>Begin</button>
          </div>
        </div>
      )}

      {subtitle && started && !cutToBlack && (
        <div className="overlay caption">{subtitle}</div>
      )}

      {ended && (
        <div className="controls" style={{ background: "linear-gradient(180deg, rgba(0,0,0,.85), rgba(0,0,0,.96))" }}>
          <div style={{ textAlign: "center" }}>
            <div className="badge">END</div>
            <button onClick={() => { setStarted(false); setEnded(false); setSubtitle(""); setCutToBlack(false); }}>Replay</button>
          </div>
        </div>
      )}
    </div>
  );
}

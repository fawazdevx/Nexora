import {useEffect, useRef} from "react";

type Node = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  pulse: number;
  pulseSpeed: number;
};

const NODE_COLOR = "rgba(192, 132, 252, 0.9)";
const LINK_COLOR = "139, 92, 246";

/**
 * Subtle animated mesh of drifting "agent" nodes connected by lines that brighten
 * as nodes approach. Canvas-based for performance, pauses when off-screen or when
 * the user prefers reduced motion.
 */
export function AgentMesh() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = context;
    let width = 0;
    let height = 0;
    let nodes: Node[] = [];
    let frame = 0;
    let running = true;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const LINK_DISTANCE = 168;

    function nodeCount() {
      // Scale node density to viewport, capped for performance.
      return Math.min(58, Math.max(22, Math.round((width * height) / 26000)));
    }

    function seed() {
      nodes = Array.from({length: nodeCount()}, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: 0.006 + Math.random() * 0.012
      }));
    }

    function resize() {
      width = canvas!.clientWidth;
      height = canvas!.clientHeight;
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);

      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;
        node.pulse += node.pulseSpeed;
        if (node.x < 0 || node.x > width) node.vx *= -1;
        if (node.y < 0 || node.y > height) node.vy *= -1;
      }

      // Links between nearby nodes.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK_DISTANCE) {
            const strength = (1 - dist / LINK_DISTANCE) * 0.32;
            ctx.strokeStyle = `rgba(${LINK_COLOR}, ${strength})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Nodes with a soft pulsing glow.
      for (const node of nodes) {
        const glow = 1.6 + Math.sin(node.pulse) * 0.9;
        const radius = 1.5 + Math.sin(node.pulse) * 0.5;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + glow, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(155, 92, 246, 0.12)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = NODE_COLOR;
        ctx.fill();
      }
    }

    function loop() {
      if (!running) return;
      draw();
      frame = window.requestAnimationFrame(loop);
    }

    function start() {
      if (running) return;
      running = true;
      loop();
    }

    function stop() {
      running = false;
      window.cancelAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);

    // Pause when the tab is hidden to save cycles.
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);

    if (reduceMotion) {
      draw(); // single static frame
    } else {
      loop();
    }

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}

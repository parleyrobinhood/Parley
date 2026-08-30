"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * The hero constellation: an agent network in dark space.
 *
 * ~240 nodes start clustered in the triad of the logo, hold for a beat, then
 * release into a wide drifting field. Light pulses travel along edges — a post
 * finding a reader — and occasionally an edge crystallises and stays bright,
 * which is a signal: the one thing on this network that is permanent.
 *
 * That is the argument for the whole animation. It is not decoration with a
 * story bolted on; it is the protocol's shape. Agents scattered, connected,
 * mostly quiet, occasionally endorsing something that then stays lit.
 *
 * Falls back to a 2D canvas when WebGL is unavailable or reduced-motion is set
 * — the field is still drawn so the hero keeps its texture, it simply stops
 * moving. Everything is disposed on unmount; a WebGL context that outlives its
 * component is a leak the browser will not collect for you.
 */
const NODE_COUNT = 240;
const RELEASE_AFTER = 2.2;

interface Pulse {
  a: number;
  b: number;
  t: number;
  speed: number;
  mesh: THREE.Mesh;
}

export function Constellation() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const webglOk = (() => {
      try {
        const probe = document.createElement("canvas");
        return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
      } catch {
        return false;
      }
    })();

    /* ------------------------------ 2D fallback ------------------------------ */

    if (!webglOk || reduced) {
      const canvas = document.createElement("canvas");
      canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
      mount.appendChild(canvas);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let w = 0;
      let h = 0;
      const resize = () => {
        w = mount.clientWidth;
        h = mount.clientHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      window.addEventListener("resize", resize);

      const pts = Array.from({ length: 120 }, () => ({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.0004,
        vy: (Math.random() - 0.5) * 0.0004,
        r: 1 + Math.random() * 1.6,
      }));

      let raf2d = 0;
      const draw2d = () => {
        ctx.clearRect(0, 0, w, h);
        for (const p of pts) {
          p.x = (p.x + p.vx + 1) % 1;
          p.y = (p.y + p.vy + 1) % 1;
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(143,255,138,0.55)";
          ctx.fill();
        }
        ctx.strokeStyle = "rgba(143,255,138,0.06)";
        for (let i = 0; i < pts.length; i += 1) {
          for (let j = i + 1; j < pts.length; j += 1) {
            const dx = (pts[i]!.x - pts[j]!.x) * w;
            const dy = (pts[i]!.y - pts[j]!.y) * h;
            if (dx * dx + dy * dy < 110 * 110) {
              ctx.beginPath();
              ctx.moveTo(pts[i]!.x * w, pts[i]!.y * h);
              ctx.lineTo(pts[j]!.x * w, pts[j]!.y * h);
              ctx.stroke();
            }
          }
        }
        if (!reduced) raf2d = requestAnimationFrame(draw2d);
      };
      draw2d();

      return () => {
        cancelAnimationFrame(raf2d);
        window.removeEventListener("resize", resize);
        canvas.remove();
      };
    }

    /* ------------------------------ WebGL scene ------------------------------ */

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x070b07, 0.055);
    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 16);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    mount.appendChild(renderer.domElement);

    // Nodes begin in the logo's three lobes and are given a scattered target to
    // drift toward, so the opening is a mark that dissolves into a network.
    const positions = new Float32Array(NODE_COUNT * 3);
    const targets: THREE.Vector3[] = [];
    const velocities: THREE.Vector3[] = [];
    const lobes = [
      new THREE.Vector3(0, 3.2, 0),
      new THREE.Vector3(-3.2, -2.2, 0),
      new THREE.Vector3(3.2, -2.2, 0),
    ];

    for (let i = 0; i < NODE_COUNT; i += 1) {
      const lobe = lobes[i % 3]!;
      positions[i * 3] = lobe.x + (Math.random() - 0.5) * 2.4;
      positions[i * 3 + 1] = lobe.y + (Math.random() - 0.5) * 2.4;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 2.4;
      targets.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 30,
          (Math.random() - 0.5) * 18,
          (Math.random() - 0.5) * 14,
        ),
      );
      velocities.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.006,
          (Math.random() - 0.5) * 0.006,
          (Math.random() - 0.5) * 0.006,
        ),
      );
    }

    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    // A soft round sprite, drawn once into a canvas. Cheaper and softer than a
    // circle geometry per node, and it gives the additive blend something to
    // bloom with.
    const spriteCanvas = document.createElement("canvas");
    spriteCanvas.width = 64;
    spriteCanvas.height = 64;
    const sctx = spriteCanvas.getContext("2d")!;
    const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(180,255,176,1)");
    grad.addColorStop(0.35, "rgba(143,255,138,0.85)");
    grad.addColorStop(1, "rgba(143,255,138,0)");
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 64, 64);
    const sprite = new THREE.CanvasTexture(spriteCanvas);

    const nodeMat = new THREE.PointsMaterial({
      size: 0.42,
      map: sprite,
      color: new THREE.Color("#8FFF8A"),
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    scene.add(new THREE.Points(nodeGeo, nodeMat));

    // Topology is computed once from the drift targets, not per frame: an
    // O(n²) neighbour search every frame at 240 nodes would dominate the loop,
    // and edges that rewire as nodes pass each other read as noise anyway.
    const edgePairs: Array<[number, number]> = [];
    for (let i = 0; i < NODE_COUNT; i += 1) {
      const near = [...targets.keys()]
        .filter((j) => j !== i)
        .sort((a, b) => targets[a]!.distanceToSquared(targets[i]!) - targets[b]!.distanceToSquared(targets[i]!))
        .slice(0, 2);
      for (const j of near) {
        if (!edgePairs.some(([a, b]) => a === j && b === i)) edgePairs.push([i, j]);
      }
    }

    const edgePos = new Float32Array(edgePairs.length * 6);
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute("position", new THREE.BufferAttribute(edgePos, 3));
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x8fff8a,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    scene.add(new THREE.LineSegments(edgeGeo, edgeMat));

    // Crystallised edges are signals: brighter, and they never fade.
    const crystalPairs: Array<[number, number]> = [];
    const crystalGeo = new THREE.BufferGeometry();
    const crystalMat = new THREE.LineBasicMaterial({
      color: 0xb4ffb0,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    scene.add(new THREE.LineSegments(crystalGeo, crystalMat));

    const pulseGeo = new THREE.SphereGeometry(0.16, 8, 8);
    const pulseMat = new THREE.MeshBasicMaterial({
      color: 0xb4ffb0,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pulses: Pulse[] = [];

    const posAttr = nodeGeo.getAttribute("position") as THREE.BufferAttribute;
    const getPos = (idx: number) =>
      new THREE.Vector3(posAttr.getX(idx), posAttr.getY(idx), posAttr.getZ(idx));

    const spawnPulse = () => {
      if (pulses.length > 7 || edgePairs.length === 0) return;
      const pair = edgePairs[Math.floor(Math.random() * edgePairs.length)]!;
      const mesh = new THREE.Mesh(pulseGeo, pulseMat.clone());
      scene.add(mesh);
      pulses.push({ a: pair[0], b: pair[1], t: 0, speed: 0.008 + Math.random() * 0.012, mesh });
    };

    const crystallize = () => {
      if (crystalPairs.length > 14 || edgePairs.length === 0) return;
      const pair = edgePairs[Math.floor(Math.random() * edgePairs.length)]!;
      if (crystalPairs.some(([a, b]) => a === pair[0] && b === pair[1])) return;
      crystalPairs.push(pair);
      const arr = new Float32Array(crystalPairs.length * 6);
      crystalPairs.forEach(([a, b], k) => {
        const pa = getPos(a);
        const pb = getPos(b);
        arr.set([pa.x, pa.y, pa.z, pb.x, pb.y, pb.z], k * 6);
      });
      crystalGeo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    };

    const pulseTimer = window.setInterval(spawnPulse, 1400);
    const crystalTimer = window.setInterval(crystallize, 5200);

    let mx = 0;
    let my = 0;
    const onMouse = (e: MouseEvent) => {
      mx = (e.clientX / window.innerWidth - 0.5) * 2;
      my = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMouse);

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    const clock = new THREE.Clock();
    let raf = 0;

    const animate = () => {
      const t = clock.getElapsedTime();
      const release = Math.min(Math.max((t - RELEASE_AFTER) / 2.5, 0), 1);
      const ease = release * release * (3 - 2 * release);

      for (let i = 0; i < NODE_COUNT; i += 1) {
        const ix = i * 3;
        const cx = positions[ix]!;
        const cy = positions[ix + 1]!;
        const cz = positions[ix + 2]!;
        const target = targets[i]!;
        const vel = velocities[i]!;
        positions[ix] = cx + (target.x - cx) * 0.004 * ease + vel.x * ease + Math.sin(t * 0.4 + i) * 0.0015;
        positions[ix + 1] =
          cy + (target.y - cy) * 0.004 * ease + vel.y * ease + Math.cos(t * 0.35 + i * 1.3) * 0.0015;
        positions[ix + 2] = cz + (target.z - cz) * 0.004 * ease + vel.z * ease;
      }
      posAttr.needsUpdate = true;

      for (let k = 0; k < edgePairs.length; k += 1) {
        const [a, b] = edgePairs[k]!;
        edgePos[k * 6] = posAttr.getX(a);
        edgePos[k * 6 + 1] = posAttr.getY(a);
        edgePos[k * 6 + 2] = posAttr.getZ(a);
        edgePos[k * 6 + 3] = posAttr.getX(b);
        edgePos[k * 6 + 4] = posAttr.getY(b);
        edgePos[k * 6 + 5] = posAttr.getZ(b);
      }
      edgeGeo.getAttribute("position").needsUpdate = true;

      if (crystalPairs.length) {
        const attr = crystalGeo.getAttribute("position") as THREE.BufferAttribute;
        crystalPairs.forEach(([a, b], k) => {
          attr.setXYZ(k * 2, posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
          attr.setXYZ(k * 2 + 1, posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
        });
        attr.needsUpdate = true;
      }

      for (let i = pulses.length - 1; i >= 0; i -= 1) {
        const p = pulses[i]!;
        p.t += p.speed;
        if (p.t >= 1) {
          scene.remove(p.mesh);
          (p.mesh.material as THREE.Material).dispose();
          pulses.splice(i, 1);
          continue;
        }
        p.mesh.position.lerpVectors(getPos(p.a), getPos(p.b), p.t);
        p.mesh.scale.setScalar(0.6 + Math.sin(p.t * Math.PI) * 1.1);
      }

      camera.position.x += (mx * 1.6 - camera.position.x) * 0.03;
      camera.position.y += (-my * 1.0 - camera.position.y) * 0.03;
      camera.position.z = 16 + Math.sin(t * 0.12) * 0.8;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(pulseTimer);
      clearInterval(crystalTimer);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("resize", onResize);
      for (const p of pulses) (p.mesh.material as THREE.Material).dispose();
      renderer.dispose();
      nodeGeo.dispose();
      edgeGeo.dispose();
      crystalGeo.dispose();
      nodeMat.dispose();
      edgeMat.dispose();
      crystalMat.dispose();
      pulseGeo.dispose();
      pulseMat.dispose();
      sprite.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={mountRef} className="absolute inset-0" aria-hidden="true" />;
}

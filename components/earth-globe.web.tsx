import { useEffect, useRef } from "react";
import { Image, Platform } from "react-native";
import * as THREE from "three";

const EARTH_TEXTURE = require("@/assets/images/rook-earth-texture.jpg");

export function EarthGlobe() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      typeof window === "undefined" ||
      !hostRef.current
    ) {
      return;
    }

    const host = hostRef.current;
    let disposed = false;
    let cleanupScene: (() => void) | undefined;

    const initialiseGlobe = async () => {
      try {
        if (disposed) return;

        const renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        });
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.style.cssText =
          "display:block;width:100%;height:100%;cursor:grab;touch-action:none;";
        host.replaceChildren(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
        camera.position.set(0, 0, 4.8);

        const globeGroup = new THREE.Group();
        globeGroup.rotation.set(-0.18, -0.72, 0.13);
        scene.add(globeGroup);

        const textureSource = Image.resolveAssetSource(EARTH_TEXTURE);
        const texture = await new Promise<THREE.Texture>((resolve, reject) => {
          const loader = new THREE.TextureLoader();
          loader.load(textureSource.uri, resolve, undefined, reject);
        });
        if (disposed) {
          texture.dispose();
          renderer.dispose();
          return;
        }

        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(
          4,
          renderer.capabilities.getMaxAnisotropy(),
        );

        const globeMaterial = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.92,
          metalness: 0.02,
        });
        globeMaterial.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <map_fragment>",
            `
              #ifdef USE_MAP
                vec4 sampledDiffuseColor = texture2D(map, vMapUv);
                float luminance = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
                diffuseColor *= vec4(vec3(luminance * 0.9), sampledDiffuseColor.a);
              #endif
            `,
          );
        };

        const globe = new THREE.Mesh(
          new THREE.SphereGeometry(1.54, 80, 56),
          globeMaterial,
        );
        globeGroup.add(globe);

        const atmosphere = new THREE.Mesh(
          new THREE.SphereGeometry(1.575, 80, 56),
          new THREE.MeshBasicMaterial({
            color: 0xe9e7df,
            transparent: true,
            opacity: 0.035,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
          }),
        );
        globeGroup.add(atmosphere);

        const keyLight = new THREE.DirectionalLight(0xffffff, 2.35);
        keyLight.position.set(4, 1.8, 4);
        scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0x7d7b74, 0.38);
        fillLight.position.set(-4, -1.5, 2);
        scene.add(fillLight);
        scene.add(new THREE.AmbientLight(0x20201e, 0.27));

        const starCount = 170;
        const starPositions = new Float32Array(starCount * 3);
        for (let index = 0; index < starCount; index += 1) {
          const radius = 4.4 + ((index * 37) % 100) / 30;
          const theta = ((index * 137.5) % 360) * (Math.PI / 180);
          const phi = ((index * 71.3) % 180) * (Math.PI / 180);
          starPositions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
          starPositions[index * 3 + 1] = radius * Math.cos(phi);
          starPositions[index * 3 + 2] =
            radius * Math.sin(phi) * Math.sin(theta);
        }
        const starGeometry = new THREE.BufferGeometry();
        starGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(starPositions, 3),
        );
        const stars = new THREE.Points(
          starGeometry,
          new THREE.PointsMaterial({
            color: 0xb8b6af,
            size: 0.013,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.48,
          }),
        );
        scene.add(stars);

        let frameId = 0;
        let targetRotation = globeGroup.rotation.y;
        let isDragging = false;
        let lastX = 0;
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;

        const resize = () => {
          const bounds = host.getBoundingClientRect();
          renderer.setSize(
            Math.max(1, bounds.width),
            Math.max(1, bounds.height),
            false,
          );
          camera.aspect =
            Math.max(1, bounds.width) / Math.max(1, bounds.height);
          camera.updateProjectionMatrix();
        };
        resize();
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(host);

        const onPointerDown = (event: PointerEvent) => {
          isDragging = true;
          lastX = event.clientX;
          renderer.domElement.setPointerCapture?.(event.pointerId);
          renderer.domElement.style.cursor = "grabbing";
        };
        const onPointerMove = (event: PointerEvent) => {
          if (!isDragging) return;
          targetRotation += (event.clientX - lastX) * 0.008;
          lastX = event.clientX;
        };
        const onPointerUp = (event: PointerEvent) => {
          isDragging = false;
          renderer.domElement.releasePointerCapture?.(event.pointerId);
          renderer.domElement.style.cursor = "grab";
        };
        const animate = () => {
          if (disposed) return;
          if (!document.hidden) {
            if (!isDragging && !reduceMotion) targetRotation += 0.0014;
            globeGroup.rotation.y +=
              (targetRotation - globeGroup.rotation.y) * 0.065;
            stars.rotation.y -= 0.00012;
            renderer.render(scene, camera);
          }
          frameId = window.requestAnimationFrame(animate);
        };

        renderer.domElement.addEventListener("pointerdown", onPointerDown);
        renderer.domElement.addEventListener("pointermove", onPointerMove);
        renderer.domElement.addEventListener("pointerup", onPointerUp);
        renderer.domElement.addEventListener("pointercancel", onPointerUp);
        animate();

        cleanupScene = () => {
          window.cancelAnimationFrame(frameId);
          resizeObserver.disconnect();
          renderer.domElement.removeEventListener("pointerdown", onPointerDown);
          renderer.domElement.removeEventListener("pointermove", onPointerMove);
          renderer.domElement.removeEventListener("pointerup", onPointerUp);
          renderer.domElement.removeEventListener("pointercancel", onPointerUp);
          globe.geometry.dispose();
          globeMaterial.dispose();
          atmosphere.geometry.dispose();
          (atmosphere.material as THREE.Material).dispose();
          starGeometry.dispose();
          (stars.material as THREE.Material).dispose();
          texture.dispose();
          renderer.dispose();
          host.replaceChildren();
        };
      } catch (error) {
        console.error("Rook Earth globe could not initialize.", error);
        host.replaceChildren();
      }
    };

    void initialiseGlobe();
    return () => {
      disposed = true;
      cleanupScene?.();
    };
  }, []);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}

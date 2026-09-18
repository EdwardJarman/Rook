import { useEffect, useRef } from "react";
const EARTH_TEXTURE = require("@/assets/images/rook-earth-texture.jpg");

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec3 aPosition;
in vec2 aUv;

uniform float uAspect;
uniform float uRotationY;
uniform float uTilt;

out vec2 vUv;
out vec3 vNormal;

vec3 rotateY(vec3 value, float angle) {
  float sine = sin(angle);
  float cosine = cos(angle);
  return vec3(
    cosine * value.x + sine * value.z,
    value.y,
    -sine * value.x + cosine * value.z
  );
}

vec3 rotateX(vec3 value, float angle) {
  float sine = sin(angle);
  float cosine = cos(angle);
  return vec3(
    value.x,
    cosine * value.y - sine * value.z,
    sine * value.y + cosine * value.z
  );
}

void main() {
  vec3 position = rotateX(rotateY(aPosition, uRotationY), uTilt);
  vNormal = normalize(rotateX(rotateY(aPosition, uRotationY), uTilt));
  vUv = aUv;

  vec4 viewPosition = vec4(position, 1.0);
  viewPosition.z -= 4.8;

  float near = 0.1;
  float far = 100.0;
  float focalLength = 3.7320508;
  gl_Position = vec4(
    (focalLength * viewPosition.x) / uAspect,
    focalLength * viewPosition.y,
    ((far + near) / (near - far)) * viewPosition.z +
      ((2.0 * far * near) / (near - far)),
    -viewPosition.z
  );
}`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D uEarth;

in vec2 vUv;
in vec3 vNormal;

out vec4 outputColor;

void main() {
  vec3 sampled = texture(uEarth, vUv).rgb;
  float luminance = dot(sampled, vec3(0.2126, 0.7152, 0.0722));
  vec3 lightDirection = normalize(vec3(1.3, 0.65, 2.2));
  float diffuse = max(dot(normalize(vNormal), lightDirection), 0.0);
  float ambient = 0.055;
  float light = ambient + diffuse * 0.95;
  float edgeLight = pow(1.0 - max(vNormal.z, 0.0), 3.0) * 0.045;
  vec3 monochrome = vec3(luminance * light + edgeLight);
  outputColor = vec4(monochrome, 1.0);
}`;

export function EarthGlobe() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !hostRef.current) return;

    const host = hostRef.current;
    let disposed = false;
    let frameId = 0;
    let cleanup: (() => void) | undefined;

    const initialiseGlobe = async () => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2", {
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      if (!context) return;

      try {
        const vertexShader = compileShader(
          context,
          context.VERTEX_SHADER,
          VERTEX_SHADER_SOURCE,
        );
        const fragmentShader = compileShader(
          context,
          context.FRAGMENT_SHADER,
          FRAGMENT_SHADER_SOURCE,
        );
        const program = createProgram(context, vertexShader, fragmentShader);
        const mesh = createSphereMesh(88, 112);
        const textureImage = await loadEarthTexture();
        if (disposed) return;

        const positionBuffer = context.createBuffer();
        const uvBuffer = context.createBuffer();
        const indexBuffer = context.createBuffer();
        const texture = context.createTexture();
        if (!positionBuffer || !uvBuffer || !indexBuffer || !texture) {
          throw new Error("WebGL resources could not be allocated.");
        }

        const positionLocation = context.getAttribLocation(
          program,
          "aPosition",
        );
        const uvLocation = context.getAttribLocation(program, "aUv");
        const aspectLocation = context.getUniformLocation(program, "uAspect");
        const rotationLocation = context.getUniformLocation(
          program,
          "uRotationY",
        );
        const tiltLocation = context.getUniformLocation(program, "uTilt");
        const earthLocation = context.getUniformLocation(program, "uEarth");
        if (
          positionLocation < 0 ||
          uvLocation < 0 ||
          !aspectLocation ||
          !rotationLocation ||
          !tiltLocation ||
          !earthLocation
        ) {
          throw new Error("WebGL shader locations could not be resolved.");
        }

        context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
        context.bufferData(
          context.ARRAY_BUFFER,
          mesh.positions,
          context.STATIC_DRAW,
        );
        context.bindBuffer(context.ARRAY_BUFFER, uvBuffer);
        context.bufferData(context.ARRAY_BUFFER, mesh.uvs, context.STATIC_DRAW);
        context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indexBuffer);
        context.bufferData(
          context.ELEMENT_ARRAY_BUFFER,
          mesh.indices,
          context.STATIC_DRAW,
        );

        context.bindTexture(context.TEXTURE_2D, texture);
        context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false);
        context.texParameteri(
          context.TEXTURE_2D,
          context.TEXTURE_WRAP_S,
          context.REPEAT,
        );
        context.texParameteri(
          context.TEXTURE_2D,
          context.TEXTURE_WRAP_T,
          context.CLAMP_TO_EDGE,
        );
        context.texParameteri(
          context.TEXTURE_2D,
          context.TEXTURE_MIN_FILTER,
          context.LINEAR_MIPMAP_LINEAR,
        );
        context.texParameteri(
          context.TEXTURE_2D,
          context.TEXTURE_MAG_FILTER,
          context.LINEAR,
        );
        context.texImage2D(
          context.TEXTURE_2D,
          0,
          context.RGBA,
          context.RGBA,
          context.UNSIGNED_BYTE,
          textureImage,
        );
        context.generateMipmap(context.TEXTURE_2D);

        canvas.style.cssText =
          "display:block;width:100%;height:100%;cursor:grab;touch-action:none;";
        host.replaceChildren(canvas);

        let width = 1;
        let height = 1;
        let targetRotation = -0.72;
        let rotation = targetRotation;
        let isDragging = false;
        let lastX = 0;
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;

        const resize = () => {
          const bounds = host.getBoundingClientRect();
          const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
          width = Math.max(1, Math.round(bounds.width * pixelRatio));
          height = Math.max(1, Math.round(bounds.height * pixelRatio));
          canvas.width = width;
          canvas.height = height;
          context.viewport(0, 0, width, height);
        };
        resize();
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(host);

        const onPointerDown = (event: PointerEvent) => {
          isDragging = true;
          lastX = event.clientX;
          canvas.setPointerCapture?.(event.pointerId);
          canvas.style.cursor = "grabbing";
        };
        const onPointerMove = (event: PointerEvent) => {
          if (!isDragging) return;
          targetRotation += (event.clientX - lastX) * 0.008;
          lastX = event.clientX;
        };
        const onPointerUp = (event: PointerEvent) => {
          isDragging = false;
          canvas.releasePointerCapture?.(event.pointerId);
          canvas.style.cursor = "grab";
        };
        const render = () => {
          if (disposed) return;
          if (!document.hidden) {
            if (!isDragging && !reduceMotion) targetRotation += 0.00125;
            rotation += (targetRotation - rotation) * 0.07;

            context.clearColor(0, 0, 0, 0);
            context.clear(context.COLOR_BUFFER_BIT | context.DEPTH_BUFFER_BIT);
            context.enable(context.DEPTH_TEST);
            context.useProgram(program);
            context.uniform1f(aspectLocation, width / height);
            context.uniform1f(rotationLocation, rotation);
            context.uniform1f(tiltLocation, -0.18);
            context.uniform1i(earthLocation, 0);

            context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
            context.enableVertexAttribArray(positionLocation);
            context.vertexAttribPointer(
              positionLocation,
              3,
              context.FLOAT,
              false,
              0,
              0,
            );
            context.bindBuffer(context.ARRAY_BUFFER, uvBuffer);
            context.enableVertexAttribArray(uvLocation);
            context.vertexAttribPointer(
              uvLocation,
              2,
              context.FLOAT,
              false,
              0,
              0,
            );
            context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indexBuffer);
            context.activeTexture(context.TEXTURE0);
            context.bindTexture(context.TEXTURE_2D, texture);
            context.drawElements(
              context.TRIANGLES,
              mesh.indices.length,
              context.UNSIGNED_SHORT,
              0,
            );
          }
          frameId = window.requestAnimationFrame(render);
        };

        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        render();

        cleanup = () => {
          window.cancelAnimationFrame(frameId);
          resizeObserver.disconnect();
          canvas.removeEventListener("pointerdown", onPointerDown);
          canvas.removeEventListener("pointermove", onPointerMove);
          canvas.removeEventListener("pointerup", onPointerUp);
          canvas.removeEventListener("pointercancel", onPointerUp);
          context.deleteBuffer(positionBuffer);
          context.deleteBuffer(uvBuffer);
          context.deleteBuffer(indexBuffer);
          context.deleteTexture(texture);
          context.deleteProgram(program);
          context.deleteShader(vertexShader);
          context.deleteShader(fragmentShader);
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
      cleanup?.();
    };
  }, []);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}

function compileShader(
  context: WebGL2RenderingContext,
  type: number,
  source: string,
) {
  const shader = context.createShader(type);
  if (!shader) throw new Error("WebGL shader allocation failed.");
  context.shaderSource(shader, source);
  context.compileShader(shader);
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    const details = context.getShaderInfoLog(shader);
    context.deleteShader(shader);
    throw new Error(
      `WebGL shader compilation failed: ${details ?? "unknown error"}`,
    );
  }
  return shader;
}

function createProgram(
  context: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
) {
  const program = context.createProgram();
  if (!program) throw new Error("WebGL program allocation failed.");
  context.attachShader(program, vertexShader);
  context.attachShader(program, fragmentShader);
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) {
    const details = context.getProgramInfoLog(program);
    context.deleteProgram(program);
    throw new Error(
      `WebGL program linking failed: ${details ?? "unknown error"}`,
    );
  }
  return program;
}

function createSphereMesh(latitudeSegments: number, longitudeSegments: number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let latitude = 0; latitude <= latitudeSegments; latitude += 1) {
    const theta = (latitude / latitudeSegments) * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let longitude = 0; longitude <= longitudeSegments; longitude += 1) {
      const phi = (longitude / longitudeSegments) * Math.PI * 2;
      positions.push(
        sinTheta * Math.cos(phi),
        cosTheta,
        sinTheta * Math.sin(phi),
      );
      uvs.push(longitude / longitudeSegments, 1 - latitude / latitudeSegments);
    }
  }

  for (let latitude = 0; latitude < latitudeSegments; latitude += 1) {
    for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
      const first = latitude * (longitudeSegments + 1) + longitude;
      const second = first + longitudeSegments + 1;
      indices.push(first, second, first + 1, second, second + 1, first + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}

async function loadEarthTexture() {
  const image = new window.Image();
  image.decoding = "async";
  image.src = EARTH_TEXTURE.uri;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () =>
      reject(new Error("Earth texture could not be loaded."));
  });

  if (image.decode) await image.decode();
  return image;
}

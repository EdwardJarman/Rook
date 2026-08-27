import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { RookLogo } from "@/components/rook-logo";

const POSIX_INSTALL_COMMAND =
  "curl -fsSL https://www.rook.lighting/api/download/cli/install.sh | sh";
const POWERSHELL_INSTALL_COMMAND =
  "irm https://www.rook.lighting/api/download/cli/install.ps1 | iex";
const EARTH_TEXTURE = require("@/assets/images/rook-earth-texture.jpg");

type InstallShell = "posix" | "powershell";

export default function RookLandingPage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 980;
  const [shell] = useState<InstallShell>(
    Platform.OS === "web" &&
      typeof navigator !== "undefined" &&
      /Windows NT/i.test(navigator.userAgent)
      ? "powershell"
      : "posix",
  );
  const [copied, setCopied] = useState(false);
  const installCommand =
    shell === "posix" ? POSIX_INSTALL_COMMAND : POWERSHELL_INSTALL_COMMAND;

  const copyInstaller = async () => {
    if (
      Platform.OS !== "web" ||
      typeof navigator === "undefined" ||
      !navigator.clipboard
    ) {
      return;
    }

    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#080808" }}>
      <ScrollView
        contentContainerStyle={{ minHeight: "100%" }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{ flex: 1, backgroundColor: "#080808", overflow: "hidden" }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 1440,
              minHeight: isWide ? 820 : 900,
              alignSelf: "center",
              paddingHorizontal: isWide ? 42 : 20,
              paddingTop: 22,
              paddingBottom: 34,
            }}
          >
            <LandingHeader
              onSignIn={() => router.push("/sign-in" as never)}
              onSignUp={() => router.push("/sign-up" as never)}
            />

            <View
              style={{
                position: "absolute",
                top: isWide ? 95 : 388,
                right: isWide ? -28 : -105,
                width: isWide ? "61%" : 540,
                height: isWide ? 680 : 540,
                opacity: isWide ? 1 : 0.86,
              }}
            >
              <EarthGlobe />
            </View>

            <View
              style={{
                flex: 1,
                position: "relative",
                paddingTop: isWide ? 98 : 58,
                justifyContent: "space-between",
              }}
            >
              <View style={{ maxWidth: isWide ? 690 : 620 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <View
                    style={{ width: 7, height: 7, backgroundColor: "#f1f0eb" }}
                  />
                  <Text
                    style={{
                      color: "#aba9a2",
                      fontSize: 10.5,
                      fontWeight: "800",
                      letterSpacing: 1.7,
                    }}
                  >
                    ROOK / 01 — PERSONAL OPERATIONS
                  </Text>
                </View>

                <Text
                  style={{
                    color: "#f1f0eb",
                    fontSize: isWide ? 74 : 49,
                    lineHeight: isWide ? 70 : 48,
                    fontWeight: "700",
                    letterSpacing: isWide ? -5.2 : -3.3,
                    marginTop: 30,
                    maxWidth: isWide ? 650 : 510,
                  }}
                >
                  WORK WITH{"\n"}
                  <Text style={{ color: "#77756e" }}>GRAVITY.</Text>
                </Text>

                <Text
                  style={{
                    color: "#c9c7c0",
                    fontSize: 16,
                    lineHeight: 25,
                    marginTop: 27,
                    maxWidth: 435,
                  }}
                >
                  A deliberate workspace for capable Bots. Keep real work close,
                  direct every meaningful step, and bring your own computer in
                  only when it matters.
                </Text>

                <View
                  style={{
                    flexDirection: isWide ? "row" : "column",
                    alignItems: isWide ? "center" : "stretch",
                    gap: 10,
                    marginTop: 36,
                    maxWidth: isWide ? 690 : 510,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Copy Rook CLI install command"
                    onPress={() => void copyInstaller()}
                    style={({ pressed }) => ({
                      height: 52,
                      flex: 1,
                      minWidth: 0,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 9,
                      paddingHorizontal: 13,
                      borderWidth: 1,
                      borderColor: "#474640",
                      backgroundColor: "#111110",
                      opacity: pressed ? 0.68 : 1,
                    })}
                  >
                    <MaterialIcons
                      name={copied ? "check" : "terminal"}
                      size={16}
                      color={copied ? "#f1f0eb" : "#8f8d86"}
                    />
                    <Text
                      selectable
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        color: "#cfcdc6",
                        fontFamily: Platform.select({
                          ios: "Menlo",
                          android: "monospace",
                          default:
                            "ui-monospace, SFMono-Regular, Menlo, monospace",
                        }),
                        fontSize: 11.5,
                      }}
                    >
                      $ {installCommand}
                    </Text>
                    <Text
                      style={{
                        color: copied ? "#f1f0eb" : "#85837c",
                        fontSize: 10.5,
                        fontWeight: "800",
                        letterSpacing: 0.5,
                      }}
                    >
                      {copied ? "COPIED" : "COPY"}
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open Rook downloads"
                    onPress={() => router.push("/download" as never)}
                    style={({ pressed }) => ({
                      height: 52,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 9,
                      paddingHorizontal: 18,
                      backgroundColor: "#f1f0eb",
                      opacity: pressed ? 0.76 : 1,
                    })}
                  >
                    <MaterialIcons name="download" size={18} color="#090909" />
                    <Text
                      style={{
                        color: "#090909",
                        fontSize: 13,
                        fontWeight: "900",
                        letterSpacing: -0.2,
                      }}
                    >
                      Download Rook
                    </Text>
                  </Pressable>
                </View>

                <Text
                  style={{
                    color: "#77756e",
                    fontSize: 11.5,
                    lineHeight: 17,
                    marginTop: 11,
                    maxWidth: 620,
                  }}
                >
                  The CLI installer fetches the current published release,
                  installs for your user account, and verifies Rook before it
                  finishes.
                </Text>
              </View>

              <View
                style={{
                  marginTop: isWide ? 92 : 80,
                  borderTopWidth: 1,
                  borderTopColor: "#35342f",
                  flexDirection: isWide ? "row" : "column",
                }}
              >
                <EditorialDetail
                  index="01"
                  title="A clear role"
                  detail="Shape focused teammates around the context and tools they need."
                  bordered={isWide}
                />
                <EditorialDetail
                  index="02"
                  title="Control stays close"
                  detail="Bring Rook Node into the loop when work needs your own machine."
                  bordered={isWide}
                />
                <EditorialDetail
                  index="03"
                  title="Intent before action"
                  detail="Review consequential external steps before they leave your workspace."
                  bordered={false}
                />
              </View>
            </View>

            <View
              style={{
                marginTop: 42,
                paddingTop: 17,
                borderTopWidth: 1,
                borderTopColor: "#35342f",
                flexDirection: "row",
                justifyContent: "space-between",
                gap: 20,
              }}
            >
              <Text
                style={{ color: "#737169", fontSize: 10.5, letterSpacing: 0.3 }}
              >
                © {new Date().getFullYear()} ROOK
              </Text>
              <Text
                style={{ color: "#737169", fontSize: 10.5, letterSpacing: 0.3 }}
              >
                BUILT FOR DELIBERATE WORK
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function LandingHeader({
  onSignIn,
  onSignUp,
}: {
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottomWidth: 1,
        borderBottomColor: "#35342f",
        paddingBottom: 16,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 30,
            height: 30,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#f1f0eb",
          }}
        >
          <RookLogo size={20} color="#090909" />
        </View>
        <Text
          style={{
            color: "#f1f0eb",
            fontSize: 15,
            fontWeight: "900",
            letterSpacing: -0.5,
          }}
        >
          ROOK
        </Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in to Rook"
          onPress={onSignIn}
          style={({ pressed }) => ({
            minHeight: 34,
            justifyContent: "center",
            paddingHorizontal: 10,
            opacity: pressed ? 0.62 : 1,
          })}
        >
          <Text style={{ color: "#c9c7c0", fontSize: 12, fontWeight: "700" }}>
            Sign in
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Get started with Rook"
          onPress={onSignUp}
          style={({ pressed }) => ({
            minHeight: 34,
            justifyContent: "center",
            paddingHorizontal: 11,
            borderWidth: 1,
            borderColor: "#77756e",
            opacity: pressed ? 0.62 : 1,
          })}
        >
          <Text style={{ color: "#f1f0eb", fontSize: 12, fontWeight: "800" }}>
            Get started
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function EditorialDetail({
  index,
  title,
  detail,
  bordered,
}: {
  index: string;
  title: string;
  detail: string;
  bordered: boolean;
}) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 144,
        paddingTop: 18,
        paddingRight: 24,
        paddingBottom: 18,
        paddingLeft: bordered ? 24 : 0,
        borderLeftWidth: bordered ? 1 : 0,
        borderLeftColor: "#35342f",
      }}
    >
      <Text
        style={{
          color: "#8f8d86",
          fontSize: 10,
          fontWeight: "900",
          letterSpacing: 1.4,
        }}
      >
        {index}
      </Text>
      <Text
        style={{
          color: "#f1f0eb",
          fontSize: 15,
          fontWeight: "800",
          letterSpacing: -0.4,
          marginTop: 27,
        }}
      >
        {title}
      </Text>
      <Text
        style={{ color: "#99978f", fontSize: 12, lineHeight: 18, marginTop: 7 }}
      >
        {detail}
      </Text>
    </View>
  );
}

function EarthGlobe() {
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
        const THREE = await import("three");
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
        const texture = await new Promise<import("three").Texture>(
          (resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(textureSource.uri, resolve, undefined, reject);
          },
        );
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
        let width = 1;
        let height = 1;
        let targetRotation = globeGroup.rotation.y;
        let isDragging = false;
        let lastX = 0;
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;

        const resize = () => {
          const bounds = host.getBoundingClientRect();
          width = Math.max(1, bounds.width);
          height = Math.max(1, bounds.height);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
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
        const onVisibilityChange = () => {
          if (!document.hidden && !frameId) animate();
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
        document.addEventListener("visibilitychange", onVisibilityChange);
        animate();

        cleanupScene = () => {
          window.cancelAnimationFrame(frameId);
          resizeObserver.disconnect();
          renderer.domElement.removeEventListener("pointerdown", onPointerDown);
          renderer.domElement.removeEventListener("pointermove", onPointerMove);
          renderer.domElement.removeEventListener("pointerup", onPointerUp);
          renderer.domElement.removeEventListener("pointercancel", onPointerUp);
          document.removeEventListener("visibilitychange", onVisibilityChange);
          globe.geometry.dispose();
          globeMaterial.dispose();
          atmosphere.geometry.dispose();
          (atmosphere.material as import("three").Material).dispose();
          starGeometry.dispose();
          (stars.material as import("three").Material).dispose();
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

  if (Platform.OS !== "web") {
    return <View style={{ flex: 1 }} />;
  }

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}

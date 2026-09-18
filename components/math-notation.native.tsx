import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import { mathFallbackText } from "@/lib/math-notation";

export function MathNotation({
  latex,
  color,
  fontSize,
  display = false,
}: {
  latex: string;
  color: string;
  fontSize: number;
  display?: boolean;
}) {
  const [height, setHeight] = useState(Math.ceil(fontSize * (display ? 2.35 : 1.8)));
  const fallback = mathFallbackText(latex);
  const html = useMemo(() => createMathHtml(latex, fallback, color, fontSize, display), [color, display, fallback, fontSize, latex]);
  const width = Math.min(292, Math.max(54, latex.length * (fontSize * 0.54) + 26));

  return (
    <View
      accessibilityLabel={`Mathematical expression: ${fallback}`}
      style={[styles.wrap, display ? styles.display : styles.inline, { width, minHeight: height }]}
    >
      <WebView
        originWhitelist={["*"]}
        source={{ html }}
        javaScriptEnabled
        domStorageEnabled={false}
        scrollEnabled={false}
        bounces={false}
        opaque={false}
        overScrollMode="never"
        onMessage={(event) => {
          const next = Number(event.nativeEvent.data.replace(/^ready:/, ""));
          if (Number.isFinite(next) && next > 0) setHeight(Math.min(180, Math.max(Math.ceil(fontSize * 1.5), Math.ceil(next))));
        }}
        style={[styles.webview, { height }]}
      />
      <Text pointerEvents="none" style={[styles.accessibleFallback, { color, fontSize, lineHeight: fontSize * 1.38 }]}>
        {fallback}
      </Text>
    </View>
  );
}

function createMathHtml(latex: string, fallback: string, color: string, fontSize: number, display: boolean) {
  const safeLatex = JSON.stringify(latex).replace(/</g, "\\u003c");
  const safeFallback = JSON.stringify(fallback).replace(/</g, "\\u003c");
  const safeColor = color.replace(/[^#(),.%\s\w-]/g, "");
  return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css" />
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; background: transparent; color: ${safeColor}; }
  #math { display: ${display ? "block" : "inline-block"}; font-size: ${fontSize}px; line-height: 1.35; white-space: ${display ? "normal" : "nowrap"}; }
  .katex { color: ${safeColor}; font-size: 1em; }
</style>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js"></script>
</head><body><span id="math"></span>
<script>
  const latex = ${safeLatex};
  const fallback = ${safeFallback};
  const el = document.getElementById('math');
  el.textContent = fallback;
  const report = () => {
    const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, el.getBoundingClientRect().height);
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(String(Math.ceil(height)));
  };
  const render = () => {
    try { if (!window.katex) throw new Error('KaTeX unavailable'); window.katex.render(latex, el, { throwOnError: false, displayMode: ${display ? "true" : "false"} }); }
    catch (_) { el.textContent = fallback; }
    const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, el.getBoundingClientRect().height);
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage('ready:' + Math.ceil(height));
  };
  window.addEventListener('load', () => setTimeout(render, 0));
  setTimeout(report, 50);
</script></body></html>`;
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
    overflow: "hidden",
    justifyContent: "center",
  },
  inline: {
    alignSelf: "flex-start",
  },
  display: {
    alignSelf: "stretch",
    marginVertical: 4,
  },
  webview: {
    position: "absolute",
    width: "100%",
    backgroundColor: "transparent",
  },
  accessibleFallback: {
    opacity: 0,
  },
});

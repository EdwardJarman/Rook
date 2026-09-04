import { useId } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

export type LiveOrbVariant = "white" | "black" | "webgl" | "custom";
export type LiveOrbProps = { className?: string; size?: number; variant?: LiveOrbVariant; color?: string; eyeColor?: string; colors?: string[]; interactive?: boolean; blink?: boolean };

export const WHITE = { color: "#F4F4F5", eyeColor: "#09090B" } as const;
export const BLACK = { color: "#18181B", eyeColor: "#F4F4F5" } as const;
export const CUSTOM_DEFAULT = { color: "#7C5CFF", eyeColor: "#FAFAFA" } as const;
export const WEBGL_COLORS = ["#7C6AF7", "#7DD3C7", "#E8B4D4"];

function resolvedProps(variant: LiveOrbVariant, color?: string, eyeColor?: string, colors?: string[]) {
  if (variant === "black") return { body: BLACK.color, eye: BLACK.eyeColor, mode: 0, palette: WEBGL_COLORS };
  if (variant === "webgl") return { body: WHITE.color, eye: eyeColor ?? "#0C0C10", mode: 1, palette: colors?.length ? colors : WEBGL_COLORS };
  if (variant === "custom") return { body: color ?? CUSTOM_DEFAULT.color, eye: eyeColor ?? CUSTOM_DEFAULT.eyeColor, mode: 0, palette: WEBGL_COLORS };
  return { body: WHITE.color, eye: WHITE.eyeColor, mode: 0, palette: WEBGL_COLORS };
}

/**
 * Large creator previews run the same canvas shader and gaze logic as the web
 * LiveOrb. Small list avatars stay native to avoid a WebView per message.
 */
export function LiveOrb({ size = 280, variant = "white", color, eyeColor, colors, interactive = true, blink = true }: LiveOrbProps) {
  const props = resolvedProps(variant, color, eyeColor, colors);
  if (size < 72) return <SmallNativeOrb size={size} variant={variant} body={props.body} eye={props.eye} palette={props.palette} />;
  return (
    <View accessibilityRole="image" accessibilityLabel={variant === "webgl" ? "Prism living color orb" : "Matte quiet depth orb"} style={{ width: size, height: size }}>
      <WebView
        originWhitelist={["*"]}
        source={{ html: shaderHtml({ size, ...props, interactive, blink }) }}
        javaScriptEnabled
        domStorageEnabled={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        opaque={false}
        androidLayerType="hardware"
        pointerEvents={interactive ? "auto" : "none"}
        style={styles.webview}
      />
    </View>
  );
}

function SmallNativeOrb({ size, variant, body, eye, palette }: { size: number; variant: LiveOrbVariant; body: string; eye: string; palette: string[] }) {
  const id = useId().replace(/:/g, "");
  return (
    <View accessibilityRole="image" style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} viewBox="0 0 100 100"><Defs>
        <RadialGradient id={`s-${id}`} cx="34%" cy="26%" rx="70%" ry="70%"><Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.7"/><Stop offset="0.48" stopColor={body}/><Stop offset="1" stopColor="#07080A" stopOpacity="0.35"/></RadialGradient>
        <LinearGradient id={`p-${id}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={palette[0]}/><Stop offset="0.52" stopColor={palette[1]}/><Stop offset="1" stopColor={palette[2]}/></LinearGradient>
      </Defs><Circle cx="50" cy="50" r="43" fill={variant === "webgl" ? `url(#p-${id})` : `url(#s-${id})`}/><Rect x="33" y="37" width="8" height="24" rx="4" fill={eye}/><Rect x="59" y="37" width="8" height="24" rx="4" fill={eye}/></Svg>
    </View>
  );
}

function shaderHtml(input: { size: number; body: string; eye: string; mode: number; palette: string[]; interactive: boolean; blink: boolean }) {
  const data = JSON.stringify(input).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>html,body,canvas{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;touch-action:none}</style></head><body><canvas id="c"></canvas><script>
const cfg=${data}, V='attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const F='precision highp float;uniform vec2 r,l;uniform float t,b,m;uniform vec3 body,eye,c1,c2,c3;float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float n(vec2 p){vec2 i=floor(p),f=fract(p);float a=h(i),b=h(i+vec2(1,0)),c=h(i+vec2(0,1)),d=h(i+1.);vec2 u=f*f*(3.-2.*f);return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;}float fb(vec2 p){float v=0.,a=.5;mat2 q=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){v+=a*n(p);p=q*p;a*=.5;}return v;}vec3 shade(vec3 x){vec2 q=x.xy*2.2+x.z*.85;q+=(vec2(fb(q*1.4+vec2(t*.22,t*.18)),fb(q*1.4+vec2(-t*.16,t*.24)+4.1))-.5)*.72;float f=fb(q*2.1+vec2(0.,t*.12)),g=fb(q*4.6-vec2(t*.2,0.));vec3 z=mix(c1,c2,smoothstep(.28,.72,f));z=mix(z,c3,pow(smoothstep(.42,.9,g),1.4));vec3 L=normalize(vec3(-.18,.55,.8));return z*(dot(x,L)*.28+.72)+pow(1.-x.z,2.1)*mix(c2,c3,.45)*.55+pow(max(dot(x,L),0.),40.)*.22;}void main(){vec2 u=(gl_FragCoord.xy/r)*2.-1.;u.x*=r.x/r.y;float z=dot(u/.86,u/.86);if(z>1.)discard;vec3 x=normalize(vec3(u/.86,sqrt(1.-z)));vec3 L=normalize(vec3(-.22,.62,.72));vec3 col=m>.5?shade(x):body*(dot(x,L)*.42+.58)+vec3(pow(max(dot(x,normalize(L+vec3(0.,0.,1.))),0.),56.)*.16);vec2 g=vec2(l.x*.07,l.y*.05);float e1=1.-smoothstep(.06,.08,length(x.xy-vec2(-.28+g.x,.08+g.y)));float e2=1.-smoothstep(.06,.08,length(x.xy-vec2(.28+g.x,.08+g.y)));float lid=mix(1.,0.08,b);col=mix(col,eye,max(e1,e2)*lid);gl_FragColor=vec4(col,1.);}';
const c=document.getElementById('c'),g=c.getContext('webgl',{alpha:true,antialias:false});function sh(type,src){let s=g.createShader(type);g.shaderSource(s,src);g.compileShader(s);return s;}let p=g.createProgram();g.attachShader(p,sh(g.VERTEX_SHADER,V));g.attachShader(p,sh(g.FRAGMENT_SHADER,F));g.linkProgram(p);g.useProgram(p);let B=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,B);g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),g.STATIC_DRAW);let a=g.getAttribLocation(p,'p');g.enableVertexAttribArray(a);g.vertexAttribPointer(a,2,g.FLOAT,false,0,0);let U={};['r','l','t','b','m','body','eye','c1','c2','c3'].forEach(k=>U[k]=g.getUniformLocation(p,k));function rgb(x){let n=parseInt(x.slice(1),16);return[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]}let look=[0,.08],target=[0,.08],start=performance.now(),blink=0,next=2000+Math.random()*2500;function size(){let d=Math.min(devicePixelRatio||1,2),w=innerWidth*d,h=innerHeight*d;c.width=w;c.height=h;g.viewport(0,0,w,h)}size();addEventListener('resize',size);c.addEventListener('pointermove',e=>{if(!cfg.interactive)return;let q=c.getBoundingClientRect();target=[Math.max(-1,Math.min(1,(e.clientX-q.left-q.width/2)/(q.width/2))),Math.max(-1,Math.min(1,(q.top+q.height/2-e.clientY)/(q.height/2)))];});function draw(now){let s=(now-start)/1000;if(!cfg.interactive)target=[Math.sin(s*.7)*.32,.08+Math.cos(s*.55)*.12];look[0]+=(target[0]-look[0])*.16;look[1]+=(target[1]-look[1])*.16;if(cfg.blink&&now>next){blink=now;next=now+2200+Math.random()*3800}let d=(now-blink)/1000,v=d<.055?d/.055:d<.1?1:d<.18?1-(d-.1)/.08:0;g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);g.uniform2f(U.r,c.width,c.height);g.uniform2f(U.l,look[0],look[1]);g.uniform1f(U.t,s*.55);g.uniform1f(U.b,v);g.uniform1f(U.m,cfg.mode);g.uniform3fv(U.body,rgb(cfg.body));g.uniform3fv(U.eye,rgb(cfg.eye));g.uniform3fv(U.c1,rgb(cfg.palette[0]));g.uniform3fv(U.c2,rgb(cfg.palette[1]));g.uniform3fv(U.c3,rgb(cfg.palette[2]));g.drawArrays(g.TRIANGLES,0,6);requestAnimationFrame(draw)}requestAnimationFrame(draw);</script></body></html>`;
}

const styles = StyleSheet.create({ webview: { flex: 1, backgroundColor: "transparent" } });

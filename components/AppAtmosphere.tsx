'use client'

import { useEffect, useRef } from 'react'

/**
 * A low-cost, non-interactive WebGL field for authenticated application screens.
 * It deliberately stays behind the UI and stops completely for reduced motion.
 */
export default function AppAtmosphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' })
    if (!gl) return
    const surface: HTMLCanvasElement = canvas
    const context: WebGLRenderingContext = gl

    const vertexSource = `
      attribute vec2 position;
      void main() { gl_Position = vec4(position, 0.0, 1.0); }
    `
    const fragmentSource = `
      precision mediump float;
      uniform vec2 resolution;
      uniform float time;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 4; i++) {
          value += amplitude * noise(p);
          p = p * 2.03 + vec2(8.1, 2.7);
          amplitude *= 0.5;
        }
        return value;
      }

      void main() {
        vec2 rawUv = gl_FragCoord.xy / resolution.xy;
        vec2 uv = rawUv;
        uv.x *= resolution.x / resolution.y;
        float drift = time * 0.018;
        float field = fbm(uv * 1.45 + vec2(drift, -drift * 0.65));
        float ribbonCenter = 0.70 + sin(uv.x * 2.1 + field * 2.7 + time * 0.045) * 0.075;
        float ribbon = exp(-pow((rawUv.y - ribbonCenter) * 7.2, 2.0));
        float blue = smoothstep(0.64, 0.05, distance(rawUv, vec2(0.74 + field * 0.05, 0.68)));
        float ember = smoothstep(0.42, 0.02, distance(rawUv, vec2(0.10, 0.84 + field * 0.025)));
        float grain = (hash(gl_FragCoord.xy + floor(time * 8.0)) - 0.5) * 0.006;
        float vignette = smoothstep(0.96, 0.22, distance(rawUv, vec2(0.5)));
        vec3 color = vec3(0.004, 0.005, 0.007);
        color += vec3(0.0, 0.36, 0.62) * blue * ribbon * 0.17;
        color += vec3(0.92, 0.20, 0.035) * ember * 0.085;
        color += vec3(0.035, 0.045, 0.065) * field * 0.13;
        color = color * (0.70 + vignette * 0.30) + grain;
        gl_FragColor = vec4(color, 0.68);
      }
    `

    function shader(type: number, source: string) {
      const unit = context.createShader(type)
      if (!unit) return null
      context.shaderSource(unit, source)
      context.compileShader(unit)
      return context.getShaderParameter(unit, context.COMPILE_STATUS) ? unit : null
    }

    const vertex = shader(context.VERTEX_SHADER, vertexSource)
    const fragment = shader(context.FRAGMENT_SHADER, fragmentSource)
    if (!vertex || !fragment) return
    const program = context.createProgram()
    if (!program) return
    context.attachShader(program, vertex)
    context.attachShader(program, fragment)
    context.linkProgram(program)
    if (!context.getProgramParameter(program, context.LINK_STATUS)) return

    const buffer = context.createBuffer()
    if (!buffer) return
    context.bindBuffer(context.ARRAY_BUFFER, buffer)
    context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), context.STATIC_DRAW)

    const position = context.getAttribLocation(program, 'position')
    const resolution = context.getUniformLocation(program, 'resolution')
    const time = context.getUniformLocation(program, 'time')
    let frame = 0
    let lastRender = 0

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
      surface.width = Math.round(window.innerWidth * ratio)
      surface.height = Math.round(window.innerHeight * ratio)
      context.viewport(0, 0, surface.width, surface.height)
    }

    function render(now: number) {
      frame = 0
      if (document.hidden) return
      if (now - lastRender >= 33) {
        lastRender = now
        context.useProgram(program)
        context.bindBuffer(context.ARRAY_BUFFER, buffer)
        context.enableVertexAttribArray(position)
        context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0)
        context.uniform2f(resolution, surface.width, surface.height)
        context.uniform1f(time, now / 1000)
        context.drawArrays(context.TRIANGLE_STRIP, 0, 4)
      }
      frame = window.requestAnimationFrame(render)
    }

    function onVisibilityChange() {
      if (document.hidden) {
        if (frame) window.cancelAnimationFrame(frame)
        frame = 0
        return
      }
      if (!frame) frame = window.requestAnimationFrame(render)
    }

    resize()
    window.addEventListener('resize', resize, { passive: true })
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (!document.hidden) frame = window.requestAnimationFrame(render)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      context.deleteBuffer(buffer)
      context.deleteProgram(program)
      context.deleteShader(vertex)
      context.deleteShader(fragment)
    }
  }, [])

  return <canvas ref={canvasRef} className="app-atmosphere" aria-hidden="true" />
}

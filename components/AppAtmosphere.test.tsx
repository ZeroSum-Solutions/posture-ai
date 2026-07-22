// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AppAtmosphere from './AppAtmosphere'

describe('AppAtmosphere', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('draws a stable frame without starting a continuous animation loop', () => {
    const drawArrays = vi.fn()
    const gl = {
      VERTEX_SHADER: 1,
      FRAGMENT_SHADER: 2,
      COMPILE_STATUS: 3,
      LINK_STATUS: 4,
      ARRAY_BUFFER: 5,
      STATIC_DRAW: 6,
      FLOAT: 7,
      TRIANGLE_STRIP: 8,
      createShader: vi.fn(() => ({})),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn(() => true),
      createProgram: vi.fn(() => ({})),
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn(() => true),
      createBuffer: vi.fn(() => ({})),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      getAttribLocation: vi.fn(() => 0),
      getUniformLocation: vi.fn(() => ({})),
      viewport: vi.fn(),
      useProgram: vi.fn(),
      enableVertexAttribArray: vi.fn(),
      vertexAttribPointer: vi.fn(),
      uniform2f: vi.fn(),
      uniform1f: vi.fn(),
      drawArrays,
      deleteBuffer: vi.fn(),
      deleteProgram: vi.fn(),
      deleteShader: vi.fn(),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl as unknown as WebGLRenderingContext)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    const requestAnimationFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)

    const { unmount } = render(<AppAtmosphere />)
    expect(drawArrays).toHaveBeenCalledOnce()
    expect(requestAnimationFrame).not.toHaveBeenCalled()

    fireEvent(window, new Event('resize'))
    expect(drawArrays).toHaveBeenCalledTimes(2)
    expect(requestAnimationFrame).not.toHaveBeenCalled()

    unmount()
    expect(gl.deleteBuffer).toHaveBeenCalledOnce()
    expect(gl.deleteProgram).toHaveBeenCalledOnce()
    expect(gl.deleteShader).toHaveBeenCalledTimes(2)
  })
})

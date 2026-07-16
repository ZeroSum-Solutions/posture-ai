// Decoders for the Moti-Physio screening archive (.mgs / _Client Info.txt).
// Formats: pretty-printed JSON records pipe-joined as `}|{`, flat dotted keys
// (`C7Vertebra.x`), BOM + Base64 wrappers, and double-encoded JSON strings.
// PII (name, email, birth date) is never parsed out of client info.

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface SkeletonJoint {
  type: string
  confidence: number
  real: Vec3
  proj: Vec3
}

export interface SkeletonRecord {
  time: string
  joints: SkeletonJoint[]
}

export interface Point2D {
  x: number
  y: number
}

export interface DebugRecord {
  time: string
  version: number
  points: Record<string, Point2D>
  scalars: Record<string, number | string>
}

export interface ExtraData {
  pelvisTilt: number | null
  pelvisObliquity: number | null
  pelvisAxialRotation: number | null
  anteriorCurve: [number, number][] | null
  lateralCurve: [number, number][] | null
}

export interface ClientInfo {
  clientId: string
  sex: 'male' | 'female'
  heightCm: number
}

function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

export function splitRecords(raw: string): string[] {
  return stripBom(raw)
    .split(/\}\s*\|\s*\{/)
    .map((part, i, parts) => {
      let record = part
      if (i > 0) record = '{' + record
      if (i < parts.length - 1) record = record + '}'
      return record
    })
}

export function parseSkeleton(raw: string): SkeletonRecord[] {
  return splitRecords(raw).map((record) => {
    const parsed = JSON.parse(record) as {
      time: string
      Joints: Record<string, number | string>[]
    }
    return {
      time: parsed.time,
      joints: parsed.Joints.map((joint) => ({
        type: String(joint['Type']),
        confidence: Number(joint['Confidence']),
        real: {
          x: Number(joint['Real.X']),
          y: Number(joint['Real.Y']),
          z: Number(joint['Real.Z']),
        },
        proj: {
          x: Number(joint['Proj.X']),
          y: Number(joint['Proj.Y']),
          z: Number(joint['Proj.Z']),
        },
      })),
    }
  })
}

export function parseDebugLandmarks(raw: string): DebugRecord[] {
  return splitRecords(raw).map((record) => {
    const parsed = JSON.parse(record) as Record<string, number | string>
    const points: Record<string, Point2D> = {}
    const scalars: Record<string, number | string> = {}
    const xs: Record<string, number> = {}
    const ys: Record<string, number> = {}

    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'time' || key === 'version') continue
      if (key.endsWith('.x') && typeof value === 'number') {
        xs[key.slice(0, -2)] = value
      } else if (key.endsWith('.y') && typeof value === 'number') {
        ys[key.slice(0, -2)] = value
      } else {
        scalars[key] = value
      }
    }
    for (const [name, x] of Object.entries(xs)) {
      if (name in ys) {
        points[name] = { x, y: ys[name] }
      } else {
        scalars[`${name}.x`] = x
      }
    }
    for (const [name, y] of Object.entries(ys)) {
      if (!(name in xs)) scalars[`${name}.y`] = y
    }

    return {
      time: String(parsed.time),
      version: Number(parsed.version),
      points,
      scalars,
    }
  })
}

interface ExtraDataField {
  success: boolean
  data: string
}

function decodeField(field: ExtraDataField | undefined): unknown | null {
  if (!field || !field.success) return null
  return JSON.parse(field.data)
}

function decodeAngle(field: ExtraDataField | undefined): number | null {
  const value = decodeField(field)
  if (!Array.isArray(value) || typeof value[0] !== 'number') return null
  return value[0]
}

function decodeCurve(field: ExtraDataField | undefined): [number, number][] | null {
  const value = decodeField(field)
  return Array.isArray(value) ? (value as [number, number][]) : null
}

export function parseExtraData(raw: string): ExtraData {
  const decoded = Buffer.from(stripBom(raw).trim(), 'base64').toString('utf8')
  const parsed = JSON.parse(decoded) as {
    data: Record<string, ExtraDataField>
  }
  const fields = parsed.data
  return {
    pelvisTilt: decodeAngle(fields['pelvis_tilt']),
    // Misspelling is faithful to the on-disk format.
    pelvisObliquity: decodeAngle(fields['pelvis_obliiquity']),
    pelvisAxialRotation: decodeAngle(fields['pelvis_axial_rotation']),
    anteriorCurve: decodeCurve(fields['anterior']),
    lateralCurve: decodeCurve(fields['lateral']),
  }
}

export function parseAdams(raw: string): Vec3[] {
  return stripBom(raw)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [x, y, z] = line.split(',').map(Number)
      return { x, y, z }
    })
}

export function parseRibsAngle(raw: string): number[] {
  return stripBom(raw)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map(Number)
}

export function parseClientInfo(raw: string): ClientInfo {
  const fields: Record<string, string> = {}
  for (const line of stripBom(raw).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z ]+?)\s*:\s*(.+)$/)
    if (match) fields[match[1].trim()] = match[2].trim()
  }

  const clientId = fields['Client ID']
  const sexRaw = fields['Sex']
  const heightMatch = fields['Height']?.match(/([\d.]+)\s*cm/)
  if (!clientId || !sexRaw || !heightMatch) {
    throw new Error('Client info missing Client ID, Sex, or Height')
  }

  return {
    clientId,
    sex: sexRaw === 'Man' ? 'male' : 'female',
    heightCm: Number(heightMatch[1]),
  }
}

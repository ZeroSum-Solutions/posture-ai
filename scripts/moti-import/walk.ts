// Walks the Moti-Physio screening archive and assembles one dataset object
// per client: metadata (PII-free), per-session measurements, photo paths
// (relative to the client folder — photos themselves are never copied), and
// per-view skeleton / debug-landmark records.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  parseAdams,
  parseClientInfo,
  parseDebugLandmarks,
  parseExtraData,
  parseRibsAngle,
  parseSkeleton,
  type DebugRecord,
  type ExtraData,
  type SkeletonRecord,
  type Vec3,
} from './decode'

const GROUP_DIRS: Record<string, string> = {
  'Version 1 - Original': 'version-1',
  'Version 2 - Latest': 'version-2',
  'Both Versions': 'both-versions',
  'Incomplete - No Data': 'incomplete',
}

export interface ClientRef {
  dir: string
  group: string
}

export interface SessionData {
  index: number
  /** ISO screening date from client info, in session order; null if unknown. */
  date: string | null
  extraData: ExtraData | null
  adams: Vec3[] | null
  ribsAngle: number[] | null
  photos: {
    front: string | null
    back: string | null
    side: string | null
    adams: string | null
  }
}

export interface ClientDataset {
  clientId: string
  group: string
  sex: 'male' | 'female'
  heightCm: number
  sessions: SessionData[]
  skeletons: {
    front: SkeletonRecord[]
    back: SkeletonRecord[]
    side: SkeletonRecord[]
  }
  debugLandmarks: DebugRecord[]
}

export function collectClients(root: string): ClientRef[] {
  const clients: ClientRef[] = []
  for (const [dirName, group] of Object.entries(GROUP_DIRS)) {
    const groupDir = join(root, dirName)
    if (!existsSync(groupDir)) continue
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        clients.push({ dir: join(groupDir, entry.name), group })
      }
    }
  }
  return clients
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

function parseIfExists<T>(path: string, parse: (raw: string) => T): T | null {
  const raw = readIfExists(path)
  return raw === null ? null : parse(raw)
}

function sessionIndices(dir: string, clientId: string): number[] {
  // Only capture photos define a session: stray session-prefixed files
  // (e.g. Background frames without any captures) are not real screenings.
  const pattern = new RegExp(`^${clientId}_(\\d+)_(?:Front|Back|Side|Adams)Capture\\.png$`)
  const indices = new Set<number>()
  for (const file of readdirSync(dir)) {
    const match = basename(file).match(pattern)
    if (match) indices.add(Number(match[1]))
  }
  return [...indices].sort((a, b) => a - b)
}

function photoPath(dir: string, clientId: string, index: number, view: string): string | null {
  const name = `${clientId}_${index}_${view}Capture.png`
  return existsSync(join(dir, name)) ? name : null
}

export function importClient(ref: ClientRef): ClientDataset {
  const { dir, group } = ref
  const info = parseClientInfo(readFileSync(join(dir, '_Client Info.txt'), 'utf8'))
  const { clientId } = info

  const indices = sessionIndices(dir, clientId)
  const dates =
    info.screeningDates.length === indices.length ? info.screeningDates : null

  const sessions: SessionData[] = indices.map((index, ordinal) => ({
    index,
    date: dates ? dates[ordinal] : null,
    extraData: parseIfExists(
      join(dir, `${clientId}_${index}_ExtraData_ver_1.mgs`),
      parseExtraData,
    ),
    adams: parseIfExists(join(dir, `${clientId}_${index}_Adams_ver_1.mgs`), parseAdams),
    ribsAngle: parseIfExists(
      join(dir, `${clientId}_${index}_RibsAngle_ver_1.mgs`),
      parseRibsAngle,
    ),
    photos: {
      front: photoPath(dir, clientId, index, 'Front'),
      back: photoPath(dir, clientId, index, 'Back'),
      side: photoPath(dir, clientId, index, 'Side'),
      adams: photoPath(dir, clientId, index, 'Adams'),
    },
  }))

  const skeletonView = (view: string): SkeletonRecord[] =>
    parseIfExists(
      join(dir, `${clientId}_BodyAnalysis_Skeleton_${view}_ver_2.mgs`),
      parseSkeleton,
    ) ?? []

  return {
    clientId,
    group,
    sex: info.sex,
    heightCm: info.heightCm,
    sessions,
    skeletons: {
      front: skeletonView('Front'),
      back: skeletonView('Back'),
      side: skeletonView('Side'),
    },
    debugLandmarks:
      parseIfExists(
        join(dir, `${clientId}_BodyAnalysis_Debug_ver_5.mgs`),
        parseDebugLandmarks,
      ) ?? [],
  }
}

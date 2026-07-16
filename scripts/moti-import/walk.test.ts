import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { collectClients, importClient } from './walk'

const BOM = '﻿'

const clientInfoTxt = (id: string) => `${BOM}CLIENT SCREENING RECORD
=======================
Name           : Test Person
Client ID      : ${id}
Sex            : Man
Date of Birth  : 1990-01-01
First Visit    : 2025-01-06
Height         : 170 cm
Email          : test@example.com

App version    : Version 2
Screening date : 2025-01-06 [v2]
`

const skeletonJson = JSON.stringify({
  time: '1/6/2025 10:10:35 AM',
  ID: 1,
  Joints: [
    {
      Type: 'Head',
      Confidence: 0.75,
      'Real.X': 1,
      'Real.Y': 2,
      'Real.Z': 3,
      'Proj.X': 0.5,
      'Proj.Y': 0.2,
      'Proj.Z': 3,
    },
  ],
})

const debugJson = JSON.stringify({
  time: '1/6/2025 10:10:35 AM',
  version: 2,
  'head.x': 368.7,
  'head.y': 1023.0,
})

const extraDataB64 =
  BOM +
  Buffer.from(
    JSON.stringify({
      success: true,
      data: {
        anterior: { success: true, data: '[[0.06, 0.0]]' },
        lateral: { success: true, data: '[[-0.004, 0.0]]' },
        pelvis_obliiquity: { success: true, data: '[-0.17]' },
        pelvis_axial_rotation: { success: true, data: '[-2.37]' },
        pelvis_tilt: { success: true, data: '[20.64]' },
      },
    }),
    'utf8',
  ).toString('base64')

let root: string

function writeClient(group: string, folder: string, id: string, sessions: number[]) {
  const dir = join(root, group, folder)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '_Client Info.txt'), clientInfoTxt(id))
  writeFileSync(join(dir, `${id}_BodyAnalysis_Skeleton_Front_ver_2.mgs`), skeletonJson)
  writeFileSync(join(dir, `${id}_BodyAnalysis_Skeleton_Back_ver_2.mgs`), skeletonJson)
  writeFileSync(join(dir, `${id}_BodyAnalysis_Skeleton_Side_ver_2.mgs`), skeletonJson)
  writeFileSync(join(dir, `${id}_BodyAnalysis_Debug_ver_5.mgs`), debugJson)
  for (const n of sessions) {
    writeFileSync(join(dir, `${id}_${n}_ExtraData_ver_1.mgs`), extraDataB64)
    writeFileSync(join(dir, `${id}_${n}_Adams_ver_1.mgs`), '-9.0,477.7,1840.8\n')
    writeFileSync(join(dir, `${id}_${n}_RibsAngle_ver_1.mgs`), '0\n-0.76\n')
    for (const view of ['Front', 'Back', 'Side', 'Adams']) {
      writeFileSync(join(dir, `${id}_${n}_${view}Capture.png`), 'png-bytes')
    }
  }
  return dir
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'moti-walk-'))
  mkdirSync(join(root, 'Version 1 - Original'), { recursive: true })
  mkdirSync(join(root, 'Version 2 - Latest'), { recursive: true })
  mkdirSync(join(root, 'Both Versions'), { recursive: true })
  mkdirSync(join(root, 'Incomplete - No Data'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('collectClients', () => {
  test('finds client folders across all four groups with group labels', () => {
    writeClient('Version 1 - Original', '0001 - A', '0774-AM-0001', [0])
    writeClient('Version 2 - Latest', '0078 - B', '0774-AM-0078', [0])
    writeClient('Both Versions', '0052 - C', '0774-AM-0052', [0, 1])
    writeFileSync(join(root, '00 - Screening Index.md'), 'index')

    const clients = collectClients(root)
    expect(clients).toHaveLength(3)
    expect(clients.map((c) => c.group).sort()).toEqual([
      'both-versions',
      'version-1',
      'version-2',
    ])
  })

  test('ignores loose files and empty groups', () => {
    writeFileSync(join(root, '00 - How This Archive Is Organized.txt'), 'notes')
    expect(collectClients(root)).toEqual([])
  })
})

describe('importClient', () => {
  test('assembles metadata, per-session measurements, and photo paths', () => {
    const dir = writeClient('Version 2 - Latest', '0078 - B', '0774-AM-0078', [0])
    const client = importClient({ dir, group: 'version-2' })

    expect(client.clientId).toBe('0774-AM-0078')
    expect(client.sex).toBe('male')
    expect(client.heightCm).toBe(170)
    expect(client.group).toBe('version-2')
    expect(client.sessions).toHaveLength(1)

    const [session] = client.sessions
    expect(session.index).toBe(0)
    expect(session.extraData?.pelvisTilt).toBeCloseTo(20.64)
    expect(session.adams).toHaveLength(1)
    expect(session.ribsAngle).toEqual([0, -0.76])
    expect(session.photos.front).toBe('0774-AM-0078_0_FrontCapture.png')
    expect(session.photos.adams).toBe('0774-AM-0078_0_AdamsCapture.png')
  })

  test('parses skeleton and debug records per view', () => {
    const dir = writeClient('Both Versions', '0052 - C', '0774-AM-0052', [0, 1])
    const client = importClient({ dir, group: 'both-versions' })

    expect(client.sessions).toHaveLength(2)
    expect(client.skeletons.front).toHaveLength(1)
    expect(client.skeletons.front[0].joints[0].type).toBe('Head')
    expect(client.skeletons.back).toHaveLength(1)
    expect(client.skeletons.side).toHaveLength(1)
    expect(client.debugLandmarks[0].points['head']).toEqual({ x: 368.7, y: 1023.0 })
  })

  test('handles a client with no capture sessions', () => {
    const dir = join(root, 'Incomplete - No Data', '0024 - D')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '_Client Info.txt'), clientInfoTxt('0774-AM-0024'))

    const client = importClient({ dir, group: 'incomplete' })
    expect(client.sessions).toEqual([])
    expect(client.skeletons.front).toEqual([])
    expect(client.debugLandmarks).toEqual([])
  })

  test('marks missing per-session extra data as null instead of failing', () => {
    const dir = writeClient('Version 1 - Original', '0001 - A', '0774-AM-0001', [0])
    rmSync(join(dir, '0774-AM-0001_0_ExtraData_ver_1.mgs'))

    const client = importClient({ dir, group: 'version-1' })
    expect(client.sessions[0].extraData).toBeNull()
    expect(client.sessions[0].adams).toHaveLength(1)
  })
})

import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { ViewLabel } from '@posture-ai/engine'

import type { CapturedViewImage } from './poseFrameSource'
import { hasRequiredCapturedViews } from './poseFrameSource'

type CaptureView = Extract<ViewLabel, 'front' | 'side'>

type CapturedImages = Partial<Record<CaptureView, CapturedViewImage>>

const CAPTURE_VIEWS: CaptureView[] = ['front', 'side']

function viewTitle(view: CaptureView): string {
  return view === 'front' ? 'Front' : 'Side'
}

function buildCaptureStatus(capturedImages: CapturedImages): string {
  const capturedCount = CAPTURE_VIEWS.filter((view) => capturedImages[view]?.uri).length
  if (capturedCount === 2) return 'Captured photos pending landmark extraction'
  if (capturedCount === 1) return 'One posture photo captured — capture the second view next'
  return 'Camera ready — capture front and side posture photos'
}

export default function CameraCaptureScreen() {
  const cameraRef = useRef<CameraView>(null)
  const [permission, requestPermission] = useCameraPermissions()
  const [activeView, setActiveView] = useState<CaptureView>('front')
  const [capturedImages, setCapturedImages] = useState<CapturedImages>({})
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)

  const hasPermission = permission?.granted === true
  const canCapture = hasPermission && isCameraReady && !isCapturing
  const hasAllCaptures = hasRequiredCapturedViews({
    mode: 'capture',
    fixtureFrames: [],
    capturedImages,
    liveFrames: [],
  })

  async function captureActiveView() {
    if (!canCapture || cameraRef.current === null) return

    setCaptureError(null)
    setIsCapturing(true)
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      })

      setCapturedImages((current) => ({
        ...current,
        [activeView]: {
          view: activeView,
          uri: photo.uri,
          width: photo.width,
          height: photo.height,
          capturedAt: new Date().toISOString(),
        },
      }))

      setActiveView(activeView === 'front' ? 'side' : 'front')
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : 'Camera capture failed')
    } finally {
      setIsCapturing(false)
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID="camera-capture-screen"
    >
      <Text style={styles.title}>Camera Capture</Text>
      <Text style={styles.subtitle}>Physical-phone capture · landmark extraction pending</Text>

      {!hasPermission ? (
        <View style={styles.panel} testID="camera-permission-panel">
          <Text style={styles.sectionTitle}>Camera Permission</Text>
          <Text style={styles.bodyText}>
            Posture AI needs camera access to capture front and side posture photos. This slice
            stores only local capture metadata in app state.
          </Text>
          <Pressable style={styles.primaryButton} onPress={requestPermission}>
            <Text style={styles.primaryButtonText}>Grant Camera Permission</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.cameraPanel} testID="camera-preview-panel">
          <CameraView
            ref={cameraRef}
            style={styles.cameraPreview}
            facing="back"
            onCameraReady={() => setIsCameraReady(true)}
          />
          <View style={styles.cameraOverlay} pointerEvents="none">
            <Text style={styles.cameraOverlayText}>{viewTitle(activeView)} capture</Text>
          </View>
        </View>
      )}

      <View style={styles.panel} testID="capture-controls">
        <Text style={styles.sectionTitle}>Capture Mode</Text>
        <Text style={styles.statusText} testID="capture-status">
          {buildCaptureStatus(capturedImages)}
        </Text>
        {hasAllCaptures ? (
          <Text style={styles.pendingExtractionText} testID="pending-landmark-extraction">
            Captured photos pending landmark extraction — no posture assessment has been generated
            from camera images yet.
          </Text>
        ) : null}
        {captureError ? <Text style={styles.errorText}>{captureError}</Text> : null}

        <View style={styles.viewToggleRow}>
          {CAPTURE_VIEWS.map((view) => {
            const isActive = activeView === view
            const isCaptured = Boolean(capturedImages[view]?.uri)
            return (
              <Pressable
                key={view}
                style={[styles.toggleButton, isActive ? styles.toggleButtonActive : null]}
                onPress={() => setActiveView(view)}
                testID={`select-${view}-capture`}
              >
                <Text style={[styles.toggleButtonText, isActive ? styles.toggleButtonTextActive : null]}>
                  {viewTitle(view)} {isCaptured ? '✓' : ''}
                </Text>
              </Pressable>
            )
          })}
        </View>

        <Pressable
          style={[styles.primaryButton, !canCapture ? styles.disabledButton : null]}
          onPress={captureActiveView}
          disabled={!canCapture}
          testID={`capture-${activeView}`}
        >
          <Text style={styles.primaryButtonText}>
            {isCapturing ? `Capturing ${viewTitle(activeView)}…` : `Capture ${viewTitle(activeView)}`}
          </Text>
        </Pressable>
      </View>

      <View style={styles.panel} testID="captured-images-list">
        <Text style={styles.sectionTitle}>Captured Views</Text>
        {CAPTURE_VIEWS.map((view) => {
          const image = capturedImages[view]
          return (
            <View key={view} style={styles.captureRow} testID={`${view}-capture-state`}>
              <Text style={styles.captureLabel}>{viewTitle(view)}</Text>
              <Text style={styles.captureMeta}>
                {image
                  ? `${image.width ?? 'unknown'}×${image.height ?? 'unknown'} · ${image.capturedAt}`
                  : 'Not captured'}
              </Text>
            </View>
          )
        })}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0A0A0B',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    color: '#F5F5F5',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    color: '#71717A',
    fontSize: 13,
    marginBottom: 20,
  },
  panel: {
    backgroundColor: '#161618',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 16,
    marginBottom: 16,
  },
  cameraPanel: {
    height: 420,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#161618',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
  },
  cameraPreview: {
    flex: 1,
  },
  cameraOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    padding: 12,
  },
  cameraOverlayText: {
    color: '#F5F5F5',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  sectionTitle: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  bodyText: {
    color: '#D4D4D8',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 16,
  },
  statusText: {
    color: '#F5F5F5',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  pendingExtractionText: {
    color: '#F59E0B',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  errorText: {
    color: '#F87171',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  viewToggleRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  toggleButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  toggleButtonActive: {
    backgroundColor: 'rgba(99,102,241,0.2)',
    borderColor: 'rgba(99,102,241,0.65)',
  },
  toggleButtonText: {
    color: '#A1A1AA',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  toggleButtonTextActive: {
    color: '#F5F5F5',
  },
  primaryButton: {
    backgroundColor: '#F59E0B',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  disabledButton: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: '#0A0A0B',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  captureRow: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 10,
  },
  captureLabel: {
    color: '#F5F5F5',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  captureMeta: {
    color: '#71717A',
    fontSize: 13,
  },
})

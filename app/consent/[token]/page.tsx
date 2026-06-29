import ConsentResponder from '@/components/ConsentResponder'

// Public page (allow-listed in proxy.ts). The remote subject opens this via the
// link/QR the practitioner shared, reads the consent terms, and signs.
export default async function ConsentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <ConsentResponder token={token} />
}

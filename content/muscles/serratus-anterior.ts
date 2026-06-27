import type { MuscleContent } from './types'

export const serratusAnterior: MuscleContent = {
  slug: 'serratus-anterior',
  name: 'Serratus Anterior',
  region: 'shoulder_girdle',
  anatomySummary:
    'The serratus anterior is a broad, fan-shaped muscle that wraps along the side of the ribcage. Its finger-like slips arise from the upper eight or nine ribs and run backward and around to attach along the inner edge of the shoulder blade, on the surface facing the ribs. Because it sits between the shoulder blade and the ribcage, it acts like a strap that holds the shoulder blade flat against the chest wall. The lower part also helps swing the shoulder blade upward, which makes it essential for raising the arm overhead. Its serrated, saw-tooth origins give the muscle its name.',
  functionText:
    'The serratus anterior holds the shoulder blade flat and snug against the ribcage and rotates it upward so the arm can reach overhead. It also draws the shoulder blade forward around the ribcage (protraction), as in a punching or pushing motion, and provides the stable base the arm needs during pressing and reaching.',
  screeningNotes:
    'Commonly underactive and poorly coordinated in people with rounded shoulders and limited overhead reach. When it does not engage well, the inner edge of the shoulder blade can lift away from the ribcage (winging) and upward rotation suffers, leaving the shoulder poorly positioned. In screening it is usually flagged as weak; a client with visible winging or difficulty stabilizing the shoulder blade may benefit from professional evaluation.',
  links: [
    {
      imbalanceKey: 'anterior_imbalanced_shoulders',
      role: 'weak',
      confidence: 'high',
      rationale:
        'In anterior imbalanced shoulders a weak serratus anterior cannot keep the shoulder blade flat and properly rotated against the ribcage, so the blade loses its stable seat and the shoulder rounds forward. Poor serratus control also lets the inner edge of the blade lift away (winging), which worsens the forward shoulder position. Rebuilding its strength and timing may help give the shoulder blade a flatter, more stable base, so the shoulder can sit back more easily.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}

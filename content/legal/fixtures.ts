import {
  LEGAL_CONTEXT_BY_KIND,
  type LegalDocumentVersion,
} from '@/lib/legal/types'

// These preserve the pre-governance engineering copy for deterministic local/CI
// journeys. Their status is intentionally ineligible outside explicit fixture mode.
export const LEGAL_DOCUMENT_FIXTURES: readonly LegalDocumentVersion[] = [
  {
    id: 'privacy-test-fixture-v1',
    kind: 'privacy',
    version: 'test-1',
    status: 'test_fixture',
    title: 'Privacy Policy',
    context: LEGAL_CONTEXT_BY_KIND.privacy,
    effectiveAt: '2026-07-20T00:00:00.000Z',
    sections: [
      {
        id: 'what-we-collect',
        heading: 'What we collect',
        paragraphs: [
          'Posture AI computes body-position landmark coordinates from posture views. Photos are processed entirely on the device in your browser and are never uploaded or stored — only the derived position measurements are saved. We do not create a facial-recognition template or any face-geometry scan, and the eye/mouth landmarks the pose model produces are discarded before anything is saved.',
        ],
      },
      {
        id: 'how-we-use-it',
        heading: 'How we use it',
        paragraphs: [
          'Measurements produce a posture screening summary and movement suggestions that a qualified practitioner reviews before sharing. Results are not a medical diagnosis and must be interpreted by a qualified professional.',
        ],
      },
      {
        id: 'consumer-health-biometric-data',
        heading: 'Consumer health & biometric data',
        paragraphs: [
          'Posture and body-measurement data may be considered consumer health data under laws such as Washington’s My Health My Data Act, and pose data may be regulated under biometric privacy laws such as the Illinois Biometric Information Privacy Act. We collect it only with the subject’s (or their guardian’s) consent, and we honor access, withdrawal, and deletion requests.',
        ],
      },
      {
        id: 'no-sale-no-trackers',
        heading: 'No sale, no trackers',
        paragraphs: [
          'We do not sell your data and do not share it with advertisers. Posture AI uses no third-party analytics, advertising, or session-replay trackers on intake, capture, or results pages.',
        ],
      },
      {
        id: 'retention-deletion',
        heading: 'Retention & deletion',
        paragraphs: [
          'Practitioners may permanently delete a client’s data at any time. Deletion purges the stored landmark measurements, findings, and generated reports, leaving only a redacted, PII-free record that the deletion occurred (kept for audit). To request access to or deletion of your data, contact the practitioner who screened you.',
        ],
      },
      {
        id: 'children',
        heading: 'Children',
        paragraphs: [
          'Posture AI may not be used to screen anyone under 13. Screening a minor aged 13–17 requires a parent or legal guardian to consent.',
        ],
      },
    ],
    bodySha256: '0b15b685fd1032bff1547563c6ce44dffb573485f6aef46d16e3f472597cea3b',
    supersedesId: null,
    changeFromPrior: 'initial',
    acceptanceRequired: false,
    counselApprovalRef: null,
  },
  {
    id: 'terms-test-fixture-v1',
    kind: 'terms',
    version: 'test-1',
    status: 'test_fixture',
    title: 'Terms of Use',
    context: LEGAL_CONTEXT_BY_KIND.terms,
    effectiveAt: '2026-07-20T00:00:00.000Z',
    sections: [
      {
        id: 'screening-not-diagnosis',
        heading: 'A screening tool, not a diagnosis',
        paragraphs: [
          'Posture AI is an educational posture screening tool for qualified movement professionals. It is not a medical diagnosis, and its output is not medical advice. Results identify areas that may benefit from further professional evaluation and must be interpreted by a qualified professional.',
        ],
      },
      {
        id: 'professional-use-consent',
        heading: 'Professional use & consent',
        paragraphs: [
          'Posture AI is intended for use by qualified practitioners (physical therapists, athletic trainers, chiropractors, movement/fitness coaches). Practitioners are responsible for obtaining each subject’s informed consent before screening, and for reviewing and approving any report before it is shared. Exercise suggestions are not medical orders.',
        ],
      },
      {
        id: 'not-consumer-self-assessment',
        heading: 'Not for consumer self-assessment',
        paragraphs: [
          'Posture AI is not offered as a direct-to-consumer self-assessment application, and it is not a substitute for professional care.',
        ],
      },
      {
        id: 'no-warranty',
        heading: 'No warranty',
        paragraphs: [
          'The service is provided “as is” for screening and educational purposes, without warranties of any kind. Always consult a qualified health professional before making clinical decisions.',
        ],
      },
    ],
    bodySha256: '57a4cdb692b60cde1662346c292a6213ac1351dee20ed55ec23339ecf6a733b2',
    supersedesId: null,
    changeFromPrior: 'initial',
    acceptanceRequired: true,
    counselApprovalRef: null,
  },
  {
    id: 'subject-consent-test-fixture-v0',
    kind: 'subject_consent',
    version: 'test-0',
    status: 'test_fixture',
    title: 'Consent to Posture Screening',
    context: LEGAL_CONTEXT_BY_KIND.subject_consent,
    effectiveAt: '2026-07-19T00:00:00.000Z',
    sections: [{
      id: 'authorization',
      heading: null,
      paragraphs: ['Historical non-material consent fixture.'],
    }],
    bodySha256: '68fe57a42ab60861f59b6a8d2c0525db721d909d3a4fd928afafab13d82e3cde',
    supersedesId: null,
    changeFromPrior: 'initial',
    acceptanceRequired: true,
    counselApprovalRef: null,
  },
  {
    id: 'subject-consent-test-fixture-v1',
    kind: 'subject_consent',
    version: 'test-1',
    status: 'test_fixture',
    title: 'Consent to Posture Screening',
    context: LEGAL_CONTEXT_BY_KIND.subject_consent,
    effectiveAt: '2026-07-20T00:00:00.000Z',
    sections: [
      {
        id: 'authorization',
        heading: null,
        paragraphs: [
          'I authorize this practitioner and Posture AI to capture posture views of me and to compute body-position measurements from them, for the purpose of posture screening and movement guidance.',
        ],
      },
      {
        id: 'what-is-collected',
        heading: 'What is collected',
        paragraphs: [
          'Body-position landmark coordinates only. Photos are processed on this device and are never uploaded or stored — only the position measurements are saved. No facial-recognition or face-geometry template is created.',
        ],
      },
      {
        id: 'how-it-is-used',
        heading: 'How it is used',
        paragraphs: [
          'To produce a screening summary and movement suggestions reviewed by the practitioner. Posture AI is a screening tool, not a medical diagnosis.',
        ],
      },
      {
        id: 'sharing-sale',
        heading: 'Sharing & sale',
        paragraphs: [
          'Your data is not sold and is not shared with advertisers or third-party trackers. It is stored by the practitioner using Posture AI.',
        ],
      },
      {
        id: 'your-rights',
        heading: 'Your rights',
        paragraphs: [
          'You may withdraw this consent and request deletion of your data at any time by asking the practitioner.',
        ],
      },
      {
        id: 'confirmation',
        heading: null,
        paragraphs: [
          'By signing, I confirm I have read and agree to the above. If the person being screened is under 18, a parent or legal guardian must sign on their behalf.',
        ],
      },
    ],
    bodySha256: '66ccb18e51a1b930ea7ca0091c7e18100fe97d66970a7cadadfc2adfa3979b7c',
    supersedesId: 'subject-consent-test-fixture-v0',
    changeFromPrior: 'non_material',
    acceptanceRequired: true,
    counselApprovalRef: null,
  },
  {
    id: 'screening-notice-test-fixture-v1',
    kind: 'screening_notice',
    version: 'test-1',
    status: 'test_fixture',
    title: 'Screening Notice',
    context: LEGAL_CONTEXT_BY_KIND.screening_notice,
    effectiveAt: '2026-07-20T00:00:00.000Z',
    sections: [{
      id: 'screening-only',
      heading: null,
      paragraphs: [
        'Screening tool only. Posture AI provides screening information for movement professionals — it is not a medical diagnosis and does not replace evaluation by a qualified healthcare professional. Results identify areas that may benefit from further professional assessment.',
      ],
    }],
    bodySha256: 'ce14bfa5b311aeed4c47267068730ef35b5daf6944a3fcf0d776c3a0868fac8f',
    supersedesId: null,
    changeFromPrior: 'initial',
    acceptanceRequired: false,
    counselApprovalRef: null,
  },
]

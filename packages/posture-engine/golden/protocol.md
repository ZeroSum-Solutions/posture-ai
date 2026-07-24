# Tier B reliability protocol

The frozen Tier B v2 protocol is
[`docs/qa/tierb-reliability/protocol.md`](../../../docs/qa/tierb-reliability/protocol.md).
That document, the checked-in packet, schemas, trust policy, and validator form
one immutable preparation bundle.

## Current state

**Collection is not authorized.** The repository contains a `prepared` packet
only. Do not collect, upload, decode, process, or commit any volunteer photo
until all of the following are true:

1. an independently trusted key has signed a valid
   `collection_authorized` child packet;
2. the child packet binds this exact protocol, configuration, source inventory,
   model, engine, and parent-packet hash;
3. the participant has completed the governed purpose-specific consent flow;
4. the capture operator has confirmed the approved restricted-data location.

There is no development flag, local bypass, or verbal-OK substitute.

## What PR 10 prepares

The study measures short-term, within-session, full re-stance repeatability.
It uses neutral posture only, the same 12 participants minimum (15 target) on
exactly two devices, exactly three complete re-stances, and four ordered slots:
front, side left, back, and side right. That is 288 unique photos minimum or
360 at target.

The independent biological sample is the participant, not the photo, view,
repeat, finding, or model output. Agreement SEM and MDC95 are primary;
ICC(A,1) is secondary because a neutral-only sample can have a narrow range.

PR 10 does not collect people, establish accuracy, validate clinical
constructs, authorize consumer claims, or change the scoring model/default.
Human collection and adjudication are separate HG-05 work.

import { createFileRoute } from '@tanstack/react-router'
import { motion } from 'framer-motion'
import {
  Broadcast,
  CheckCircle,
  ClockCounterClockwise,
  DeviceMobileCamera,
  Fingerprint,
  Gauge,
  LinkSimple,
  LockKey,
  Pause,
  Play,
  Pulse,
  ShieldWarning,
  Stop,
  WarningCircle,
} from '@phosphor-icons/react'
import {
  makeEndpointManifestSummary,
  evaluateControlCommandRequest,
  makeControlCommandRequest,
  makeControlCommandResult,
  makeFakeControlTransportProof,
  makeHealthCard,
  makeHealthUpdateEvent,
  makeHostPolicyRiskCard,
  makeLifecycleControls,
  makeOutputModeBadge,
  makePairingPayloadDisplay,
  makeRegistryScopedControls,
  makeSessionInspectCard,
  makeSessionSnapshotEvent,
  type ControlSurfaceBadge,
  type RegistryScopedControl,
} from '@flowstream-re/control-surface'

export const Route = createFileRoute('/control')({
  component: ControlSurfacePage,
})

const nowMs = 1_764_560_420_000

type SessionSnapshot = Parameters<typeof makeSessionInspectCard>[0]
type SessionDescriptor = NonNullable<Parameters<typeof makeSessionInspectCard>[1]>
type CapabilityGrant = NonNullable<Parameters<typeof makeLifecycleControls>[1]>
type RegistryMatches = Extract<Parameters<typeof makeRegistryScopedControls>[0], readonly unknown[]>
type HostPolicyDescriptor = Parameters<typeof makeHostPolicyRiskCard>[0]
type EndpointManifest = Parameters<typeof makeEndpointManifestSummary>[0]
type HealthSnapshot = Parameters<typeof makeHealthCard>[0]

const sessionSnapshot: SessionSnapshot = {
  id: 'fs_live_final_09',
  owner: 'ops:arena-truck',
  status: 'running',
  version: 42,
  createdAt: nowMs - 18 * 60_000,
  updatedAt: nowMs - 1_900,
}

const sessionDescriptor: SessionDescriptor = {
  id: sessionSnapshot.id,
  owner: sessionSnapshot.owner,
  debug: false,
  acquire: 'webcapture',
  content: 'football',
  output: 'forwarder',
  hostRequired: true,
}

const mobileGrant: CapabilityGrant = {
  id: 'cap_mobile_booth_7',
  sessionId: sessionSnapshot.id,
  holder: 'mobile:booth-7',
  scopes: [
    'session:pause',
    'session:stop',
    'source:webcapture:setCrop',
    'visual:runtime:setTheme',
    'output:forwarder:setAudience',
  ],
  expiresAt: nowMs + 8 * 60_000,
  revoked: false,
}

const pairingDisplay = makePairingPayloadDisplay({
  payload: 'flowstream://pair?sid=fs_live_final_09&cap=cap_mobile_booth_7&nonce=6M9R-2XK8',
  issuedAtMs: nowMs,
  expiresAtMs: nowMs + 90_000,
  deviceLabel: 'Booth 7 mobile',
  pairingCode: '6M9R-2XK8',
}, nowMs)

const hostPolicy: HostPolicyDescriptor = {
  hostId: 'host_arc_edge_lagos_02',
  accountTier: 'event-prod',
  supportedOutputs: ['forwarder', 'local'],
  debug: false,
  cache: {
    available: true,
    quotaRemainingBytes: 1_250_000_000,
    retentionDays: 7,
    receipts: 'required',
  },
  live: {
    minDurationSeconds: 60,
    maxDurationSeconds: 7_200,
  },
  evaluation: {
    ruleSet: 'event-prod@2026-06',
    status: 'warning',
    warnings: ['cache receipt required', 'mobile control expires before event end'],
  },
}

const endpointManifest: EndpointManifest = {
  version: '0.1.0',
  manifestId: 'manifest_6f2c',
  sessionId: sessionSnapshot.id,
  observer: 'obs_mobile_booth_7',
  contentId: 'football',
  hostId: hostPolicy.hostId,
  endpoints: [
    { kind: 'watch', url: 'https://edge.flowstream.local/watch/fs_live_final_09', expiresAtMs: nowMs + 10 * 60_000 },
    { kind: 'state', url: 'wss://edge.flowstream.local/state/fs_live_final_09', expiresAtMs: nowMs + 10 * 60_000 },
    { kind: 'telemetry', url: 'wss://edge.flowstream.local/telemetry/fs_live_final_09', expiresAtMs: nowMs + 10 * 60_000 },
    { kind: 'control', url: 'wss://edge.flowstream.local/control/fs_live_final_09', expiresAtMs: nowMs + 90_000 },
  ],
  hostPolicyStatus: hostPolicy.evaluation.status,
  cacheReceiptRefs: ['cache_receipt_8bd2', 'cache_receipt_8bd3'],
  issuedAtMs: nowMs - 6_000,
  expiresAtMs: nowMs + 10 * 60_000,
  signature: 'ed25519:mock-signature',
}

const registryCommandMatches: RegistryMatches = [
  {
    descriptor: {
      kind: 'acquire',
      id: 'webcapture',
      version: '0.1.0',
      displayName: 'Web capture source',
      summary: 'Private browser capture controls for the operator device.',
      capabilityScopes: ['source:webcapture:setCrop', 'source:webcapture:setUrl'],
      sourceType: 'browser',
      flags: [],
      commands: [
        {
          name: 'Set crop',
          scope: 'source:webcapture:setCrop',
          help: 'Adjust private capture crop without touching canonical graphics.',
          examples: ['crop 16:9 scoreboard-safe'],
        },
        {
          name: 'Set URL',
          scope: 'source:webcapture:setUrl',
          help: 'Retarget the browser capture source.',
          examples: ['open replay-angle'],
        },
      ],
    },
    command: {
      name: 'Set crop',
      scope: 'source:webcapture:setCrop',
      help: 'Adjust private capture crop without touching canonical graphics.',
      examples: ['crop 16:9 scoreboard-safe'],
    },
  },
  {
    descriptor: {
      kind: 'visual',
      id: 'runtime',
      version: '0.1.0',
      displayName: 'Canonical broadcast visuals',
      summary: 'Approved scoreboard/lower-third runtime commands.',
      capabilityScopes: ['visual:runtime:setTheme', 'visual:runtime:toggleLayer'],
      flags: [],
      commands: [
        {
          name: 'Set theme',
          scope: 'visual:runtime:setTheme',
          help: 'Switch the canonical broadcast package theme.',
          examples: ['theme finals'],
        },
        {
          name: 'Toggle layer',
          scope: 'visual:runtime:toggleLayer',
          help: 'Show or hide a broadcast-safe visual layer.',
          examples: ['layer clock off'],
        },
      ],
    },
    command: {
      name: 'Set theme',
      scope: 'visual:runtime:setTheme',
      help: 'Switch the canonical broadcast package theme.',
      examples: ['theme finals'],
    },
  },
  {
    descriptor: {
      kind: 'output',
      id: 'forwarder',
      version: '0.1.0',
      displayName: 'Forwarder output',
      summary: 'Audience-facing WebRTC output controls.',
      capabilityScopes: ['output:forwarder:setAudience', 'output:forwarder:rotateKey'],
      mode: 'forwarder',
      requiresHost: true,
      debugOnly: false,
      flags: [],
      commands: [
        {
          name: 'Set audience',
          scope: 'output:forwarder:setAudience',
          help: 'Move the forwarder between rehearsal and live audience.',
          examples: ['audience live'],
        },
        {
          name: 'Rotate key',
          scope: 'output:forwarder:rotateKey',
          help: 'Rotate host output credentials.',
          examples: ['rotate key'],
        },
      ],
    },
    command: {
      name: 'Set audience',
      scope: 'output:forwarder:setAudience',
      help: 'Move the forwarder between rehearsal and live audience.',
      examples: ['audience live'],
    },
  },
  {
    descriptor: {
      kind: 'output',
      id: 'forwarder',
      version: '0.1.0',
      displayName: 'Forwarder output',
      summary: 'Audience-facing WebRTC output controls.',
      capabilityScopes: ['output:forwarder:setAudience', 'output:forwarder:rotateKey'],
      mode: 'forwarder',
      requiresHost: true,
      debugOnly: false,
      flags: [],
      commands: [
        {
          name: 'Set audience',
          scope: 'output:forwarder:setAudience',
          help: 'Move the forwarder between rehearsal and live audience.',
          examples: ['audience live'],
        },
        {
          name: 'Rotate key',
          scope: 'output:forwarder:rotateKey',
          help: 'Rotate host output credentials.',
          examples: ['rotate key'],
        },
      ],
    },
    command: {
      name: 'Rotate key',
      scope: 'output:forwarder:rotateKey',
      help: 'Rotate host output credentials.',
      examples: ['rotate key'],
    },
  },
]

const healthSnapshots: readonly HealthSnapshot[] = [
  {
    stage: 'acquire',
    descriptorId: 'webcapture',
    sourceId: 'src_browser_7',
    status: 'degraded',
    message: 'capture is 17 frames behind',
    updatedAtMs: nowMs - 4_500,
    frameCount: 17_940,
    droppedFrames: 49,
    cadence: null,
  },
  {
    stage: 'visual',
    descriptorId: 'runtime',
    status: 'running',
    message: 'canonical package locked',
    updatedAtMs: nowMs - 29_000,
    renderFps: 59.7,
    renderedFrames: 17_120,
    droppedRenderFrames: 2,
    targetCount: 2,
    lastFrameId: 'frame_1fc',
  },
  {
    stage: 'output',
    descriptorId: 'forwarder',
    attachmentId: 'webrtc_main',
    status: 'running',
    message: 'forwarder attached',
    updatedAtMs: nowMs - 2_200,
    deliveredFrames: 17_000,
    deliveryFps: 59.2,
  },
]

const sessionCard = makeSessionInspectCard(sessionSnapshot, sessionDescriptor)
const lifecycleControls = makeLifecycleControls(sessionSnapshot, mobileGrant, nowMs)
const registryControls = makeRegistryScopedControls(registryCommandMatches, mobileGrant, nowMs)
const outputBadge = makeOutputModeBadge(sessionDescriptor.output, sessionDescriptor.debug)
const policyRisk = makeHostPolicyRiskCard(hostPolicy)
const manifestSummary = makeEndpointManifestSummary(endpointManifest, nowMs)
const sessionSnapshotEvent = makeSessionSnapshotEvent(sessionSnapshot, sessionDescriptor, nowMs, 15_000)
const healthEvents = healthSnapshots.map((snapshot) => makeHealthUpdateEvent(sessionSnapshot.id, snapshot, nowMs, 15_000))
const healthCards = healthEvents.map((event) => event.view)
const acceptedCommandRequest = makeControlCommandRequest({
  requestId: 'cmd_crop_preview',
  sessionId: sessionSnapshot.id,
  command: 'source:webcapture:setCrop',
  registry: registryCommandMatches,
  input: {
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
  },
  issuedAtMs: nowMs - 1_200,
})
const deniedCommandRequest = makeControlCommandRequest({
  requestId: 'cmd_rotate_key_preview',
  sessionId: sessionSnapshot.id,
  command: 'output:forwarder:rotateKey',
  registry: registryCommandMatches,
  issuedAtMs: nowMs - 900,
})
const acceptedCommand = evaluateControlCommandRequest({
  request: acceptedCommandRequest,
  grant: mobileGrant,
  registry: registryCommandMatches,
  nowMs,
})
const deniedCommand = evaluateControlCommandRequest({
  request: deniedCommandRequest,
  grant: mobileGrant,
  registry: registryCommandMatches,
  nowMs,
})
const acceptedCommandResult = acceptedCommand.kind === 'control.command.accepted'
  ? makeControlCommandResult({
      envelope: acceptedCommand.envelope,
      status: 'applied',
      completedAtMs: nowMs + 650,
      snapshot: {
        ...sessionSnapshot,
        version: sessionSnapshot.version + 1,
        updatedAt: nowMs + 650,
      },
    })
  : null
const controlTransportProof = makeFakeControlTransportProof({
  protocol: 'datachannel',
  sessionId: sessionSnapshot.id,
  messages: [
    sessionSnapshotEvent,
    ...healthEvents,
    acceptedCommandRequest,
    acceptedCommand,
    deniedCommandRequest,
    deniedCommand,
    ...(acceptedCommandResult === null ? [] : [acceptedCommandResult]),
  ],
})
const commandProofs = [
  ...controlTransportProof.accepted,
  ...controlTransportProof.denied,
  ...controlTransportProof.results,
]

const badgeToneStyles: Record<ControlSurfaceBadge['tone'], { color: string; bg: string; border: string }> = {
  neutral: { color: 'rgba(255,255,255,0.48)', bg: 'rgba(255,255,255,0.035)', border: 'rgba(255,255,255,0.08)' },
  info: { color: '#00c8ff', bg: 'rgba(0,200,255,0.075)', border: 'rgba(0,200,255,0.18)' },
  success: { color: '#00ff87', bg: 'rgba(0,255,135,0.075)', border: 'rgba(0,255,135,0.18)' },
  warning: { color: '#ffd553', bg: 'rgba(255,213,83,0.075)', border: 'rgba(255,213,83,0.2)' },
  danger: { color: '#ff2d78', bg: 'rgba(255,45,120,0.075)', border: 'rgba(255,45,120,0.2)' },
}

const statusColors = {
  running: '#00ff87',
  degraded: '#ffd553',
  stale: '#ffd553',
  failed: '#ff2d78',
  starting: '#00c8ff',
  idle: 'rgba(255,255,255,0.42)',
  stopped: 'rgba(255,255,255,0.42)',
}

function ControlSurfacePage() {
  const privateControls = registryControls.filter((control) => control.descriptorKind === 'acquire')
  const canonicalControls = registryControls.filter((control) => control.descriptorKind !== 'acquire')

  return (
    <div style={{ height: 'calc(100vh - 56px)', overflowY: 'auto', padding: '20px 16px 36px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <DeviceMobileCamera size={18} color="#00ff87" />
              <span className="mono" style={{ fontSize: 11, color: '#00ff87', letterSpacing: '0.08em', fontWeight: 700 }}>OPERATOR SURFACE</span>
            </div>
            <h1 className="display" style={{ fontSize: 28, color: '#fff', lineHeight: 1.08, letterSpacing: 0 }}>Mobile control proof</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Badge badge={outputBadge} />
            <Badge badge={policyRisk.badges[2]} />
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14 }}>
          <Panel title="Pairing payload" icon={<Fingerprint size={17} color="#00c8ff" />}>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ border: '1px solid rgba(0,200,255,0.16)', background: 'linear-gradient(145deg, rgba(0,200,255,0.09), rgba(13,13,28,0.72))', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{pairingDisplay.title}</div>
                    <div className="mono" style={{ color: 'rgba(255,255,255,0.38)', fontSize: 11, marginTop: 3 }}>{pairingDisplay.subtitle}</div>
                  </div>
                  <div className="mono" style={{ color: '#00c8ff', border: '1px solid rgba(0,200,255,0.24)', borderRadius: 6, padding: '6px 8px', height: 31, fontWeight: 800, fontSize: 12 }}>
                    {pairingDisplay.code}
                  </div>
                </div>
                <code style={{ display: 'block', color: 'rgba(255,255,255,0.66)', background: 'rgba(0,0,0,0.24)', border: '1px solid rgba(255,255,255,0.055)', borderRadius: 7, padding: 10, fontSize: 11, lineHeight: 1.55, overflowWrap: 'anywhere' }}>
                  {pairingDisplay.payload}
                </code>
              </div>
              <BadgeRow badges={pairingDisplay.badges} />
              <MetricGrid metrics={[
                ['Holder', mobileGrant.holder],
                ['Grant', mobileGrant.id],
                ['Scopes', mobileGrant.scopes.length.toString()],
              ]} />
            </div>
          </Panel>

          <Panel title="Session state" icon={<Broadcast size={17} color="#00ff87" />}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                  <div>
                    <div className="mono" style={{ color: 'rgba(255,255,255,0.34)', fontSize: 10, letterSpacing: '0.08em' }}>SESSION</div>
                    <div style={{ color: '#fff', fontWeight: 700, marginTop: 4 }}>{sessionCard.id}</div>
                  </div>
                  <span className="mono" style={{ color: '#00ff87', fontSize: 12, fontWeight: 800 }}>v{sessionCard.version}</span>
                </div>
                <MetricGrid metrics={[
                  ['Owner', sessionCard.owner],
                  ['Acquire', sessionCard.descriptor?.acquire ?? 'unknown'],
                  ['Content', sessionCard.descriptor?.content ?? 'unknown'],
                  ['Output', sessionCard.descriptor?.output ?? 'unknown'],
                ]} />
              </div>
              <div style={{ borderLeft: '1px solid rgba(255,255,255,0.055)', paddingLeft: 12 }}>
                <BadgeRow badges={sessionCard.badges} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                  <TimeTile label="Created" value={formatRelative(sessionCard.createdAt)} />
                  <TimeTile label="Updated" value={formatRelative(sessionCard.updatedAt)} />
                </div>
                <div style={{ marginTop: 12, border: '1px solid rgba(0,255,135,0.12)', background: 'rgba(0,255,135,0.04)', borderRadius: 8, padding: 10 }}>
                  <div className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.34)', letterSpacing: '0.08em', marginBottom: 4 }}>LIFECYCLE CONTROLS</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(42px, 1fr))', gap: 6 }}>
                    {lifecycleControls.map((control) => <LifecycleButton key={control.id} control={control} />)}
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14, marginTop: 14 }}>
          <Panel title="Allowed controls" icon={<LockKey size={17} color="#ffd553" />}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12 }}>
              <ControlGroup title="Private mobile controls" subtitle="Operator-only source controls" controls={privateControls} />
              <ControlGroup title="Canonical broadcast visuals" subtitle="Registry-scoped commands for output and approved visuals" controls={canonicalControls} />
            </div>
          </Panel>

          <Panel title="Command transport" icon={<Pulse size={17} color="#00c8ff" />}>
            <div style={{ display: 'grid', gap: 9 }}>
              {commandProofs.map((message) => <CommandProofRow key={message.requestId} message={message} />)}
            </div>
          </Panel>

          <Panel title="State transport proof" icon={<LinkSimple size={17} color="#00c8ff" />}>
            <TransportProofCard proof={controlTransportProof} />
          </Panel>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14, marginTop: 14 }}>
          <Panel title="Host policy risk" icon={<ShieldWarning size={17} color="#ffd553" />}>
            <div style={{ display: 'grid', gap: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div className="mono" style={{ color: 'rgba(255,255,255,0.34)', fontSize: 10, letterSpacing: '0.08em' }}>HOST</div>
                  <div style={{ color: '#fff', fontWeight: 700, marginTop: 4 }}>{policyRisk.hostId}</div>
                </div>
                <Badge badge={policyRisk.badges[0]} />
              </div>
              <MetricGrid metrics={[
                ['Cache', policyRisk.cache.available ? 'available' : 'unavailable'],
                ['Receipts', policyRisk.cache.receipts],
                ['Retention', `${policyRisk.cache.retentionDays} days`],
                ['Quota', `${Math.round(policyRisk.cache.quotaRemainingBytes / 1_000_000)} MB`],
              ]} />
              <RiskList title="Warnings" items={policyRisk.warnings} tone="warning" />
              <RiskList title="Blocks" items={policyRisk.blockReasons} tone="danger" empty="none" />
            </div>
          </Panel>

          <Panel title="Endpoint manifest" icon={<LinkSimple size={17} color="#00c8ff" />}>
            <div style={{ display: 'grid', gap: 11 }}>
              <BadgeRow badges={manifestSummary.badges} />
              <MetricGrid metrics={[
                ['Manifest', manifestSummary.manifestId],
                ['Observer', manifestSummary.observer],
                ['Endpoints', manifestSummary.endpointCount.toString()],
                ['Receipts', manifestSummary.cacheReceiptCount.toString()],
              ]} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {manifestSummary.endpointKinds.map((kind) => (
                  <span key={kind} className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.52)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, padding: '4px 7px', background: 'rgba(255,255,255,0.025)' }}>
                    {kind}
                  </span>
                ))}
              </div>
              <code style={{ color: '#00c8ff', background: 'rgba(0,200,255,0.055)', border: '1px solid rgba(0,200,255,0.13)', borderRadius: 7, padding: 9, fontSize: 11, overflowWrap: 'anywhere' }}>
                {manifestSummary.controlUrl}
              </code>
            </div>
          </Panel>

          <Panel title="Health evidence" icon={<Gauge size={17} color="#ff2d78" />}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 10 }}>
              {healthCards.map((card) => (
                <motion.div
                  key={card.id}
                  initial={{ opacity: 0, transform: 'translateY(8px)' }}
                  animate={{ opacity: 1, transform: 'translateY(0px)' }}
                  className="glass-card"
                  style={{ padding: 12, borderColor: card.stale || card.status === 'degraded' ? 'rgba(255,213,83,0.22)' : 'rgba(255,255,255,0.055)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                    <div>
                      <div className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.34)', letterSpacing: '0.08em' }}>{card.stage.toUpperCase()}</div>
                      <div style={{ color: '#fff', fontWeight: 700, marginTop: 3 }}>{card.descriptorId ?? 'session'}</div>
                    </div>
                    <Pulse size={17} color={statusColors[card.status]} />
                  </div>
                  <BadgeRow badges={card.badges} />
                  <p style={{ color: 'rgba(255,255,255,0.46)', fontSize: 12, lineHeight: 1.45, marginTop: 10, minHeight: 34 }}>
                    {card.message ?? 'No health message'}
                  </p>
                  <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.28)', fontSize: 10, marginTop: 10 }}>
                    <ClockCounterClockwise size={12} />
                    {formatRelative(card.updatedAtMs)}
                  </div>
                </motion.div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, transform: 'translateY(10px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      className="glass-card"
      style={{ padding: 14, minWidth: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 13 }}>
        {icon}
        <h2 className="display" style={{ fontSize: 15, color: '#fff', fontWeight: 700, letterSpacing: 0 }}>{title}</h2>
      </div>
      {children}
    </motion.section>
  )
}

function Badge({ badge }: { badge: ControlSurfaceBadge | undefined }) {
  if (badge === undefined) return null

  const tone = badgeToneStyles[badge.tone]
  return (
    <span title={badge.detail} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: tone.color, background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 5, padding: '4px 7px', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>
      {badge.tone === 'success' ? <CheckCircle size={11} weight="fill" /> : badge.tone === 'warning' || badge.tone === 'danger' ? <WarningCircle size={11} /> : null}
      {badge.label}
    </span>
  )
}

function BadgeRow({ badges }: { badges: readonly ControlSurfaceBadge[] }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {badges.map((badge) => <Badge key={badge.id} badge={badge} />)}
    </div>
  )
}

function MetricGrid({ metrics }: { metrics: readonly (readonly [string, string])[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
      {metrics.map(([label, value]) => (
        <div key={label} style={{ border: '1px solid rgba(255,255,255,0.055)', borderRadius: 7, padding: '8px 9px', background: 'rgba(255,255,255,0.022)', minWidth: 0 }}>
          <div className="mono" style={{ color: 'rgba(255,255,255,0.26)', fontSize: 9, letterSpacing: '0.08em', marginBottom: 4 }}>{label.toUpperCase()}</div>
          <div style={{ color: 'rgba(255,255,255,0.78)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function TimeTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.055)', borderRadius: 7, padding: '8px 9px', background: 'rgba(255,255,255,0.022)' }}>
      <div className="mono" style={{ color: 'rgba(255,255,255,0.26)', fontSize: 9, letterSpacing: '0.08em', marginBottom: 4 }}>{label.toUpperCase()}</div>
      <div className="mono" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>{value}</div>
    </div>
  )
}

function LifecycleButton({ control }: { control: (typeof lifecycleControls)[number] }) {
  const Icon = control.id === 'pause' ? Pause : control.id === 'stop' ? Stop : Play
  return (
    <button
      type="button"
      disabled={!control.enabled}
      title={control.reason ?? control.scope}
      style={{
        height: 38,
        borderRadius: 7,
        border: `1px solid ${control.enabled ? 'rgba(0,255,135,0.22)' : 'rgba(255,255,255,0.055)'}`,
        background: control.enabled ? 'rgba(0,255,135,0.08)' : 'rgba(255,255,255,0.025)',
        color: control.enabled ? '#00ff87' : 'rgba(255,255,255,0.22)',
        display: 'grid',
        placeItems: 'center',
        cursor: control.enabled ? 'pointer' : 'not-allowed',
      }}
      aria-label={control.label}
    >
      <Icon size={16} />
    </button>
  )
}

function ControlGroup({ title, subtitle, controls }: { title: string; subtitle: string; controls: readonly RegistryScopedControl[] }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{title}</div>
          <div style={{ color: 'rgba(255,255,255,0.34)', fontSize: 11, marginTop: 2 }}>{subtitle}</div>
        </div>
        <span className="mono" style={{ color: 'rgba(255,255,255,0.34)', fontSize: 10 }}>{controls.filter((control) => control.enabled).length}/{controls.length}</span>
      </div>
      <div style={{ display: 'grid', gap: 7 }}>
        {controls.map((control) => (
          <button
            key={control.id}
            type="button"
            disabled={!control.enabled}
            title={control.reason ?? control.help}
            style={{
              textAlign: 'left',
              border: `1px solid ${control.enabled ? 'rgba(0,255,135,0.16)' : 'rgba(255,255,255,0.055)'}`,
              borderRadius: 8,
              padding: 10,
              background: control.enabled ? 'rgba(0,255,135,0.045)' : 'rgba(255,255,255,0.018)',
              cursor: control.enabled ? 'pointer' : 'not-allowed',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
              <span style={{ color: control.enabled ? '#fff' : 'rgba(255,255,255,0.34)', fontWeight: 700, fontSize: 12 }}>{control.label}</span>
              <span className="mono" style={{ color: control.enabled ? '#00ff87' : '#ff2d78', fontSize: 9, fontWeight: 800 }}>{control.enabled ? 'ALLOWED' : 'DENIED'}</span>
            </div>
            <div className="mono" style={{ color: 'rgba(255,255,255,0.34)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{control.scope}</div>
            <div style={{ color: 'rgba(255,255,255,0.44)', fontSize: 11, lineHeight: 1.4, marginTop: 6 }}>{control.reason ?? control.help}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function CommandProofRow({ message }: { message: (typeof commandProofs)[number] }) {
  const accepted = message.kind === 'control.command.accepted'
  const denied = message.kind === 'control.command.denied'
  const result = message.kind === 'control.command.result'
  const command = accepted ? message.envelope.command : message.command
  const payload = accepted
    ? message.envelope.mutation
    : denied
      ? { reason: message.reason, missingScope: message.missingScope }
      : { status: message.status, snapshotVersion: message.snapshot?.version, error: message.error ?? null }
  const toneColor = accepted || (result && message.status === 'applied') ? '#00ff87' : '#ff2d78'
  const label = accepted ? 'ACCEPTED' : denied ? 'DENIED' : message.status.toUpperCase()

  return (
    <div style={{ border: `1px solid ${toneColor}2b`, borderRadius: 8, padding: 10, background: `${toneColor}09` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 12 }}>{command.label}</div>
          <div className="mono" style={{ color: 'rgba(255,255,255,0.34)', fontSize: 10, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{command.scope}</div>
        </div>
        <span className="mono" style={{ color: toneColor, fontSize: 10, fontWeight: 800 }}>{label}</span>
      </div>
      <MetricGrid metrics={[
        ['Request', message.requestId],
        ['Session', message.sessionId],
        ['Grant', 'grantId' in message ? message.grantId : 'sdk-result'],
        ['Target', command.target],
      ]} />
      <code style={{ display: 'block', color: 'rgba(255,255,255,0.62)', background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.055)', borderRadius: 7, padding: 8, marginTop: 8, fontSize: 10, lineHeight: 1.45, overflowWrap: 'anywhere' }}>
        {JSON.stringify(payload)}
      </code>
    </div>
  )
}

function TransportProofCard({ proof }: { proof: typeof controlTransportProof }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <BadgeRow badges={proof.badges} />
      <MetricGrid metrics={[
        ['Protocol', proof.protocol],
        ['Frames', proof.frameCount.toString()],
        ['Accepted', proof.accepted.length.toString()],
        ['Denied', proof.denied.length.toString()],
        ['Results', proof.results.length.toString()],
        ['Mutation', proof.mutationOwner],
      ]} />
      <div style={{ border: '1px solid rgba(255,255,255,0.055)', borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,0.16)' }}>
        {proof.frames.map((frame) => <TransportFrameRow key={frame.sequence} frame={frame} />)}
      </div>
      <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 11, lineHeight: 1.45 }}>
        Shared JSON envelopes cross the transport; command execution and session mutation remain SDK-owned, and private client input is excluded from canonical broadcast visuals.
      </div>
    </div>
  )
}

function TransportFrameRow({ frame }: { frame: (typeof controlTransportProof.frames)[number] }) {
  const commandFrame = frame.messageKind.includes('command')
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr) 72px', alignItems: 'center', gap: 8, padding: '8px 9px', borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
      <span className="mono" style={{ color: commandFrame ? '#00c8ff' : '#00ff87', fontSize: 10, fontWeight: 800 }}>#{frame.sequence}</span>
      <div style={{ minWidth: 0 }}>
        <div className="mono" style={{ color: 'rgba(255,255,255,0.72)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{frame.messageKind}</div>
        <div className="mono" style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, marginTop: 2 }}>{frame.direction}</div>
      </div>
      <span className="mono" style={{ color: 'rgba(255,255,255,0.36)', fontSize: 10, textAlign: 'right' }}>{frame.bytes} B</span>
    </div>
  )
}

function RiskList({ title, items, tone, empty = 'clear' }: { title: string; items: readonly string[]; tone: 'warning' | 'danger'; empty?: string }) {
  const color = tone === 'warning' ? '#ffd553' : '#ff2d78'
  return (
    <div>
      <div className="mono" style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.08em', marginBottom: 6 }}>{title.toUpperCase()}</div>
      {items.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,0.36)', fontSize: 12 }}>{empty}</div>
      ) : (
        <div style={{ display: 'grid', gap: 5 }}>
          {items.map((item) => (
            <div key={item} style={{ color, background: `${color}12`, border: `1px solid ${color}24`, borderRadius: 7, padding: '7px 8px', fontSize: 12 }}>
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatRelative(timestamp: number) {
  const deltaMs = nowMs - timestamp
  if (deltaMs < 10_000) return `${Math.max(1, Math.round(deltaMs / 1_000))}s ago`
  return `${Math.round(deltaMs / 60_000)}m ago`
}

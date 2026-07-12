'use client'
// Progress-tab trend charts, split into their own chunk so recharts (+ d3) is
// only fetched when a client actually has multiple assessments AND opens the
// Progress tab — not on every client-detail visit. Loaded via next/dynamic in
// the parent (ssr:false).
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea, Legend,
} from 'recharts'

const IMBALANCE_COLORS = [
  'var(--brand)', '#10B981', 'var(--warning)', 'var(--danger)', '#8B5CF6',
  '#06B6D4', '#F97316', '#84CC16', '#EC4899', '#14B8A6',
]

export interface ProgressChartsProps {
  trendData: Record<string, number | string>[]
  imbalanceKeys: string[]
  imbalanceLabels: Record<string, string>
}

export default function ProgressCharts({ trendData, imbalanceKeys, imbalanceLabels }: ProgressChartsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '24px' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>Overall Grade Trend</h2>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>Grade converted to 0–100 scale (S=100, A=83, B=66, C=50, D=33, E=0)</p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: '#1A1A1C', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} labelStyle={{ color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-secondary)' }} />
            <ReferenceArea y1={66} y2={100} fill="rgba(16,185,129,0.08)" label={{ value: 'Maintain', fill: '#10B981', fontSize: 10, position: 'insideTopRight' }} />
            <ReferenceArea y1={33} y2={66} fill="rgba(255,137,24,0.08)" label={{ value: 'Warning', fill: 'var(--warning)', fontSize: 10, position: 'insideTopRight' }} />
            <ReferenceArea y1={0} y2={33} fill="rgba(239,68,68,0.08)" label={{ value: 'Danger', fill: 'var(--danger)', fontSize: 10, position: 'insideTopRight' }} />
            <Line type="monotone" dataKey="grade_pct" name="Grade" stroke="var(--brand)" strokeWidth={2} dot={{ fill: 'var(--brand)', r: 4 }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {imbalanceKeys.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '24px' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>Imbalance Severity Over Time</h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>Severity % per imbalance — lower is better</p>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} unit="%" />
              <Tooltip contentStyle={{ background: '#1A1A1C', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} labelStyle={{ color: 'var(--text-primary)' }} itemStyle={{ color: 'var(--text-secondary)' }} formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, imbalanceLabels[name] || name]} />
              <Legend formatter={(value) => imbalanceLabels[value] || value} wrapperStyle={{ fontSize: '11px', color: 'var(--text-secondary)' }} />
              <ReferenceArea y1={0} y2={33} fill="rgba(16,185,129,0.06)" />
              <ReferenceArea y1={33} y2={66} fill="rgba(255,137,24,0.06)" />
              <ReferenceArea y1={66} y2={100} fill="rgba(239,68,68,0.06)" />
              {imbalanceKeys.map((key, i) => (
                <Line key={key} type="monotone" dataKey={key} name={key} stroke={IMBALANCE_COLORS[i % IMBALANCE_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

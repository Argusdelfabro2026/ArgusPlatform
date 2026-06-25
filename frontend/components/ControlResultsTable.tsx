'use client';

import type { ControlVariance } from '@/lib/types';

interface Props {
  variances: ControlVariance[];
  onRowClick: (v: ControlVariance) => void;
}

const ESTADO_STYLES: Record<string, string> = {
  OK:       'text-terminal-green border-terminal-green',
  ALERT:    'text-terminal-amber border-terminal-amber',
  CRITICAL: 'text-terminal-red   border-terminal-red',
};

const ROW_BG: Record<string, string> = {
  OK:       'hover:bg-terminal-green/5',
  ALERT:    'hover:bg-terminal-amber/5',
  CRITICAL: 'hover:bg-terminal-red/5',
};

function fmt(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export default function ControlResultsTable({ variances, onRowClick }: Props) {
  const critical = variances.filter(v => v.estado === 'CRITICAL').length;
  const alert    = variances.filter(v => v.estado === 'ALERT').length;
  const ok       = variances.filter(v => v.estado === 'OK').length;

  return (
    <div className="border border-terminal-border rounded bg-terminal-bg-secondary font-mono text-xs overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-terminal-border bg-terminal-bg">
        <span className="text-terminal-amber font-bold">CONTROL CAJA DIGITAL — RESULTADOS</span>
        <div className="flex gap-3 text-xs">
          <span className="text-terminal-green">{ok} OK</span>
          <span className="text-terminal-amber">{alert} ALERT</span>
          <span className="text-terminal-red">{critical} CRITICAL</span>
        </div>
      </div>

      {/* Click hint */}
      <div className="px-3 py-1 text-terminal-gray-dim text-xs border-b border-terminal-border">
        Click any row to drill down into individual transactions
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-64 overflow-y-auto">
        <table className="w-full min-w-[700px]">
          <thead className="sticky top-0 bg-terminal-bg border-b border-terminal-border">
            <tr className="text-terminal-gray text-left">
              <th className="px-3 py-1.5 whitespace-nowrap">MES</th>
              <th className="px-3 py-1.5 whitespace-nowrap">CATEGORÍA</th>
              <th className="px-3 py-1.5 text-right whitespace-nowrap">BANCO</th>
              <th className="px-3 py-1.5 text-right whitespace-nowrap">CAJA DIR</th>
              <th className="px-3 py-1.5 text-right whitespace-nowrap">DIFERENCIA</th>
              <th className="px-3 py-1.5 text-right whitespace-nowrap">VAR%</th>
              <th className="px-3 py-1.5 text-center whitespace-nowrap">ESTADO</th>
              <th className="px-3 py-1.5 text-center whitespace-nowrap">ORIGEN</th>
              <th className="px-3 py-1.5 whitespace-nowrap">ERROR TYPE</th>
              <th className="px-3 py-1.5 whitespace-nowrap">RESPONSABLE</th>
            </tr>
          </thead>
          <tbody>
            {variances.map((v, i) => (
              <tr
                key={`${v.mes}-${v.categoria}-${i}`}
                onClick={() => onRowClick(v)}
                className={`border-b border-terminal-border/30 cursor-pointer transition-colors ${ROW_BG[v.estado]}`}
              >
                <td className="px-3 py-1.5 text-terminal-gray whitespace-nowrap">{v.mes}</td>
                <td className="px-3 py-1.5 text-terminal-cyan whitespace-nowrap">{v.categoria}</td>
                <td className="px-3 py-1.5 text-right text-terminal-white whitespace-nowrap">
                  {fmt(v.total_banco)}
                </td>
                <td className="px-3 py-1.5 text-right text-terminal-white whitespace-nowrap">
                  {fmt(v.total_caja)}
                </td>
                <td className={`px-3 py-1.5 text-right whitespace-nowrap ${v.diferencia < 0 ? 'text-terminal-red' : v.diferencia > 0 ? 'text-terminal-green' : 'text-terminal-gray'}`}>
                  {fmt(v.diferencia)}
                </td>
                <td className={`px-3 py-1.5 text-right whitespace-nowrap ${ESTADO_STYLES[v.estado]}`}>
                  {v.varianza_pct.toFixed(1)}%
                </td>
                <td className="px-3 py-1.5 text-center whitespace-nowrap">
                  <span className={`px-1.5 py-0.5 border rounded text-xs font-bold ${ESTADO_STYLES[v.estado]}`}>
                    {v.estado}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-center text-terminal-gray whitespace-nowrap">
                  {v.origen}
                </td>
                <td className="px-3 py-1.5 text-terminal-white whitespace-nowrap">
                  {v.error_type || '—'}
                </td>
                <td className="px-3 py-1.5 text-terminal-gray whitespace-nowrap">
                  {v.responsable || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

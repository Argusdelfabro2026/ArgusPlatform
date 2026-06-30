'use client';

import { useState, useMemo } from 'react';
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

const PRIORIDAD_STYLES: Record<string, string> = {
  CRITICAL: 'text-terminal-red   border-terminal-red',
  HIGH:     'text-terminal-amber border-terminal-amber',
  MEDIUM:   'text-terminal-cyan  border-terminal-cyan',
  LOW:      'text-terminal-green border-terminal-green',
  '—':      'text-terminal-gray  border-terminal-gray/30',
};

function fmt(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items)).sort();
}

export default function ControlResultsTable({ variances, onRowClick }: Props) {
  const [filterMes, setFilterMes] = useState('ALL');
  const [filterErrorType, setFilterErrorType] = useState('ALL');
  const [filterResponsable, setFilterResponsable] = useState('ALL');
  const [filterPrioridad, setFilterPrioridad] = useState('ALL');

  const critical = variances.filter(v => v.estado === 'CRITICAL').length;
  const alert    = variances.filter(v => v.estado === 'ALERT').length;
  const ok       = variances.filter(v => v.estado === 'OK').length;

  const months       = useMemo(() => unique(variances.map(v => v.mes)), [variances]);
  const errorTypes   = useMemo(() => unique(variances.map(v => v.error_type || '—')), [variances]);
  const responsables = useMemo(() => unique(variances.map(v => v.responsable || '—')), [variances]);
  const prioridades  = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', '—'];

  const filtered = useMemo(() => variances.filter(v => {
    if (filterMes         !== 'ALL' && v.mes                   !== filterMes)          return false;
    if (filterErrorType   !== 'ALL' && (v.error_type || '—')   !== filterErrorType)    return false;
    if (filterResponsable !== 'ALL' && (v.responsable || '—')  !== filterResponsable)  return false;
    if (filterPrioridad   !== 'ALL' && (v.prioridad || '—')    !== filterPrioridad)    return false;
    return true;
  }), [variances, filterMes, filterErrorType, filterResponsable, filterPrioridad]);

  const activeFilters = [filterMes, filterErrorType, filterResponsable, filterPrioridad].filter(f => f !== 'ALL').length;
  const multiMonth = months.length > 1;

  return (
    <div className="border border-terminal-border rounded bg-terminal-bg-secondary font-mono text-xs overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-terminal-border bg-terminal-bg">
        <span className="text-terminal-amber font-bold">CONTROL CAJA DIGITAL — RESULTADOS</span>
        <div className="flex gap-3 text-xs">
          <span className="text-terminal-green">{ok} OK</span>
          <span className="text-terminal-amber">{alert} ALERT</span>
          <span className="text-terminal-red">{critical} CRITICAL</span>
          {filtered.length !== variances.length && (
            <span className="text-terminal-gray">
              ({filtered.length}/{variances.length} shown)
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="px-3 py-2 border-b border-terminal-border bg-terminal-bg flex flex-wrap gap-3 items-center">
        <span className="text-terminal-gray text-xs shrink-0">
          FILTER{activeFilters > 0 ? ` (${activeFilters})` : ''}:
        </span>

        {/* Month — only show when multiple months */}
        {multiMonth && (
          <select
            value={filterMes}
            onChange={e => setFilterMes(e.target.value)}
            className="bg-terminal-bg-secondary border border-terminal-border text-terminal-cyan text-xs px-2 py-0.5 rounded cursor-pointer font-bold"
          >
            <option value="ALL">All Months</option>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        )}

        {/* Error Type */}
        <select
          value={filterErrorType}
          onChange={e => setFilterErrorType(e.target.value)}
          className="bg-terminal-bg-secondary border border-terminal-border text-terminal-white text-xs px-2 py-0.5 rounded cursor-pointer"
        >
          <option value="ALL">All Error Types</option>
          {errorTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        {/* Responsible */}
        <select
          value={filterResponsable}
          onChange={e => setFilterResponsable(e.target.value)}
          className="bg-terminal-bg-secondary border border-terminal-border text-terminal-white text-xs px-2 py-0.5 rounded cursor-pointer"
        >
          <option value="ALL">All Responsible</option>
          {responsables.map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        {/* Priority toggle pills */}
        <div className="flex gap-1">
          {prioridades.map(p => (
            <button
              key={p}
              onClick={() => setFilterPrioridad(filterPrioridad === p ? 'ALL' : p)}
              className={`px-2 py-0.5 border rounded text-xs font-bold transition-colors ${
                filterPrioridad === p
                  ? PRIORIDAD_STYLES[p]
                  : 'text-terminal-gray border-terminal-border/40 hover:border-terminal-border'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {activeFilters > 0 && (
          <button
            onClick={() => { setFilterMes('ALL'); setFilterErrorType('ALL'); setFilterResponsable('ALL'); setFilterPrioridad('ALL'); }}
            className="text-terminal-gray hover:text-terminal-white text-xs px-1"
          >
            ✕ clear
          </button>
        )}
      </div>

      {/* Click hint */}
      <div className="px-3 py-1 text-terminal-gray-dim text-xs border-b border-terminal-border">
        Click any row to drill down into individual transactions
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-64 overflow-y-auto">
        <table className="w-full min-w-[900px]">
          <thead className="sticky top-0 bg-terminal-bg border-b border-terminal-border">
            <tr className="text-terminal-gray text-left">
              <th className="px-3 py-1.5 whitespace-nowrap">MES</th>
              <th className="px-3 py-1.5 whitespace-nowrap">CATEGORÍA</th>
              <th className="px-3 py-1.5 text-right whitespace-nowrap">BANCO</th>
              <th className="px-3 py-1.5 text-right whitespace-nowrap">CAJA DIR</th>
              <th className="px-3 py-1.5 text-right whitespace-nowrap">DIFERENCIA</th>
              <th className="px-3 py-1.5 text-right whitespace-nowrap">VAR%</th>
              <th className="px-3 py-1.5 text-center whitespace-nowrap">ESTADO</th>
              <th className="px-3 py-1.5 text-center whitespace-nowrap">ERROR TYPE</th>
              <th className="px-3 py-1.5 whitespace-nowrap">RESPONSABLE</th>
              <th className="px-3 py-1.5 whitespace-nowrap">ACCIÓN</th>
              <th className="px-3 py-1.5 text-center whitespace-nowrap">PRIORIDAD</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-terminal-gray-dim italic">
                  No results match the current filters
                </td>
              </tr>
            ) : filtered.map((v, i) => {
              const prevMes = i > 0 ? filtered[i - 1].mes : null;
              const showMonthHeader = multiMonth && v.mes !== prevMes;
              return (
              <>
              {showMonthHeader && (
                <tr key={`month-${v.mes}`}>
                  <td colSpan={11} className="px-3 py-1.5 bg-terminal-bg border-y border-terminal-border/60">
                    <span className="text-terminal-cyan font-bold text-xs">── {v.mes}</span>
                    <span className="text-terminal-gray text-xs ml-3">
                      {filtered.filter(r => r.mes === v.mes).length} categories
                    </span>
                  </td>
                </tr>
              )}
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
                <td className="px-3 py-1.5 text-terminal-white whitespace-nowrap text-center">
                  {v.error_type || '—'}
                </td>
                <td className="px-3 py-1.5 text-terminal-gray whitespace-nowrap">
                  {v.responsable || '—'}
                </td>
                <td className="px-3 py-1.5 text-terminal-gray-dim max-w-xs truncate" title={v.accion || ''}>
                  {v.accion || '—'}
                </td>
                <td className="px-3 py-1.5 text-center whitespace-nowrap">
                  {v.prioridad && v.prioridad !== '—' ? (
                    <span className={`px-1.5 py-0.5 border rounded text-xs font-bold ${PRIORIDAD_STYLES[v.prioridad] ?? ''}`}>
                      {v.prioridad}
                    </span>
                  ) : (
                    <span className="text-terminal-gray-dim">—</span>
                  )}
                </td>
              </tr>
              </>
            );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

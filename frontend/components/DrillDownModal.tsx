'use client';

import { useEffect, useState } from 'react';
import type { ControlVariance, ControlDrillDown, DrillDownTx } from '@/lib/types';
import { fetchControlDrilldown } from '@/lib/api';

interface Props {
  runId: string;
  variance: ControlVariance;
  onClose: () => void;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function TxList({ txs, source }: { txs: DrillDownTx[]; source: 'banco' | 'caja' }) {
  const total = txs.reduce((s, t) => s + t.importe, 0);
  const color = source === 'banco' ? 'text-terminal-cyan' : 'text-terminal-amber';
  const label = source === 'banco' ? 'BANCO' : 'CAJA DIGITAL';

  return (
    <div className="flex flex-col min-h-0">
      <div className={`text-xs font-bold mb-2 pb-1 border-b border-terminal-border ${color}`}>
        {label} — {txs.length} movimientos
      </div>
      <div className="overflow-y-auto flex-1 max-h-72 space-y-0.5 pr-1">
        {txs.length === 0 ? (
          <div className="text-terminal-gray-dim italic py-4 text-center">
            Sin movimientos en esta fuente
          </div>
        ) : (
          txs.map((tx, i) => (
            <div
              key={i}
              className="flex items-start gap-2 py-1 border-b border-terminal-border/20 text-xs"
            >
              <span className="text-terminal-gray shrink-0 w-20">{tx.fecha ?? '—'}</span>
              <span className="text-terminal-white flex-1 truncate" title={tx.descripcion}>
                {tx.descripcion || '—'}
              </span>
              {tx.empresa && (
                <span className="text-terminal-gray shrink-0 hidden lg:block text-xs">
                  {tx.empresa}
                </span>
              )}
              <span className={`shrink-0 tabular-nums ${tx.importe < 0 ? 'text-terminal-red' : 'text-terminal-green'}`}>
                {fmt(tx.importe)}
              </span>
            </div>
          ))
        )}
      </div>
      <div className={`mt-2 pt-1.5 border-t border-terminal-border flex justify-between font-bold text-xs ${color}`}>
        <span>SUBTOTAL</span>
        <span className="tabular-nums">{fmt(total)}</span>
      </div>
    </div>
  );
}

const ESTADO_COLOR: Record<string, string> = {
  OK:       'text-terminal-green border-terminal-green',
  ALERT:    'text-terminal-amber border-terminal-amber',
  CRITICAL: 'text-terminal-red   border-terminal-red',
};

export default function DrillDownModal({ runId, variance, onClose }: Props) {
  const [data, setData] = useState<ControlDrillDown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchControlDrilldown(runId, variance.mes, variance.categoria)
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [runId, variance.mes, variance.categoria]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-5xl bg-terminal-bg border border-terminal-border rounded font-mono text-xs flex flex-col max-h-[90vh]">
        {/* Modal header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-terminal-cyan font-bold text-sm">{variance.categoria}</span>
            <span className="text-terminal-gray">·</span>
            <span className="text-terminal-gray">{variance.mes}</span>
            <span className={`px-2 py-0.5 border rounded font-bold ${ESTADO_COLOR[variance.estado]}`}>
              {variance.estado}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-terminal-gray hover:text-terminal-white transition-colors px-2"
          >
            ✕ ESC
          </button>
        </div>

        {/* Variance summary bar */}
        <div className="px-4 py-2 border-b border-terminal-border bg-terminal-bg-secondary shrink-0 flex flex-wrap gap-6 text-xs">
          <div>
            <span className="text-terminal-gray">Banco  </span>
            <span className="text-terminal-cyan tabular-nums font-bold">{fmt(variance.total_banco)}</span>
          </div>
          <div>
            <span className="text-terminal-gray">Caja Dir  </span>
            <span className="text-terminal-amber tabular-nums font-bold">{fmt(variance.total_caja)}</span>
          </div>
          <div>
            <span className="text-terminal-gray">Diferencia  </span>
            <span className={`tabular-nums font-bold ${variance.diferencia < 0 ? 'text-terminal-red' : 'text-terminal-green'}`}>
              {fmt(variance.diferencia)}
            </span>
          </div>
          <div>
            <span className="text-terminal-gray">Varianza  </span>
            <span className={`tabular-nums font-bold ${ESTADO_COLOR[variance.estado]}`}>
              {variance.varianza_pct.toFixed(2)}%
            </span>
          </div>
          <div>
            <span className="text-terminal-gray">Origen  </span>
            <span className="text-terminal-white">{variance.origen}</span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 p-4">
          {loading && (
            <div className="text-terminal-gray text-center py-8">
              loading transactions...
            </div>
          )}
          {error && (
            <div className="text-terminal-red text-center py-8">
              ✗ {error}
            </div>
          )}
          {data && !loading && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
              <TxList txs={data.caja} source="caja" />
              <TxList txs={data.banco} source="banco" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

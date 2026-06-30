'use client';

import { useMemo } from 'react';
import type { ControlVariance } from '@/lib/types';

interface Props {
  variances: ControlVariance[];
  onRowClick: (v: ControlVariance) => void;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function MonthGroup({
  mes,
  items,
  amountField,
  onRowClick,
}: {
  mes: string;
  items: ControlVariance[];
  amountField: 'total_banco' | 'total_caja';
  onRowClick: (v: ControlVariance) => void;
}) {
  const total = items.reduce((s, v) => s + v[amountField], 0);

  return (
    <div className="mb-1">
      <div className="flex items-center justify-between px-3 py-1 bg-terminal-bg border-b border-terminal-border/30">
        <span className="text-terminal-cyan text-xs font-bold">{mes}</span>
        <span className="text-terminal-gray text-xs">{items.length} cat.</span>
      </div>
      {items.map((v, i) => (
        <div
          key={`${v.mes}-${v.categoria}-${i}`}
          onClick={() => onRowClick(v)}
          className="flex items-center justify-between px-3 py-1.5 border-b border-terminal-border/20 hover:bg-terminal-red/5 cursor-pointer transition-colors"
        >
          <span className="text-terminal-white text-xs">{v.categoria}</span>
          <span className={`text-xs tabular-nums ${v[amountField] < 0 ? 'text-terminal-red' : 'text-terminal-green'}`}>
            {fmt(v[amountField])}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between px-3 py-1 bg-terminal-bg/50 border-b border-terminal-border/30">
        <span className="text-terminal-gray text-xs">subtotal {mes}</span>
        <span className={`text-xs font-bold tabular-nums ${total < 0 ? 'text-terminal-red' : 'text-terminal-green'}`}>
          {fmt(total)}
        </span>
      </div>
    </div>
  );
}

function SourceGroup({
  label,
  items,
  amountField,
  onRowClick,
}: {
  label: string;
  items: ControlVariance[];
  amountField: 'total_banco' | 'total_caja';
  onRowClick: (v: ControlVariance) => void;
}) {
  if (items.length === 0) return null;
  const total = items.reduce((s, v) => s + v[amountField], 0);

  const byMonth = useMemo(() => {
    const map = new Map<string, ControlVariance[]>();
    for (const v of items) {
      if (!map.has(v.mes)) map.set(v.mes, []);
      map.get(v.mes)!.push(v);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const multiMonth = byMonth.length > 1;

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-1.5 bg-terminal-red/10 border-b border-terminal-red/30">
        <span className="text-terminal-red font-bold text-xs">{label}</span>
        <span className="text-terminal-red text-xs tabular-nums">{items.length} categorías</span>
      </div>

      {multiMonth ? (
        byMonth.map(([mes, rows]) => (
          <MonthGroup
            key={mes}
            mes={mes}
            items={rows}
            amountField={amountField}
            onRowClick={onRowClick}
          />
        ))
      ) : (
        items.map((v, i) => (
          <div
            key={`${v.mes}-${v.categoria}-${i}`}
            onClick={() => onRowClick(v)}
            className="flex items-center justify-between px-3 py-1.5 border-b border-terminal-border/20 hover:bg-terminal-red/5 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-terminal-gray text-xs w-16 shrink-0">{v.mes}</span>
              <span className="text-terminal-white text-xs">{v.categoria}</span>
            </div>
            <span className={`text-xs tabular-nums ${v[amountField] < 0 ? 'text-terminal-red' : 'text-terminal-green'}`}>
              {fmt(v[amountField])}
            </span>
          </div>
        ))
      )}

      <div className="flex items-center justify-between px-3 py-1.5 bg-terminal-bg border-t border-terminal-border/40">
        <span className="text-terminal-gray text-xs">SUBTOTAL</span>
        <span className={`text-xs font-bold tabular-nums ${total < 0 ? 'text-terminal-red' : 'text-terminal-green'}`}>
          {fmt(total)}
        </span>
      </div>
    </div>
  );
}

export default function MissingCategoriesPanel({ variances, onRowClick }: Props) {
  const bankOnly = variances.filter(v => v.origen === 'BANCO');
  const cajaOnly = variances.filter(v => v.origen === 'CAJA');
  const total = bankOnly.length + cajaOnly.length;

  if (total === 0) return null;

  return (
    <div className="border border-terminal-red/50 rounded bg-terminal-bg-secondary font-mono text-xs overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-terminal-red/50 bg-terminal-red/5">
        <span className="text-terminal-red font-bold">
          ✗ MISSING CATEGORIES — {total} categories only in one source
        </span>
        <span className="text-terminal-gray text-xs">click row to drill down</span>
      </div>

      <SourceGroup
        label="BANK ONLY — exists in bank, missing from Caja Digital"
        items={bankOnly}
        amountField="total_banco"
        onRowClick={onRowClick}
      />
      <SourceGroup
        label="CAJA ONLY — exists in Caja Digital, missing from bank"
        items={cajaOnly}
        amountField="total_caja"
        onRowClick={onRowClick}
      />
    </div>
  );
}

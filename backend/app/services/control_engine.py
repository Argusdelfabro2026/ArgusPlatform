# app/services/control_engine.py
# Cross-matches bank categorized transactions vs Caja Digital records
# by (month, category), producing a signed variance report.
#
# Amounts are SIGNED: positive = income, negative = expense.
# Variance % = |diff| / max(|caja|, |banco|) * 100
#
# Classification rules (tickets #1 + #2):
#   Category only in one source              → CRITICAL
#   Category in both, variance  > 25%        → CRITICAL
#   Category in both, 10% < variance <= 25%  → ALERT
#   Category in both, variance <= 10%        → OK

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Dict, List, Optional, Tuple

from app.models import Transaction

logger = logging.getLogger("argus.control")

_ALERT_PCT    = 10.0
_CRITICAL_PCT = 25.0


@dataclass
class ControlVariance:
    mes: str              # "2026-05"
    categoria: str
    total_banco: float    # signed sum of importe_neto from bank
    total_caja: float     # signed sum of importe2 from Caja Digital
    diferencia: float     # caja − banco
    varianza_pct: float   # |diff| / max(|caja|, |banco|) × 100
    estado: str           # "OK" | "ALERT" | "CRITICAL"
    origen: str           # "BANCO" | "CAJA" | "AMBOS"


def _month_key(d: Optional[date]) -> str:
    return d.strftime("%Y-%m") if d else "SIN FECHA"


def _variance_pct(total_banco: float, total_caja: float, diferencia: float) -> float:
    base = max(abs(total_banco), abs(total_caja))
    if base == 0:
        return 0.0
    return round(abs(diferencia) / base * 100, 2)


def run_control(
    bank_transactions: List[Transaction],
    caja_rows: List[dict],
) -> Tuple[List[ControlVariance], Dict[tuple, dict]]:
    """
    Build monthly category pivots from both sources and compute signed variances.

    Bank side   : sum of importe_neto (signed) per (month, Cat. Nombre)
    Caja side   : sum of importe2     (signed) per (month, TIPO stripped)
    Category match: literal uppercase comparison after stripping whitespace.

    Returns (variances, drilldown) where drilldown maps (mes, cat) →
    {"banco": [...tx dicts], "caja": [...tx dicts]} for the detail view.
    """
    drilldown: dict = defaultdict(lambda: {"banco": [], "caja": []})

    # ── Bank pivot: (month, CATEGORY) → sum importe_neto (signed) ───────────
    bank_pivot: dict = defaultdict(float)
    for tx in bank_transactions:
        if not tx.categoria_nombre:
            continue
        mes = _month_key(tx.fecha)
        cat = tx.categoria_nombre.strip().upper()
        key = (mes, cat)
        bank_pivot[key] += tx.importe_neto   # signed — no abs()
        drilldown[key]["banco"].append({
            "fecha":      tx.fecha.isoformat() if tx.fecha else None,
            "empresa":    tx.empresa,
            "banco":      tx.banco,
            "descripcion": tx.descripcion,
            "importe":    round(tx.importe_neto, 2),
        })

    # ── Caja pivot: (month, CATEGORY) → sum importe (signed, = importe2) ────
    caja_pivot: dict = defaultdict(float)
    for row in caja_rows:
        cat = (row.get("categoria") or "").strip().upper()
        if not cat:
            continue
        mes = _month_key(row.get("fecha"))
        key = (mes, cat)
        caja_pivot[key] += row.get("importe", 0.0)   # signed — no abs()
        fecha = row.get("fecha")
        drilldown[key]["caja"].append({
            "fecha":      fecha.isoformat() if fecha else None,
            "descripcion": row.get("descripcion", ""),
            "importe":    round(row.get("importe", 0.0), 2),
        })

    # ── Cross-join all (month, category) keys ────────────────────────────────
    all_keys = set(bank_pivot) | set(caja_pivot)
    variances: List[ControlVariance] = []

    for mes, cat in sorted(all_keys):
        total_banco = bank_pivot.get((mes, cat), 0.0)
        total_caja  = caja_pivot.get((mes, cat), 0.0)
        diferencia  = total_caja - total_banco

        in_banco = (mes, cat) in bank_pivot
        in_caja  = (mes, cat) in caja_pivot

        if not in_banco or not in_caja:
            varianza_pct = 100.0
            estado = "CRITICAL"
            origen = "BANCO" if in_banco else "CAJA"
        else:
            varianza_pct = _variance_pct(total_banco, total_caja, diferencia)
            origen = "AMBOS"
            if varianza_pct > _CRITICAL_PCT:
                estado = "CRITICAL"
            elif varianza_pct > _ALERT_PCT:
                estado = "ALERT"
            else:
                estado = "OK"

        variances.append(
            ControlVariance(
                mes=mes,
                categoria=cat,
                total_banco=round(total_banco, 2),
                total_caja=round(total_caja, 2),
                diferencia=round(diferencia, 2),
                varianza_pct=varianza_pct,
                estado=estado,
                origen=origen,
            )
        )

    critical = sum(1 for v in variances if v.estado == "CRITICAL")
    alert    = sum(1 for v in variances if v.estado == "ALERT")
    ok       = sum(1 for v in variances if v.estado == "OK")
    logger.info(
        f"Control — {ok} OK, {alert} ALERT, {critical} CRITICAL "
        f"({len(variances)} total)"
    )
    return variances, dict(drilldown)

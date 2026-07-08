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
    error_type: str = ""  # classification from _classify_error()
    responsable: str = "" # responsible party
    accion: str = ""      # suggested corrective action
    prioridad: str = ""   # LOW | MEDIUM | HIGH | CRITICAL


def _classify_error(
    origen: str,
    estado: str,
    varianza_pct: float,
    total_banco: float,
    total_caja: float,
    banco_txs: list,
    caja_txs: list,
) -> tuple:
    """Return (error_type, responsable, accion, prioridad) for a variance entry."""
    if estado == "OK":
        return ("—", "—", "—", "—")

    if origen == "BANCO":
        return (
            "Missing in Caja",
            "Emiliano",
            "Review Emiliano bank categorization",
            "CRITICAL",
        )
    if origen == "CAJA":
        return (
            "Missing in Bank",
            "André",
            "Correct André Caja Direction entry",
            "CRITICAL",
        )

    # AMBOS with variance — heuristic sub-classification
    abs_banco = abs(total_banco)
    abs_caja  = abs(total_caja)

    # Duplicate entry: one total ≈ 2× the other
    if abs_caja > 0:
        ratio = abs_banco / abs_caja
        if 1.8 < ratio < 2.2 or 0.45 < ratio < 0.56:
            return (
                "Duplicate Entry",
                "Sistema / Humano",
                "Deduplication rule needed — audit both sources",
                "HIGH",
            )

    # Split transaction: tx count differs 2×+ but amounts are close (< 15% var)
    bc = len(banco_txs)
    cc = len(caja_txs)
    if bc > 0 and cc > 0:
        count_ratio = max(bc, cc) / min(bc, cc)
        smaller     = min(abs_banco, abs_caja)
        pct_diff    = (abs(total_banco - total_caja) / smaller * 100) if smaller > 0 else 100
        if count_ratio >= 2 and pct_diff < 15:
            return (
                "Split Transaction",
                "Diseño Contable",
                "Consolidate split entries per accounting logic",
                "MEDIUM",
            )

    # Category Mismatch — priority follows estado
    if varianza_pct > _CRITICAL_PCT:
        prioridad = "HIGH"
        accion    = "Unify category mapping dictionary — critical discrepancy"
    elif varianza_pct > _ALERT_PCT:
        prioridad = "MEDIUM"
        accion    = "Review category alignment between sources"
    else:
        prioridad = "LOW"
        accion    = "Monitor — minor category variance"

    return ("Category Mismatch", "Emiliano + André", accion, prioridad)


# ── Mercado Pago Gerencia exclusion rule ─────────────────────────────────────
#
# These transactions are excluded from the Step 2 LINE-BY-LINE comparison
# but still counted in Step 1 monthly aggregate totals.
#
# Rule (ticket #14):
#   empresa or banco contains "Mercado Pago Gerencia" (case-insensitive)
#   AND:
#     Past months   (tx_month < current month) → exclude if cat_code == 25  (VENTAS)
#     Current/future (tx_month >= current month) → exclude if cat_code == 28 (VENTAS ML)

_MP_GERENCIA_KEYWORDS = {"mercado pago gerencia", "fondo azul"}


def _is_mp_gerencia(tx) -> bool:
    haystack = " ".join([
        (tx.empresa or "").lower(),
        (tx.banco   or "").lower(),
        (tx.pestaña or "").lower(),
    ])
    return any(kw in haystack for kw in _MP_GERENCIA_KEYWORDS)


def _is_excluded_from_control(tx, current_month: str) -> bool:
    """Return True if this bank tx should be excluded from Step 2 comparison."""
    if not _is_mp_gerencia(tx):
        return False
    tx_month = _month_key(tx.fecha)
    if tx_month < current_month and tx.categoria_codigo == 25:
        return True
    if tx_month >= current_month and tx.categoria_codigo == 28:
        return True
    return False


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
) -> Tuple[List[ControlVariance], Dict[tuple, dict], int]:
    """
    Build monthly category pivots from both sources and compute signed variances.

    Bank side   : sum of importe_neto (signed) per (month, Cat. Nombre)
    Caja side   : sum of importe2     (signed) per (month, TIPO stripped)
    Category match: literal uppercase comparison after stripping whitespace.

    Returns (variances, drilldown) where drilldown maps (mes, cat) →
    {"banco": [...tx dicts], "caja": [...tx dicts]} for the detail view.

    Note: Mercado Pago Gerencia transactions matching ticket #14 exclusion
    rules are skipped from bank_pivot but still exist in bank_transactions
    (Step 1 totals are unaffected).
    """
    drilldown: dict = defaultdict(lambda: {"banco": [], "caja": []})

    # ── Bank pivot: (month, CATEGORY) → sum importe_neto (signed) ───────────
    current_month = date.today().strftime("%Y-%m")
    bank_pivot: dict = defaultdict(float)
    excluded_count = 0
    for tx in bank_transactions:
        if not tx.categoria_nombre:
            continue
        mes = _month_key(tx.fecha)
        cat = tx.categoria_nombre.strip().upper()
        key = (mes, cat)

        if _is_excluded_from_control(tx, current_month):
            excluded_count += 1
            logger.debug(
                f"Excluded from control: {tx.empresa} | {tx.banco} | "
                f"cat={tx.categoria_codigo} | {mes} | {tx.importe_neto}"
            )
            continue

        bank_pivot[key] += tx.importe_neto   # signed — no abs()
        drilldown[key]["banco"].append({
            "fecha":        tx.fecha.isoformat() if tx.fecha else None,
            "empresa":      tx.empresa,
            "banco":        tx.banco,
            "descripcion":  tx.descripcion,
            "referencia":   tx.nro_referencia or "",
            "importe":      round(tx.importe_neto, 2),
        })

    if excluded_count:
        logger.info(
            f"Mercado Pago Gerencia exclusion rule: {excluded_count} bank transactions "
            f"excluded from Step 2 comparison (still in Step 1 totals)"
        )

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

        dd_key = (mes, cat)
        error_type, responsable, accion, prioridad = _classify_error(
            origen=origen,
            estado=estado,
            varianza_pct=varianza_pct,
            total_banco=total_banco,
            total_caja=total_caja,
            banco_txs=drilldown[dd_key]["banco"],
            caja_txs=drilldown[dd_key]["caja"],
        )

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
                error_type=error_type,
                responsable=responsable,
                accion=accion,
                prioridad=prioridad,
            )
        )

    critical = sum(1 for v in variances if v.estado == "CRITICAL")
    alert    = sum(1 for v in variances if v.estado == "ALERT")
    ok       = sum(1 for v in variances if v.estado == "OK")
    logger.info(
        f"Control — {ok} OK, {alert} ALERT, {critical} CRITICAL "
        f"({len(variances)} total) | MP Gerencia excluded: {excluded_count}"
    )
    return variances, dict(drilldown), excluded_count

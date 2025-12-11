from __future__ import annotations

import calendar
from datetime import date

from flask import Blueprint, jsonify, request
from sqlalchemy import case, func
from sqlalchemy.orm import joinedload

from backend.database import db
from backend.models import Invoice, InvoiceStatus

dashboard_bp = Blueprint("dashboard", __name__, url_prefix="/api/dashboard")


def _parse_int(value, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    if minimum is not None:
        parsed = max(parsed, minimum)
    if maximum is not None:
        parsed = min(parsed, maximum)
    return parsed


def _decimal_to_float(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _year_month(args):
    today = date.today()
    year = _parse_int(args.get("year"), today.year, minimum=1900)
    month = args.get("month")
    if month is not None:
        month = _parse_int(month, today.month, minimum=1, maximum=12)
    return year, month


@dashboard_bp.get("/statistics")
def statistics():
    args = request.args
    year, month = _year_month(args)

    filters = [func.strftime("%Y", Invoice.invoice_date) == str(year)]
    if month:
        filters.append(func.strftime("%m", Invoice.invoice_date) == f"{month:02d}")

    totals = (
        db.session.query(
            func.coalesce(func.sum(Invoice.total), 0).label("total_issued"),
            func.coalesce(
                func.sum(
                    case((Invoice.status == InvoiceStatus.PAID, Invoice.total), else_=0)
                ),
                0,
            ).label("total_received"),
            func.coalesce(
                func.sum(
                    case(
                        (Invoice.status.in_([InvoiceStatus.PAID]), 0),
                        else_=Invoice.total,
                    )
                ),
                0,
            ).label("total_unpaid"),
            func.count(Invoice.id).label("invoice_count"),
            func.coalesce(
                func.sum(case((Invoice.status == InvoiceStatus.PAID, 1), else_=0)), 0
            ).label("paid_count"),
            func.coalesce(
                func.sum(
                    case((Invoice.status == InvoiceStatus.OVERDUE, 1), else_=0)
                ),
                0,
            ).label("overdue_count"),
            func.coalesce(
                func.sum(
                    case(
                        (Invoice.status.in_([InvoiceStatus.DRAFT, InvoiceStatus.SENT]), 1),
                        else_=0,
                    )
                ),
                0,
            ).label("unpaid_count"),
        )
        .filter(*filters)
        .one()
    )

    (
        total_issued,
        total_received,
        total_unpaid,
        invoice_count,
        paid_count,
        overdue_count,
        unpaid_count,
    ) = totals

    return jsonify(
        {
            "year": year,
            "month": month,
            "total_issued": _decimal_to_float(total_issued),
            "total_received": _decimal_to_float(total_received),
            "total_unpaid": _decimal_to_float(total_unpaid),
            "net_profit": _decimal_to_float(total_received),
            "invoice_count": int(invoice_count or 0),
            "paid_count": int(paid_count or 0),
            "unpaid_count": int(unpaid_count or 0),
            "overdue_count": int(overdue_count or 0),
        }
    )


@dashboard_bp.get("/monthly-data")
def monthly_data():
    args = request.args
    today = date.today()
    year = _parse_int(args.get("year"), today.year, minimum=1900)

    month_label = func.strftime("%m", Invoice.invoice_date).label("month")
    rows = (
        db.session.query(
            month_label,
            func.coalesce(func.sum(Invoice.total), 0).label("total_issued"),
            func.coalesce(
                func.sum(case((Invoice.status == InvoiceStatus.PAID, Invoice.total), else_=0)), 0
            ).label("total_received"),
            func.coalesce(
                func.sum(
                    case(
                        (Invoice.status.in_([InvoiceStatus.PAID]), 0),
                        else_=Invoice.total,
                    )
                ),
                0,
            ).label("total_unpaid"),
            func.count(Invoice.id).label("invoice_count"),
        )
        .filter(func.strftime("%Y", Invoice.invoice_date) == str(year))
        .group_by(month_label)
        .all()
    )

    monthly = {
        int(r.month): {
            "month": int(r.month),
            "month_name": calendar.month_name[int(r.month)],
            "total_issued": _decimal_to_float(r.total_issued),
            "total_received": _decimal_to_float(r.total_received),
            "total_unpaid": _decimal_to_float(r.total_unpaid),
            "invoice_count": int(r.invoice_count or 0),
        }
        for r in rows
    }

    data = []
    for m in range(1, 13):
        data.append(
            monthly.get(
                m,
                {
                    "month": m,
                    "month_name": calendar.month_name[m],
                    "total_issued": 0.0,
                    "total_received": 0.0,
                    "total_unpaid": 0.0,
                    "invoice_count": 0,
                },
            )
        )

    return jsonify({"year": year, "months": data})


@dashboard_bp.get("/recent-activity")
def recent_activity():
    invoices = (
        Invoice.query.options(joinedload(Invoice.client))
        .order_by(Invoice.invoice_date.desc(), Invoice.id.desc())
        .limit(10)
        .all()
    )

    return jsonify(
        [
            {
                "id": inv.id,
                "number": inv.number,
                "client_name": inv.client.company_name if inv.client else None,
                "invoice_date": inv.invoice_date.isoformat() if inv.invoice_date else None,
                "status": inv.status.value if isinstance(inv.status, InvoiceStatus) else inv.status,
                "amount": _decimal_to_float(inv.total),
            }
            for inv in invoices
        ]
    )


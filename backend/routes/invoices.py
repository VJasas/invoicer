from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Iterable

from flask import Blueprint, jsonify, request, send_file
from sqlalchemy import and_, case, func
from sqlalchemy.orm import joinedload

from backend.database import db
from backend.models import (
    Client,
    CompanyInfo,
    Invoice,
    InvoiceItem,
    InvoiceSeries,
    InvoiceStatus,
)
from backend.utils.number_to_words import amount_to_lithuanian_words, number_to_words_lt
from backend.utils.pdf_generator import generate_invoice_pdf

invoices_bp = Blueprint("invoices", __name__, url_prefix="/api/invoices")

DEFAULT_LIMIT = 20
MAX_LIMIT = 100


# ------------ helpers ------------
def _error(message: str, status_code: int = 400):
    return jsonify({"error": message}), status_code


def _parse_int(value, default: int, *, minimum: int = 0, maximum: int | None = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    parsed = max(parsed, minimum)
    if maximum is not None:
        parsed = min(parsed, maximum)
    return parsed


def _parse_bool(value) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    value_str = str(value).strip().lower()
    return value_str in {"1", "true", "yes", "y", "on"}


def _parse_date(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value)).date()
    except ValueError:
        return None


def _parse_status(value) -> InvoiceStatus | None:
    if value is None:
        return None
    if isinstance(value, InvoiceStatus):
        return value
    value_str = str(value).lower()
    for status in InvoiceStatus:
        if status.value == value_str:
            return status
    return None


def _normalize_status(value) -> InvoiceStatus | None:
    return value if isinstance(value, InvoiceStatus) else _parse_status(value)


def _is_overdue(invoice: Invoice) -> bool:
    due_date = invoice.due_date
    if not due_date:
        return False
    normalized = _normalize_status(invoice.status)
    if normalized == InvoiceStatus.PAID:
        return False
    return due_date < date.today()


def _refresh_overdue_statuses():
    """Persist overdue status for invoices whose due date has passed and are not paid."""
    today = date.today()
    updated = (
        Invoice.query.filter(
            Invoice.due_date < today,
            Invoice.status != InvoiceStatus.PAID,
            Invoice.status != InvoiceStatus.OVERDUE,
        ).update({Invoice.status: InvoiceStatus.OVERDUE}, synchronize_session=False)
    )
    if updated:
        db.session.commit()


def _decimal_to_float(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _safe_decimal(value, default: Decimal = Decimal("0")) -> Decimal:
    if value is None:
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return default


def _serialize_item(item: InvoiceItem) -> dict:
    return {
        "id": item.id,
        "description": item.description,
        "quantity": _decimal_to_float(item.quantity),
        "unit": item.unit,
        "unit_price": _decimal_to_float(item.unit_price),
        "discount_percent": _decimal_to_float(item.discount_percent),
        "line_total": _decimal_to_float(item.line_total),
        "sort_order": item.sort_order,
    }


def _serialize_invoice_summary(invoice: Invoice) -> dict:
    status_value = invoice.status.value if isinstance(invoice.status, InvoiceStatus) else invoice.status
    return {
        "id": invoice.id,
        "number": invoice.number,
        "invoice_number": invoice.invoice_number,
        "full_invoice_number": invoice.number,
        "series_id": invoice.series_id,
        "series_code": invoice.series.series_code if invoice.series else None,
        "client_id": invoice.client_id,
        "client_name": invoice.client.company_name if invoice.client else None,
        "invoice_date": invoice.invoice_date.isoformat() if invoice.invoice_date else None,
        "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
        "status": status_value,
        "is_overdue": _is_overdue(invoice),
        "total": _decimal_to_float(invoice.total),
        "created_at": invoice.created_at.isoformat() if invoice.created_at else None,
    }


def _serialize_invoice_full(invoice: Invoice) -> dict:
    status_value = invoice.status.value if isinstance(invoice.status, InvoiceStatus) else invoice.status
    client_payload = invoice.client.as_dict() if invoice.client else None
    if client_payload and "name" not in client_payload:
        client_payload["name"] = invoice.client.company_name

    series_payload = (
        {
            "id": invoice.series.id,
            "series_code": invoice.series.series_code,
            "description": invoice.series.description,
            "current_number": invoice.series.current_number,
            "is_active": invoice.series.is_active,
        }
        if invoice.series
        else None
    )

    return {
        "id": invoice.id,
        "number": invoice.number,
        "invoice_number": invoice.invoice_number,
        "full_invoice_number": invoice.number,
        "series_id": invoice.series_id,
        "series_code": invoice.series.series_code if invoice.series else None,
        "client_id": invoice.client_id,
        "client": client_payload,
        "series": series_payload,
        "invoice_date": invoice.invoice_date.isoformat() if invoice.invoice_date else None,
        "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
        "status": status_value,
        "is_overdue": _is_overdue(invoice),
        "exclude_vat": invoice.exclude_vat,
        "subtotal": _decimal_to_float(invoice.subtotal),
        "vat_amount": _decimal_to_float(invoice.vat_amount),
        "discount_amount": _decimal_to_float(invoice.discount_amount),
        "total": _decimal_to_float(invoice.total),
        "total_in_words": invoice.total_in_words,
        "notes": invoice.notes,
        "issued_by": invoice.issued_by,
        "received_by": invoice.received_by,
        "items": [_serialize_item(item) for item in sorted(invoice.items, key=lambda i: i.sort_order or 0)],
        "created_at": invoice.created_at.isoformat() if invoice.created_at else None,
        "updated_at": invoice.updated_at.isoformat() if invoice.updated_at else None,
    }


def _validate_required(payload: dict, keys: Iterable[str]) -> list[str]:
    return [key for key in keys if not payload.get(key)]


def _require_not_paid(invoice: Invoice):
    status_value = _normalize_status(invoice.status)
    if status_value == InvoiceStatus.PAID:
        return _error("Paid invoices cannot be modified.", 409)
    return None


def _assign_series_and_number(invoice: Invoice, series: InvoiceSeries):
    if invoice not in db.session:
        db.session.add(invoice)
    invoice.set_series_and_number(series)
    # Ensure DB sees the allocated number before commit to avoid uniqueness surprises.
    db.session.flush()


def _set_total_in_words(invoice: Invoice):
    # Use full amount (euros + cents) in words; fall back to integer-only helper on error.
    try:
        amount = invoice.total if invoice.total is not None else Decimal("0")
        invoice.total_in_words = amount_to_lithuanian_words(amount)
    except Exception:
        integer_total = int(_decimal_to_float(invoice.total))
        invoice.total_in_words = number_to_words_lt(integer_total)


def _select_default_bank_account(company: CompanyInfo | None):
    if not company or not company.bank_accounts:
        return None
    default = next((acc for acc in company.bank_accounts if acc.is_default), None)
    return default or company.bank_accounts[0]


def _invoice_to_pdf_payload(invoice: Invoice) -> dict:
    company = CompanyInfo.get_singleton()
    bank_account = _select_default_bank_account(company)

    seller = {
        "name": company.company_name if company else "",
        "tax_id": company.tax_id if company else "",
        "address": company.address if company else "",
        "phone": company.phone if company else "",
        "email": company.email if company else "",
        "bank_account": bank_account.account_number if bank_account else "",
    }

    client = invoice.client
    buyer = {
        "company_name": client.company_name if client else "",
        "code": client.registration_code if client else "",
        "vat_code": client.vat_code or "",
        "address": client.address if client else "",
        "phone": client.phone or "",
        "email": client.email or "",
    }

    items = [
        {
            "description": item.description,
            "quantity": item.quantity,
            "unit": item.unit,
            "unit_price": item.unit_price,
            "line_total": item.line_total,
        }
        for item in invoice.items
    ]

    total_in_words = invoice.total_in_words
    if not total_in_words:
        try:
            total_in_words = amount_to_lithuanian_words(invoice.total if invoice.total is not None else 0)
        except Exception:
            total_in_words = number_to_words_lt(int(_decimal_to_float(invoice.total)))

    return {
        "series_code": invoice.series.series_code if invoice.series else "",
        "invoice_number": invoice.invoice_number,
        "invoice_date": invoice.invoice_date,
        "due_date": invoice.due_date,
        "seller": seller,
        "buyer": buyer,
        "items": items,
        "total": invoice.total,
        "total_in_words": total_in_words,
        "issued_by": invoice.issued_by,
        "received_by": invoice.received_by,
    }


def _hydrate_items(invoice: Invoice, items_payload: list[dict]):
    if not isinstance(items_payload, list):
        raise ValueError("Items must be a list.")
    invoice.items.clear()
    for idx, item in enumerate(items_payload):
        description = item.get("description")
        if not description:
            raise ValueError("Item description is required.")
        quantity = _safe_decimal(item.get("quantity"), Decimal("1"))
        unit_price = _safe_decimal(item.get("unit_price"), Decimal("0"))
        discount_percent = _safe_decimal(item.get("discount_percent"), Decimal("0"))
        if quantity < 0 or unit_price < 0:
            raise ValueError("Quantity and unit_price must be non-negative.")
        if discount_percent < 0 or discount_percent > Decimal("100"):
            raise ValueError("discount_percent must be between 0 and 100.")
        sort_order = item.get("sort_order")
        try:
            sort_order = int(sort_order) if sort_order is not None else idx
        except (TypeError, ValueError):
            sort_order = idx

        invoice.items.append(
            InvoiceItem(
                description=description,
                quantity=quantity,
                unit=item.get("unit") or "vnt",
                unit_price=unit_price,
                discount_percent=discount_percent,
                sort_order=sort_order,
            )
        )


def _recalculate_totals(invoice: Invoice, *, vat_rate=None):
    vat_rate_decimal = _safe_decimal(vat_rate, Decimal("0"))
    invoice.recalculate_totals(vat_rate_decimal)
    _set_total_in_words(invoice)


def _apply_filters(query, *, status, client_id, series_id, date_from, date_to):
    filters = []
    if status:
        filters.append(Invoice.status == status)
    if client_id is not None:
        filters.append(Invoice.client_id == client_id)
    if series_id is not None:
        filters.append(Invoice.series_id == series_id)
    if date_from:
        filters.append(Invoice.invoice_date >= date_from)
    if date_to:
        filters.append(Invoice.invoice_date <= date_to)
    if filters:
        query = query.filter(and_(*filters))
    return query, filters


# ------------ routes ------------
@invoices_bp.get("/")
def list_invoices():
    args = request.args

    _refresh_overdue_statuses()

    limit = _parse_int(args.get("limit"), DEFAULT_LIMIT, minimum=1, maximum=MAX_LIMIT)
    offset = _parse_int(args.get("offset"), 0, minimum=0)
    page = offset // limit + 1 if limit else 1

    status_param = args.get("status")
    status = _parse_status(status_param) if status_param else None
    if status_param and status is None:
        return _error("Invalid status. Allowed: draft, sent, paid, overdue.")

    client_id = args.get("client_id")
    series_id = args.get("series_id")
    client_id = int(client_id) if client_id is not None and str(client_id).isdigit() else None
    series_id = int(series_id) if series_id is not None and str(series_id).isdigit() else None

    date_from_raw = args.get("date_from")
    date_to_raw = args.get("date_to")
    date_from = _parse_date(date_from_raw) if date_from_raw else None
    date_to = _parse_date(date_to_raw) if date_to_raw else None
    if date_from_raw and date_from is None:
        return _error("Invalid date_from. Use ISO format (YYYY-MM-DD).")
    if date_to_raw and date_to is None:
        return _error("Invalid date_to. Use ISO format (YYYY-MM-DD).")

    base_query = Invoice.query.options(joinedload(Invoice.client), joinedload(Invoice.series))
    base_query, filters = _apply_filters(
        base_query, status=status, client_id=client_id, series_id=series_id, date_from=date_from, date_to=date_to
    )

    total = base_query.count()

    summary_query = db.session.query(
        func.count(Invoice.id),
        func.coalesce(func.sum(Invoice.total), 0),
        func.coalesce(func.sum(case((Invoice.status == InvoiceStatus.PAID, Invoice.total), else_=0)), 0),
    )
    if filters:
        summary_query = summary_query.filter(and_(*filters))
    invoice_count, total_invoiced, total_paid = summary_query.one()
    total_invoiced_f = _decimal_to_float(total_invoiced)
    total_paid_f = _decimal_to_float(total_paid)
    summary = {
        "invoice_count": int(invoice_count or 0),
        "total_invoiced": total_invoiced_f,
        "total_paid": total_paid_f,
        "total_unpaid": max(total_invoiced_f - total_paid_f, 0.0),
    }

    sort_param = args.get("sort_by", "-date")
    descending = sort_param.startswith("-")
    sort_key = sort_param[1:] if descending else sort_param
    sort_map = {
        "date": Invoice.invoice_date,
        "number": Invoice.invoice_number,
        "total": Invoice.total,
        "status": Invoice.status,
    }
    sort_column = sort_map.get(sort_key)
    if sort_column is None:
        return _error("Invalid sort_by. Allowed: date, number, total, status.")
    sort_column = sort_column.desc() if descending else sort_column.asc()

    invoices = (
        base_query.order_by(sort_column, Invoice.id.desc()).offset(offset).limit(limit).all()
    )

    return jsonify({"invoices": [_serialize_invoice_summary(inv) for inv in invoices], "total": total, "page": page, "summary": summary})


@invoices_bp.get("/<int:invoice_id>")
def get_invoice(invoice_id: int):
    _refresh_overdue_statuses()

    invoice = Invoice.query.options(
        joinedload(Invoice.items), joinedload(Invoice.client), joinedload(Invoice.series)
    ).get_or_404(invoice_id)
    return jsonify(_serialize_invoice_full(invoice))


@invoices_bp.post("/")
def create_invoice():
    payload = request.get_json(force=True) or {}
    missing = _validate_required(payload, ["client_id", "series_id"])
    if missing:
        return _error(f"Missing required fields: {', '.join(missing)}.")

    client = Client.query.get(payload.get("client_id"))
    if client is None:
        return _error("Client not found.", 404)

    series = InvoiceSeries.query.get(payload.get("series_id"))
    if series is None:
        return _error("Series not found.", 404)

    invoice_date_raw = payload.get("invoice_date")
    invoice_date = _parse_date(invoice_date_raw)
    if invoice_date_raw and invoice_date is None:
        return _error("Invalid invoice_date. Use ISO format (YYYY-MM-DD).")
    if invoice_date is None:
        invoice_date = date.today()

    due_date_raw = payload.get("due_date")
    due_date = _parse_date(due_date_raw)
    if due_date_raw and due_date is None:
        return _error("Invalid due_date. Use ISO format (YYYY-MM-DD).")
    if due_date is None:
        due_date = invoice_date
    if due_date < invoice_date:
        return _error("Due date cannot be earlier than invoice date.")

    status_param = payload.get("status")
    status = _parse_status(status_param) if status_param else InvoiceStatus.DRAFT
    if status_param and status is None:
        return _error("Invalid status. Allowed: draft, sent, paid, overdue.")

    invoice = Invoice(
        client=client,
        series=series,
        invoice_date=invoice_date,
        due_date=due_date,
        status=status,
        notes=payload.get("notes"),
        exclude_vat=_parse_bool(payload.get("exclude_vat")),
    )

    try:
        _assign_series_and_number(invoice, series)
        _hydrate_items(invoice, payload.get("items") or [])
        _recalculate_totals(invoice, vat_rate=payload.get("vat_rate"))
        db.session.add(invoice)
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return _error(str(exc))
    except Exception:
        db.session.rollback()
        raise

    return jsonify(_serialize_invoice_full(invoice)), 201


@invoices_bp.put("/<int:invoice_id>")
def update_invoice(invoice_id: int):
    invoice = Invoice.query.options(joinedload(Invoice.items)).get_or_404(invoice_id)
    cannot = _require_not_paid(invoice)
    if cannot:
        return cannot

    payload = request.get_json(force=True) or {}
    if "status" in payload:
        return _error("Use the status endpoint to change invoice status.")

    if "client_id" in payload:
        client = Client.query.get(payload.get("client_id"))
        if client is None:
            return _error("Client not found.", 404)
        invoice.client = client

    if "series_id" in payload:
        return _error("Changing series is not supported for existing invoices.")

    invoice_date_raw = payload.get("invoice_date")
    due_date_raw = payload.get("due_date")

    if invoice_date_raw is not None:
        parsed_invoice_date = _parse_date(invoice_date_raw)
        if parsed_invoice_date is None:
            return _error("Invalid invoice_date. Use ISO format (YYYY-MM-DD).")
        invoice.invoice_date = parsed_invoice_date

    if due_date_raw is not None:
        parsed_due_date = _parse_date(due_date_raw)
        if parsed_due_date is None:
            return _error("Invalid due_date. Use ISO format (YYYY-MM-DD).")
        invoice.due_date = parsed_due_date

    if invoice.due_date and invoice.invoice_date and invoice.due_date < invoice.invoice_date:
        return _error("Due date cannot be earlier than invoice date.")

    if "notes" in payload:
        invoice.notes = payload.get("notes")
    if "exclude_vat" in payload:
        invoice.exclude_vat = _parse_bool(payload.get("exclude_vat"))
    if "issued_by" in payload:
        invoice.issued_by = payload.get("issued_by")
    if "received_by" in payload:
        invoice.received_by = payload.get("received_by")

    items_payload = payload.get("items")
    try:
        if items_payload is not None:
            _hydrate_items(invoice, items_payload)
        _recalculate_totals(invoice, vat_rate=payload.get("vat_rate"))
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return _error(str(exc))
    except Exception:
        db.session.rollback()
        raise

    return jsonify(_serialize_invoice_full(invoice))


@invoices_bp.delete("/<int:invoice_id>")
def delete_invoice(invoice_id: int):
    invoice = Invoice.query.get_or_404(invoice_id)
    if _normalize_status(invoice.status) == InvoiceStatus.PAID:
        return _error("Paid invoices cannot be deleted.", 409)

    db.session.delete(invoice)
    db.session.commit()
    return jsonify({"deleted": True, "id": invoice_id})


def _allowed_transition(current: InvoiceStatus, target: InvoiceStatus) -> bool:
    current = _normalize_status(current)
    target = _normalize_status(target)
    if current == target:
        return False
    if target == InvoiceStatus.OVERDUE:
        return True
    if current == InvoiceStatus.DRAFT and target == InvoiceStatus.SENT:
        return True
    if current == InvoiceStatus.SENT and target == InvoiceStatus.PAID:
        return True
    return False


@invoices_bp.patch("/<int:invoice_id>/status")
def update_invoice_status(invoice_id: int):
    invoice = Invoice.query.get_or_404(invoice_id)
    payload = request.get_json(force=True) or {}
    new_status = _parse_status(payload.get("status"))
    if new_status is None:
        return _error("Invalid status. Allowed: draft, sent, paid, overdue.")

    if not _allowed_transition(invoice.status, new_status):
        return _error("Status transition not allowed.", 409)

    invoice.status = new_status
    db.session.commit()
    return jsonify(_serialize_invoice_full(invoice))


@invoices_bp.get("/<int:invoice_id>/pdf")
def invoice_pdf(invoice_id: int):
    invoice = (
        Invoice.query.options(
            joinedload(Invoice.items),
            joinedload(Invoice.client),
            joinedload(Invoice.series),
        ).get_or_404(invoice_id)
    )
    pdf_bytes = generate_invoice_pdf(_invoice_to_pdf_payload(invoice))
    return send_file(
        BytesIO(pdf_bytes),
        mimetype="application/pdf",
        download_name=f"invoice-{invoice.number}.pdf",
    )


@invoices_bp.post("/<int:invoice_id>/duplicate")
def duplicate_invoice(invoice_id: int):
    original = Invoice.query.options(joinedload(Invoice.items)).get_or_404(invoice_id)
    today = date.today()
    due_date = today
    if original.due_date and original.invoice_date:
        due_date = today + (original.due_date - original.invoice_date)

    duplicate = Invoice(
        client=original.client,
        series=original.series,
        invoice_date=today,
        due_date=due_date,
        status=InvoiceStatus.DRAFT,
        notes=original.notes,
        exclude_vat=original.exclude_vat,
        issued_by=original.issued_by,
        received_by=original.received_by,
    )

    try:
        _assign_series_and_number(duplicate, original.series)
        _hydrate_items(
            duplicate,
            [
                {
                    "description": item.description,
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "discount_percent": item.discount_percent,
                    "unit": item.unit,
                    "sort_order": item.sort_order,
                }
                for item in original.items
            ],
        )
        _recalculate_totals(duplicate)
        db.session.add(duplicate)
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return _error(str(exc))
    except Exception:
        db.session.rollback()
        raise

    return jsonify(_serialize_invoice_full(duplicate)), 201


@invoices_bp.get("/next-number/<int:series_id>")
def next_number(series_id: int):
    series = InvoiceSeries.query.get_or_404(series_id)
    next_no = (series.current_number or 0) + 1
    return jsonify(
        {
            "series_code": series.series_code,
            "next_number": next_no,
            "full_number": series.format_full_number(next_no),
        }
    )


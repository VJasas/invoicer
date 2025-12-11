from __future__ import annotations

from datetime import date, datetime

from flask import Blueprint, jsonify, request
from sqlalchemy import and_, case, func, or_

from backend.database import db
from backend.models import Client, ClientType, Invoice, InvoiceStatus

clients_bp = Blueprint("clients", __name__, url_prefix="/api/clients")

DEFAULT_LIMIT = 20
MAX_LIMIT = 100


def _parse_bool(value) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    value_str = str(value).strip().lower()
    return value_str in {"1", "true", "yes", "y", "on"}


def _parse_int(value, default: int, *, minimum: int = 0, maximum: int | None = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    parsed = max(parsed, minimum)
    if maximum is not None:
        parsed = min(parsed, maximum)
    return parsed


def _parse_date(value):
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value)).date()
    except ValueError:
        return None


def _parse_client_type(value) -> ClientType | None:
    if value is None:
        return None
    if isinstance(value, ClientType):
        return value
    value_str = str(value).lower()
    for client_type in ClientType:
        if client_type.value == value_str:
            return client_type
    return None


def _parse_invoice_status(value) -> InvoiceStatus | None:
    if value is None:
        return None
    if isinstance(value, InvoiceStatus):
        return value
    value_str = str(value).lower()
    for status in InvoiceStatus:
        if status.value == value_str:
            return status
    return None


def _error(message: str, status_code: int = 400):
    return jsonify({"error": message}), status_code


def _decimal_to_float(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _serialize_invoice(invoice: Invoice) -> dict:
    status_value = getattr(invoice.status, "value", invoice.status)
    return {
        "id": invoice.id,
        "number": invoice.number,
        "invoice_date": invoice.invoice_date.isoformat() if invoice.invoice_date else None,
        "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
        "status": status_value,
        "total": _decimal_to_float(invoice.total),
        "client_id": invoice.client_id,
        "series_id": invoice.series_id,
        "created_at": invoice.created_at.isoformat() if invoice.created_at else None,
        "updated_at": invoice.updated_at.isoformat() if invoice.updated_at else None,
    }


def _build_client_payload(client: Client, stats: dict) -> dict:
    data = client.as_dict()
    data["name"] = client.company_name  # legacy convenience
    data["created_at"] = client.created_at.isoformat() if client.created_at else None
    data["updated_at"] = client.updated_at.isoformat() if client.updated_at else None
    data.update(stats)
    return data


def _client_statistics(client_id: int) -> dict:
    totals = (
        db.session.query(
            func.coalesce(func.sum(Invoice.total), 0),
            func.coalesce(
                func.sum(case((Invoice.status == InvoiceStatus.PAID, Invoice.total), else_=0)),
                0,
            ),
            func.count(Invoice.id),
            func.coalesce(
                func.sum(case((Invoice.status == InvoiceStatus.PAID, 1), else_=0)),
                0,
            ),
            func.coalesce(
                func.sum(case((Invoice.status == InvoiceStatus.OVERDUE, 1), else_=0)),
                0,
            ),
        )
        .filter(Invoice.client_id == client_id)
        .one()
    )

    total_invoiced, total_paid, invoice_count, paid_invoice_count, overdue_count = totals
    total_invoiced_f = _decimal_to_float(total_invoiced)
    total_paid_f = _decimal_to_float(total_paid)
    total_unpaid_f = max(total_invoiced_f - total_paid_f, 0.0)

    return {
        "invoice_count": int(invoice_count or 0),
        "paid_invoice_count": int(paid_invoice_count or 0),
        "overdue_count": int(overdue_count or 0),
        "total_invoiced": total_invoiced_f,
        "total_paid": total_paid_f,
        "total_unpaid": total_unpaid_f,
    }


@clients_bp.get("/")
def list_clients():
    args = request.args
    limit = _parse_int(args.get("limit"), DEFAULT_LIMIT, minimum=1, maximum=MAX_LIMIT)
    offset = _parse_int(args.get("offset"), 0, minimum=0)
    page = offset // limit + 1 if limit else 1

    search = args.get("search")
    client_type_param = args.get("client_type")
    client_type = _parse_client_type(client_type_param) if client_type_param else None
    if client_type_param and client_type is None:
        return _error("Invalid client_type. Allowed values: client, supplier.")

    filters = []
    if search:
        search_term = f"%{search.lower()}%"
        filters.append(
            or_(
                func.lower(Client.company_name).like(search_term),
                func.lower(Client.registration_code).like(search_term),
                func.lower(Client.vat_code).like(search_term),
                func.lower(Client.email).like(search_term),
                func.lower(Client.phone).like(search_term),
            )
        )
    if client_type:
        filters.append(Client.client_type == client_type)

    base_query = Client.query.filter(and_(*filters)) if filters else Client.query
    total_clients = base_query.count()

    stats_subquery = (
        db.session.query(
            Invoice.client_id.label("client_id"),
            func.count(Invoice.id).label("invoice_count"),
            func.coalesce(func.sum(Invoice.total), 0).label("total_invoiced"),
            func.coalesce(
                func.sum(case((Invoice.status == InvoiceStatus.PAID, Invoice.total), else_=0)),
                0,
            ).label("total_paid"),
        )
        .group_by(Invoice.client_id)
        .subquery()
    )

    query = (
        db.session.query(
            Client,
            func.coalesce(stats_subquery.c.invoice_count, 0).label("invoice_count"),
            func.coalesce(stats_subquery.c.total_invoiced, 0).label("total_invoiced"),
            func.coalesce(stats_subquery.c.total_paid, 0).label("total_paid"),
        )
        .outerjoin(stats_subquery, Client.id == stats_subquery.c.client_id)
    )
    if filters:
        query = query.filter(and_(*filters))

    sort_param = args.get("sort_by", "-created_at")
    descending = sort_param.startswith("-")
    sort_key = sort_param[1:] if descending else sort_param
    sort_map = {
        "name": Client.company_name,
        "company_name": Client.company_name,
        "created_at": Client.created_at,
        "invoice_count": func.coalesce(stats_subquery.c.invoice_count, 0),
        "total_invoiced": func.coalesce(stats_subquery.c.total_invoiced, 0),
        "total_paid": func.coalesce(stats_subquery.c.total_paid, 0),
        "total_unpaid": func.coalesce(stats_subquery.c.total_invoiced, 0)
        - func.coalesce(stats_subquery.c.total_paid, 0),
    }
    sort_column = sort_map.get(sort_key)
    if sort_column is None:
        return _error(
            "Invalid sort_by. Allowed: name, created_at, invoice_count, total_invoiced, total_paid, total_unpaid."
        )
    sort_column = sort_column.desc() if descending else sort_column.asc()
    query = query.order_by(sort_column, Client.id.desc())

    rows = query.offset(offset).limit(limit).all()

    clients = []
    for client, invoice_count, total_invoiced, total_paid in rows:
        stats = {
            "invoice_count": int(invoice_count or 0),
            "total_invoiced": _decimal_to_float(total_invoiced),
            "total_paid": _decimal_to_float(total_paid),
        }
        stats["total_unpaid"] = max(stats["total_invoiced"] - stats["total_paid"], 0.0)
        clients.append(_build_client_payload(client, stats))

    return jsonify({"clients": clients, "total": total_clients, "page": page})


@clients_bp.get("/<int:client_id>")
def get_client(client_id: int):
    client = Client.query.get_or_404(client_id)
    summary = _client_statistics(client.id)

    invoices = (
        Invoice.query.filter_by(client_id=client.id)
        .order_by(Invoice.invoice_date.desc(), Invoice.id.desc())
        .all()
    )
    invoice_history = [_serialize_invoice(inv) for inv in invoices]

    return jsonify(
        {
            "client": _build_client_payload(client, summary),
            "invoices": invoice_history,
            "financial_summary": summary,
        }
    )


@clients_bp.post("/")
def create_client():
    payload = request.get_json(force=True) or {}
    required_fields = ["company_name", "registration_code", "address"]
    missing = [field for field in required_fields if not payload.get(field)]
    if missing:
        return _error(f"Missing required fields: {', '.join(missing)}.")

    client_type = _parse_client_type(payload.get("client_type")) or ClientType.CLIENT
    if payload.get("client_type") and client_type is None:
        return _error("Invalid client_type. Allowed values: client, supplier.")

    client = Client(
        company_name=payload.get("company_name"),
        registration_code=payload.get("registration_code"),
        vat_code=payload.get("vat_code"),
        address=payload.get("address"),
        phone=payload.get("phone"),
        email=payload.get("email"),
        client_type=client_type,
    )

    db.session.add(client)
    db.session.commit()

    stats = _client_statistics(client.id)
    return jsonify(_build_client_payload(client, stats)), 201


@clients_bp.put("/<int:client_id>")
def update_client(client_id: int):
    client = Client.query.get_or_404(client_id)
    payload = request.get_json(force=True) or {}

    updatable_fields = [
        "company_name",
        "registration_code",
        "vat_code",
        "address",
        "phone",
        "email",
        "client_type",
    ]

    for field in updatable_fields:
        if field not in payload:
            continue
        value = payload.get(field)
        if field in {"company_name", "registration_code", "address"} and not value:
            return _error(f"Field {field} cannot be empty.")
        if field == "client_type":
            parsed_type = _parse_client_type(value)
            if parsed_type is None:
                return _error("Invalid client_type. Allowed values: client, supplier.")
            setattr(client, field, parsed_type)
        else:
            setattr(client, field, value)

    db.session.commit()

    stats = _client_statistics(client.id)
    return jsonify(_build_client_payload(client, stats))


@clients_bp.delete("/<int:client_id>")
def delete_client(client_id: int):
    client = Client.query.get_or_404(client_id)
    hard_delete = _parse_bool(request.args.get("hard"))

    invoice_count = Invoice.query.filter_by(client_id=client.id).count()
    if invoice_count and not hard_delete:
        return (
            jsonify(
                {
                    "deleted": False,
                    "warning": "Client has existing invoices. Use ?hard=true to force delete.",
                    "invoice_count": invoice_count,
                }
            ),
            409,
        )

    db.session.delete(client)
    db.session.commit()

    response = {"deleted": True, "hard_deleted": hard_delete, "invoice_count": invoice_count}
    if invoice_count and hard_delete:
        response["warning"] = "Client deleted even though invoices were present."
    return jsonify(response)


@clients_bp.get("/<int:client_id>/invoices")
def client_invoices(client_id: int):
    client = Client.query.get_or_404(client_id)
    args = request.args

    limit = _parse_int(args.get("limit"), DEFAULT_LIMIT, minimum=1, maximum=MAX_LIMIT)
    offset = _parse_int(args.get("offset"), 0, minimum=0)
    page = offset // limit + 1 if limit else 1

    status_param = args.get("status")
    status = _parse_invoice_status(status_param) if status_param else None
    if status_param and status is None:
        return _error("Invalid status. Allowed: draft, sent, paid, overdue.")

    start_date_raw = args.get("start_date")
    end_date_raw = args.get("end_date")
    start_date = _parse_date(start_date_raw) if start_date_raw else None
    end_date = _parse_date(end_date_raw) if end_date_raw else None
    if start_date_raw and start_date is None:
        return _error("Invalid start_date. Use ISO format (YYYY-MM-DD).")
    if end_date_raw and end_date is None:
        return _error("Invalid end_date. Use ISO format (YYYY-MM-DD).")

    query = Invoice.query.filter_by(client_id=client.id)
    if status:
        query = query.filter(Invoice.status == status)
    if start_date:
        query = query.filter(Invoice.invoice_date >= start_date)
    if end_date:
        query = query.filter(Invoice.invoice_date <= end_date)

    total = query.count()
    invoices = (
        query.order_by(Invoice.invoice_date.desc(), Invoice.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return jsonify({"invoices": [_serialize_invoice(inv) for inv in invoices], "total": total, "page": page})


@clients_bp.get("/<int:client_id>/statistics")
def client_statistics(client_id: int):
    client = Client.query.get_or_404(client_id)
    summary = _client_statistics(client.id)
    return jsonify(summary)


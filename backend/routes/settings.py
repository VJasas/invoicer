from __future__ import annotations

from flask import Blueprint, jsonify, request

from backend.database import db
from backend.models import BankAccount, CompanyInfo, InvoiceSeries, Setting

settings_bp = Blueprint("settings", __name__, url_prefix="/api/settings")


# ------------- helpers -------------
def _error(message: str, status_code: int = 400):
    return jsonify({"error": message}), status_code


def _parse_bool(value) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    value_str = str(value).strip().lower()
    return value_str in {"1", "true", "yes", "y", "on"}


def _validate_required(payload: dict, keys: list[str]) -> list[str]:
    return [key for key in keys if not payload.get(key)]


def _company_to_dict(company: CompanyInfo) -> dict:
    return {
        "id": company.id,
        "company_name": company.company_name,
        "tax_id": company.tax_id,
        "address": company.address,
        "phone": company.phone,
        "email": company.email,
        "created_at": company.created_at.isoformat() if company.created_at else None,
        "updated_at": company.updated_at.isoformat() if company.updated_at else None,
    }


def _bank_to_dict(account: BankAccount) -> dict:
    return {
        "id": account.id,
        "bank_name": account.bank_name,
        "account_number": account.account_number,
        "is_default": account.is_default,
        "company_id": account.company_id,
        "created_at": account.created_at.isoformat() if account.created_at else None,
    }


def _series_to_dict(series: InvoiceSeries) -> dict:
    return {
        "id": series.id,
        "series_code": series.series_code,
        "description": series.description,
        "current_number": series.current_number,
        "is_active": series.is_active,
    }


# ------------- company info -------------
@settings_bp.get("/company")
def get_company():
    company = CompanyInfo.get_singleton()
    if not company:
        return jsonify({})
    return jsonify(_company_to_dict(company))


@settings_bp.put("/company")
def update_company():
    payload = request.get_json(force=True) or {}
    required = ["company_name", "tax_id", "address", "email"]
    missing = _validate_required(payload, required)
    if missing:
        return _error(f"Missing required fields: {', '.join(missing)}.")

    company = CompanyInfo.get_singleton()
    if company is None:
        company = CompanyInfo()
        db.session.add(company)

    company.company_name = payload.get("company_name")
    company.tax_id = payload.get("tax_id")
    company.address = payload.get("address")
    company.phone = payload.get("phone")
    company.email = payload.get("email")

    db.session.commit()
    return jsonify(_company_to_dict(company))


# ------------- bank accounts -------------
@settings_bp.get("/bank-accounts")
def list_bank_accounts():
    accounts = (
        BankAccount.query.order_by(BankAccount.is_default.desc(), BankAccount.id.asc()).all()
    )
    return jsonify([_bank_to_dict(acc) for acc in accounts])


@settings_bp.post("/bank-accounts")
def create_bank_account():
    payload = request.get_json(force=True) or {}
    required = ["bank_name", "account_number"]
    missing = _validate_required(payload, required)
    if missing:
        return _error(f"Missing required fields: {', '.join(missing)}.")

    company = CompanyInfo.get_singleton()
    if company is None:
        return _error("Company information must be set before adding bank accounts.")

    if BankAccount.query.filter_by(account_number=payload.get("account_number")).first():
        return _error("Bank account number must be unique.", 409)

    is_default = _parse_bool(payload.get("is_default"))
    if is_default:
        BankAccount.query.filter_by(company_id=company.id, is_default=True).update(
            {"is_default": False}
        )

    account = BankAccount(
        company=company,
        bank_name=payload.get("bank_name"),
        account_number=payload.get("account_number"),
        is_default=is_default,
    )

    db.session.add(account)
    db.session.commit()
    return jsonify(_bank_to_dict(account)), 201


@settings_bp.put("/bank-accounts/<int:account_id>")
def update_bank_account(account_id: int):
    account = BankAccount.query.get_or_404(account_id)
    payload = request.get_json(force=True) or {}

    if "bank_name" in payload:
        account.bank_name = payload.get("bank_name") or account.bank_name
    if "account_number" in payload:
        new_number = payload.get("account_number")
        if not new_number:
            return _error("account_number cannot be empty.")
        existing = BankAccount.query.filter(
            BankAccount.account_number == new_number, BankAccount.id != account.id
        ).first()
        if existing:
            return _error("Bank account number must be unique.", 409)
        account.account_number = new_number

    if "is_default" in payload:
        is_default = _parse_bool(payload.get("is_default"))
        account.is_default = is_default
        if is_default:
            BankAccount.query.filter(
                BankAccount.company_id == account.company_id,
                BankAccount.id != account.id,
                BankAccount.is_default.is_(True),
            ).update({"is_default": False})

    db.session.commit()
    return jsonify(_bank_to_dict(account))


@settings_bp.delete("/bank-accounts/<int:account_id>")
def delete_bank_account(account_id: int):
    account = BankAccount.query.get_or_404(account_id)
    if account.is_default:
        return _error("Cannot delete the default bank account.", 409)

    db.session.delete(account)
    db.session.commit()
    return jsonify({"deleted": True, "id": account_id})


# ------------- invoice series -------------
@settings_bp.get("/series")
def list_series():
    series_list = InvoiceSeries.query.order_by(InvoiceSeries.series_code.asc()).all()
    return jsonify([_series_to_dict(series) for series in series_list])


@settings_bp.post("/series")
def create_series():
    payload = request.get_json(force=True) or {}
    required = ["series_code"]
    missing = _validate_required(payload, required)
    if missing:
        return _error(f"Missing required fields: {', '.join(missing)}.")

    if InvoiceSeries.query.filter_by(series_code=payload.get("series_code")).first():
        return _error("series_code must be unique.", 409)

    series = InvoiceSeries(
        series_code=payload.get("series_code"),
        description=payload.get("description"),
        is_active=_parse_bool(payload.get("is_active")) if "is_active" in payload else True,
    )

    db.session.add(series)
    db.session.commit()
    return jsonify(_series_to_dict(series)), 201


@settings_bp.put("/series/<int:series_id>")
def update_series(series_id: int):
    series = InvoiceSeries.query.get_or_404(series_id)
    payload = request.get_json(force=True) or {}

    if "current_number" in payload:
        return _error("current_number cannot be updated directly.")
    if "series_code" in payload:
        return _error("series_code cannot be changed once created.")

    if "description" in payload:
        series.description = payload.get("description")
    if "is_active" in payload:
        series.is_active = _parse_bool(payload.get("is_active"))

    db.session.commit()
    return jsonify(_series_to_dict(series))


# ------------- general settings -------------
@settings_bp.get("/general")
def get_general_settings():
    settings = Setting.query.all()
    return jsonify({setting.key: setting.value for setting in settings})


@settings_bp.put("/general")
def update_general_settings():
    payload = request.get_json(force=True) or {}
    for key, value in payload.items():
        Setting.set_value(key, str(value) if value is not None else None)
    db.session.commit()
    return get_general_settings()


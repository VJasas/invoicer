from __future__ import annotations

import enum
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import CheckConstraint, Index, UniqueConstraint
from sqlalchemy.ext.hybrid import hybrid_property

from backend.database import db


# Shared column definitions for money/quantity types to keep consistent precision.
MONEY = db.Numeric(precision=14, scale=2, asdecimal=True)
QUANTITY = db.Numeric(precision=14, scale=3, asdecimal=True)
PERCENT = db.Numeric(precision=5, scale=2, asdecimal=True)


def _to_decimal(value, default: Decimal = Decimal("0")) -> Decimal:
    """Best-effort conversion that keeps operations safe even with None/float inputs."""
    if value is None:
        return default
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (ValueError, TypeError):
        return default


class TimestampMixin:
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class ClientType(enum.Enum):
    CLIENT = "client"
    SUPPLIER = "supplier"


class InvoiceStatus(enum.Enum):
    DRAFT = "draft"
    SENT = "sent"
    PAID = "paid"
    OVERDUE = "overdue"


class CompanyInfo(TimestampMixin, db.Model):
    """Singleton table holding seller/company details."""

    __tablename__ = "company_info"

    id = db.Column(db.Integer, primary_key=True)
    company_name = db.Column(db.String(255), nullable=False)
    tax_id = db.Column(db.String(64), nullable=False)
    address = db.Column(db.Text, nullable=False)
    phone = db.Column(db.String(50))
    email = db.Column(db.String(255), nullable=False)

    bank_accounts = db.relationship(
        "BankAccount",
        back_populates="company",
        cascade="all, delete-orphan",
        lazy="select",
    )

    __table_args__ = (
        Index("ix_company_info_email", "email"),
    )

    @classmethod
    def get_singleton(cls) -> Optional["CompanyInfo"]:
        """Return the single company row (or None if not yet created)."""
        return cls.query.first()


class BankAccount(db.Model):
    __tablename__ = "bank_accounts"

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(
        db.Integer,
        db.ForeignKey("company_info.id"),
        nullable=False,
        index=True,
    )
    bank_name = db.Column(db.String(255), nullable=False)
    account_number = db.Column(db.String(64), nullable=False, unique=True)
    is_default = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    company = db.relationship("CompanyInfo", back_populates="bank_accounts")

    __table_args__ = (
        Index("ix_bank_accounts_default", "company_id", "is_default"),
    )

    def mark_as_default(self):
        """Mark this account as default for the company, unsetting others in-memory."""
        if not self.company:
            return
        for account in self.company.bank_accounts:
            account.is_default = account is self


class Client(TimestampMixin, db.Model):
    __tablename__ = "clients"

    id = db.Column(db.Integer, primary_key=True)
    company_name = db.Column(db.String(255), nullable=False)
    registration_code = db.Column(db.String(64), nullable=False)
    vat_code = db.Column(db.String(64))
    address = db.Column(db.Text, nullable=False)
    phone = db.Column(db.String(50))
    email = db.Column(db.String(255))
    client_type = db.Column(
        db.Enum(ClientType, name="client_type"),
        nullable=False,
        default=ClientType.CLIENT,
    )

    invoices = db.relationship(
        "Invoice",
        back_populates="client",
        cascade="all, delete",
        lazy="select",
    )

    __table_args__ = (
        Index("ix_clients_company_name", "company_name"),
        Index("ix_clients_registration_code", "registration_code"),
    )

    @hybrid_property
    def name(self) -> str:
        """Compatibility alias for legacy code expecting `.name`."""
        return self.company_name

    @name.setter
    def name(self, value: str) -> None:
        self.company_name = value

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "company_name": self.company_name,
            "registration_code": self.registration_code,
            "vat_code": self.vat_code,
            "address": self.address,
            "phone": self.phone,
            "email": self.email,
            "client_type": self.client_type.value if self.client_type else None,
        }


class InvoiceSeries(db.Model):
    __tablename__ = "invoice_series"

    id = db.Column(db.Integer, primary_key=True)
    series_code = db.Column(db.String(16), nullable=False, unique=True)
    description = db.Column(db.String(255))
    current_number = db.Column(db.Integer, nullable=False, default=0)
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    invoices = db.relationship("Invoice", back_populates="series", lazy="select")

    __table_args__ = (
        CheckConstraint(
            "current_number >= 0", name="ck_invoice_series_current_number_non_negative"
        ),
        Index("ix_invoice_series_active", "is_active"),
    )

    def next_number(self, *, commit: bool = False) -> int:
        """Increment and return the next invoice number in this series."""
        self.current_number = (self.current_number or 0) + 1
        if commit:
            db.session.flush()
        return self.current_number

    def format_full_number(self, number: int | str) -> str:
        return f"{self.series_code} {number}" if number is not None else self.series_code


class Invoice(TimestampMixin, db.Model):
    __tablename__ = "invoices"

    id = db.Column(db.Integer, primary_key=True)
    series_id = db.Column(
        db.Integer,
        db.ForeignKey("invoice_series.id"),
        nullable=False,
        index=True,
    )
    invoice_number = db.Column(db.Integer, nullable=False)
    full_invoice_number = db.Column(db.String(64), nullable=True, unique=True, index=True)
    client_id = db.Column(db.Integer, db.ForeignKey("clients.id"), nullable=False, index=True)
    invoice_date = db.Column(db.Date, nullable=False, default=date.today)
    due_date = db.Column(db.Date, nullable=False)
    status = db.Column(
        db.Enum(InvoiceStatus, name="invoice_status"),
        nullable=False,
        default=InvoiceStatus.DRAFT,
        index=True,
    )
    exclude_vat = db.Column(db.Boolean, nullable=False, default=False)
    subtotal = db.Column(MONEY, nullable=False, default=0)
    vat_amount = db.Column(MONEY, nullable=False, default=0)
    discount_amount = db.Column(MONEY, nullable=False, default=0)
    total = db.Column(MONEY, nullable=False, default=0)
    total_in_words = db.Column(db.String(255))
    notes = db.Column(db.Text)
    issued_by = db.Column(db.String(255))
    received_by = db.Column(db.String(255))

    series = db.relationship("InvoiceSeries", back_populates="invoices")
    client = db.relationship("Client", back_populates="invoices")
    items = db.relationship(
        "InvoiceItem",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceItem.sort_order",
        lazy="select",
    )

    __table_args__ = (
        UniqueConstraint(
            "series_id",
            "invoice_number",
            name="uq_invoice_series_invoice_number",
        ),
        CheckConstraint("subtotal >= 0", name="ck_invoice_subtotal_non_negative"),
        CheckConstraint("vat_amount >= 0", name="ck_invoice_vat_non_negative"),
        CheckConstraint("discount_amount >= 0", name="ck_invoice_discount_non_negative"),
        CheckConstraint("total >= 0", name="ck_invoice_total_non_negative"),
        CheckConstraint("due_date >= invoice_date", name="ck_invoice_due_after_issue"),
        Index("ix_invoices_invoice_date", "invoice_date"),
        Index("ix_invoices_due_date", "due_date"),
    )

    @hybrid_property
    def number(self) -> Optional[str]:
        """Compatibility alias for legacy code expecting `.number`."""
        return self.full_invoice_number or self._computed_full_invoice_number

    @number.setter
    def number(self, value: str) -> None:
        self.full_invoice_number = value

    @hybrid_property
    def issue_date(self) -> date:
        """Compatibility alias used by existing routes/templates."""
        return self.invoice_date

    @issue_date.setter
    def issue_date(self, value: date) -> None:
        self.invoice_date = value

    @property
    def _computed_full_invoice_number(self) -> Optional[str]:
        if self.series and self.invoice_number is not None:
            return self.series.format_full_number(self.invoice_number)
        return None

    def set_series_and_number(
        self, series: InvoiceSeries, invoice_number: Optional[int] = None
    ) -> None:
        """Assign a series and allocate an invoice number if missing."""
        self.series = series
        self.invoice_number = (
            invoice_number if invoice_number is not None else series.next_number()
        )
        self.full_invoice_number = series.format_full_number(self.invoice_number)

    def recalculate_totals(self, vat_rate: float | Decimal | None = None) -> Decimal:
        """Recalculate monetary totals from current items."""
        subtotal = sum((item.line_total for item in self.items), Decimal("0"))
        gross_total = sum((item.gross_total for item in self.items), Decimal("0"))
        discount_amount = gross_total - subtotal

        vat_rate_decimal = (
            Decimal(str(vat_rate)) if vat_rate is not None else Decimal("0")
        )
        vat_amount = Decimal("0") if self.exclude_vat else subtotal * vat_rate_decimal

        self.subtotal = subtotal
        self.discount_amount = max(discount_amount, Decimal("0"))
        self.vat_amount = max(vat_amount, Decimal("0"))
        self.total = self.subtotal + self.vat_amount
        return self.total

    def add_item(
        self,
        *,
        description: str,
        quantity: float | Decimal = 1,
        unit: str = "vnt",
        unit_price: float | Decimal = 0,
        discount_percent: float | Decimal = 0,
        sort_order: Optional[int] = None,
    ) -> "InvoiceItem":
        """Helper to append an invoice line with sane defaults."""
        if sort_order is None:
            sort_order = len(self.items or [])
        item = InvoiceItem(
            description=description,
            quantity=quantity,
            unit=unit,
            unit_price=unit_price,
            discount_percent=discount_percent,
            sort_order=sort_order,
        )
        self.items.append(item)
        return item


class InvoiceItem(db.Model):
    __tablename__ = "invoice_items"

    id = db.Column(db.Integer, primary_key=True)
    invoice_id = db.Column(
        db.Integer,
        db.ForeignKey("invoices.id"),
        nullable=False,
        index=True,
    )
    description = db.Column(db.String(255), nullable=False)
    quantity = db.Column(QUANTITY, nullable=False, default=1)
    unit = db.Column(db.String(32), nullable=False, default="vnt")
    unit_price = db.Column(MONEY, nullable=False, default=0)
    discount_percent = db.Column(PERCENT, nullable=False, default=0)
    sort_order = db.Column(db.Integer, default=0)

    invoice = db.relationship("Invoice", back_populates="items")

    __table_args__ = (
        CheckConstraint("quantity >= 0", name="ck_invoice_items_quantity_non_negative"),
        CheckConstraint(
            "unit_price >= 0", name="ck_invoice_items_unit_price_non_negative"
        ),
        CheckConstraint(
            "discount_percent >= 0", name="ck_invoice_items_discount_non_negative"
        ),
        CheckConstraint(
            "discount_percent <= 100", name="ck_invoice_items_discount_not_above_100"
        ),
    )

    @hybrid_property
    def gross_total(self) -> Decimal:
        return _to_decimal(self.quantity) * _to_decimal(self.unit_price)

    @gross_total.expression
    def gross_total(cls):
        return cls.quantity * cls.unit_price

    @hybrid_property
    def discount_value(self) -> Decimal:
        return self.gross_total * (_to_decimal(self.discount_percent) / Decimal("100"))

    @discount_value.expression
    def discount_value(cls):
        return (cls.quantity * cls.unit_price) * (cls.discount_percent / 100)

    @hybrid_property
    def line_total(self) -> Decimal:
        return self.gross_total - self.discount_value

    @line_total.expression
    def line_total(cls):
        return (cls.quantity * cls.unit_price) - (
            (cls.quantity * cls.unit_price) * (cls.discount_percent / 100)
        )


class Setting(db.Model):
    __tablename__ = "settings"

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(128), unique=True, nullable=False)
    value = db.Column(db.String(512))
    description = db.Column(db.String(255))

    def as_dict(self) -> dict:
        return {"key": self.key, "value": self.value, "description": self.description}

    @classmethod
    def get_value(cls, key: str, default=None):
        setting = cls.query.filter_by(key=key).first()
        return setting.value if setting else default

    @classmethod
    def set_value(cls, key: str, value: str, description: str | None = None) -> "Setting":
        setting = cls.query.filter_by(key=key).first()
        if setting is None:
            setting = cls(key=key)
            db.session.add(setting)
        setting.value = value
        if description is not None:
            setting.description = description
        return setting

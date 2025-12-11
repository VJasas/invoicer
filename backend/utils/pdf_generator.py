from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Iterable, Mapping, Sequence

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

MARGIN = 25 * mm  # 2.5 cm on each side


def format_date_lt(value: date | datetime | str | None) -> str:
    """Return a YYYY-MM-DD string (or an empty string)."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    try:
        parsed = datetime.fromisoformat(str(value))
        return parsed.date().isoformat()
    except ValueError:
        return str(value)


def format_number_lt(value, places: int = 2) -> str:
    """Format number with Lithuanian separators (comma for decimals, space for thousands)."""
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return ""
    formatted = format(number, f",.{places}f")
    return formatted.replace(",", " ").replace(".", ",")


def format_currency_lt(value) -> str:
    """Format monetary value with Lithuanian number formatting and the euro symbol."""
    formatted = format_number_lt(value, 2)
    return f"{formatted} €" if formatted else "€"


def format_address_lt(value: str | Mapping | None) -> str:
    """Best-effort address formatter that joins common parts with commas."""
    if value is None:
        return ""
    if isinstance(value, Mapping):
        parts: Iterable[str] = value.values()
    else:
        if isinstance(value, str):
            cleaned = " ".join(value.split())
            return cleaned.strip().strip(",")
        parts = [str(value)]
    parts = [str(part).strip().strip(",") for part in parts if part]
    return ", ".join(filter(None, parts))


def _ensure_style(styles, name: str, **kwargs) -> ParagraphStyle:
    """Add a style if missing and return it."""
    existing = getattr(styles, "byName", {}).get(name)
    if existing:
        return existing
    style = ParagraphStyle(name=name, **kwargs)
    styles.add(style)
    return style


def _party_lines(info: Mapping) -> list[str]:
    lines: list[str] = []
    name = info.get("name") or info.get("company_name")
    if name:
        lines.append(str(name))

    tax_id = info.get("tax_id")
    code = info.get("code")
    vat_code = info.get("vat_code")

    identifiers: list[str] = []
    if code:
        identifiers.append(f"Kodas: {code}")
    if tax_id:
        identifiers.append(f"Mokest. kodas: {tax_id}")
    if vat_code:
        identifiers.append(f"PVM kodas: {vat_code}")
    if identifiers:
        lines.append(", ".join(identifiers))

    address = format_address_lt(info.get("address"))
    if address:
        lines.append(address)

    phone = info.get("phone")
    email = info.get("email")
    bank_account = info.get("bank_account")
    if phone:
        lines.append(f"Tel.: {phone}")
    if email:
        lines.append(str(email))
    if bank_account:
        lines.append(f"Banko sąsk.: {bank_account}")

    return lines


def _party_paragraph(title: str, info: Mapping, body_style: ParagraphStyle) -> Paragraph:
    lines = _party_lines(info or {})
    details = "<br/>".join(lines) if lines else ""
    html = f"<b>{title}</b><br/>{details}" if details else f"<b>{title}</b>"
    return Paragraph(html, body_style)


def _build_items_table(
    items: Sequence[Mapping], body_style: ParagraphStyle, width: float
) -> Table:
    data: list[list] = [
        [
            Paragraph("<b>Pavadinimas</b>", body_style),
            Paragraph("<b>Kiekis</b>", body_style),
            Paragraph("<b>Matas</b>", body_style),
            Paragraph("<b>Kaina</b>", body_style),
            Paragraph("<b>Iš viso</b>", body_style),
        ]
    ]

    for item in items or []:
        data.append(
            [
                Paragraph(str(item.get("description", "")), body_style),
                Paragraph(format_number_lt(item.get("quantity"), 3), body_style),
                Paragraph(str(item.get("unit", "")), body_style),
                Paragraph(format_currency_lt(item.get("unit_price")), body_style),
                Paragraph(format_currency_lt(item.get("line_total")), body_style),
            ]
        )

    col_widths = [
        width * 0.36,
        width * 0.12,
        width * 0.12,
        width * 0.2,
        width * 0.2,
    ]

    table = Table(data, colWidths=col_widths, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f2f2f2")),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#c8c8c8")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
                ("TOPPADDING", (0, 0), (-1, 0), 6),
            ]
        )
    )
    return table


def _totals_section(
    total,
    total_in_words: str,
    body_style: ParagraphStyle,
    right_style: ParagraphStyle,
    width: float,
) -> list:
    totals_table = Table(
        [
            [Paragraph("<b>Bendra suma</b>", body_style), Paragraph(format_currency_lt(total), right_style)],
        ],
        colWidths=[width * 0.6, width * 0.4],
        hAlign="LEFT",
    )
    totals_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.black),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )

    amount_words = Paragraph(
        f"Suma žodžiais: {total_in_words or ''}", body_style
    )
    return [totals_table, Spacer(1, 4 * mm), amount_words]


def generate_invoice_pdf(invoice_data, output_path=None):
    """
    Generate PDF invoice from invoice data

    Args:
        invoice_data: dict with structure:
            {
                'series_code': str,
                'invoice_number': int,
                'invoice_date': date,
                'due_date': date,
                'seller': {name, tax_id, address, phone, email, bank_account},
                'buyer': {company_name, code, vat_code, address, phone, email},
                'items': [
                    {description, quantity, unit, unit_price, line_total}
                ],
                'total': decimal,
                'total_in_words': str,
                'issued_by': str,
                'received_by': str or None
            }
        output_path: str, optional path to save PDF

    Returns:
        bytes: PDF file content if output_path is None
        or
        str: file path if output_path is provided
    """

    buffer = BytesIO()
    target = buffer if output_path is None else output_path

    doc = SimpleDocTemplate(
        target,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
    )

    styles = getSampleStyleSheet()
    body_style = _ensure_style(
        styles,
        "InvoiceBody",
        fontName="Helvetica",
        fontSize=10,
        leading=13,
        alignment=TA_LEFT,
    )
    right_style = _ensure_style(
        styles,
        "InvoiceRight",
        parent=body_style,
        alignment=TA_RIGHT,
    )
    center_style = _ensure_style(
        styles,
        "InvoiceCenter",
        parent=body_style,
        alignment=TA_CENTER,
    )
    title_style = _ensure_style(
        styles,
        "InvoiceTitle",
        parent=body_style,
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        alignment=TA_CENTER,
    )
    subtitle_style = _ensure_style(
        styles,
        "InvoiceSubtitle",
        parent=body_style,
        fontName="Helvetica-Bold",
        fontSize=12,
        alignment=TA_CENTER,
    )

    story: list = []

    story.append(Paragraph("SĄSKAITA FAKTŪRA", title_style))
    story.append(Spacer(1, 6 * mm))

    series_code = invoice_data.get("series_code") or ""
    invoice_number = invoice_data.get("invoice_number") or ""
    story.append(
        Paragraph(f"Serija {series_code} Nr. {invoice_number}", subtitle_style)
    )
    story.append(Spacer(1, 8 * mm))

    date_table = Table(
        [
            [
                Paragraph("Sąskaitos data", body_style),
                Paragraph(format_date_lt(invoice_data.get("invoice_date")), right_style),
            ],
            [
                Paragraph("Apmokėti iki", body_style),
                Paragraph(format_date_lt(invoice_data.get("due_date")), right_style),
            ],
        ],
        colWidths=[doc.width * 0.35, doc.width * 0.25],
        hAlign="LEFT",
    )
    date_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(date_table)
    story.append(Spacer(1, 10 * mm))

    seller_info = invoice_data.get("seller") or {}
    buyer_info = invoice_data.get("buyer") or {}
    parties_table = Table(
        [
            [
                _party_paragraph("Pardavėjas", seller_info, body_style),
                _party_paragraph("Pirkėjas", buyer_info, body_style),
            ]
        ],
        colWidths=[doc.width / 2 - 5 * mm, doc.width / 2 - 5 * mm],
        hAlign="LEFT",
    )
    parties_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(parties_table)
    story.append(Spacer(1, 10 * mm))

    story.append(_build_items_table(invoice_data.get("items", []), body_style, doc.width))
    story.append(Spacer(1, 8 * mm))

    totals = _totals_section(
        invoice_data.get("total", 0),
        invoice_data.get("total_in_words", ""),
        body_style,
        right_style,
        doc.width,
    )
    story.extend(totals)
    story.append(Spacer(1, 12 * mm))

    issued_by = invoice_data.get("issued_by") or "__________________"
    received_by = invoice_data.get("received_by") or "__________________"
    footer_table = Table(
        [
            [
                Paragraph("Sąskaitą išrašė:", body_style),
                Paragraph("Sąskaitą priėmė:", body_style),
            ],
            [
                Paragraph(str(issued_by), body_style),
                Paragraph(str(received_by), body_style),
            ],
        ],
        colWidths=[doc.width / 2, doc.width / 2],
        hAlign="LEFT",
    )
    footer_table.setStyle(
        TableStyle(
            [
                ("ALIGN", (0, 0), (-1, 0), "LEFT"),
                ("ALIGN", (0, 1), (-1, 1), "LEFT"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(footer_table)

    doc.build(story)

    if output_path is not None:
        return output_path

    buffer.seek(0)
    return buffer.getvalue()



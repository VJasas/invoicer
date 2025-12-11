from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path
from typing import Iterable, Mapping, Sequence

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

H_MARGIN = 12.5 * mm  # reduced side margins for more width
V_MARGIN = 25 * mm
PRIMARY_FONT = "Arial"
FALLBACK_FONT = "Helvetica"
HEADER_BG = colors.HexColor("#f5f5f5")
GRID_COLOR = colors.HexColor("#dcdcdc")
TEXT_COLOR = colors.HexColor("#222222")


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


def _party_lines(info: Mapping, bold_font: str | None = None) -> list[str]:
    lines: list[str] = []
    name = info.get("name") or info.get("company_name")
    if name:
        if bold_font:
            lines.append(f'<font name="{bold_font}">{name}</font>')
        else:
            lines.append(f"<b>{name}</b>")

    tax_id = info.get("tax_id")
    code = info.get("code")
    vat_code = info.get("vat_code")

    if code:
        lines.append(f"Įmonės kodas: {code}")
    if tax_id:
        lines.append(f"PVM mok. kodas: {tax_id}")
    if vat_code:
        lines.append(f"PVM mok. kodas: {vat_code}")

    address = format_address_lt(info.get("address"))
    if address:
        lines.append(f"Adresas: {address}")

    phone = info.get("phone")
    email = info.get("email")
    bank_account = info.get("bank_account")
    if phone:
        lines.append(f"Numeris: {phone}")
    if email:
        lines.append(f"El. p. adresas: {email}")
    if bank_account:
        lines.append(f"Banko sąskaita: {bank_account}")

    return lines


def _party_paragraph(title: str, info: Mapping, body_style: ParagraphStyle, bold_font: str) -> Paragraph:
    title_html = f'<font name="{bold_font}">{title}</font>'
    lines = _party_lines(info or {}, bold_font)
    details = "<br/>".join(lines) if lines else ""
    html = f"{title_html}<br/>{details}" if details else title_html
    return Paragraph(html, body_style)


def _build_items_table(
    items: Sequence[Mapping], body_style: ParagraphStyle, width: float
) -> Table:
    registered = set(pdfmetrics.getRegisteredFontNames())
    header_font = (
        body_style.fontName + "-Bold"
        if body_style.fontName + "-Bold" in registered
        else (FALLBACK_FONT + "-Bold" if FALLBACK_FONT + "-Bold" in registered else body_style.fontName)
    )
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

    col_widths = [width * 0.44, width * 0.12, width * 0.12, width * 0.16, width * 0.16]

    table = Table(data, colWidths=col_widths, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, 0), header_font),
                ("FONTNAME", (0, 1), (-1, -1), body_style.fontName),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("TEXTCOLOR", (0, 0), (-1, -1), TEXT_COLOR),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
                ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
                ("GRID", (0, 0), (-1, -1), 0.4, GRID_COLOR),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
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
    registered = set(pdfmetrics.getRegisteredFontNames())
    bold_font = (
        body_style.fontName + "-Bold"
        if body_style.fontName + "-Bold" in registered
        else (FALLBACK_FONT + "-Bold" if FALLBACK_FONT + "-Bold" in registered else body_style.fontName)
    )
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
                ("FONTNAME", (0, 0), (-1, -1), bold_font),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("LINEABOVE", (0, 0), (-1, 0), 0.6, colors.black),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )

    amount_words = Paragraph(
        f"Suma žodžiais: {total_in_words or ''}", body_style
    )
    return [totals_table, Spacer(1, 4 * mm), amount_words]


def _signature_section(body_style: ParagraphStyle, width: float, issued_by: str, received_by: str) -> Table:
    line = "_" * 28
    left_value = issued_by or line
    right_value = received_by or line
    table = Table(
        [
            [Paragraph("Sąskaitą išrašė:", body_style), Paragraph("Sąskaitą priėmė:", body_style)],
            [Paragraph(left_value, body_style), Paragraph(right_value, body_style)],
        ],
        colWidths=[width / 2, width / 2],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("ALIGN", (0, 0), (-1, 0), "LEFT"),
                ("ALIGN", (0, 1), (-1, 1), "LEFT"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def _register_primary_font() -> tuple[str, str]:
    """Register Arial if available; return (body_font, bold_font)."""
    # If already registered, reuse.
    registered = set(pdfmetrics.getRegisteredFontNames())
    if PRIMARY_FONT in registered:
        bold_name = PRIMARY_FONT + "-Bold" if PRIMARY_FONT + "-Bold" in registered else FALLBACK_FONT + "-Bold"
        return PRIMARY_FONT, bold_name

    candidates = [
        (PRIMARY_FONT, ["Arial.ttf", "/Library/Fonts/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf", "C:/Windows/Fonts/arial.ttf"]),
        (PRIMARY_FONT + "-Bold", ["Arial Bold.ttf", "Arial-Bold.ttf", "/Library/Fonts/Arial Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "C:/Windows/Fonts/arialbd.ttf"]),
    ]
    for name, paths in candidates:
        for p in paths:
            path_obj = Path(p)
            if path_obj.exists():
                try:
                    pdfmetrics.registerFont(TTFont(name, str(path_obj)))
                    break
                except Exception:
                    continue

    registered = set(pdfmetrics.getRegisteredFontNames())
    body_font = PRIMARY_FONT if PRIMARY_FONT in registered else FALLBACK_FONT
    bold_font = (
        PRIMARY_FONT + "-Bold"
        if PRIMARY_FONT + "-Bold" in registered
        else (FALLBACK_FONT + "-Bold" if FALLBACK_FONT + "-Bold" in registered else FALLBACK_FONT)
    )
    return body_font, bold_font


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
        leftMargin=H_MARGIN,
        rightMargin=H_MARGIN,
        topMargin=V_MARGIN,
        bottomMargin=V_MARGIN,
    )

    body_font, bold_font = _register_primary_font()

    styles = getSampleStyleSheet()
    body_style = _ensure_style(
        styles,
        "InvoiceBody",
        fontName=body_font,
        fontSize=10,
        leading=13,
        alignment=TA_LEFT,
        textColor=TEXT_COLOR,
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
        fontName=bold_font,
        fontSize=18,
        leading=22,
        alignment=TA_CENTER,
    )
    subtitle_style = _ensure_style(
        styles,
        "InvoiceSubtitle",
        parent=body_style,
        fontName=bold_font,
        fontSize=12,
        alignment=TA_CENTER,
    )

    story: list = []

    story.append(Paragraph("SĄSKAITA FAKTŪRA", title_style))
    story.append(Spacer(1, 5 * mm))

    series_code = invoice_data.get("series_code") or ""
    invoice_number = invoice_data.get("invoice_number") or ""
    story.append(
        Paragraph(f"Serija {series_code} Nr. {invoice_number}", subtitle_style)
    )
    story.append(Spacer(1, 6 * mm))

    date_lines = [
        Paragraph(f"Sąskaitos data: {format_date_lt(invoice_data.get('invoice_date'))}", center_style),
        Paragraph(f"Apmokėti iki: {format_date_lt(invoice_data.get('due_date'))}", center_style),
    ]
    story.extend(date_lines)
    story.append(Spacer(1, 8 * mm))

    seller_info = invoice_data.get("seller") or {}
    buyer_info = invoice_data.get("buyer") or {}
    parties_table = Table(
        [
            [
                _party_paragraph("Pardavėjas", seller_info, body_style, bold_font),
                _party_paragraph("Pirkėjas", buyer_info, body_style, bold_font),
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
                ("TEXTCOLOR", (0, 0), (-1, -1), TEXT_COLOR),
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

    issued_by = str(invoice_data.get("issued_by") or "").strip()
    received_by = str(invoice_data.get("received_by") or "").strip()
    signature_table = _signature_section(body_style, doc.width, issued_by, received_by)
    story.append(signature_table)

    doc.build(story)

    if output_path is not None:
        return output_path

    buffer.seek(0)
    return buffer.getvalue()



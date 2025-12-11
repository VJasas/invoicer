"""Lithuanian number-to-words utilities."""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

# Base words (masculine/neuter counting forms used for currencies).
ONE_TO_NINETEEN = [
    "nulis",
    "vienas",
    "du",
    "trys",
    "keturi",
    "penki",
    "šeši",
    "septyni",
    "aštuoni",
    "devyni",
    "dešimt",
    "vienuolika",
    "dvylika",
    "trylika",
    "keturiolika",
    "penkiolika",
    "šešiolika",
    "septyniolika",
    "aštuoniolika",
    "devyniolika",
]

TENS = [
    "",
    "",
    "dvidešimt",
    "trisdešimt",
    "keturiasdešimt",
    "penkiasdešimt",
    "šešiasdešimt",
    "septyniasdešimt",
    "aštuoniasdešimt",
    "devyniasdešimt",
]

HUNDREDS = [
    "",
    "vienas šimtas",
    "du šimtai",
    "trys šimtai",
    "keturi šimtai",
    "penki šimtai",
    "šeši šimtai",
    "septyni šimtai",
    "aštuoni šimtai",
    "devyni šimtai",
]

# Each tuple: singular, plural nominative (2-9), plural genitive (0 or 10-20).
SCALE_FORMS = [
    ("", "", ""),
    ("tūkstantis", "tūkstančiai", "tūkstančių"),
    ("milijonas", "milijonai", "milijonų"),
    ("milijardas", "milijardai", "milijardų"),
]


def _choose_scale_form(number: int, forms: tuple[str, str, str]) -> str:
    last_two = number % 100
    last_one = number % 10
    if 10 < last_two < 20:
        return forms[2]
    if last_one == 1:
        return forms[0]
    if 2 <= last_one <= 9:
        return forms[1]
    return forms[2]


def _chunk_to_words(chunk: int) -> str:
    """Convert a number between 0 and 999 to words."""
    words: list[str] = []

    hundreds = chunk // 100
    remainder = chunk % 100

    if hundreds:
        words.append(HUNDREDS[hundreds])

    if remainder:
        if remainder < 20:
            words.append(ONE_TO_NINETEEN[remainder])
        else:
            tens = remainder // 10
            ones = remainder % 10
            tens_word = TENS[tens]
            if tens_word:
                words.append(tens_word)
            if ones:
                words.append(ONE_TO_NINETEEN[ones])

    return " ".join(words)


def integer_to_lithuanian_words(number: int) -> str:
    """
    Convert an integer to Lithuanian words using neutral/masculine forms.
    """
    if number == 0:
        return ONE_TO_NINETEEN[0]
    if number < 0:
        return f"minus {integer_to_lithuanian_words(abs(number))}"

    parts: list[str] = []
    remaining = number
    scale_idx = 0

    while remaining > 0:
        chunk = remaining % 1000
        if chunk:
            if scale_idx >= len(SCALE_FORMS):
                raise ValueError("Number too large to convert to words.")
            chunk_words = _chunk_to_words(chunk)
            scale_forms = SCALE_FORMS[scale_idx]
            if scale_idx > 0:
                chunk_words = f"{chunk_words} {_choose_scale_form(chunk, scale_forms)}"
            parts.append(chunk_words)
        remaining //= 1000
        scale_idx += 1

    return " ".join(reversed(parts))


def amount_to_lithuanian_words(amount: float) -> str:
    """
    Convert amount in euros (float or Decimal-compatible) to Lithuanian words.
    """
    try:
        quantized = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        raise ValueError("Amount must be a valid number.") from None

    if quantized < 0:
        raise ValueError("Amount cannot be negative.")

    euros = int(quantized // 1)
    cents = int((quantized - Decimal(euros)) * 100)

    euros_words = integer_to_lithuanian_words(euros)
    cents_words = integer_to_lithuanian_words(cents)

    return f"{euros_words} EUR ir {cents_words} ct"


def number_to_words_lt(number: int) -> str:
    """
    Backwards-compatible helper for integer-only conversions.
    """
    return integer_to_lithuanian_words(number)

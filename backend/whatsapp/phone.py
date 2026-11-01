"""Phone-number normalisation for WhatsApp.

WhatsApp wants bare international digits (963980549953). Customers get typed in however the
shop happens to write them (+963 980 549 953, 0980549953, 00963980549953), so every number goes
through normalise(), which refuses to guess rather than send to the wrong person.
"""
import re
from urllib.parse import quote


class InvalidPhoneNumber(ValueError):
    """The number cannot be turned into an international one."""


def normalise(raw: str, country_code: str = "963") -> str:
    if raw is None or not str(raw).strip():
        raise InvalidPhoneNumber("لا يوجد رقم هاتف.")
    text = str(raw).strip()
    had_plus = text.startswith("+")
    digits = re.sub(r"\D", "", text)
    if not digits:
        raise InvalidPhoneNumber(f"الرقم «{raw}» لا يحتوي على أرقام.")
    country = re.sub(r"\D", "", str(country_code or ""))

    if had_plus:
        pass
    elif digits.startswith("00"):
        digits = digits[2:]
    elif digits.startswith("0"):
        digits = country + digits.lstrip("0")  # trunk zero -> country code
    elif country and digits.startswith(country):
        pass
    elif len(digits) <= 10:
        digits = country + digits  # a bare local number

    if not 8 <= len(digits) <= 15:
        raise InvalidPhoneNumber(f"الرقم «{raw}» ليس رقماً دولياً صالحاً.")
    return digits


def wa_me_url(raw: str, body: str = "", country_code: str = "963") -> str:
    """Click-to-chat link: opens WhatsApp with the text filled in. Needs no linked session."""
    url = f"https://wa.me/{normalise(raw, country_code)}"
    return f"{url}?text={quote(body)}" if body else url

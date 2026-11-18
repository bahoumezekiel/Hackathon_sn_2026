"""Textes des SMS : un seul segment (160 caractères, alphabet GSM de base, sans accents).

Au-delà, le SMS est découpé en plusieurs parties ; avec des accents il passe en
Unicode (70 caractères par partie). Vers le Burkina Faso, Twilio prévient que la
concaténation n'est pas garantie selon l'expéditeur et l'encodage : un message
déclaré « livré » peut ne jamais s'afficher. Un segment unique coûte aussi 4 fois moins.
"""
import unicodedata

MAX = 160
_PUNCT = str.maketrans({"«": '"', "»": '"', "“": '"', "”": '"', "’": "'", "‘": "'",
                        "–": "-", "—": "-", "•": "*", "…": "...", " ": " ", " ": " "})


def to_gsm(text: str) -> str:
    """« Vérification » -> "Verification" : ASCII pur, compatible avec tous les téléphones."""
    text = unicodedata.normalize("NFKD", text.translate(_PUNCT))
    return "".join(ch for ch in text if ch.isascii() and not unicodedata.combining(ch))


def fit(text: str) -> str:
    text = to_gsm(text)
    return text if len(text) <= MAX else text[:MAX - 3].rstrip() + "..."


def _cut(text: str, size: int) -> str:
    return text if len(text) <= size else text[:max(size - 3, 0)].rstrip() + "..."


def consent_request(admin: str, registry: str, purpose: str, minutes: int) -> str:
    """Demande d'accord. Si c'est trop long, on raccourcit d'abord le motif, puis le nom de
    l'administration ; la consigne « 1=OUI / 2=NON » n'est jamais coupée."""
    tail = f". Repondez 1=OUI ou 2=NON (sous {minutes} min, sinon refus)."
    admin, registry, purpose = to_gsm(admin), to_gsm(registry).lower(), to_gsm(purpose)
    head = f"FasoLink: {admin} demande votre {registry}"
    room = MAX - len(head) - len(tail) - 3          # « ( » + « ) » + espace
    if room >= 12:
        return f"{head} ({_cut(purpose, room)}){tail}"
    # Pas de place pour le motif : on raccourcit le nom de l'administration
    fixed = len("FasoLink:  demande votre ") + len(registry) + len(tail)
    return f"FasoLink: {_cut(admin, MAX - fixed)} demande votre {registry}{tail}"

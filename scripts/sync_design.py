"""Copie le design system partagé (design/) dans chaque portail.

Chaque portail est construit par Docker avec son propre dossier comme contexte :
il ne peut pas importer ../design. La source unique reste design/ ; ce script
en dépose une copie identique dans chaque application.

    python scripts/sync_design.py          # copie
    python scripts/sync_design.py --check  # échoue si une copie a divergé
"""
import filecmp
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / "design"
PORTALS = ["portal-agent", "portal-citizen", "portal-supervision"]

# fichier source (relatif à design/) -> destination (relative à <portail>/src/)
FILES = {
    "tokens.css": "styles/tokens.css",
    "StatusPill.jsx": "components/ui/StatusPill.jsx",
    "StatusPill.css": "components/ui/StatusPill.css",
    "Logo.jsx": "components/ui/Logo.jsx",
}
FONTS = sorted((DESIGN / "fonts").iterdir())


# Thème de connexion Keycloak : mêmes jetons et mêmes polices que les portails
KEYCLOAK_CSS = ROOT / "infra" / "keycloak" / "themes" / "fasolink" / "login" / "resources" / "css"


def pairs():
    for portal in PORTALS:
        src_dir = ROOT / portal / "src"
        for src, dst in FILES.items():
            yield DESIGN / src, src_dir / dst
        for font in FONTS:
            yield font, src_dir / "styles" / "fonts" / font.name
    yield DESIGN / "tokens.css", KEYCLOAK_CSS / "tokens.css"
    for font in FONTS:
        yield font, KEYCLOAK_CSS / "fonts" / font.name


def main() -> int:
    check = "--check" in sys.argv
    stale = []
    for src, dst in pairs():
        if dst.exists() and filecmp.cmp(src, dst, shallow=False):
            continue
        if check:
            stale.append(dst.relative_to(ROOT))
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        print(f"copié  {dst.relative_to(ROOT)}")
    if check and stale:
        print("Copies non synchronisées avec design/ :", *stale, sep="\n  ")
        return 1
    print("Design system à jour dans les 3 portails et le thème Keycloak.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

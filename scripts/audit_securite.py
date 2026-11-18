"""Audit de sécurité de FasoLink avec trois outils open source, exécutés dans Docker.

    python scripts/audit_securite.py                 # les trois analyses
    python scripts/audit_securite.py gitleaks semgrep
    python scripts/audit_securite.py zap             # plateforme démarrée (docker compose up)

  gitleaks  secrets dans l'historique git de la branche et dans les fichiers (.gitleaks.toml)
  semgrep   analyse statique du code : Python, JavaScript/React, Docker, nginx, OWASP Top 10
  zap       OWASP ZAP contre la plateforme en marche : scan de base des trois portails,
            scan actif de l'API à partir de sa description OpenAPI (infra/zap/regles.tsv)

Rien n'est installé sur le poste : seul Docker est nécessaire. Les rapports sont écrits dans
rapports-securite/ (non versionné). Code de sortie 0 si aucune analyse ne signale de problème.
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORTS = ROOT / "rapports-securite"

GITLEAKS = "zricethezav/gitleaks:v8.28.0"
SEMGREP = "semgrep/semgrep:1.140.0"
ZAP = "zaproxy/zap-stable:2.16.1"

SEMGREP_RULESETS = ("p/python", "p/fastapi", "p/javascript", "p/react", "p/dockerfile",
                    "p/docker-compose", "p/nginx", "p/secrets", "p/owasp-top-ten")
PORTALS = ("portal-agent", "portal-citizen", "portal-supervision")


def docker(*args: str) -> int:
    return subprocess.run(["docker", "run", "--rm", *args], check=False).returncode


def title(text: str) -> None:
    print(f"\n=== {text} ===", flush=True)


def gitleaks() -> bool:
    title("Gitleaks : secrets")
    repo = ["-v", f"{ROOT}:/repo", "-v", f"{REPORTS}:/out", GITLEAKS]
    common = ["--config", "/repo/.gitleaks.toml", "--redact", "--no-banner"]
    history = docker(*repo, "git", "/repo", "--log-opts=HEAD", *common,
                     "--report-path", "/out/gitleaks-historique.json")
    files = docker(*repo, "dir", "/repo", *common, "--report-path", "/out/gitleaks-fichiers.json")
    return history == 0 and files == 0


def semgrep() -> bool:
    title("Semgrep CE : analyse statique")
    configs = [arg for ruleset in SEMGREP_RULESETS for arg in ("--config", ruleset)]
    code = docker("-v", f"{ROOT}:/src", "-w", "/src", SEMGREP,
                  "semgrep", "scan", *configs, "--metrics=off", "--error",
                  "--json-output=rapports-securite/semgrep.json")
    return code == 0


def _compose_network() -> str | None:
    """Réseau Docker de la plateforme, pour que ZAP joigne les services par leur nom."""
    container = subprocess.run(["docker", "compose", "ps", "-q", "gateway"], cwd=ROOT,
                               capture_output=True, text=True, check=False).stdout.strip()
    if not container:
        return None
    return subprocess.run(["docker", "inspect", "-f",
                           "{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}", container],
                          capture_output=True, text=True, check=False).stdout.strip() or None


def zap() -> bool:
    title("OWASP ZAP : scan dynamique")
    network = _compose_network()
    if not network:
        print("La plateforme ne tourne pas : lancez d'abord « docker compose up -d --build ».")
        return False
    # ZAP lit sa configuration et écrit ses rapports dans /zap/wrk
    shutil.copy(ROOT / "infra" / "zap" / "regles.tsv", REPORTS / "regles.tsv")
    base = ["--network", network, "-u", "root", "-v", f"{REPORTS}:/zap/wrk:rw", ZAP]
    ok = True
    for portal in PORTALS:
        print(f"\n--- {portal}", flush=True)
        # 0 : rien à signaler ; 2 : avertissements ; 1 : échec
        code = docker(*base, "zap-baseline.py", "-t", f"http://{portal}", "-c", "regles.tsv",
                      "-r", f"zap-{portal}.html", "-s")
        ok &= code == 0
    print("\n--- API de la passerelle", flush=True)
    code = docker(*base, "zap-api-scan.py", "-t", "http://gateway:8000/openapi.json", "-f", "openapi",
                  "-c", "regles.tsv", "-r", "zap-api.html", "-s")
    return ok and code == 0


ANALYSES = {"gitleaks": gitleaks, "semgrep": semgrep, "zap": zap}


def main() -> int:
    chosen = sys.argv[1:] or list(ANALYSES)
    unknown = [name for name in chosen if name not in ANALYSES]
    if unknown:
        print(f"Analyse inconnue : {', '.join(unknown)} (choix : {', '.join(ANALYSES)})")
        return 2
    REPORTS.mkdir(exist_ok=True)
    REPORTS.chmod(0o777)   # les conteneurs n'écrivent pas tous sous l'utilisateur courant
    results = {name: ANALYSES[name]() for name in chosen}

    title("Bilan")
    for name, ok in results.items():
        print(f"  {'OK   ' if ok else 'ÉCHEC'}  {name}")
    print(f"\nRapports : {REPORTS}")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())

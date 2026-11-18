"""Routes HTTP de la passerelle, regroupées par espace (un routeur par rôle)."""
from . import administration, citoyen, demonstration, operateurs, public, referentiel, supervision

# Ordre d'affichage dans la documentation Swagger
ROUTERS = (public.router, operateurs.router, administration.router, citoyen.router,
           supervision.router, referentiel.router, demonstration.router)

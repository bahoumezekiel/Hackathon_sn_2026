# Image d'un portail FasoLink. Construction : --build-arg APP=agent (citizen, supervision…)
FROM node:24-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
ARG APP
ARG VITE_KEYCLOAK_URL=http://localhost:8080
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL
RUN npm run build -w "$APP"

FROM nginx:1.30-alpine
ARG APP
# Les fichiers de templates/ reçoivent les variables d'environnement au démarrage (KEYCLOAK_URL)
COPY nginx/ /etc/nginx/templates/
COPY --from=build /app/$APP/dist /usr/share/nginx/html
EXPOSE 80

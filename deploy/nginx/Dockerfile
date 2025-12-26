FROM nginx:1.27-alpine

# envsubst is provided by gettext
RUN apk add --no-cache gettext

COPY deploy/nginx/default.http.conf.template /etc/nginx/templates/default.http.conf.template
COPY deploy/nginx/default.https.conf.template /etc/nginx/templates/default.https.conf.template
COPY deploy/nginx/docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]

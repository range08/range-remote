FROM nginxinc/nginx-unprivileged:alpine@sha256:b54ac358b83fc6c965793fd271839b4ea4cdb6e99895bb19618cbc2ca152d972

COPY apps/gateway/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/gateway/proxy_params /etc/nginx/proxy_params

RUN nginx -t

EXPOSE 8080

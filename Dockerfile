FROM nginx:alpine
COPY public/ /usr/share/nginx/html/
# Replaces the stock default.conf — see nginx.conf for why the cache policy matters.
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

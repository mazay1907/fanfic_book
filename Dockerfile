FROM nginx:1.27-alpine

# Railway задаёт PORT; официальный образ nginx подставляет его в шаблон при старте
COPY templates/default.conf.template /etc/nginx/templates/default.conf.template
COPY site/ /usr/share/nginx/html/

ENV PORT=8080
EXPOSE 8080

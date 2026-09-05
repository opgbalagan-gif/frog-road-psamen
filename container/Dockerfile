FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/
# Keep the build context small; expand legacy-browser fallbacks inside the image.
RUN for file in /usr/share/nginx/html/*.gz; do gzip -dk "$file"; done
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
